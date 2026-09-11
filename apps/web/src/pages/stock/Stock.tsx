import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings2, ArrowLeftRight, TrendingUp, Search, Plus, Check, X, Download, Package } from 'lucide-react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { AppShell } from '@/components/layout/AppShell'
import { Table, Badge, SkeletonTable, Button, Modal, Input, Select, Drawer, Pagination, DateRangePicker, BulkActionBar } from '@/components/ui'
import { api } from '@/api/client'
import type { PaginationMeta } from '@/types/api'
import { getApiErrorCode } from '@/lib/api-error'
import { useSelection } from '@/hooks/useSelection'
import { exportRowsToExcel } from '@/lib/export'
import { formatDate, formatDateTime } from '@/lib/format'
import { useAuthStore } from '@/stores/auth.store'
import { cn } from '@/lib/cn'

// ─── Types ───────────────────────────────────────────────────────────────────

interface StockEntry {
  id: string
  quantity: number
  minQuantity: number
  variant: { id: string; sku: string; product: { id: string; name: string; unit?: string } }
  branch: { id: string; name: string }
}

interface Movement {
  id: string
  type: string
  quantity: number
  reference?: string
  createdAt: string
  variant: { id: string; sku: string; product: { id: string; name: string } }
  branch: { id: string; name: string }
  user?: { id: string; fullName: string }
}

interface Transfer {
  id: string
  status: 'pending' | 'completed' | 'rejected'
  fromBranch: { id: string; name: string }
  toBranch: { id: string; name: string }
  createdBy: { id: string; fullName: string }
  notes?: string
  createdAt: string
  _count: { items: number }
}

interface TransferDetail extends Omit<Transfer, '_count'> {
  approvedBy?: { id: string; fullName: string }
  items: { id: string; quantity: number; variant: { id: string; sku: string; product: { id: string; name: string } } }[]
}

interface Branch { id: string; name: string }

const LIMIT = 20

// ─── Adjust Modal ─────────────────────────────────────────────────────────────

const adjustSchema = z.object({
  quantity: z.coerce.number().int().refine((n) => n !== 0, { message: 'يجب أن لا يكون صفراً' }),
  reason: z.string().min(1, 'السبب مطلوب'),
  note: z.string().optional(),
})
type AdjustForm = z.infer<typeof adjustSchema>

function AdjustModal({ entry, onClose }: { entry: StockEntry; onClose: () => void }) {
  const qc = useQueryClient()
  const { register, handleSubmit, formState: { errors } } = useForm<AdjustForm>({ resolver: zodResolver(adjustSchema) })

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: AdjustForm) => {
      await api.post('/stock/adjust', {
        variantId: entry.variant.id,
        branchId: entry.branch.id,
        quantity: data.quantity,
        reason: data.reason,
        note: data.note,
      })
    },
    onSuccess: () => {
      toast.success('تم تعديل المخزون')
      qc.invalidateQueries({ queryKey: ['stock'] })
      onClose()
    },
    onError: (e: unknown) => {
      toast.error(getApiErrorCode(e) === 'insufficient_stock' ? 'الكمية الحالية لا تكفي' : 'حدث خطأ في التعديل')
    },
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-gray-750 rounded-md p-3 text-sm border border-gray-700 flex justify-between">
        <span className="text-gray-400">الكمية الحالية</span>
        <span className="text-gray-100 font-mono font-semibold">{entry.quantity}</span>
      </div>
      <Input label="التعديل (+ إضافة / - خصم)" type="number" placeholder="مثال: 10 أو -5" error={errors.quantity?.message} {...register('quantity')} />
      <Select label="سبب التعديل" error={errors.reason?.message} {...register('reason')}>
        <option value="">اختر السبب</option>
        <option value="purchase">استلام مشتريات</option>
        <option value="damage">تلف أو فقدان</option>
        <option value="return">مرتجع من عميل</option>
        <option value="correction">تصحيح جرد</option>
        <option value="other">أخرى</option>
      </Select>
      <div>
        <label className="text-sm text-gray-400 block mb-1">ملاحظة (اختياري)</label>
        <textarea {...register('note')} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)] resize-none" />
      </div>
      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={onClose}>إلغاء</Button>
        <Button loading={isPending} className="flex-1" onClick={handleSubmit((d) => mutate(d))}>تطبيق</Button>
      </div>
    </div>
  )
}

