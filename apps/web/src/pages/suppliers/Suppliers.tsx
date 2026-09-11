import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, Trash2, ReceiptText, CreditCard, Search, Download, Truck } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { AppShell } from '@/components/layout/AppShell'
import { Table, Money, SkeletonTable, Badge, Button, Drawer, Modal, Input, Select, Pagination, BulkActionBar, DateRangePicker } from '@/components/ui'
import { api } from '@/api/client'
import { downloadFromApi } from '@/lib/download'
import { cn } from '@/lib/cn'
import { formatMoney, formatDateTime } from '@/lib/format'
import type { PaginationMeta } from '@/types/api'
import { useSelection } from '@/hooks/useSelection'
import { exportRowsToExcel } from '@/lib/export'

interface Supplier { id: string; name: string; phone?: string; email?: string; balance: number; totalOrders: number; isActive: boolean }
interface SupplierTransaction {
  id: string
  type: 'purchase' | 'payment' | 'return'
  amount: number
  reference?: string
  note?: string
  createdAt: string
  user?: { id: string; fullName: string }
  branch?: { id: string; name: string }
}
interface TxnSummary {
  totalPurchases: number
  totalPayments: number
  totalReturns: number
  countPurchases: number
  countPayments: number
  countReturns: number
}
interface Branch { id: string; name: string }

const LIMIT = 20

const schema = z.object({
  name: z.string().min(1, 'الاسم مطلوب'),
  phone: z.string().optional(),
  email: z.string().email('بريد غير صالح').optional().or(z.literal('')),
  address: z.string().optional(),
  taxNumber: z.string().optional(),
  bankAccount: z.string().optional(),
  notes: z.string().optional(),
})
type FormData = z.infer<typeof schema>

const txnTypeMap: Record<string, { label: string; color: string }> = {
  purchase: { label: 'مشتريات', color: 'text-danger-600' },
  payment: { label: 'دفعة', color: 'text-success-600' },
  return: { label: 'مرتجع', color: 'text-warning-600' },
}

// ─── Transaction Drawer ───────────────────────────────────────────────────────

const txnSchema = z.object({
  type: z.enum(['payment', 'return']),
  amount: z.coerce.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  branchId: z.string().uuid('اختر الفرع'),
  reference: z.string().optional(),
  note: z.string().optional(),
})
type TxnForm = z.infer<typeof txnSchema>

