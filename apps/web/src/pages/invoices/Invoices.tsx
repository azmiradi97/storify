import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Eye, RotateCcw, Printer, Download, Ban, Mail, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import { AppShell } from '@/components/layout/AppShell'
import { Input, Table, Badge, Money, SkeletonTable, Button, Drawer, Pagination, Modal, DateRangePicker, BulkActionBar, Select } from '@/components/ui'
import { api } from '@/api/client'
import { printInvoice } from '@/lib/print'
import type { PaginationMeta } from '@/types/api'
import { invoiceStatusMap, getStatus } from '@/constants/status'
import { useSelection } from '@/hooks/useSelection'
import { exportRowsToExcel } from '@/lib/export'
import { formatDate, formatDateTime } from '@/lib/format'
import { getApiErrorMessage } from '@/lib/api-error'

interface InvoiceItem {
  id: string
  variantId?: string       // null for service line items
  serviceId?: string       // set for service line items
  lineDescription?: string // snapshot of service name
  productName: string
  variantSku?: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

interface Invoice {
  id: string
  invoiceNumber: string
  customer?: { fullName: string; phone?: string; email?: string }
  totalAmount: number
  subtotal: number
  feeAmount: number
  taxTotal: number
  discountAmount: number
  status: string
  paymentMethod?: { name: string; type: string }
  cashier?: { fullName: string }
  createdAt: string
  items?: InvoiceItem[]
}

// Only product items can be returned (service items have no stock to restock)
interface ReturnItem { itemId: string; variantId: string; quantity: number; maxQty: number; productName: string; variantSku: string }

const LIMIT = 20

function ReturnModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const qc = useQueryClient()
  const [returnItems, setReturnItems] = useState<ReturnItem[]>(
    // Service items (no variantId) cannot be returned — filter them out
    (invoice.items ?? [])
      .filter((i): i is InvoiceItem & { variantId: string } => !!i.variantId)
      .map((i) => ({
        itemId: i.id,
        variantId: i.variantId,
        quantity: 0,
        maxQty: i.quantity,
        productName: i.productName,
        variantSku: i.variantSku ?? i.lineDescription ?? '—',
      }))
  )
  const [returnType, setReturnType] = useState<'refund' | 'credit'>('refund')
  const [reason, setReason] = useState('')

  const { mutate: submitReturn, isPending } = useMutation({
    mutationFn: async () => {
      const items = returnItems.filter((i) => i.quantity > 0).map((i) => ({ variantId: i.variantId, quantity: i.quantity }))
      if (items.length === 0) throw new Error('اختر صنفاً واحداً على الأقل')
      await api.post(`/invoices/${invoice.id}/return`, { returnType, reason: reason || undefined, items })
    },
    onSuccess: () => {
      toast.success('تم تسجيل المرتجع')
      qc.invalidateQueries({ queryKey: ['invoices'] })
      onClose()
    },
    onError: (e: unknown) => {
      const msg = (e as Error).message
      // Surface the local "pick at least one item" check; otherwise defer to
      // the backend's normalized error message via getApiErrorMessage.
      if (msg === 'اختر صنفاً واحداً على الأقل') toast.error(msg)
      else toast.error(getApiErrorMessage(e, 'فشل تسجيل المرتجع'))
    },
  })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-sm text-gray-400 mb-3">اختر الأصناف المرتجعة والكمية</p>
        <div className="flex flex-col gap-2">
          {returnItems.map((item, idx) => (
            <div key={item.itemId} className="flex items-center gap-3 py-2 border-b border-gray-700 last:border-0">
              <div className="flex-1">
                <p className="text-sm text-gray-100">{item.productName}</p>
                <p className="text-xs num-code">{item.variantSku} · الكمية المباعة: <span className="font-numeric num num-strong">{item.maxQty}</span></p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setReturnItems((prev) => prev.map((r, i) => i === idx ? { ...r, quantity: Math.max(0, r.quantity - 1) } : r))}
                  className="w-7 h-7 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-sm"
                  disabled={item.quantity === 0}
                >−</button>
                <span className="w-6 text-center font-mono text-sm">{item.quantity}</span>
                <button
                  onClick={() => setReturnItems((prev) => prev.map((r, i) => i === idx ? { ...r, quantity: Math.min(r.maxQty, r.quantity + 1) } : r))}
                  className="w-7 h-7 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-sm"
                  disabled={item.quantity >= item.maxQty}
                >+</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm text-gray-400 mb-2">نوع المرتجع</p>
        <div className="flex gap-2">
          <button
            onClick={() => setReturnType('refund')}
            className={`flex-1 py-2 rounded text-sm border transition-all ${returnType === 'refund' ? 'border-brand-500 text-brand-400 bg-brand-500/10' : 'border-gray-700 text-gray-400'}`}
          >استرداد نقدي</button>
          <button
            onClick={() => setReturnType('credit')}
            className={`flex-1 py-2 rounded text-sm border transition-all ${returnType === 'credit' ? 'border-success-500 text-success-600 bg-success-500/10' : 'border-gray-700 text-gray-400'}`}
          >رصيد للعميل</button>
        </div>
      </div>

      <div>
        <label className="text-sm text-gray-400 block mb-1">سبب الإرجاع (اختياري)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)] resize-none"
          placeholder="عيب في المنتج، مقاس خاطئ..."
        />
      </div>

      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={onClose}>إلغاء</Button>
        <Button className="flex-1" loading={isPending} onClick={() => submitReturn()}>
          <RotateCcw className="w-4 h-4" />
          تأكيد الإرجاع
        </Button>
      </div>
    </div>
  )
}