// ─── Min Qty Modal ────────────────────────────────────────────────────────────

function MinQtyModal({ entry, onClose }: { entry: StockEntry; onClose: () => void }) {
  const qc = useQueryClient()
  const { register, handleSubmit } = useForm<{ minQuantity: number }>({ defaultValues: { minQuantity: entry.minQuantity } })

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: { minQuantity: number }) => {
      await api.patch(`/stock/min-quantity?variantId=${entry.variant.id}&branchId=${entry.branch.id}`, { minQuantity: Number(data.minQuantity) })
    },
    onSuccess: () => {
      toast.success('تم تحديث حد التنبيه')
      qc.invalidateQueries({ queryKey: ['stock'] })
      onClose()
    },
    onError: () => toast.error('حدث خطأ'),
  })

  return (
    <div className="flex flex-col gap-4">
      <Input label="الحد الأدنى للتنبيه" type="number" min={0} {...register('minQuantity')} />
      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={onClose}>إلغاء</Button>
        <Button loading={isPending} className="flex-1" onClick={handleSubmit((d) => mutate(d))}>حفظ</Button>
      </div>
    </div>
  )
}

// ─── Create Transfer Drawer ───────────────────────────────────────────────────

const transferSchema = z.object({
  fromBranchId: z.string().uuid('اختر الفرع'),
  toBranchId: z.string().uuid('اختر الفرع'),
  notes: z.string().optional(),
  items: z.array(z.object({
    variantId: z.string().uuid(),
    sku: z.string(),
    productName: z.string(),
    quantity: z.coerce.number().int().positive('الكمية يجب أن تكون أكبر من صفر'),
  })).min(1, 'أضف صنفاً على الأقل'),
})
type TransferForm = z.infer<typeof transferSchema>