function SupplierDetailDrawer({ supplier }: { supplier: Supplier }) {
  const qc = useQueryClient()
  const [txnPage, setTxnPage] = useState(1)
  const [addTxnOpen, setAddTxnOpen] = useState(false)
  const [typeFilter, setTypeFilter] = useState<'' | 'purchase' | 'payment' | 'return'>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const { data: txnData, isLoading: txnLoading } = useQuery<{
    data: SupplierTransaction[]
    meta: PaginationMeta
    summary: TxnSummary
  }>({
    queryKey: ['supplier-txns', supplier.id, txnPage, typeFilter, from, to],
    queryFn: async () => (await api.get<{
      data: SupplierTransaction[]
      meta: PaginationMeta
      summary: TxnSummary
    }>(`/suppliers/${supplier.id}/transactions`, {
      params: {
        page: txnPage,
        limit: 10,
        ...(typeFilter ? { type: typeFilter } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      },
    })).data,
  })

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get<{ data: Branch[] }>('/branches')).data.data,
  })

  const txns = txnData?.data ?? []
  const txnMeta = txnData?.meta
  const summary = txnData?.summary
  const hasFilters = typeFilter !== '' || from !== '' || to !== ''
  const clearFilters = () => { setTypeFilter(''); setFrom(''); setTo(''); setTxnPage(1) }

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<TxnForm>({
    resolver: zodResolver(txnSchema),
    defaultValues: { type: 'payment' },
  })
  const txnType = watch('type')

  const { mutate: addTxn, isPending } = useMutation({
    mutationFn: async (data: TxnForm) => {
      await api.post(`/suppliers/${supplier.id}/transactions`, data)
    },
    onSuccess: () => {
      toast.success(txnType === 'payment' ? 'تم تسجيل الدفعة' : 'تم تسجيل المرتجع')
      qc.invalidateQueries({ queryKey: ['supplier-txns', supplier.id] })
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      setAddTxnOpen(false)
      reset()
    },
    onError: () => toast.error('حدث خطأ في تسجيل المعاملة'),
  })

  return (
    <div className="flex flex-col gap-6">
      {/* Balance summary */}
      <div className="bg-gray-750 rounded-md border border-gray-700 p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500 uppercase mb-1">الرصيد المستحق</p>
          {supplier.balance > 0
            ? <Money value={supplier.balance} size="lg" />
            : <Badge variant="success" dot>مسدد بالكامل</Badge>}
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await downloadFromApi(
                  `/suppliers/${supplier.id}/statement`,
                  `supplier-${supplier.name}.xlsx`,
                )
              } catch { toast.error('فشل تصدير كشف الحساب') }
            }}
          >
            <Download className="w-4 h-4" />كشف حساب
          </Button>
          <Button onClick={() => setAddTxnOpen(true)}>
            <CreditCard className="w-4 h-4" />تسجيل دفعة
          </Button>
        </div>
      </div>

      {/* Transactions list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-gray-300">سجل المعاملات</h4>
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
              مسح الفلاتر ×
            </button>
          )}
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value as typeof typeFilter); setTxnPage(1) }}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-brand-500"
          >
            <option value="">كل الأنواع</option>
            <option value="purchase">مشتريات</option>
            <option value="payment">دفعات</option>
            <option value="return">مرتجعات</option>
          </select>
          <DateRangePicker
            compact
            value={{ from, to }}
            onChange={(v) => { setFrom(v.from); setTo(v.to); setTxnPage(1) }}
          />
        </div>

        {/* Summary stats over the FILTERED set */}
        {summary && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-gray-750 border border-gray-700 rounded-md px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-gray-500">مشتريات</p>
              <p className="font-mono text-sm text-danger-600 mt-0.5 num">
                {formatMoney(summary.totalPurchases)} ج
              </p>
              <p className="text-[10px] text-gray-500">{summary.countPurchases} حركة</p>
            </div>
            <div className="bg-gray-750 border border-gray-700 rounded-md px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-gray-500">دفعات</p>
              <p className="font-mono text-sm text-success-600 mt-0.5 num">
                {formatMoney(summary.totalPayments)} ج
              </p>
              <p className="text-[10px] text-gray-500">{summary.countPayments} حركة</p>
            </div>
            <div className="bg-gray-750 border border-gray-700 rounded-md px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-gray-500">مرتجعات</p>
              <p className="font-mono text-sm text-warning-600 mt-0.5 num">
                {formatMoney(summary.totalReturns)} ج
              </p>
              <p className="text-[10px] text-gray-500">{summary.countReturns} حركة</p>
            </div>
          </div>
        )}

        {txnLoading ? (
          <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 bg-gray-750 rounded animate-pulse" />)}</div>
        ) : txns.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">
            {hasFilters ? 'لا توجد معاملات تطابق الفلاتر' : 'لا توجد معاملات'}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {txns.map((t) => {
              const tm = txnTypeMap[t.type] ?? { label: t.type, color: 'text-gray-400' }
              const sign = t.type === 'purchase' ? '+' : '-'
              const amountColor = t.type === 'purchase' ? 'text-danger-600' : 'text-success-600'
              return (
                <div key={t.id} className="flex items-center justify-between py-2.5 border-b border-gray-700 last:border-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={cn('text-sm font-medium', tm.color)}>{tm.label}</p>
                      {t.reference && (
                        <span className="text-[10px] num-code bg-gray-800 border border-gray-700 px-1.5 py-0.5 rounded" dir="ltr">
                          {t.reference}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {t.user?.fullName ?? '—'}
                      {' · '}
                      <span className="font-mono">{formatDateTime(t.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</span>
                      {t.branch && ` · ${t.branch.name}`}
                    </p>
                    {t.note && <p className="text-xs text-gray-500 mt-0.5 truncate">{t.note}</p>}
                  </div>
                  <span className={cn('font-mono font-semibold text-sm shrink-0 mr-3', amountColor)}>
                    {sign}{formatMoney(Number(t.amount))} ج
                  </span>
                </div>
              )
            })}
          </div>
        )}
        {txnMeta && txnMeta.pages > 1 && (
          <Pagination page={txnMeta.page} pages={txnMeta.pages} total={txnMeta.total} limit={10} onPage={setTxnPage} />
        )}
      </div>

      {/* Add transaction modal */}
      <Modal open={addTxnOpen} onClose={() => { setAddTxnOpen(false); reset() }} title="تسجيل معاملة مع المورد"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setAddTxnOpen(false); reset() }}>إلغاء</Button>
            <Button loading={isPending} onClick={handleSubmit((d) => addTxn(d))}>تسجيل</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm text-gray-400 mb-2">نوع المعاملة</p>
            <div className="flex gap-2">
              <label className={cn('flex-1 cursor-pointer py-2 rounded text-sm border text-center transition-all', txnType === 'payment' ? 'border-success-500 text-success-600 bg-success-500/10' : 'border-gray-700 text-gray-400')}>
                <input type="radio" value="payment" {...register('type')} className="hidden" />
                دفعة للمورد
              </label>
              <label className={cn('flex-1 cursor-pointer py-2 rounded text-sm border text-center transition-all', txnType === 'return' ? 'border-warning-500 text-warning-600 bg-warning-500/10' : 'border-gray-700 text-gray-400')}>
                <input type="radio" value="return" {...register('type')} className="hidden" />
                مرتجع للمورد
              </label>
            </div>
          </div>
          <Input label="المبلغ (ج)" type="number" step="0.01" error={errors.amount?.message} {...register('amount')} />
          <Select label="الفرع" error={errors.branchId?.message} {...register('branchId')}>
            <option value="">اختر الفرع...</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Input label="مرجع (رقم شيك / تحويل)" {...register('reference')} />
          <div>
            <label className="text-sm text-gray-400 block mb-1">ملاحظة (اختياري)</label>
            <textarea {...register('note')} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)] resize-none" />
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Suppliers() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null)
  const [detailSupplier, setDetailSupplier] = useState<Supplier | null>(null)

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading } = useQuery<{ data: Supplier[]; meta: PaginationMeta }>({
    queryKey: ['suppliers', page, debouncedSearch],
    queryFn: async () => (await api.get<{ data: Supplier[]; meta: PaginationMeta }>('/suppliers', { params: { limit: LIMIT, page, ...(debouncedSearch ? { search: debouncedSearch } : {}) } })).data,
  })

  const suppliers = data?.data ?? []
  const meta = data?.meta

  const selection = useSelection(suppliers.map((s) => s.id))

  const bulkExport = async () => {
    const selected = suppliers.filter((s) => selection.isSelected(s.id))
    await exportRowsToExcel(
      selected,
      [
        { header: 'الاسم', accessor: 'name', width: 28 },
        { header: 'الهاتف', accessor: (s) => s.phone ?? '', width: 16 },
        { header: 'البريد', accessor: (s) => s.email ?? '', width: 28 },
        { header: 'الرصيد المستحق', accessor: 'balance', width: 16 },
        { header: 'الطلبات', accessor: 'totalOrders', width: 10 },
        { header: 'نشط', accessor: (s) => (s.isActive ? 'نعم' : 'لا'), width: 8 },
      ],
      `suppliers-${selected.length}.xlsx`,
      'الموردون',
    )
  }

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  const openNew = () => { setEditing(null); reset({}); setDrawerOpen(true) }
  const openEdit = (s: Supplier) => {
    setEditing(s)
    reset({ name: s.name, phone: s.phone ?? '', email: s.email ?? '' })
    setDrawerOpen(true)
  }

  const { mutate: save, isPending } = useMutation({
    mutationFn: async (data: FormData) => {
      const body = { ...data, email: data.email || undefined }
      if (editing) await api.patch(`/suppliers/${editing.id}`, body)
      else await api.post('/suppliers', body)
    },
    onSuccess: () => {
      toast.success(editing ? 'تم تحديث المورد' : 'تم إضافة المورد')
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      setDrawerOpen(false)
    },
    onError: () => toast.error('حدث خطأ، حاول مرة أخرى'),
  })

  const { mutate: deleteSup, isPending: isDeleting } = useMutation({
    mutationFn: async (id: string) => api.delete(`/suppliers/${id}`),
    onSuccess: () => {
      toast.success('تم حذف المورد')
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      setDeleteTarget(null)
    },
    onError: () => toast.error('لا يمكن حذف مورد لديه طلبات'),
  })

  return (
    <AppShell title="الموردون">
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث باسم المورد أو الهاتف..."
              className="w-full bg-gray-800 border border-gray-700 rounded-md pr-9 pl-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-brand-500"
            />
          </div>
          <Button onClick={openNew}><Plus className="w-4 h-4" />مورد جديد</Button>
        </div>

        {isLoading ? <SkeletonTable rows={8} cols={5} /> : (
          <>
            <Table
              selection={{
                isSelected: (s) => selection.isSelected(s.id),
                onToggle: (s) => selection.toggle(s.id),
                onToggleAll: selection.toggleAllVisible,
                allSelected: selection.allVisibleSelected,
                someSelected: selection.someVisibleSelected,
              }}
              columns={[
                { key: 'name', header: 'المورد', render: (s) => (
                  <button className="font-medium text-brand-400 hover:underline text-right" onClick={() => setDetailSupplier(s)}>{s.name}</button>
                )},
                { key: 'phone', header: 'الهاتف', className: 'num-code text-sm' },
                { key: 'email', header: 'البريد', className: 'text-gray-500 text-sm' },
                { key: 'totalOrders', header: 'الطلبات', className: 'text-center font-numeric num num-strong' },
                { key: 'balance', header: 'الرصيد المستحق', render: (s) => s.balance > 0 ? <Money value={s.balance} /> : <Badge variant="success" dot>مسدد</Badge> },
                { key: 'actions', header: '', render: (s) => (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDetailSupplier(s) }}><ReceiptText className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openEdit(s) }}><Edit2 className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDeleteTarget(s) }} className="text-danger-500"><Trash2 className="w-3 h-3" /></Button>
                  </div>
                )},
              ]}
              data={suppliers} keyExtractor={(s) => s.id} emptyMessage="لا يوجد موردون" emptyIcon={<Truck className="w-8 h-8" />} emptyDescription="أضف مورديك لإدارة المشتريات"
            />
            {meta && <Pagination page={meta.page} pages={meta.pages} total={meta.total} limit={meta.limit} onPage={setPage} />}
          </>
        )}
      </div>

      {/* Detail / Transactions Drawer */}
      <Drawer open={!!detailSupplier} onClose={() => setDetailSupplier(null)} title={detailSupplier?.name ?? ''} width="w-[480px]">
        {detailSupplier && <SupplierDetailDrawer supplier={detailSupplier} />}
      </Drawer>

      {/* Create / Edit Drawer */}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={editing ? 'تعديل بيانات المورد' : 'مورد جديد'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>إلغاء</Button>
            <Button loading={isPending} onClick={handleSubmit((d) => save(d))}>حفظ</Button>
          </>
        }
      >
        <form className="flex flex-col gap-5">
          <Input label="اسم المورد" error={errors.name?.message} {...register('name')} />
          <Input label="رقم الهاتف" type="tel" {...register('phone')} />
          <Input label="البريد الإلكتروني" type="email" error={errors.email?.message} {...register('email')} />
          <Input label="العنوان" {...register('address')} />
          <Input label="الرقم الضريبي" {...register('taxNumber')} />
          <Input label="الحساب البنكي (IBAN)" {...register('bankAccount')} />
          <div>
            <label className="text-sm text-gray-400 block mb-1">ملاحظات</label>
            <textarea {...register('notes')} rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)] resize-none" />
          </div>
        </form>
      </Drawer>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="حذف المورد"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button variant="danger" loading={isDeleting} onClick={() => deleteTarget && deleteSup(deleteTarget.id)}>حذف</Button>
          </>
        }
      >
        <p className="text-gray-300">هل أنت متأكد من حذف المورد <strong className="text-gray-100">{deleteTarget?.name}</strong>؟ لا يمكن التراجع عن هذا الإجراء.</p>
      </Modal>
      <BulkActionBar count={selection.count} onClear={selection.clear}>
        <Button variant="outline" size="sm" onClick={bulkExport}>
          <Download className="w-4 h-4" />تصدير
        </Button>
      </BulkActionBar>
    </AppShell>
  )
}