export default function Invoices() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''
  const setRange = (next: { from: string; to: string }) => {
    const params = new URLSearchParams(searchParams)
    if (next.from) params.set('from', next.from); else params.delete('from')
    if (next.to) params.set('to', next.to); else params.delete('to')
    setSearchParams(params, { replace: true })
  }
  const [page, setPage] = useState(1)
  const [detailInvoice, setDetailInvoice] = useState<Invoice | null>(null)
  const [returnInvoice, setReturnInvoice] = useState<Invoice | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Invoice | null>(null)
  const [emailTarget, setEmailTarget] = useState<Invoice | null>(null)
  const [emailTo, setEmailTo] = useState('')
  const qc = useQueryClient()

  const resetPage = () => setPage(1)

  const { data, isLoading } = useQuery<{ data: Invoice[]; meta: PaginationMeta }>({
    queryKey: ['invoices', search, status, from, to, page],
    queryFn: async () => (await api.get<{ data: Invoice[]; meta: PaginationMeta }>('/invoices', {
      params: {
        page, limit: LIMIT,
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      },
    })).data,
  })

  const invoices = data?.data ?? []
  const meta = data?.meta

  const selection = useSelection(invoices.map((i) => i.id))

  const bulkExport = async () => {
    const selected = invoices.filter((i) => selection.isSelected(i.id))
    await exportRowsToExcel(
      selected,
      [
        { header: 'رقم الفاتورة', accessor: 'invoiceNumber', width: 18 },
        { header: 'العميل', accessor: (i) => i.customer?.fullName ?? 'نقدي', width: 24 },
        { header: 'طريقة الدفع', accessor: (i) => i.paymentMethod?.name ?? '—', width: 16 },
        { header: 'الكاشير', accessor: (i) => i.cashier?.fullName ?? '—', width: 18 },
        { header: 'الحالة', accessor: (i) => getStatus(invoiceStatusMap, i.status).label, width: 12 },
        { header: 'المجموع الفرعي', accessor: 'subtotal', width: 14 },
        { header: 'الخصم', accessor: 'discountAmount', width: 12 },
        { header: 'الضريبة', accessor: 'taxTotal', width: 12 },
        { header: 'رسوم الدفع', accessor: 'feeAmount', width: 12 },
        { header: 'الإجمالي', accessor: 'totalAmount', width: 14 },
        { header: 'التاريخ', accessor: (i) => formatDateTime(i.createdAt), width: 22 },
      ],
      `invoices-${selected.length}.xlsx`,
      'الفواتير',
    )
  }

  const openDetail = async (inv: Invoice) => {
    const res = await api.get<{ data: Invoice }>(`/invoices/${inv.id}`)
    setDetailInvoice(res.data.data)
  }

  const { mutate: cancelInvoiceMutation, isPending: isCancelling } = useMutation({
    mutationFn: async (id: string) => api.post(`/invoices/${id}/cancel`),
    onSuccess: () => {
      toast.success('تم إلغاء الفاتورة واستعادة المخزون')
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['customer-ledger'] })
      qc.invalidateQueries({ queryKey: ['stock'] })
      setCancelTarget(null)
      setDetailInvoice(null)
    },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'فشل إلغاء الفاتورة')),
  })

  const { mutate: emailInvoiceMutation, isPending: isEmailing } = useMutation({
    mutationFn: async ({ id, to }: { id: string; to: string }) =>
      api.post<{ data: { sentTo: string } }>(`/invoices/${id}/email-receipt`, { to }),
    onSuccess: (res) => {
      toast.success(`تم إرسال الفاتورة إلى ${res.data.data.sentTo}`)
      setEmailTarget(null)
      setEmailTo('')
    },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'فشل إرسال البريد')),
  })

  const openEmailModal = (inv: Invoice) => {
    setEmailTarget(inv)
    setEmailTo(inv.customer?.email ?? '')
  }

  return (
    <AppShell title="الفواتير">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 max-w-xs">
            <Input placeholder="بحث برقم الفاتورة..." value={search} onChange={(e) => { setSearch(e.target.value); resetPage() }} startIcon={<Search className="w-4 h-4" />} />
          </div>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); resetPage() }}>
            <option value="">كل الحالات</option>
            <option value="completed">مكتملة</option>
            <option value="pending">معلقة</option>
            <option value="returned">مرتجعة</option>
            <option value="cancelled">ملغاة</option>
          </Select>
          <DateRangePicker
            value={{ from, to }}
            onChange={(v) => { setRange({ from: v.from, to: v.to }); resetPage() }}
          />
          {(status || from || to) && (
            <button onClick={() => { setStatus(''); setRange({ from: '', to: '' }); resetPage() }}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors">مسح الفلاتر ×</button>
          )}
        </div>

        {isLoading ? <SkeletonTable rows={8} cols={6} /> : (
          <>
            <Table
              selection={{
                isSelected: (i) => selection.isSelected(i.id),
                onToggle: (i) => selection.toggle(i.id),
                onToggleAll: selection.toggleAllVisible,
                allSelected: selection.allVisibleSelected,
                someSelected: selection.someVisibleSelected,
              }}
              columns={[
                { key: 'invoiceNumber', header: 'رقم الفاتورة', render: (i) => (
                  <button className="font-mono text-brand-400 hover:underline" onClick={() => openDetail(i)}>{i.invoiceNumber}</button>
                )},
                { key: 'customer', header: 'العميل', render: (i) => i.customer?.fullName ?? <span className="text-gray-500">—</span> },
                { key: 'paymentMethod', header: 'طريقة الدفع', render: (i) => <span className="text-gray-400">{i.paymentMethod?.name ?? '—'}</span> },
                { key: 'totalAmount', header: 'الإجمالي', render: (i) => <Money value={i.totalAmount} /> },
                { key: 'status', header: 'الحالة', render: (i) => {
                  const s = getStatus(invoiceStatusMap, i.status)
                  return <Badge variant={s.variant} dot>{s.label}</Badge>
                }},
                { key: 'createdAt', header: 'التاريخ', render: (i) => <span className="text-gray-500 text-xs">{formatDate(i.createdAt)}</span> },
                { key: 'actions', header: '', render: (i) => (
                  <Button variant="ghost" size="sm" onClick={() => openDetail(i)}><Eye className="w-3 h-3" /></Button>
                )},
              ]}
              data={invoices} keyExtractor={(i) => i.id} emptyMessage="لا توجد فواتير" emptyDescription="لم يتم إصدار أي فاتورة بعد" emptyIcon={<FileText className="w-8 h-8" />}
            />
            {meta && <Pagination page={meta.page} pages={meta.pages} total={meta.total} limit={meta.limit} onPage={setPage} />}
          </>
        )}
      </div>

      <Drawer
        open={!!detailInvoice}
        onClose={() => setDetailInvoice(null)}
        title={`فاتورة ${detailInvoice?.invoiceNumber ?? ''}`}
        width="w-[520px]"
        footer={
          <div className="flex gap-2 w-full">
            <Button variant="ghost" onClick={() => detailInvoice && printInvoice(detailInvoice)}>
              <Printer className="w-4 h-4" />طباعة
            </Button>
            {detailInvoice && (
              <Button variant="ghost" onClick={() => openEmailModal(detailInvoice)}>
                <Mail className="w-4 h-4" />إرسال بالبريد
              </Button>
            )}
            {detailInvoice?.status === 'completed' && (
              <Button variant="secondary" onClick={() => { setReturnInvoice(detailInvoice); setDetailInvoice(null) }}>
                <RotateCcw className="w-4 h-4" />إرجاع
              </Button>
            )}
            {detailInvoice && (detailInvoice.status === 'completed' || detailInvoice.status === 'pending') && (
              <Button variant="danger" onClick={() => setCancelTarget(detailInvoice)}>
                <Ban className="w-4 h-4" />إلغاء الفاتورة
              </Button>
            )}
          </div>
        }
      >
        {detailInvoice && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">العميل</span><p className="text-gray-100 font-medium">{detailInvoice.customer?.fullName ?? 'نقدي'}</p></div>
              <div><span className="text-gray-500">الكاشير</span><p className="text-gray-100">{detailInvoice.cashier?.fullName ?? '—'}</p></div>
              <div><span className="text-gray-500">طريقة الدفع</span><p className="text-gray-100">{detailInvoice.paymentMethod?.name ?? '—'}</p></div>
              <div><span className="text-gray-500">التاريخ</span><p className="font-numeric num num-strong text-xs">{formatDateTime(detailInvoice.createdAt)}</p></div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-3">الأصناف</h4>
              <div className="flex flex-col gap-1">
                {detailInvoice.items?.map((item) => (
                  <div key={item.id} className="flex justify-between text-sm py-2 border-b border-gray-700 last:border-0">
                    <div>
                      <p className="text-gray-100">{item.productName}</p>
                      {item.variantSku ? (
                        <p className="text-xs"><span className="num-code">{item.variantSku}</span> × <span className="font-numeric num num-muted">{item.quantity}</span></p>
                      ) : (
                        <p className="text-xs text-info-600/80">{item.lineDescription ?? 'خدمة'} × {item.quantity}</p>
                      )}
                    </div>
                    <Money value={item.totalPrice} />
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gray-750 rounded-md border border-gray-700 p-4 flex flex-col gap-2 text-sm">
              <div className="flex justify-between text-gray-400"><span>المجموع الفرعي</span><Money value={detailInvoice.subtotal} /></div>
              {detailInvoice.discountAmount > 0 && (
                <div className="flex justify-between text-danger-600"><span>الخصم</span><span>-<Money value={detailInvoice.discountAmount} /></span></div>
              )}
              {detailInvoice.taxTotal > 0 && (
                <div className="flex justify-between text-gray-400"><span>الضريبة</span><Money value={detailInvoice.taxTotal} /></div>
              )}
              {detailInvoice.feeAmount > 0 && (
                <div className="flex justify-between text-gray-400"><span>رسوم الدفع</span><Money value={detailInvoice.feeAmount} /></div>
              )}
              <div className="flex justify-between text-gray-100 font-semibold border-t border-gray-600 pt-2 mt-1">
                <span>الإجمالي</span><Money value={detailInvoice.totalAmount} />
              </div>
            </div>
          </div>
        )}
      </Drawer>
      <Modal open={!!returnInvoice} onClose={() => setReturnInvoice(null)} title={`إرجاع فاتورة ${returnInvoice?.invoiceNumber ?? ''}`}>
        {returnInvoice && <ReturnModal invoice={returnInvoice} onClose={() => setReturnInvoice(null)} />}
      </Modal>
      <Modal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title={`إلغاء فاتورة ${cancelTarget?.invoiceNumber ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelTarget(null)} disabled={isCancelling}>تراجع</Button>
            <Button variant="danger" loading={isCancelling} onClick={() => cancelTarget && cancelInvoiceMutation(cancelTarget.id)}>
              <Ban className="w-4 h-4" />تأكيد الإلغاء
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-gray-300">سيؤدي إلغاء الفاتورة إلى:</p>
          <ul className="list-disc list-inside text-gray-400 space-y-1 mr-2">
            <li>إعادة الأصناف إلى المخزون</li>
            <li>استرداد الرصيد المستخدم للعميل (إن وجد)</li>
            <li>إلغاء نقاط الولاء المكتسبة (إن وجدت)</li>
          </ul>
          <p className="text-xs text-warning-600 bg-warning-500/10 border border-warning-500/30 rounded-md px-3 py-2">
            هذا الإجراء لا يمكن التراجع عنه.
          </p>
        </div>
      </Modal>
      <Modal
        open={!!emailTarget}
        onClose={() => { setEmailTarget(null); setEmailTo('') }}
        title={`إرسال فاتورة ${emailTarget?.invoiceNumber ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setEmailTarget(null); setEmailTo('') }} disabled={isEmailing}>إلغاء</Button>
            <Button
              loading={isEmailing}
              disabled={!emailTo.trim() || !/.+@.+\..+/.test(emailTo)}
              onClick={() => emailTarget && emailInvoiceMutation({ id: emailTarget.id, to: emailTo.trim() })}
            >
              <Mail className="w-4 h-4" />إرسال
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <Input
            label="البريد الإلكتروني"
            type="email"
            value={emailTo}
            onChange={(e) => setEmailTo(e.target.value)}
            placeholder="customer@example.com"
            autoFocus
            dir="ltr"
          />
          {!emailTarget?.customer?.email && (
            <p className="text-xs text-gray-500">
              لا يوجد بريد محفوظ للعميل — أضِف بريداً في صفحة العميل لتعبئته تلقائياً.
            </p>
          )}
          <p className="text-xs text-gray-500">
            سيتم إرسال نسخة منسّقة من الفاتورة كرسالة HTML.
          </p>
        </div>
      </Modal>
      <BulkActionBar count={selection.count} onClear={selection.clear}>
        <Button variant="outline" size="sm" onClick={bulkExport}>
          <Download className="w-4 h-4" />تصدير
        </Button>
        <Button
          variant="outline" size="sm"
          onClick={() => invoices.filter((i) => selection.isSelected(i.id)).forEach((i) => printInvoice(i))}
        >
          <Printer className="w-4 h-4" />طباعة
        </Button>
      </BulkActionBar>
    </AppShell>
  )
}