function CreateTransferDrawer({ branches, onClose }: { branches: Branch[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [variantSearch, setVariantSearch] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: string; sku: string; product: { name: string } }[]>([])

  const { register, handleSubmit, control, formState: { errors } } = useForm<TransferForm>({
    resolver: zodResolver(transferSchema),
    defaultValues: { items: [] },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })

  const doSearch = async (q: string) => {
    if (!q.trim()) { setSearchResults([]); return }
    try {
      const res = await api.get<{ data: { id: string; sku: string; product: { name: string } }[] }>('/products/search', { params: { q, limit: 6 } })
      setSearchResults(res.data.data)
    } catch { setSearchResults([]) }
  }

  const addVariant = (v: { id: string; sku: string; product: { name: string } }) => {
    if (fields.find((f) => f.variantId === v.id)) return
    append({ variantId: v.id, sku: v.sku, productName: v.product.name, quantity: 1 })
    setVariantSearch('')
    setSearchResults([])
  }

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: TransferForm) => {
      if (data.fromBranchId === data.toBranchId) throw new Error('same_branch')
      await api.post('/stock/transfers', {
        fromBranchId: data.fromBranchId,
        toBranchId: data.toBranchId,
        notes: data.notes,
        items: data.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
      })
    },
    onSuccess: () => {
      toast.success('تم إنشاء طلب التحويل')
      qc.invalidateQueries({ queryKey: ['stock-transfers'] })
      onClose()
    },
    onError: (e: unknown) => {
      const msg = (e as Error).message
      toast.error(msg === 'same_branch' ? 'لا يمكن التحويل للفرع نفسه' : 'فشل إنشاء طلب التحويل')
    },
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Select label="من فرع" error={errors.fromBranchId?.message} {...register('fromBranchId')}>
            <option value="">اختر...</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
        <div>
          <Select label="إلى فرع" error={errors.toBranchId?.message} {...register('toBranchId')}>
            <option value="">اختر...</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
      </div>

      <div>
        <label className="text-sm text-gray-400 block mb-1">ملاحظات (اختياري)</label>
        <textarea {...register('notes')} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)] resize-none" />
      </div>

      <div>
        <p className="text-sm text-gray-400 mb-2">الأصناف</p>
        <div className="relative mb-3">
          <Input
            placeholder="ابحث عن منتج للإضافة..."
            value={variantSearch}
            onChange={(e) => { setVariantSearch(e.target.value); doSearch(e.target.value) }}
            startIcon={<Search className="w-4 h-4" />}
          />
          {searchResults.length > 0 && (
            <div className="absolute z-50 top-full mt-1 w-full bg-gray-800 border border-gray-700 rounded-md shadow-lg overflow-hidden">
              {searchResults.map((v) => (
                <button key={v.id} onClick={() => addVariant(v)}
                  className="w-full text-right px-4 py-2 hover:bg-gray-700 flex items-center justify-between text-sm border-b border-gray-700/50 last:border-0">
                  <span className="text-gray-100">{v.product.name}</span>
                  <span className="num-code text-xs">{v.sku}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {fields.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-4 border border-dashed border-gray-700 rounded-md">ابحث عن منتج لإضافته</p>
        )}
        {errors.items?.root && <p className="text-danger-500 text-xs">{errors.items.root.message}</p>}

        <div className="flex flex-col gap-2">
          {fields.map((field, idx) => (
            <div key={field.id} className="flex items-center gap-3 bg-gray-750 border border-gray-700 rounded-md px-3 py-2">
              <div className="flex-1">
                <p className="text-sm text-gray-100">{field.productName}</p>
                <p className="text-xs text-gray-500 font-mono">{field.sku}</p>
              </div>
              <input
                type="number"
                min={1}
                {...register(`items.${idx}.quantity`)}
                className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-center text-gray-100 focus:outline-none focus:border-brand-500"
              />
              <button onClick={() => remove(idx)} className="text-gray-500 hover:text-danger-500">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>إلغاء</Button>
        <Button loading={isPending} className="flex-1" onClick={handleSubmit((d) => mutate(d))}>
          إرسال طلب التحويل
        </Button>
      </div>
    </div>
  )
}

// ─── Status / type maps ───────────────────────────────────────────────────────

const transferStatusMap: Record<string, { label: string; variant: 'warning' | 'success' | 'danger' }> = {
  pending: { label: 'انتظار', variant: 'warning' },
  completed: { label: 'مكتمل', variant: 'success' },
  rejected: { label: 'مرفوض', variant: 'danger' },
}

const movTypeMap: Record<string, { label: string; color: string }> = {
  manual_adjustment: { label: 'تعديل يدوي', color: 'text-brand-400' },
  in: { label: 'دخول', color: 'text-success-600' },
  sale: { label: 'بيع', color: 'text-danger-600' },
  purchase: { label: 'مشتريات', color: 'text-success-600' },
  return: { label: 'مرتجع', color: 'text-warning-600' },
  transfer: { label: 'تحويل', color: 'text-gray-400' },
  correction: { label: 'تصحيح', color: 'text-gray-400' },
  cancellation: { label: 'إلغاء فاتورة', color: 'text-info-600' },
}

// ─── Stock Tab ────────────────────────────────────────────────────────────────

function StockTab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const lowStockOnly = searchParams.get('lowStockOnly') === 'true'
  const setLowStockOnly = (v: boolean) => {
    const next = new URLSearchParams(searchParams)
    if (v) next.set('lowStockOnly', 'true')
    else next.delete('lowStockOnly')
    setSearchParams(next, { replace: true })
  }
  const [adjustEntry, setAdjustEntry] = useState<StockEntry | null>(null)
  const [minQtyEntry, setMinQtyEntry] = useState<StockEntry | null>(null)

  const { data, isLoading } = useQuery<{ data: StockEntry[]; meta: PaginationMeta }>({
    queryKey: ['stock', page, lowStockOnly],
    queryFn: async () => {
      const params: Record<string, string | number | boolean> = { limit: LIMIT, page }
      if (lowStockOnly) params.lowStock = 'true'
      return (await api.get<{ data: StockEntry[]; meta: PaginationMeta }>('/stock', { params })).data
    },
  })

  const allItems = data?.data ?? []
  const meta = data?.meta
  const items = search.trim()
    ? allItems.filter((s) =>
        s.variant.product.name.toLowerCase().includes(search.toLowerCase()) ||
        s.variant.sku.toLowerCase().includes(search.toLowerCase()))
    : allItems

  return (
    <>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex-1 max-w-xs">
          <Input placeholder="بحث بالمنتج أو SKU..." value={search} onChange={(e) => setSearch(e.target.value)} startIcon={<Search className="w-4 h-4" />} />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
          <input type="checkbox" checked={lowStockOnly} onChange={(e) => { setLowStockOnly(e.target.checked); setPage(1) }} className="w-4 h-4 accent-brand-500" />
          المنخفض فقط
        </label>
      </div>

      {isLoading ? <SkeletonTable rows={10} cols={6} /> : (
        <>
          <Table
            columns={[
              { key: 'product', header: 'المنتج', render: (s) => (
                <div>
                  <p className="font-medium text-gray-100">{s.variant.product.name}</p>
                  <p className="text-xs num-code">{s.variant.sku}</p>
                </div>
              )},
              { key: 'branch', header: 'الفرع', render: (s) => <span className="text-gray-400 text-sm">{s.branch.name}</span> },
              { key: 'quantity', header: 'الكمية', render: (s) => (
                <span className={cn('font-numeric num font-semibold text-base', s.quantity === 0 ? 'text-danger-500' : s.quantity <= s.minQuantity ? 'text-warning-500' : 'text-success-500')}>
                  {s.quantity}
                </span>
              )},
              { key: 'minQuantity', header: 'حد التنبيه', render: (s) => <span className="font-numeric num num-muted text-sm">{s.minQuantity}</span> },
              { key: 'status', header: 'الحالة', render: (s) =>
                s.quantity === 0
                  ? <Badge variant="danger" dot>نفذ</Badge>
                  : s.quantity <= s.minQuantity
                  ? <Badge variant="warning" dot>منخفض</Badge>
                  : <Badge variant="success" dot>متاح</Badge>
              },
              { key: 'actions', header: '', render: (s) => (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setMinQtyEntry(s)} title="تعديل حد التنبيه">
                    <Settings2 className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setAdjustEntry(s)}>
                    تعديل
                  </Button>
                </div>
              )},
            ]}
            data={items} keyExtractor={(s) => s.id} emptyMessage="لا توجد بيانات مخزون" emptyIcon={<Package className="w-8 h-8" />} emptyDescription="أضف منتجات وسجّل المخزون الأولي"
          />
          {meta && <Pagination page={meta.page} pages={meta.pages} total={meta.total} limit={meta.limit} onPage={setPage} />}
        </>
      )}

      <Modal open={!!adjustEntry} onClose={() => setAdjustEntry(null)} title={`تعديل مخزون: ${adjustEntry?.variant.product.name ?? ''}`}>
        {adjustEntry && <AdjustModal entry={adjustEntry} onClose={() => setAdjustEntry(null)} />}
      </Modal>

      <Modal open={!!minQtyEntry} onClose={() => setMinQtyEntry(null)} title={`حد التنبيه: ${minQtyEntry?.variant.product.name ?? ''}`}>
        {minQtyEntry && <MinQtyModal entry={minQtyEntry} onClose={() => setMinQtyEntry(null)} />}
      </Modal>
    </>
  )
}

// ─── Movements Tab ────────────────────────────────────────────────────────────

function MovementsTab() {
  const [page, setPage] = useState(1)
  const [typeFilter, setTypeFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const { data, isLoading } = useQuery<{ data: Movement[]; meta: PaginationMeta }>({
    queryKey: ['stock-movements', page, typeFilter, from, to],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit: LIMIT, page }
      if (typeFilter) params.type = typeFilter
      if (from) params.from = from
      if (to) params.to = to
      return (await api.get<{ data: Movement[]; meta: PaginationMeta }>('/stock/movements', { params })).data
    },
  })

  const items = data?.data ?? []
  const meta = data?.meta

  const selection = useSelection(items.map((m) => m.id))

  const bulkExport = async () => {
    const selected = items.filter((m) => selection.isSelected(m.id))
    await exportRowsToExcel(
      selected,
      [
        { header: 'المنتج', accessor: (m) => m.variant.product.name, width: 28 },
        { header: 'SKU', accessor: (m) => m.variant.sku, width: 18 },
        { header: 'الفرع', accessor: (m) => m.branch.name, width: 16 },
        { header: 'النوع', accessor: (m) => movTypeMap[m.type]?.label ?? m.type, width: 14 },
        { header: 'الكمية', accessor: 'quantity', width: 10 },
        { header: 'المستخدم', accessor: (m) => m.user?.fullName ?? '', width: 22 },
        { header: 'التاريخ', accessor: (m) => formatDateTime(m.createdAt), width: 22 },
      ],
      `stock-movements-${selected.length}.xlsx`,
      'حركات المخزون',
    )
  }

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}>
          <option value="">كل الحركات</option>
          <option value="in">دخول</option>
          <option value="sale">بيع</option>
          <option value="return">مرتجع</option>
          <option value="transfer">تحويل</option>
          <option value="manual_adjustment">تعديل يدوي</option>
          <option value="correction">تصحيح</option>
          <option value="cancellation">إلغاء فاتورة</option>
        </Select>
        <DateRangePicker
          value={{ from, to }}
          onChange={(v) => { setFrom(v.from); setTo(v.to); setPage(1) }}
        />
      </div>

      {isLoading ? <SkeletonTable rows={10} cols={6} /> : (
        <>
          <Table
            selection={{
              isSelected: (m) => selection.isSelected(m.id),
              onToggle: (m) => selection.toggle(m.id),
              onToggleAll: selection.toggleAllVisible,
              allSelected: selection.allVisibleSelected,
              someSelected: selection.someVisibleSelected,
            }}
            columns={[
              { key: 'product', header: 'المنتج', render: (m) => (
                <div>
                  <p className="font-medium text-gray-100 text-sm">{m.variant.product.name}</p>
                  <p className="text-xs num-code">{m.variant.sku}</p>
                </div>
              )},
              { key: 'branch', header: 'الفرع', render: (m) => <span className="text-gray-400 text-sm">{m.branch.name}</span> },
              { key: 'type', header: 'النوع', render: (m) => {
                const t = movTypeMap[m.type] ?? { label: m.type, color: 'text-gray-400' }
                return <span className={cn('text-sm font-medium', t.color)}>{t.label}</span>
              }},
              { key: 'quantity', header: 'الكمية', render: (m) => (
                <span className={cn('font-mono font-semibold', m.quantity > 0 ? 'text-success-500' : 'text-danger-500')}>
                  {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                </span>
              )},
              { key: 'user', header: 'المستخدم', render: (m) => <span className="text-gray-500 text-sm">{m.user?.fullName ?? '—'}</span> },
              { key: 'createdAt', header: 'التاريخ', render: (m) => (
                <span className="text-gray-500 text-xs">{formatDateTime(m.createdAt)}</span>
              )},
            ]}
            data={items} keyExtractor={(m) => m.id} emptyMessage="لا توجد حركات مخزون" emptyIcon={<TrendingUp className="w-8 h-8" />} emptyDescription="ستظهر هنا حركات الدخول والخروج تلقائياً"
          />
          {meta && <Pagination page={meta.page} pages={meta.pages} total={meta.total} limit={meta.limit} onPage={setPage} />}
        </>
      )}
      <BulkActionBar count={selection.count} onClear={selection.clear}>
        <Button variant="outline" size="sm" onClick={bulkExport}>
          <Download className="w-4 h-4" />تصدير
        </Button>
      </BulkActionBar>
    </>
  )
}

