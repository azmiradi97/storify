import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Eye, Check, Trash2, PackageCheck, CreditCard, Printer, SendHorizontal, Download, Pencil as Edit } from 'lucide-react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { AppShell } from '@/components/layout/AppShell'
import { Table, Badge, Money, SkeletonTable, Button, Drawer, Modal, Input, Select, Pagination, BulkActionBar } from '@/components/ui'
import { api } from '@/api/client'
import { getApiErrorCode } from '@/lib/api-error'
import { purchaseOrderStatusMap, getStatus } from '@/constants/status'
import { printPurchaseOrder } from '@/lib/print'
import { useSelection } from '@/hooks/useSelection'
import { exportRowsToExcel } from '@/lib/export'
import { formatNumber, formatDate } from '@/lib/format'

interface Supplier { id: string; name: string }
interface Branch { id: string; name: string; isMain: boolean }
interface Variant { id: string; sku: string; product: { name: string } }

interface POItem {
  id: string
  variant: { id: string; sku: string; product: { name: string } }
  quantity: number
  receivedQuantity?: number
  unitCost: number
  subtotal: number
}

interface PurchaseOrder {
  id: string
  supplier?: { id: string; name: string }
  branch?: { id: string; name: string }
  status: 'draft' | 'pending' | 'approved' | 'partially_received' | 'received' | 'cancelled'
  totalAmount: number
  expectedDate?: string
  createdAt: string
  _count?: { items: number }
  items?: POItem[]
  createdBy?: { fullName: string }
  approvedBy?: { fullName: string }
}

// ─── Receive Modal ────────────────────────────────────────────────────────────

interface ReceivePayload {
  receivedDate?: string
  notes?: string
  items?: { id: string; quantity: number }[]
}

