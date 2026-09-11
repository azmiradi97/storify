import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Plus, Edit2, Wallet, FileText, Download, Upload, Users } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { AppShell } from '@/components/layout/AppShell'
import { Input, Table, Money, SkeletonTable, Button, Drawer, Pagination, Modal, Badge, BulkActionBar } from '@/components/ui'
import { api } from '@/api/client'
import { downloadFromApi } from '@/lib/download'
import { formatNumber, formatMoney, formatDate, formatDateTime } from '@/lib/format'
import { getApiErrorCode } from '@/lib/api-error'
import type { PaginationMeta } from '@/types/api'
import { invoiceStatusMap, getStatus } from '@/constants/status'
import { useSelection } from '@/hooks/useSelection'
import { exportRowsToExcel } from '@/lib/export'

interface Customer {
  id: string
  fullName: string
  phone?: string
  email?: string
  nationalId?: string
  address?: string
  creditBalance: number
  loyaltyPoints: number
  _count?: { invoices: number }
}

const LIMIT = 20

const schema = z.object({
  fullName: z.string().min(1, 'الاسم مطلوب'),
  phone: z.string().optional(),
  nationalId: z.string().optional(),
  email: z.string().email('بريد غير صالح').optional().or(z.literal('')),
  address: z.string().optional(),
  notes: z.string().optional(),
})
type FormData = z.infer<typeof schema>

const creditSchema = z.object({
  amount: z.coerce.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  type: z.enum(['add', 'deduct']),
  note: z.string().optional(),
})
type CreditFormData = z.infer<typeof creditSchema>

function CreditModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const qc = useQueryClient()
  const { register, handleSubmit, watch, formState: { errors } } = useForm<CreditFormData>({
    resolver: zodResolver(creditSchema),
    defaultValues: { type: 'add' },
  })
  const creditType = watch('type')

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: CreditFormData) => {
      await api.post(`/customers/${customer.id}/credit`, data)
    },
    onSuccess: () => {
      toast.success('تم تعديل الرصيد')
      qc.invalidateQueries({ queryKey: ['customers'] })
      onClose()
    },
    onError: (e: unknown) => {
      toast.error(getApiErrorCode(e) === 'insufficient_credit' ? 'الرصيد غير كافٍ' : 'فشل تعديل الرصيد')
    },
  })

  return (
    <form onSubmit={handleSubmit((d) => mutate(d))} className="flex flex-col gap-5">
      <div className="flex gap-4">
        <div>
          <p className="text-sm text-gray-400 mb-1">الرصيد الحالي</p>
          <Money value={customer.creditBalance} size="lg" />
        </div>
        {(customer.loyaltyPoints ?? 0) > 0 && (
          <div>
            <p className="text-sm text-gray-400 mb-1">نقاط الولاء</p>
            <p className="text-lg font-bold text-warning-600">{customer.loyaltyPoints} نقطة</p>
          </div>
        )}
      </div>
      <div>
        <p className="text-sm text-gray-400 mb-2">نوع التعديل</p>
        <div className="flex gap-2">
          <label className={`flex-1 cursor-pointer py-2 rounded text-sm border text-center transition-all ${creditType === 'add' ? 'border-success-500 text-success-600 bg-success-500/10' : 'border-gray-700 text-gray-400'}`}>
            <input type="radio" value="add" {...register('type')} className="hidden" />
            إضافة رصيد
          </label>
          <label className={`flex-1 cursor-pointer py-2 rounded text-sm border text-center transition-all ${creditType === 'deduct' ? 'border-danger-500 text-danger-600 bg-danger-500/10' : 'border-gray-700 text-gray-400'}`}>
            <input type="radio" value="deduct" {...register('type')} className="hidden" />
            خصم رصيد
          </label>
        </div>
      </div>
      <Input label="المبلغ" type="number" step="0.01" error={errors.amount?.message} {...register('amount')} />
      <div>
        <label className="text-sm text-gray-400 block mb-1">ملاحظة (اختياري)</label>
        <textarea {...register('note')} rows={2}
          className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)] resize-none" />
      </div>
      <div className="flex gap-3">
        <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>إلغاء</Button>
        <Button type="submit" loading={isPending} className="flex-1">حفظ</Button>
      </div>
    </form>
  )
}