// ─── Transfers Tab ────────────────────────────────────────────────────────────

function TransfersTab() {
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [detailTransfer, setDetailTransfer] = useState<TransferDetail | null>(null)

  const canApprove = user?.roleSlug === 'super_admin' || user?.permissions?.stock?.includes('transfer')

  const { data: branchData } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get<{ data: Branch[] }>('/branches')).data.data,
  })
  const branches = branchData ?? []

  const { data, isLoading } = useQuery<{ data: Transfer[]; meta: PaginationMeta }>({
    queryKey: ['stock-transfers', page, statusFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit: LIMIT, page }
      if (statusFilter) params.status = statusFilter
      return (await api.get<{ data: Transfer[]; meta: PaginationMeta }>('/stock/transfers', { params })).data
    },
  })

  const items = data?.data ?? []
  const meta = data?.meta

  const openDetail = async (t: Transfer) => {
    const res = await api.get<{ data: TransferDetail }>(`/stock/transfers/${t.id}`)
    setDetailTransfer(res.data.data)
  }

  const { mutate: reviewTransfer, isPending: isReviewing } = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'approve' | 'reject' }) => {
      await api.patch(`/stock/transfers/${id}/approve`, { action })
    },
    onSuccess: (_, { action }) => {
      toast.success(action === 'approve' ? 'تم اعتماد التحويل' : 'تم رفض التحويل')
      qc.invalidateQueries({ queryKey: ['stock-transfers'] })
      qc.invalidateQueries({ queryKey: ['stock'] })
      setDetailTransfer(null)
    },
    onError: (e: unknown) => {
      toast.error(getApiErrorCode(e) === 'insufficient_stock' ? 'المخزون غير كافٍ لإتمام التحويل' : 'فشلت العملية')
    },
  })

  return (
    <>
      <div className="flex items-center gap-4">
        <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
          <option value="">كل التحويلات</option>
          <option value="pending">انتظار</option>
          <option value="completed">مكتمل</option>
          <option value="rejected">مرفوض</option>
        </Select>
        <div className="flex-1" />
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" />طلب تحويل
        </Button>
      </div>

      {isLoading ? <SkeletonTable rows={8} cols={6} /> : (
        <>
          <Table
            columns={[
              { key: 'from', header: 'من', render: (t) => <span className="text-gray-200 text-sm font-medium">{t.fromBranch.name}</span> },
              { key: 'to', header: 'إلى', render: (t) => <span className="text-gray-200 text-sm font-medium">{t.toBranch.name}</span> },
              { key: 'items', header: 'الأصناف', render: (t) => <span className="text-gray-500 text-sm">{t._count.items} صنف</span> },
              { key: 'createdBy', header: 'أنشأه', render: (t) => <span className="text-gray-400 text-sm">{t.createdBy.fullName}</span> },
              { key: 'status', header: 'الحالة', render: (t) => {
                const s = transferStatusMap[t.status]
                return s ? <Badge variant={s.variant} dot>{s.label}</Badge> : <span>{t.status}</span>
              }},
              { key: 'createdAt', header: 'التاريخ', render: (t) => <span className="text-gray-500 text-xs">{formatDate(t.createdAt)}</span> },
              { key: 'actions', header: '', render: (t) => (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openDetail(t)}>تفاصيل</Button>
                  {t.status === 'pending' && canApprove && (
                    <>
                      <Button variant="ghost" size="sm" className="text-success-500" onClick={() => reviewTransfer({ id: t.id, action: 'approve' })}>
                        <Check className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-danger-500" onClick={() => reviewTransfer({ id: t.id, action: 'reject' })}>
                        <X className="w-3 h-3" />
                      </Button>
                    </>
                  )}
                </div>
              )},
            ]}
            data={items} keyExtractor={(t) => t.id} emptyMessage="لا توجد طلبات تحويل" emptyIcon={<ArrowLeftRight className="w-8 h-8" />} emptyDescription="أنشئ طلب تحويل لنقل المخزون بين الفروع"
          />
          {meta && <Pagination page={meta.page} pages={meta.pages} total={meta.total} limit={meta.limit} onPage={setPage} />}
        </>
      )}

      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="طلب تحويل مخزون" width="w-[520px]">
        {createOpen && <CreateTransferDrawer branches={branches} onClose={() => setCreateOpen(false)} />}
      </Drawer>

      <Drawer
        open={!!detailTransfer}
        onClose={() => setDetailTransfer(null)}
        title="تفاصيل التحويل"
        width="w-[480px]"
        footer={
          detailTransfer?.status === 'pending' && canApprove ? (
            <div className="flex gap-2">
              <Button variant="danger" loading={isReviewing} onClick={() => detailTransfer && reviewTransfer({ id: detailTransfer.id, action: 'reject' })}>
                <X className="w-4 h-4" />رفض
              </Button>
              <Button loading={isReviewing} onClick={() => detailTransfer && reviewTransfer({ id: detailTransfer.id, action: 'approve' })}>
                <Check className="w-4 h-4" />اعتماد
              </Button>
            </div>
          ) : undefined
        }
      >
        {detailTransfer && (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">من فرع</span><p className="text-gray-100 font-medium mt-1">{detailTransfer.fromBranch.name}</p></div>
              <div><span className="text-gray-500">إلى فرع</span><p className="text-gray-100 font-medium mt-1">{detailTransfer.toBranch.name}</p></div>
              <div><span className="text-gray-500">أنشأه</span><p className="text-gray-100 mt-1">{detailTransfer.createdBy.fullName}</p></div>
              <div>
                <span className="text-gray-500">الحالة</span>
                <p className="mt-1">
                  {(() => { const s = transferStatusMap[detailTransfer.status]; return s ? <Badge variant={s.variant} dot>{s.label}</Badge> : null })()}
                </p>
              </div>
              {detailTransfer.approvedBy && (
                <div><span className="text-gray-500">اعتمده</span><p className="text-gray-100 mt-1">{detailTransfer.approvedBy.fullName}</p></div>
              )}
              {detailTransfer.notes && (
                <div className="col-span-2"><span className="text-gray-500">ملاحظات</span><p className="text-gray-300 mt-1 text-sm">{detailTransfer.notes}</p></div>
              )}
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-3">الأصناف</h4>
              <div className="flex flex-col gap-2">
                {detailTransfer.items.map((item) => (
                  <div key={item.id} className="flex justify-between items-center py-2 border-b border-gray-700 last:border-0 text-sm">
                    <div>
                      <p className="text-gray-100">{item.variant.product.name}</p>
                      <p className="text-xs num-code">{item.variant.sku}</p>
                    </div>
                    <span className="font-numeric num num-strong font-semibold">{item.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

type Tab = 'stock' | 'movements' | 'transfers'

export default function Stock() {
  const [activeTab, setActiveTab] = useState<Tab>('stock')

  return (
    <AppShell title="المخزون">
      <div className="flex flex-col gap-6">
        <div className="flex gap-1 border-b border-gray-700">
          {([
            { id: 'stock' as Tab, label: 'مستوى المخزون', icon: <TrendingUp className="w-4 h-4" /> },
            { id: 'movements' as Tab, label: 'حركات المخزون', icon: <TrendingUp className="w-4 h-4" /> },
            { id: 'transfers' as Tab, label: 'التحويلات بين الفروع', icon: <ArrowLeftRight className="w-4 h-4" /> },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
                activeTab === tab.id
                  ? 'border-brand-500 text-brand-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200',
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'stock' && <StockTab />}
        {activeTab === 'movements' && <MovementsTab />}
        {activeTab === 'transfers' && <TransfersTab />}
      </div>
    </AppShell>
  )
}