function ReceiveModal({ po, onClose, onConfirm, isPending }: { po: PurchaseOrder | null; onClose: () => void; onConfirm: (d: ReceivePayload) => void; isPending: boolean }) {
  const [date, setDate] = useState('')
  const [notes, setNotes] = useState('')
  // qty[itemId] = how much to receive in this batch
  const [qty, setQty] = useState<Record<string, number>>({})

  // Seed the quantity inputs with each line's outstanding amount whenever the
  // modal opens for a new PO — so the default action is "receive everything
  // remaining" and partial is opt-in by editing.
  useEffect(() => {
    if (!po?.items) return
    const seed: Record<string, number> = {}
    for (const it of po.items) {
      const outstanding = it.quantity - (it.receivedQuantity ?? 0)
      seed[it.id] = Math.max(0, outstanding)
    }
    setQty(seed)
    setDate('')
    setNotes('')
  }, [po?.id])

  if (!po) return null
  const items = po.items ?? []
  const anyToReceive = Object.values(qty).some((q) => q > 0)
  const totalToReceive = Object.values(qty).reduce((s, q) => s + q, 0)

  const setItemQty = (id: string, value: number, max: number) => {
    const clamped = Math.max(0, Math.min(value, max))
    setQty((prev) => ({ ...prev, [id]: clamped }))
  }
  const fillAll = () => {
    const next: Record<string, number> = {}
    for (const it of items) next[it.id] = Math.max(0, it.quantity - (it.receivedQuantity ?? 0))
    setQty(next)
  }
  const clearAll = () => setQty(Object.fromEntries(items.map((i) => [i.id, 0])))

  const submit = () => onConfirm({
    receivedDate: date || undefined,
    notes: notes || undefined,
    items: items
      .map((it) => ({ id: it.id, quantity: qty[it.id] ?? 0 }))
      .filter((r) => r.quantity > 0),
  })

  return (
    <Modal open={!!po} onClose={onClose} title={`استلام أمر الشراء: ${(po?.id ?? '').slice(0, 8).toUpperCase()}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button loading={isPending} disabled={!anyToReceive} onClick={submit}>
            <PackageCheck className="w-4 h-4" />تأكيد الاستلام ({totalToReceive})
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-400">
          عدّل الكمية لكل صنف لتسجيل استلام جزئي. ستُحوّل حالة الأمر تلقائياً إلى
          <span className="text-warning-600 mx-1">"مستلم جزئياً"</span>
          إذا بقيت كميات.
        </p>

        <div className="bg-gray-800 border border-gray-700 rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-800 text-xs uppercase text-gray-500">
              <tr>
                <th className="text-right px-3 py-2 font-medium">الصنف</th>
                <th className="text-center px-3 py-2 font-medium w-20">مطلوب</th>
                <th className="text-center px-3 py-2 font-medium w-20">سابقاً</th>
                <th className="text-center px-3 py-2 font-medium w-24">استلام الآن</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const received = it.receivedQuantity ?? 0
                const outstanding = it.quantity - received
                return (
                  <tr key={it.id} className="border-t border-gray-700/50">
                    <td className="px-3 py-2">
                      <p className="text-gray-100">{it.variant.product.name}</p>
                      <p className="text-xs num-code">{it.variant.sku}</p>
                    </td>
                    <td className="px-3 py-2 text-center font-numeric num num-strong">{it.quantity}</td>
                    <td className="px-3 py-2 text-center font-numeric num num-muted">{received}</td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="number"
                        min={0}
                        max={outstanding}
                        value={qty[it.id] ?? 0}
                        disabled={outstanding === 0}
                        onChange={(e) => setItemQty(it.id, Number(e.target.value), outstanding)}
                        className="w-16 text-center bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-100 font-mono focus:outline-none focus:border-brand-500 disabled:opacity-40"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2 -mt-2">
          <button type="button" onClick={fillAll} className="text-xs text-brand-400 hover:text-brand-600">استلام الكل المتبقي</button>
          <span className="text-gray-700">·</span>
          <button type="button" onClick={clearAll} className="text-xs text-gray-500 hover:text-gray-300">مسح</button>
        </div>

        <Input label="تاريخ الاستلام" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <div>
          <label className="text-sm text-gray-400 block mb-1">ملاحظات (اختياري)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)] resize-none" />
        </div>
      </div>
    </Modal>
  )
}

// ─── Payment Modal ────────────────────────────────────────────────────────────

function PaymentModal({ po, onClose, onConfirm, isPending }: { po: PurchaseOrder | null; onClose: () => void; onConfirm: (d: { amount: number; paymentMethod?: string }) => void; isPending: boolean }) {
  const { register, handleSubmit, formState: { errors } } = useForm<{ amount: number; paymentMethod?: string }>({
    resolver: zodResolver(z.object({ amount: z.coerce.number().positive('المبلغ يجب أن يكون أكبر من صفر'), paymentMethod: z.string().optional() })),
  })
  if (!po) return null
  return (
    <Modal open={!!po} onClose={onClose} title={`تسجيل دفعة: ${(po?.id ?? '').slice(0, 8).toUpperCase()}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button loading={isPending} onClick={handleSubmit(onConfirm)}>
            <CreditCard className="w-4 h-4" />تسجيل الدفعة
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input label="المبلغ المدفوع (ج)" type="number" step="0.01" error={errors.amount?.message} {...register('amount')} />
        <Select label="طريقة الدفع (اختياري)" {...register('paymentMethod')}>
          <option value="">اختر</option>
          <option value="cash">نقدي</option>
          <option value="bank_transfer">تحويل بنكي</option>
          <option value="check">شيك</option>
        </Select>
      </div>
    </Modal>
  )
}

const schema = z.object({
  supplierId: z.string().uuid('اختر المورد'),
  branchId: z.string().uuid('اختر الفرع'),
  expectedDate: z.string().optional(),
  paymentType: z.string().optional(),
  items: z.array(z.object({
    variantId: z.string().uuid('اختر منتجاً'),
    variantLabel: z.string().optional(),
    quantity: z.coerce.number().int().positive('يجب أن يكون موجباً'),
    unitCost: z.coerce.number().positive('يجب أن يكون أكبر من صفر'),
  })).min(1, 'أضف صنفاً واحداً على الأقل'),
})
type FormData = z.infer<typeof schema>

// ─── Per-row variant search ───────────────────────────────────────────────────
function VariantSearchField({
  index,
  register,
  setValue,
  error,
}: {
  index: number
  register: ReturnType<typeof useForm<FormData>>['register']
  setValue: ReturnType<typeof useForm<FormData>>['setValue']
  error?: string
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Variant[]>([])
  const [selected, setSelected] = useState<string>('')

  const search = async (query: string) => {
    setQ(query)
    if (query.length < 2) { setResults([]); return }
    const res = await api.get<{ data: Variant[] }>('/products/search', { params: { q: query, limit: 8 } })
    setResults(res.data.data)
  }

  const pick = (v: Variant) => {
    setValue(`items.${index}.variantId`, v.id, { shouldValidate: true })
    setValue(`items.${index}.variantLabel`, `${v.product.name} (${v.sku})`)
    setSelected(`${v.product.name} (${v.sku})`)
    setResults([])
    setQ('')
  }

  return (
    <div className="relative flex-1">
      <input
        value={selected || q}
        placeholder="بحث عن منتج بالاسم أو SKU..."
        onChange={(e) => { setSelected(''); search(e.target.value) }}
        className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)]"
      />
      <input type="hidden" {...register(`items.${index}.variantId`)} />
      {results.length > 0 && (
        <div className="absolute z-50 w-full bg-gray-800 border border-gray-600 rounded-md mt-1 shadow-lg max-h-40 overflow-y-auto">
          {results.map((v) => (
            <button key={v.id} type="button"
              className="w-full text-right px-3 py-2 text-sm hover:bg-gray-700 text-gray-200"
              onClick={() => pick(v)}
            >
              {v.product.name} <span className="num-code text-xs mr-1">{v.sku}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-danger-500 text-xs mt-1">{error}</p>}
    </div>
  )
}

function printPO(po: PurchaseOrder) {
  const statusLabel = getStatus(purchaseOrderStatusMap, po.status).label
  printPurchaseOrder(po, statusLabel)
}

export default function PurchaseOrders() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingPO, setEditingPO] = useState<PurchaseOrder | null>(null)
  const [detailPO, setDetailPO] = useState<PurchaseOrder | null>(null)
  const [approveTarget, setApproveTarget] = useState<PurchaseOrder | null>(null)
  const [receiveTarget, setReceiveTarget] = useState<PurchaseOrder | null>(null)
  const [paymentTarget, setPaymentTarget] = useState<PurchaseOrder | null>(null)

  const { data: poData, isLoading } = useQuery<{ data: PurchaseOrder[]; meta: { total: number; page: number; limit: number; pages: number } }>({
    queryKey: ['purchase-orders', page],
    queryFn: async () => (await api.get<{ data: PurchaseOrder[]; meta: { total: number; page: number; limit: number; pages: number } }>('/purchase-orders', { params: { limit: 20, page } })).data,
  })

  const data = poData?.data ?? []
  const meta = poData?.meta

  const selection = useSelection(data.map((p) => p.id))

  const bulkExport = async () => {
    const selected = data.filter((p) => selection.isSelected(p.id))
    await exportRowsToExcel(
      selected,
      [
        { header: 'رقم الأمر', accessor: (p) => p.id.slice(0, 8).toUpperCase(), width: 18 },
        { header: 'المورد', accessor: (p) => p.supplier?.name ?? '', width: 24 },
        { header: 'الفرع', accessor: (p) => p.branch?.name ?? '', width: 16 },
        { header: 'الحالة', accessor: (p) => getStatus(purchaseOrderStatusMap, p.status).label, width: 14 },
        { header: 'الأصناف', accessor: (p) => p._count?.items ?? 0, width: 10 },
        { header: 'الإجمالي', accessor: 'totalAmount', width: 14 },
        { header: 'التاريخ المتوقع', accessor: (p) => p.expectedDate ?? '', width: 14 },
        { header: 'أُنشئ', accessor: (p) => formatDate(p.createdAt), width: 14 },
      ],
      `purchase-orders-${selected.length}.xlsx`,
      'أوامر الشراء',
    )
  }

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get<{ data: Supplier[] }>('/suppliers', { params: { limit: 100 } })).data.data,
  })

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get<{ data: Branch[] }>('/branches')).data.data,
  })

  const { register, handleSubmit, control, watch, reset, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { items: [{ variantId: '', variantLabel: '', quantity: 1, unitCost: 0 }] },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'items' })

  const { mutate: create, isPending: isCreating } = useMutation({
    mutationFn: async (data: FormData) => {
      const body = {
        supplierId: data.supplierId,
        branchId: data.branchId,
        expectedDate: data.expectedDate || undefined,
        paymentType: data.paymentType || undefined,
        items: data.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, unitCost: i.unitCost })),
      }
      if (editingPO) {
        return api.patch(`/purchase-orders/${editingPO.id}`, body)
      }
      return api.post('/purchase-orders', body)
    },
    onSuccess: () => {
      toast.success(editingPO ? 'تم تحديث أمر الشراء' : 'تم إنشاء أمر الشراء')
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      setDrawerOpen(false)
      setEditingPO(null)
      reset()
    },
    onError: (e) => toast.error(getApiErrorCode(e) === 'not_draft' ? 'لا يمكن تعديل أمر شراء بعد إرساله' : 'حدث خطأ'),
  })

  const { mutate: submit, isPending: isSubmitting } = useMutation({
    mutationFn: async (id: string) => api.patch(`/purchase-orders/${id}/submit`),
    onSuccess: () => {
      toast.success('تم إرسال أمر الشراء للموافقة')
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
    },
    onError: () => toast.error('حدث خطأ'),
  })

  const openEdit = (po: PurchaseOrder) => {
    setEditingPO(po)
    setDetailPO(null)
    reset({
      supplierId: po.supplier?.id ?? '',
      branchId: po.branch?.id ?? '',
      expectedDate: po.expectedDate ? po.expectedDate.slice(0, 10) : '',
      paymentType: '',
      items: (po.items ?? []).map((it) => ({
        variantId: it.variant.id,
        variantLabel: `${it.variant.product.name} (${it.variant.sku})`,
        quantity: it.quantity,
        unitCost: Number(it.unitCost),
      })),
    })
    setDrawerOpen(true)
  }

  const { mutate: approve, isPending: isApproving } = useMutation({
    mutationFn: async (id: string) => api.patch(`/purchase-orders/${id}/approve`),
    onSuccess: () => {
      toast.success('تمت الموافقة على أمر الشراء')
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      setApproveTarget(null)
    },
    onError: () => toast.error('حدث خطأ'),
  })

  const { mutate: receive, isPending: isReceiving } = useMutation({
    mutationFn: async ({ id, ...payload }: { id: string } & ReceivePayload) =>
      (await api.post<{ data: { status: string; itemsReceived: number } }>(`/purchase-orders/${id}/receive`, payload)).data.data,
    onSuccess: (result) => {
      toast.success(result.status === 'received' ? 'تم استلام أمر الشراء بالكامل' : 'تم تسجيل الاستلام الجزئي')
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      qc.invalidateQueries({ queryKey: ['stock'] })
      setReceiveTarget(null)
    },
    onError: (e: unknown) => {
      const code = getApiErrorCode(e)
      toast.error(
        code === 'invalid_status' ? 'أمر الشراء يجب أن يكون معتمداً أولاً'
        : code === 'qty_exceeds_outstanding' ? 'الكمية المطلوبة تتجاوز المتبقي'
        : code === 'nothing_to_receive' ? 'لا توجد كميات متبقية للاستلام'
        : 'حدث خطأ في الاستلام',
      )
    },
  })

  const { mutate: recordPayment, isPending: isPaymentPending } = useMutation({
    mutationFn: async ({ id, amount, paymentMethod }: { id: string; amount: number; paymentMethod?: string }) =>
      api.post(`/purchase-orders/${id}/payments`, { amount, paymentMethod: paymentMethod || undefined }),
    onSuccess: () => {
      toast.success('تم تسجيل الدفعة للمورد')
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      setPaymentTarget(null)
    },
    onError: () => toast.error('حدث خطأ في تسجيل الدفعة'),
  })

  const openDetail = async (po: PurchaseOrder) => {
    try {
      // Show drawer immediately with list data while fetching details
      setDetailPO(po)
      const res = await api.get<{ data: PurchaseOrder }>(`/purchase-orders/${po.id}`)
      setDetailPO(res.data.data)
    } catch {
      toast.error('تعذر تحميل تفاصيل الأمر')
    }
  }

  const items = watch('items')
  const totalCost = items.reduce((sum, item) => sum + (Number(item.unitCost) * Number(item.quantity) || 0), 0)

  return (
    <AppShell title="أوامر الشراء">
      <div className="flex flex-col gap-6">
        <div className="flex justify-end">
          <Button onClick={() => {
            reset({ items: [{ variantId: '', variantLabel: '', quantity: 1, unitCost: 0 }] })
            setDrawerOpen(true)
          }}>
            <Plus className="w-4 h-4" />أمر شراء جديد
          </Button>
        </div>

        {isLoading ? <SkeletonTable rows={8} cols={6} /> : (
          <>
          <Table
            selection={{
              isSelected: (p) => selection.isSelected(p.id),
              onToggle: (p) => selection.toggle(p.id),
              onToggleAll: selection.toggleAllVisible,
              allSelected: selection.allVisibleSelected,
              someSelected: selection.someVisibleSelected,
            }}
            columns={[
              { key: 'id', header: 'رقم الأمر', render: (po) => (
                <button className="num-code hover:underline text-xs" onClick={() => openDetail(po)}>{po.id.slice(0, 8).toUpperCase()}</button>
              )},
              { key: 'supplier', header: 'المورد', render: (po) => <span className="text-gray-100">{po.supplier?.name ?? '—'}</span> },
              { key: 'branch', header: 'الفرع', render: (po) => <span className="text-gray-400">{po.branch?.name ?? '—'}</span> },
              { key: 'items', header: 'الأصناف', render: (po) => <span className="font-numeric num num-strong">{po._count?.items ?? 0}</span> },
              { key: 'totalAmount', header: 'الإجمالي', render: (po) => <Money value={Number(po.totalAmount)} /> },
              { key: 'status', header: 'الحالة', render: (po) => {
                const s = getStatus(purchaseOrderStatusMap, po.status)
                return <Badge variant={s.variant} dot>{s.label}</Badge>
              }},
              { key: 'actions', header: '', render: (po) => (
                <div className="flex gap-1 flex-wrap">
                  <Button variant="ghost" size="sm" onClick={() => openDetail(po)}><Eye className="w-3 h-3" /></Button>
                  {po.status === 'draft' && (
                    <Button variant="ghost" size="sm" className="text-warning-500" onClick={() => submit(po.id)} loading={isSubmitting} title="إرسال للموافقة">
                      <SendHorizontal className="w-3 h-3" />
                    </Button>
                  )}
                  {po.status === 'pending' && (
                    <Button variant="ghost" size="sm" className="text-success-500" onClick={() => setApproveTarget(po)} title="الموافقة على الأمر">
                      <Check className="w-3 h-3" />
                    </Button>
                  )}
                  {po.status === 'approved' && (
                    <Button variant="ghost" size="sm" className="text-info-500" onClick={() => setReceiveTarget(po)} title="استلام البضاعة">
                      <PackageCheck className="w-3 h-3" />
                    </Button>
                  )}
                  {po.status === 'received' && (
                    <Button variant="ghost" size="sm" className="text-brand-400" onClick={() => setPaymentTarget(po)} title="تسجيل دفعة للمورد">
                      <CreditCard className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              )},
            ]}
            data={data} keyExtractor={(po) => po.id} emptyMessage="لا توجد أوامر شراء"
          />
          {meta && <Pagination page={meta.page} pages={meta.pages} total={meta.total} limit={meta.limit} onPage={setPage} />}
          </>
        )}
      </div>

      {/* Create / Edit PO Drawer */}
      <Drawer
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setEditingPO(null) }}
        title={editingPO ? `تعديل أمر #${editingPO.id.slice(0, 8).toUpperCase()}` : 'أمر شراء جديد'}
        width="w-[560px]"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setDrawerOpen(false); setEditingPO(null) }}>إلغاء</Button>
            <Button loading={isCreating} onClick={handleSubmit((d) => create(d))}>
              {editingPO ? 'حفظ التغييرات' : 'إنشاء الأمر'}
            </Button>
          </>
        }
      >
        <form className="flex flex-col gap-5">
          <Select label="المورد" error={errors.supplierId?.message} {...register('supplierId')}>
            <option value="">اختر المورد</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>

          <Select label="الفرع" error={errors.branchId?.message} {...register('branchId')}>
            <option value="">اختر الفرع</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>

          <div className="grid grid-cols-2 gap-4">
            <Input label="تاريخ التسليم المتوقع" type="date" {...register('expectedDate')} />
            <Select label="طريقة الدفع" {...register('paymentType')}>
              <option value="">اختر</option>
              <option value="cash">نقدي</option>
              <option value="credit">آجل</option>
              <option value="bank_transfer">تحويل بنكي</option>
            </Select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-semibold text-gray-300">الأصناف</label>
              <Button type="button" variant="ghost" size="sm"
                onClick={() => append({ variantId: '', variantLabel: '', quantity: 1, unitCost: 0 })}>
                <Plus className="w-3 h-3" />إضافة صنف
              </Button>
            </div>

            <div className="flex flex-col gap-3">
              {fields.map((field, idx) => (
                <div key={field.id} className="bg-gray-750 border border-gray-700 rounded-md p-3 flex flex-col gap-2">
                  <div className="flex gap-2 items-start">
                    <VariantSearchField
                      index={idx}
                      register={register}
                      setValue={setValue}
                      error={(errors.items?.[idx]?.variantId as { message?: string } | undefined)?.message}
                    />
                    <Button type="button" variant="ghost" size="sm" className="text-danger-500 mt-1" onClick={() => remove(idx)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input label="الكمية" type="number" min={1} {...register(`items.${idx}.quantity`)}
                      error={(errors.items?.[idx]?.quantity as { message?: string } | undefined)?.message} />
                    <Input label="سعر الوحدة (ج)" type="number" step="0.01" {...register(`items.${idx}.unitCost`)}
                      error={(errors.items?.[idx]?.unitCost as { message?: string } | undefined)?.message} />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between text-sm mt-3 bg-gray-750 rounded-md px-3 py-2 border border-gray-700">
              <span className="text-gray-400">الإجمالي التقديري</span>
              <span className="font-semibold text-gray-100">{formatNumber(totalCost)} ج</span>
            </div>
          </div>
        </form>
      </Drawer>

      {/* PO Detail Drawer */}
      <Drawer open={!!detailPO} onClose={() => setDetailPO(null)} title={`أمر شراء #${(detailPO?.id ?? '').slice(0, 8).toUpperCase()}`} width="w-[520px]">
        {detailPO && (
          <div className="flex flex-col gap-6">
            {/* ── Action buttons at the TOP so they're always visible ── */}
            <div className="flex flex-wrap gap-2">
              {detailPO.status === 'draft' && (
                <Button loading={isSubmitting} onClick={() => { submit(detailPO.id); setDetailPO(null) }}>
                  <SendHorizontal className="w-4 h-4" />إرسال للموافقة
                </Button>
              )}
              {detailPO.status === 'pending' && (
                <Button onClick={() => { setDetailPO(null); setApproveTarget(detailPO) }}>
                  <Check className="w-4 h-4" />الموافقة على الأمر
                </Button>
              )}
              {detailPO.status === 'approved' && (
                <Button onClick={() => { setDetailPO(null); setReceiveTarget(detailPO) }}>
                  <PackageCheck className="w-4 h-4" />استلام البضاعة
                </Button>
              )}
              {detailPO.status === 'received' && (
                <Button variant="secondary" onClick={() => { setDetailPO(null); setPaymentTarget(detailPO) }}>
                  <CreditCard className="w-4 h-4" />تسجيل دفعة للمورد
                </Button>
              )}
              <Button variant="secondary" onClick={() => printPO(detailPO)}>
                <Printer className="w-4 h-4" />طباعة
              </Button>
            </div>

            {/* ── Metadata ── */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">المورد</span><p className="text-gray-100 font-medium">{detailPO.supplier?.name ?? '—'}</p></div>
              <div><span className="text-gray-500">الفرع</span><p className="text-gray-100">{detailPO.branch?.name ?? '—'}</p></div>
              <div><span className="text-gray-500">الحالة</span>{(() => { const s = getStatus(purchaseOrderStatusMap, detailPO.status); return <Badge variant={s.variant} dot>{s.label}</Badge> })()}</div>
              <div><span className="text-gray-500">أنشأه</span><p className="text-gray-100">{detailPO.createdBy?.fullName ?? '—'}</p></div>
              {detailPO.approvedBy && <div><span className="text-gray-500">وافق عليه</span><p className="text-gray-100">{detailPO.approvedBy.fullName}</p></div>}
            </div>

            {/* ── Items ── */}
            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-3">الأصناف</h4>
              {detailPO.items?.map((item) => {
                const received = item.receivedQuantity ?? 0
                const outstanding = item.quantity - received
                const fullyReceived = outstanding === 0 && received > 0
                const partial = received > 0 && outstanding > 0
                return (
                  <div key={item.id} className="flex justify-between text-sm py-2 border-b border-gray-700 last:border-0">
                    <div>
                      <p className="text-gray-100">{item.variant?.product?.name ?? '—'}</p>
                      <p className="text-xs"><span className="num-code">{item.variant?.sku}</span> × <span className="font-numeric num num-muted">{item.quantity}</span></p>
                      {(partial || fullyReceived) && (
                        <p className="text-[10px] mt-0.5">
                          <span className={fullyReceived ? 'text-success-600' : 'text-warning-600'}>
                            استُلم {received}/{item.quantity}
                          </span>
                          {partial && <span className="text-gray-500"> · متبقي {outstanding}</span>}
                        </p>
                      )}
                    </div>
                    <Money value={Number(item.subtotal)} />
                  </div>
                )
              })}
              <div className="flex justify-between text-sm font-semibold mt-3 pt-2 border-t border-gray-600">
                <span className="text-gray-300">الإجمالي</span>
                <Money value={Number(detailPO.totalAmount)} />
              </div>
            </div>
            <Button variant="secondary" onClick={() => printPO(detailPO)}>
              <Printer className="w-4 h-4" />طباعة الأمر
            </Button>
            {detailPO.status === 'draft' && (
              <Button variant="outline" onClick={() => openEdit(detailPO)}>
                <Edit className="w-4 h-4" />تعديل المسودة
              </Button>
            )}
            {detailPO.status === 'pending' && (
              <Button onClick={() => { setDetailPO(null); setApproveTarget(detailPO) }}>
                <Check className="w-4 h-4" />الموافقة على الأمر
              </Button>
            )}
            {(detailPO.status === 'approved' || detailPO.status === 'partially_received') && (
              <Button onClick={() => { setDetailPO(null); setReceiveTarget(detailPO) }}>
                <PackageCheck className="w-4 h-4" />{detailPO.status === 'partially_received' ? 'استكمال الاستلام' : 'استلام البضاعة'}
              </Button>
            )}
            {detailPO.status === 'received' && (
              <Button variant="secondary" onClick={() => { setDetailPO(null); setPaymentTarget(detailPO) }}>
                <CreditCard className="w-4 h-4" />تسجيل دفعة للمورد
              </Button>
            )}
          </div>
        )}
      </Drawer>

      <Modal open={!!approveTarget} onClose={() => setApproveTarget(null)} title="الموافقة على أمر الشراء"
        footer={
          <>
            <Button variant="secondary" onClick={() => setApproveTarget(null)}>إلغاء</Button>
            <Button loading={isApproving} onClick={() => approveTarget && approve(approveTarget.id)}>موافقة</Button>
          </>
        }
      >
        <p className="text-gray-300">هل تريد الموافقة على الأمر <strong className="text-gray-100 font-mono">#{approveTarget?.id.slice(0, 8).toUpperCase()}</strong>؟</p>
      </Modal>

      <ReceiveModal po={receiveTarget} onClose={() => setReceiveTarget(null)} onConfirm={(d) => receiveTarget && receive({ id: receiveTarget.id, ...d })} isPending={isReceiving} />
      <PaymentModal po={paymentTarget} onClose={() => setPaymentTarget(null)} onConfirm={(d) => paymentTarget && recordPayment({ id: paymentTarget.id, ...d })} isPending={isPaymentPending} />
      <BulkActionBar count={selection.count} onClear={selection.clear}>
        <Button variant="outline" size="sm" onClick={bulkExport}>
          <Download className="w-4 h-4" />تصدير
        </Button>
      </BulkActionBar>
    </AppShell>
  )
}