// ─── Customer Detail Drawer ───────────────────────────────────────────────────

interface CustomerInvoice {
  id: string
  invoiceNumber: string
  totalAmount: number
  status: string
  createdAt: string
  paymentMethod?: { name: string }
}

// Backend uses `entity: 'customer'` audit logs with these action codes.
// `after` shape varies by action — see invoice.service.ts / customer.routes.ts.
type LedgerAction = 'credit_add' | 'credit_deduct' | 'credit_used' | 'loyalty_earned'
interface LedgerEntry {
  id: string
  action: LedgerAction | string
  createdAt: string
  actor?: { id: string; fullName: string }
  before?: { creditBalance?: string } | null
  after?: {
    amount?: string
    points?: number
    newBalance?: string | number
    note?: string
    invoiceId?: string
    invoiceNumber?: string
    creditBalance?: string
  } | null
}
interface CreditLedger {
  balance: { credit: string; loyaltyPoints: number }
  entries: LedgerEntry[]
}


function CustomerDetailDrawer({ customer }: { customer: Customer }) {
  const [invPage, setInvPage] = useState(1)

  const { data: invData, isLoading } = useQuery<{ data: CustomerInvoice[]; meta: PaginationMeta }>({
    queryKey: ['customer-invoices', customer.id, invPage],
    queryFn: async () =>
      (await api.get<{ data: CustomerInvoice[]; meta: PaginationMeta }>('/invoices', {
        params: { customerId: customer.id, limit: 8, page: invPage },
      })).data,
  })

  const invoices = invData?.data ?? []
  const meta = invData?.meta

  const { data: ledger } = useQuery<CreditLedger>({
    queryKey: ['customer-ledger', customer.id],
    queryFn: async () =>
      (await api.get<{ data: CreditLedger }>(`/customers/${customer.id}/credit-ledger`)).data.data,
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-750 border border-gray-700 rounded-md p-3">
          <p className="text-xs text-gray-500 mb-1">رصيد العميل</p>
          {customer.creditBalance > 0
            ? <Money value={customer.creditBalance} size="lg" />
            : <span className="text-gray-500 text-sm">لا يوجد رصيد</span>}
        </div>
        <div className="bg-gray-750 border border-gray-700 rounded-md p-3">
          <p className="text-xs text-gray-500 mb-1">إجمالي الفواتير</p>
          <p className="text-2xl font-mono font-bold text-gray-100">{customer._count?.invoices ?? 0}</p>
        </div>
      </div>

      {customer.phone && (
        <div className="text-sm">
          <span className="text-gray-500">الهاتف: </span>
          <span className="font-mono text-gray-300">{customer.phone}</span>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-gray-300 mb-3">سجل الفواتير</h4>
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 bg-gray-750 rounded animate-pulse" />)}
          </div>
        ) : invoices.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">لا توجد فواتير</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-700">
            {invoices.map((inv) => {
              const s = getStatus(invoiceStatusMap, inv.status)
              return (
                <div key={inv.id} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-mono text-gray-100">{inv.invoiceNumber}</p>
                    <p className="text-xs text-gray-500">
                      {formatDate(inv.createdAt)}
                      {inv.paymentMethod && ` · ${inv.paymentMethod.name}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={s.variant}>{s.label}</Badge>
                    <Money value={inv.totalAmount} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {meta && meta.pages > 1 && (
          <Pagination page={meta.page} pages={meta.pages} total={meta.total} limit={meta.limit} onPage={setInvPage} />
        )}
      </div>

      <CustomerLedger ledger={ledger} />
    </div>
  )
}

// ─── Customer credit + loyalty ledger ────────────────────────────────────────
const ledgerActionMeta: Record<string, { label: string; tone: 'success' | 'danger' | 'warning' | 'info' }> = {
  credit_add: { label: 'إضافة رصيد', tone: 'success' },
  credit_deduct: { label: 'خصم رصيد', tone: 'warning' },
  credit_used: { label: 'استخدام رصيد', tone: 'danger' },
  loyalty_earned: { label: 'نقاط ولاء', tone: 'info' },
  loyalty_reversed: { label: 'عكس نقاط ولاء', tone: 'warning' },
}

function CustomerLedger({ ledger }: { ledger?: CreditLedger }) {
  if (!ledger) {
    return (
      <div>
        <h4 className="text-sm font-semibold text-gray-300 mb-3">السجل المالي</h4>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 bg-gray-750 rounded animate-pulse" />)}
        </div>
      </div>
    )
  }

  const formatAmount = (s?: string | number) => {
    if (s === undefined || s === null) return ''
    const n = Number(s)
    if (Number.isNaN(n)) return String(s)
    return formatMoney(n)
  }

  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-300 mb-3">السجل المالي</h4>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-gray-750 border border-gray-700 rounded-md p-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">الرصيد الحالي</p>
          <Money value={Number(ledger.balance.credit)} />
        </div>
        <div className="bg-gray-750 border border-gray-700 rounded-md p-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">نقاط الولاء</p>
          <p className="font-mono text-base font-bold text-warning-600 num">{formatNumber(ledger.balance.loyaltyPoints)}</p>
        </div>
      </div>

      {ledger.entries.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-6">لا توجد حركات</p>
      ) : (
        <ol className="flex flex-col divide-y divide-gray-700">
          {ledger.entries.map((e) => {
            const meta = ledgerActionMeta[e.action] ?? { label: e.action, tone: 'info' as const }
            const after = e.after ?? {}
            const amount = after.amount ?? after.points
            const isPoints = e.action === 'loyalty_earned'
            const sign = e.action === 'credit_deduct' || e.action === 'credit_used' ? '-' : '+'
            return (
              <li key={e.id} className="py-2.5 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={meta.tone}>{meta.label}</Badge>
                    {after.invoiceNumber && (
                      <span className="text-xs text-gray-500 font-mono">{after.invoiceNumber}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {formatDateTime(e.createdAt)}
                    {e.actor && ` · ${e.actor.fullName}`}
                  </p>
                  {after.note && (
                    <p className="text-xs text-gray-400 mt-1">{after.note}</p>
                  )}
                </div>
                <div className="text-left">
                  <span className={`font-mono font-semibold text-sm num ${meta.tone === 'success' ? 'text-success-600' : meta.tone === 'danger' ? 'text-danger-600' : meta.tone === 'warning' ? 'text-warning-600' : 'text-info-600'}`}>
                    {amount !== undefined ? `${sign}${isPoints ? amount : formatAmount(amount)}` : '—'}
                    {isPoints && <span className="text-[10px] text-gray-500 mr-1">نقطة</span>}
                  </span>
                  {after.newBalance !== undefined && !isPoints && (
                    <p className="text-[10px] text-gray-500 mt-0.5">رصيد: {formatAmount(after.newBalance)} ج</p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

export default function Customers() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [creditCustomer, setCreditCustomer] = useState<Customer | null>(null)
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null)
  const [importResult, setImportResult] = useState<{ created: number; skipped: number; errors: { row: number; reason: string }[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.post<{ data: { created: number; skipped: number; errors: { row: number; reason: string }[] } }>(
        '/customers/import',
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      return res.data.data
    },
    onSuccess: (result) => {
      setImportResult(result)
      qc.invalidateQueries({ queryKey: ['customers'] })
      toast.success(`تم استيراد ${result.created} عميل`)
    },
    onError: () => toast.error('فشل الاستيراد'),
  })

  const downloadSampleCsv = () => {
    const csv = 'full_name,phone,email,national_id,address,notes\nعميل تجريبي,01000000000,sample@example.com,,,'
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'sample-customers.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const { data, isLoading } = useQuery<{ data: Customer[]; meta: PaginationMeta }>({
    queryKey: ['customers', search, page],
    queryFn: async () => (await api.get<{ data: Customer[]; meta: PaginationMeta }>('/customers', { params: { search, limit: LIMIT, page } })).data,
  })

  const customers = data?.data ?? []
  const meta = data?.meta

  const selection = useSelection(customers.map((c) => c.id))

  const bulkExport = async () => {
    const selected = customers.filter((c) => selection.isSelected(c.id))
    await exportRowsToExcel(
      selected,
      [
        { header: 'الاسم', accessor: 'fullName', width: 28 },
        { header: 'الهاتف', accessor: (c) => c.phone ?? '', width: 16 },
        { header: 'البريد الإلكتروني', accessor: (c) => c.email ?? '', width: 28 },
        { header: 'الرقم القومي', accessor: (c) => c.nationalId ?? '', width: 18 },
        { header: 'الفواتير', accessor: (c) => c._count?.invoices ?? 0, width: 10 },
        { header: 'الرصيد', accessor: 'creditBalance', width: 12 },
        { header: 'نقاط الولاء', accessor: 'loyaltyPoints', width: 12 },
      ],
      `customers-${selected.length}.xlsx`,
      'العملاء',
    )
  }

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  const openNew = () => { setEditing(null); reset({}); setDrawerOpen(true) }
  const openEdit = (c: Customer) => {
    setEditing(c)
    reset({ fullName: c.fullName, phone: c.phone ?? '', email: c.email ?? '', nationalId: c.nationalId ?? '', address: c.address ?? '' })
    setDrawerOpen(true)
  }

  const { mutate: save, isPending } = useMutation({
    mutationFn: async (data: FormData) => {
      const body = { ...data, email: data.email || undefined }
      if (editing) await api.patch(`/customers/${editing.id}`, body)
      else await api.post('/customers', body)
    },
    onSuccess: () => {
      toast.success(editing ? 'تم تحديث العميل' : 'تم إضافة العميل')
      qc.invalidateQueries({ queryKey: ['customers'] })
      setDrawerOpen(false)
    },
    onError: () => toast.error('حدث خطأ، حاول مرة أخرى'),
  })

  return (
    <AppShell title="العملاء">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 max-w-xs">
            <Input placeholder="بحث بالاسم أو الهاتف..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} startIcon={<Search className="w-4 h-4" />} />
          </div>
          <Button variant="outline" size="sm" onClick={downloadSampleCsv}>
            <Download className="w-4 h-4" />نموذج CSV
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => fileInputRef.current?.click()}
            loading={importMutation.isPending}
          >
            <Upload className="w-4 h-4" />استيراد CSV
          </Button>
          <input
            ref={fileInputRef} type="file" accept=".csv" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) { importMutation.mutate(f); e.target.value = '' }
            }}
          />
          <Button onClick={openNew}><Plus className="w-4 h-4" />عميل جديد</Button>
        </div>

        {isLoading ? <SkeletonTable rows={8} cols={5} /> : (
          <>
            <Table
              selection={{
                isSelected: (c) => selection.isSelected(c.id),
                onToggle: (c) => selection.toggle(c.id),
                onToggleAll: selection.toggleAllVisible,
                allSelected: selection.allVisibleSelected,
                someSelected: selection.someVisibleSelected,
              }}
              columns={[
                { key: 'fullName', header: 'الاسم', render: (c) => (
                  <button className="font-medium text-brand-400 hover:underline text-right" onClick={() => setDetailCustomer(c)}>{c.fullName}</button>
                )},
                { key: 'phone', header: 'الهاتف', className: 'num-code text-sm' },
                { key: 'email', header: 'البريد الإلكتروني', className: 'text-gray-500 text-sm' },
                { key: 'invoices', header: 'الفواتير', render: (c) => <span className="text-center font-numeric num num-strong">{c._count?.invoices ?? 0}</span> },
                { key: 'creditBalance', header: 'الرصيد', render: (c) => c.creditBalance > 0 ? <Money value={c.creditBalance} /> : <span className="text-gray-500">—</span> },
                { key: 'loyaltyPoints', header: 'النقاط', render: (c) => c.loyaltyPoints > 0 ? <span className="font-numeric num text-warning-600">{c.loyaltyPoints} نقطة</span> : <span className="text-gray-500">—</span> },
                { key: 'actions', header: '', render: (c) => (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" title="السجل" onClick={(e) => { e.stopPropagation(); setDetailCustomer(c) }}>
                      <FileText className="w-3 h-3" />
                    </Button>
                    <Button variant="ghost" size="sm" title="تعديل الرصيد" onClick={(e) => { e.stopPropagation(); setCreditCustomer(c) }}>
                      <Wallet className="w-3 h-3" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openEdit(c) }}>
                      <Edit2 className="w-3 h-3" />
                    </Button>
                  </div>
                )},
              ]}
              data={customers} keyExtractor={(c) => c.id} emptyMessage="لا يوجد عملاء" emptyIcon={<Users className="w-8 h-8" />} emptyDescription="أضف عملاءك لتتبّع مشترياتهم ورصيدهم"
            />
            {meta && <Pagination page={meta.page} pages={meta.pages} total={meta.total} limit={meta.limit} onPage={setPage} />}
          </>
        )}
      </div>

      <Modal open={!!creditCustomer} onClose={() => setCreditCustomer(null)} title={`تعديل رصيد: ${creditCustomer?.fullName ?? ''}`}>
        {creditCustomer && <CreditModal customer={creditCustomer} onClose={() => setCreditCustomer(null)} />}
      </Modal>

      <Drawer
        open={!!detailCustomer}
        onClose={() => setDetailCustomer(null)}
        title={detailCustomer?.fullName ?? ''}
        width="w-[480px]"
        footer={
          <Button variant="ghost" onClick={async () => {
            if (!detailCustomer) return
            try {
              await downloadFromApi(
                `/customers/${detailCustomer.id}/statement`,
                `كشف_حساب_${detailCustomer.fullName}.xlsx`,
              )
            } catch { toast.error('فشل تصدير كشف الحساب') }
          }}>
            <Download className="w-4 h-4" />تصدير كشف الحساب
          </Button>
        }
      >
        {detailCustomer && <CustomerDetailDrawer customer={detailCustomer} />}
      </Drawer>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={editing ? 'تعديل بيانات العميل' : 'عميل جديد'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>إلغاء</Button>
            <Button loading={isPending} onClick={handleSubmit((d) => save(d))}>حفظ</Button>
          </>
        }
      >
        <form className="flex flex-col gap-5">
          <Input label="الاسم الكامل" error={errors.fullName?.message} {...register('fullName')} />
          <Input label="رقم الهاتف" type="tel" {...register('phone')} />
          <Input label="الرقم القومي" {...register('nationalId')} />
          <Input label="البريد الإلكتروني" type="email" error={errors.email?.message} {...register('email')} />
          <Input label="العنوان" {...register('address')} />
          <div>
            <label className="text-sm text-gray-400 block mb-1">ملاحظات</label>
            <textarea {...register('notes')} rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)] resize-none" />
          </div>
        </form>
      </Drawer>
      <BulkActionBar count={selection.count} onClear={selection.clear}>
        <Button variant="outline" size="sm" onClick={bulkExport}>
          <Download className="w-4 h-4" />تصدير
        </Button>
      </BulkActionBar>

      {importResult && (
        <Modal
          open
          title="نتيجة الاستيراد"
          onClose={() => setImportResult(null)}
          footer={<Button onClick={() => setImportResult(null)}>إغلاق</Button>}
        >
          <div className="space-y-4">
            <div className="flex gap-6 text-center">
              <div className="flex-1 bg-success-500/10 rounded-lg p-4">
                <p className="text-2xl font-bold text-success-600">{importResult.created}</p>
                <p className="text-sm text-gray-400 mt-1">تم إنشاؤه</p>
              </div>
              <div className="flex-1 bg-warning-500/10 rounded-lg p-4">
                <p className="text-2xl font-bold text-warning-600">{importResult.skipped}</p>
                <p className="text-sm text-gray-400 mt-1">تم تخطيه</p>
              </div>
            </div>
            {importResult.errors.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-2">الأخطاء</p>
                <div className="max-h-48 overflow-y-auto bg-gray-800 border border-gray-700 rounded-md divide-y divide-gray-700">
                  {importResult.errors.map((e, i) => (
                    <div key={i} className="px-3 py-2 text-xs text-gray-300 flex items-center gap-3">
                      <span className="font-mono text-gray-500">سطر {e.row}</span>
                      <span className="text-danger-600">{e.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </AppShell>
  )
}
