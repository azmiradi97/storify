import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import {
  Plus,
  Search,
  Smartphone,
  Car,
  CalendarClock,
  Package,
  CircleDollarSign,
  Trash2,
  FileText,
  Printer,
} from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { Table, Money, SkeletonTable, Badge, Button, Drawer, Modal, Input, Select, Pagination } from '@/components/ui'
import { api } from '@/api/client'
import { getApiErrorMessage } from '@/lib/api-error'
import { formatMoney, formatDateTime } from '@/lib/format'
import { printWorkOrderReceipt } from '@/lib/print'
import { cn } from '@/lib/cn'
import type { PaginationMeta } from '@/types/api'
import type { BadgeVariant } from '@/components/ui'

// ─── Types ──────────────────────────────────────────────────────────────────

type ItemType = 'device' | 'vehicle' | 'appointment' | 'other'
type WorkOrderStatus =
  | 'received'
  | 'scheduled'
  | 'diagnosed'
  | 'quoted'
  | 'approved'
  | 'in_progress'
  | 'ready'
  | 'delivered'
  | 'cancelled'

interface WorkOrderListItem {
  id: string
  ticketNumber: string
  branchId: string
  customerId: string | null
  assignedUserId: string | null
  itemType: ItemType
  itemDetails: Record<string, unknown>
  status: WorkOrderStatus
  scheduledAt: string | null
  estimatedTotal: string | number | null
  finalTotal: string | number | null
  paidAmount: string | number
  createdAt: string
  branch: { id: string; name: string }
  customer: { id: string; fullName: string; phone: string | null } | null
  assignedUser: { id: string; fullName: string } | null
  _count: { services: number }
}

interface WorkOrderDetail extends WorkOrderListItem {
  invoiceId: string | null
  invoice?: { id: string; invoiceNumber: string } | null
  createdBy: { id: string; fullName: string }
  paymentMethod: { id: string; name: string } | null
  scheduledAt: string | null
  deposit: string | number
  diagnosisNotes: string | null
  workNotes: string | null
  customerNotes: string | null
  paidAt: string | null
  closedAt: string | null
  services: Array<{
    id: string
    serviceId: string
    quantity: number
    unitPrice: string | number
    notes: string | null
    service: { id: string; name: string; defaultPrice: string | number }
  }>
  statusHistory: Array<{
    id: string
    oldStatus: string | null
    newStatus: string
    note: string | null
    changedAt: string
    changedBy: { id: string; fullName: string }
  }>
  customer: {
    id: string
    fullName: string
    phone: string | null
    email: string | null
  } | null
}

interface Branch { id: string; name: string }
interface Customer { id: string; fullName: string; phone: string | null }
interface User { id: string; fullName: string }
interface ServiceItem { id: string; name: string; defaultPrice: string | number }
interface PaymentMethod { id: string; name: string }

const LIMIT = 20

// ─── Status / item-type display tables ──────────────────────────────────────

const STATUS_LABEL: Record<WorkOrderStatus, string> = {
  received: 'مستلم',
  scheduled: 'محجوز',
  diagnosed: 'تم الكشف',
  quoted: 'بانتظار الموافقة',
  approved: 'موافَق عليه',
  in_progress: 'قيد التنفيذ',
  ready: 'جاهز للتسليم',
  delivered: 'مُسلَّم',
  cancelled: 'ملغى',
}

const STATUS_VARIANT: Record<WorkOrderStatus, BadgeVariant> = {
  received: 'gray',
  scheduled: 'info',
  diagnosed: 'info',
  quoted: 'warning',
  approved: 'info',
  in_progress: 'warning',
  ready: 'success',
  delivered: 'success',
  cancelled: 'danger',
}

// Mirrors workOrder.schema.ts on the backend. Validated server-side; this is just
// for hiding action buttons that the server would reject anyway.
const ALLOWED_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  received: ['scheduled', 'diagnosed', 'in_progress', 'cancelled'],
  scheduled: ['in_progress', 'cancelled'],
  diagnosed: ['quoted', 'in_progress', 'cancelled'],
  quoted: ['approved', 'cancelled'],
  approved: ['in_progress', 'cancelled'],
  in_progress: ['ready', 'cancelled'],
  ready: ['delivered', 'in_progress', 'cancelled'],
  delivered: [],
  cancelled: [],
}

const ITEM_TYPE_ICON: Record<ItemType, typeof Smartphone> = {
  device: Smartphone,
  vehicle: Car,
  appointment: CalendarClock,
  other: Package,
}

const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  device: 'جهاز',
  vehicle: 'مركبة',
  appointment: 'موعد',
  other: 'أخرى',
}

function describeItem(itemType: ItemType, details: Record<string, unknown>): string {
  if (itemType === 'device') {
    const brand = (details.brand as string) ?? ''
    const model = (details.model as string) ?? ''
    return [brand, model].filter(Boolean).join(' ') || '—'
  }
  if (itemType === 'vehicle') {
    const make = (details.make as string) ?? ''
    const model = (details.model as string) ?? ''
    const plate = (details.plate as string) ?? ''
    return [make, model, plate].filter(Boolean).join(' / ') || '—'
  }
  if (itemType === 'appointment') {
    return (details.notes as string) ?? 'موعد'
  }
  return (details.description as string) ?? '—'
}

// ─── Main list page ─────────────────────────────────────────────────────────

export default function WorkOrders() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<WorkOrderStatus | ''>('')
  const [createOpen, setCreateOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading } = useQuery<{ data: WorkOrderListItem[]; meta: PaginationMeta }>({
    queryKey: ['work-orders', page, debouncedSearch, statusFilter],
    queryFn: async () =>
      (await api.get<{ data: WorkOrderListItem[]; meta: PaginationMeta }>('/work-orders', {
        params: {
          limit: LIMIT,
          page,
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
        },
      })).data,
  })

  const items = data?.data ?? []
  const meta = data?.meta

  return (
    <AppShell title="طلبات العمل">
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative w-72 max-w-full">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث برقم التذكرة..."
                className="w-full bg-gray-800 border border-gray-700 rounded-md pr-9 pl-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-brand-500"
              />
            </div>
            <Select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as WorkOrderStatus | ''); setPage(1) }}
              className="w-44"
            >
              <option value="">كل الحالات</option>
              {(Object.keys(STATUS_LABEL) as WorkOrderStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </div>
          <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" /> طلب جديد</Button>
        </div>

        {isLoading ? (
          <SkeletonTable rows={8} cols={6} />
        ) : (
          <>
            <Table
              columns={[
                { key: 'ticketNumber', header: 'رقم التذكرة', render: (w) => (
                  <button className="font-mono num-code text-brand-400 hover:underline" onClick={() => setDetailId(w.id)} dir="ltr">
                    {w.ticketNumber}
                  </button>
                )},
                { key: 'itemType', header: 'النوع', render: (w) => {
                  const Icon = ITEM_TYPE_ICON[w.itemType]
                  return (
                    <div className="flex items-center gap-1.5">
                      <Icon className="w-3.5 h-3.5 text-gray-500" />
                      <span className="text-xs text-gray-400">{ITEM_TYPE_LABEL[w.itemType]}</span>
                    </div>
                  )
                }},
                { key: 'item', header: 'الوصف', render: (w) => (
                  <span className="text-gray-300 text-sm">{describeItem(w.itemType, w.itemDetails)}</span>
                )},
                { key: 'customer', header: 'العميل', render: (w) => w.customer ? (
                  <div>
                    <p className="text-sm text-gray-200">{w.customer.fullName}</p>
                    {w.customer.phone && <p className="text-xs num-code text-gray-500" dir="ltr">{w.customer.phone}</p>}
                  </div>
                ) : <span className="text-gray-500">—</span> },
                { key: 'status', header: 'الحالة', render: (w) => (
                  <Badge variant={STATUS_VARIANT[w.status]} dot>{STATUS_LABEL[w.status]}</Badge>
                )},
                { key: 'total', header: 'الإجمالي', render: (w) => (
                  <Money value={Number(w.finalTotal ?? w.estimatedTotal ?? 0)} />
                )},
                { key: 'createdAt', header: 'التاريخ', render: (w) => (
                  <span className="text-xs text-gray-500 num">
                    {formatDateTime(w.createdAt, { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                )},
              ]}
              data={items}
              keyExtractor={(w) => w.id}
              emptyMessage="لا توجد طلبات عمل بعد"
            />
            {meta && <Pagination page={meta.page} pages={meta.pages} total={meta.total} limit={meta.limit} onPage={setPage} />}
          </>
        )}
      </div>

      <CreateWorkOrderModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => { setCreateOpen(false); setDetailId(id) }} />

      <Drawer open={!!detailId} onClose={() => setDetailId(null)} title="تفاصيل الطلب" width="w-[560px]">
        {detailId && <WorkOrderDetail id={detailId} />}
      </Drawer>
    </AppShell>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//   Detail drawer — status workflow, services, payment, history
// ═══════════════════════════════════════════════════════════════════════════

function WorkOrderDetail({ id }: { id: string }) {
  const qc = useQueryClient()
  const [transitionTarget, setTransitionTarget] = useState<WorkOrderStatus | null>(null)
  const [addServiceOpen, setAddServiceOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [issuingInvoice, setIssuingInvoice] = useState(false)

  const { data: wo, isLoading } = useQuery<WorkOrderDetail>({
    queryKey: ['work-order', id],
    queryFn: async () => (await api.get<{ data: WorkOrderDetail }>(`/work-orders/${id}`)).data.data,
  })

  const { mutate: issueInvoice, isPending: invoicePending } = useMutation({
    mutationFn: () => api.post(`/work-orders/${id}/invoice`, {}),
    onSuccess: () => {
      toast.success('تم إنشاء الفاتورة')
      setIssuingInvoice(false)
      qc.invalidateQueries({ queryKey: ['work-order', id] })
      qc.invalidateQueries({ queryKey: ['work-orders'] })
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'فشل إنشاء الفاتورة')),
  })

  if (isLoading || !wo) return <div className="p-6"><SkeletonTable rows={5} cols={1} /></div>

  const allowedNext = ALLOWED_TRANSITIONS[wo.status] ?? []
  const linesTotal = wo.services.reduce((acc, l) => acc + Number(l.unitPrice) * l.quantity, 0)
  const total = Number(wo.finalTotal ?? wo.estimatedTotal ?? linesTotal)
  const paid = Number(wo.paidAmount)
  const remaining = total - paid

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="bg-gray-800 border border-gray-700 rounded-md p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="font-mono num-code text-brand-400" dir="ltr">{wo.ticketNumber}</p>
          <Badge variant={STATUS_VARIANT[wo.status]} dot>{STATUS_LABEL[wo.status]}</Badge>
        </div>
        <p className="text-xs text-gray-500">
          أنشأه {wo.createdBy.fullName} · {formatDateTime(wo.createdAt, { dateStyle: 'short', timeStyle: 'short' })}
        </p>
        {allowedNext.length > 0 && (
          <div className="flex gap-1 flex-wrap mt-3">
            {allowedNext.map((next) => (
              <Button
                key={next}
                size="sm"
                variant={next === 'cancelled' ? 'danger' : 'secondary'}
                onClick={() => setTransitionTarget(next)}
              >
                ← {STATUS_LABEL[next]}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Item / customer */}
      <section>
        <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">العنصر</h3>
        <div className="bg-gray-750 border border-gray-700 rounded-md p-3 text-sm">
          <p className="text-gray-400 mb-1">
            <span className="text-xs text-gray-500">النوع: </span>{ITEM_TYPE_LABEL[wo.itemType]}
          </p>
          <ItemDetailsView itemType={wo.itemType} details={wo.itemDetails} />
        </div>
      </section>

      {wo.customer && (
        <section>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">العميل</h3>
          <div className="bg-gray-750 border border-gray-700 rounded-md p-3 text-sm">
            <p className="text-gray-200">{wo.customer.fullName}</p>
            {wo.customer.phone && <p className="text-xs num-code text-gray-500" dir="ltr">{wo.customer.phone}</p>}
            {wo.customer.email && <p className="text-xs text-gray-500" dir="ltr">{wo.customer.email}</p>}
          </div>
        </section>
      )}

      {/* Services */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wider text-gray-500">الخدمات ({wo.services.length})</h3>
          <Button size="sm" variant="ghost" onClick={() => setAddServiceOpen(true)}>
            <Plus className="w-3 h-3" /> إضافة خدمة
          </Button>
        </div>
        {wo.services.length === 0 ? (
          <p className="text-sm text-gray-500 py-2">لا توجد خدمات على هذا الطلب</p>
        ) : (
          <div className="flex flex-col gap-1">
            {wo.services.map((s) => (
              <ServiceLineRow key={s.id} workOrderId={wo.id} line={s} />
            ))}
            <div className="mt-1 px-2 py-2 border-t border-gray-700 flex justify-between text-sm">
              <span className="text-gray-400">إجمالي البنود</span>
              <span className="font-mono num num-strong text-gray-100">{formatMoney(linesTotal)} ج</span>
            </div>
          </div>
        )}
      </section>

      {/* Payment */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wider text-gray-500">الدفع</h3>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setPaymentOpen(true)}>
              <CircleDollarSign className="w-3 h-3" /> تسجيل دفعة
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <SmallStat label="الإجمالي" value={`${formatMoney(total)} ج`} color="text-gray-100" />
          <SmallStat label="مدفوع" value={`${formatMoney(paid)} ج`} color="text-success-600" />
          <SmallStat label="متبقي" value={`${formatMoney(remaining)} ج`} color={remaining > 0 ? 'text-warning-600' : 'text-gray-500'} />
        </div>
        {wo.paymentMethod && (
          <p className="text-xs text-gray-500 mt-2">
            آخر دفعة عبر <span className="text-gray-300">{wo.paymentMethod.name}</span>
            {wo.paidAt && <> · {formatDateTime(wo.paidAt, { dateStyle: 'short', timeStyle: 'short' })}</>}
          </p>
        )}

        {/* Invoice generation + print receipt */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-700">
          {wo.invoiceId ? (
            <div className="flex items-center gap-2 flex-1">
              <Badge variant="success" dot>
                فاتورة {wo.invoice?.invoiceNumber ?? wo.invoiceId.slice(0, 8)}
              </Badge>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 border-info-500 text-info-600 hover:bg-info-50"
              loading={invoicePending}
              disabled={wo.status === 'cancelled' || wo.status === 'received'}
              onClick={() => setIssuingInvoice(true)}
            >
              <FileText className="w-3 h-3" /> إصدار فاتورة
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => printWorkOrderReceipt({
              ticketNumber: wo.ticketNumber,
              invoiceNumber: wo.invoice?.invoiceNumber,
              createdAt: wo.createdAt,
              customerName: wo.customer?.fullName,
              paymentMethodName: wo.paymentMethod?.name,
              status: wo.status,
              services: wo.services.map((l) => ({
                name: l.service.name,
                quantity: l.quantity,
                unitPrice: Number(l.unitPrice),
                lineTotal: Number(l.unitPrice) * l.quantity,
              })),
              estimatedTotal: wo.estimatedTotal ? Number(wo.estimatedTotal) : undefined,
              finalTotal: wo.finalTotal ? Number(wo.finalTotal) : undefined,
              paidAmount: Number(wo.paidAmount),
              diagnosisNotes: wo.diagnosisNotes ?? undefined,
              workNotes: wo.workNotes ?? undefined,
            })}
          >
            <Printer className="w-3 h-3" /> طباعة
          </Button>
        </div>
      </section>

      {/* Notes */}
      {(wo.diagnosisNotes || wo.workNotes || wo.customerNotes) && (
        <section>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">ملاحظات</h3>
          <div className="flex flex-col gap-2">
            {wo.diagnosisNotes && <NoteBlock label="الكشف" text={wo.diagnosisNotes} />}
            {wo.workNotes && <NoteBlock label="العمل المنفّذ" text={wo.workNotes} />}
            {wo.customerNotes && <NoteBlock label="ملاحظات العميل" text={wo.customerNotes} />}
          </div>
        </section>
      )}

      {/* Status timeline */}
      <section>
        <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">سجل الحالة</h3>
        <div className="flex flex-col gap-2">
          {wo.statusHistory.map((h) => (
            <div key={h.id} className="text-xs flex items-start gap-2 py-1">
              <Badge variant={STATUS_VARIANT[h.newStatus as WorkOrderStatus] ?? 'gray'}>
                {STATUS_LABEL[h.newStatus as WorkOrderStatus] ?? h.newStatus}
              </Badge>
              <div className="flex-1 min-w-0">
                <p className="text-gray-400">
                  {h.changedBy.fullName} ·{' '}
                  <span className="num">{formatDateTime(h.changedAt, { dateStyle: 'short', timeStyle: 'short' })}</span>
                </p>
                {h.note && <p className="text-gray-500 mt-0.5">{h.note}</p>}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Invoice confirmation */}
      {issuingInvoice && (
        <Modal
          open
          title="إصدار فاتورة"
          onClose={() => setIssuingInvoice(false)}
          footer={
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setIssuingInvoice(false)} disabled={invoicePending}>إلغاء</Button>
              <Button
                className="bg-cyan-600 hover:bg-cyan-500 text-white"
                loading={invoicePending}
                onClick={() => issueInvoice()}
              >
                <FileText className="w-4 h-4" /> إصدار الفاتورة
              </Button>
            </div>
          }
        >
          <div className="text-sm text-gray-300 space-y-2">
            <p>سيتم إنشاء فاتورة مكتملة (<span className="font-mono text-info-600">SVC-…</span>) بناءً على الخدمات المسجلة في هذا الطلب.</p>
            {wo.paymentMethod ? (
              <p>طريقة الدفع: <span className="text-gray-100 font-medium">{wo.paymentMethod.name}</span></p>
            ) : (
              <p className="text-warning-600">⚠️ لا توجد طريقة دفع مسجلة — سجّل دفعة أولاً ثم أصدر الفاتورة.</p>
            )}
            <p className="text-xs text-gray-500">لا يمكن التراجع عن هذه العملية.</p>
          </div>
        </Modal>
      )}

      {/* Modals */}
      {transitionTarget && (
        <StatusTransitionModal
          workOrderId={wo.id}
          target={transitionTarget}
          onClose={() => setTransitionTarget(null)}
          onDone={() => { setTransitionTarget(null); qc.invalidateQueries({ queryKey: ['work-order', id] }); qc.invalidateQueries({ queryKey: ['work-orders'] }) }}
        />
      )}
      <AddServiceModal
        open={addServiceOpen}
        workOrderId={wo.id}
        onClose={() => setAddServiceOpen(false)}
        onDone={() => { setAddServiceOpen(false); qc.invalidateQueries({ queryKey: ['work-order', id] }) }}
      />
      <PaymentModal
        open={paymentOpen}
        workOrderId={wo.id}
        remaining={remaining}
        onClose={() => setPaymentOpen(false)}
        onDone={() => { setPaymentOpen(false); qc.invalidateQueries({ queryKey: ['work-order', id] }); qc.invalidateQueries({ queryKey: ['work-orders'] }) }}
      />
    </div>
  )
}

function SmallStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className={cn('font-mono text-sm mt-0.5 num', color)}>{value}</p>
    </div>
  )
}

function NoteBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="bg-gray-750 border border-gray-700 rounded p-2.5">
      <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{label}</p>
      <p className="text-xs text-gray-300 whitespace-pre-wrap">{text}</p>
    </div>
  )
}

function ItemDetailsView({ itemType, details }: { itemType: ItemType; details: Record<string, unknown> }) {
  const entries: Array<[string, string]> = []
  if (itemType === 'device') {
    if (details.brand) entries.push(['الماركة', String(details.brand)])
    if (details.model) entries.push(['الموديل', String(details.model)])
    if (details.imei) entries.push(['IMEI', String(details.imei)])
    if (details.serialNumber) entries.push(['الرقم التسلسلي', String(details.serialNumber)])
    if (details.conditionNotes) entries.push(['الحالة', String(details.conditionNotes)])
  } else if (itemType === 'vehicle') {
    if (details.make) entries.push(['الماركة', String(details.make)])
    if (details.model) entries.push(['الموديل', String(details.model)])
    if (details.year) entries.push(['السنة', String(details.year)])
    if (details.plate) entries.push(['رقم اللوحة', String(details.plate)])
    if (details.vin) entries.push(['VIN', String(details.vin)])
    if (details.mileage) entries.push(['الكيلومترات', String(details.mileage)])
  } else if (itemType === 'appointment') {
    if (details.notes) entries.push(['ملاحظات', String(details.notes)])
  } else if (details.description) {
    entries.push(['الوصف', String(details.description)])
  }

  if (entries.length === 0) return <p className="text-gray-500 text-xs">لا توجد بيانات</p>

  return (
    <dl className="space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex justify-between text-xs">
          <dt className="text-gray-500">{k}</dt>
          <dd className="text-gray-300 max-w-[60%] text-left" dir="auto">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function ServiceLineRow({ workOrderId, line }: {
  workOrderId: string
  line: WorkOrderDetail['services'][number]
}) {
  const qc = useQueryClient()
  const { mutate: removeLine, isPending } = useMutation({
    mutationFn: async () => api.delete(`/work-orders/${workOrderId}/services/${line.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-order', workOrderId] }),
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })

  const lineTotal = Number(line.unitPrice) * line.quantity
  return (
    <div className="flex items-center justify-between bg-gray-750 border border-gray-700 rounded px-3 py-2 text-sm">
      <div className="flex-1 min-w-0">
        <p className="text-gray-200 truncate">{line.service.name}</p>
        <p className="text-xs text-gray-500">
          <span className="num">{line.quantity}</span> × <span className="num">{formatMoney(Number(line.unitPrice))}</span> ج
        </p>
      </div>
      <span className="font-mono num num-strong text-gray-100 mx-3">{formatMoney(lineTotal)} ج</span>
      <Button variant="ghost" size="sm" loading={isPending} onClick={() => removeLine()} className="text-danger-500">
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  )
}

// ─── Status transition modal ────────────────────────────────────────────────

function StatusTransitionModal({ workOrderId, target, onClose, onDone }: {
  workOrderId: string
  target: WorkOrderStatus
  onClose: () => void
  onDone: () => void
}) {
  const [note, setNote] = useState('')
  const { mutate, isPending } = useMutation({
    mutationFn: async () => api.patch(`/work-orders/${workOrderId}/status`, { status: target, note: note || undefined }),
    onSuccess: () => { toast.success('تم تحديث الحالة'); onDone() },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`الانتقال إلى: ${STATUS_LABEL[target]}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button loading={isPending} onClick={() => mutate()}>تأكيد</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-gray-400">يمكنك إضافة ملاحظة تظهر في سجل الحالة (اختياري).</p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={500}
          className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)] resize-none"
        />
      </div>
    </Modal>
  )
}

// ─── Add service line modal ─────────────────────────────────────────────────

const addServiceSchema = z.object({
  serviceId: z.string().uuid('اختر الخدمة'),
  quantity: z.coerce.number().int().min(1).default(1),
  unitPrice: z.coerce.number().min(0).optional().or(z.literal('')),
  notes: z.string().optional(),
})
type AddServiceForm = z.infer<typeof addServiceSchema>

function AddServiceModal({ open, workOrderId, onClose, onDone }: {
  open: boolean
  workOrderId: string
  onClose: () => void
  onDone: () => void
}) {
  const { data: services = [] } = useQuery<ServiceItem[]>({
    queryKey: ['services-all'],
    queryFn: async () => (await api.get<{ data: ServiceItem[] }>('/services', { params: { limit: 100, isActive: 'true' } })).data.data,
    enabled: open,
  })

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<AddServiceForm>({
    resolver: zodResolver(addServiceSchema),
    defaultValues: { quantity: 1 },
  })

  const selectedServiceId = watch('serviceId')
  useEffect(() => {
    const s = services.find((x) => x.id === selectedServiceId)
    if (s) setValue('unitPrice', Number(s.defaultPrice))
  }, [selectedServiceId, services, setValue])

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: AddServiceForm) => api.post(`/work-orders/${workOrderId}/services`, {
      serviceId: data.serviceId,
      quantity: data.quantity,
      unitPrice: data.unitPrice === '' ? undefined : Number(data.unitPrice),
      notes: data.notes || undefined,
    }),
    onSuccess: () => { toast.success('تم إضافة الخدمة'); reset(); onDone() },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="إضافة خدمة"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button loading={isPending} onClick={handleSubmit((d) => mutate(d))}>إضافة</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Select label="الخدمة" error={errors.serviceId?.message} {...register('serviceId')}>
          <option value="">اختر الخدمة...</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name} — {formatMoney(Number(s.defaultPrice))} ج</option>
          ))}
        </Select>
        <Input label="الكمية" type="number" min={1} error={errors.quantity?.message} {...register('quantity')} />
        <Input label="سعر الوحدة (ج)" type="number" step="0.01" {...register('unitPrice')} />
        <div>
          <label className="text-sm text-gray-400 block mb-1">ملاحظة (اختياري)</label>
          <textarea
            {...register('notes')}
            rows={2}
            className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)] resize-none"
          />
        </div>
      </div>
    </Modal>
  )
}

// ─── Payment modal ──────────────────────────────────────────────────────────

const paymentSchema = z.object({
  paymentMethodId: z.string().uuid('اختر وسيلة الدفع'),
  amount: z.coerce.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
})
type PaymentForm = z.infer<typeof paymentSchema>

function PaymentModal({ open, workOrderId, remaining, onClose, onDone }: {
  open: boolean
  workOrderId: string
  remaining: number
  onClose: () => void
  onDone: () => void
}) {
  const { data: methods = [] } = useQuery<PaymentMethod[]>({
    queryKey: ['payment-methods'],
    queryFn: async () => (await api.get<{ data: PaymentMethod[] }>('/payment-methods')).data.data,
    enabled: open,
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<PaymentForm>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { amount: Math.max(0, remaining) },
  })

  useEffect(() => {
    reset({ amount: Math.max(0, remaining), paymentMethodId: '' })
  }, [remaining, open, reset])

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: PaymentForm) => api.post(`/work-orders/${workOrderId}/payment`, data),
    onSuccess: () => { toast.success('تم تسجيل الدفعة'); onDone() },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="تسجيل دفعة"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button loading={isPending} onClick={handleSubmit((d) => mutate(d))}>تسجيل</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Select label="وسيلة الدفع" error={errors.paymentMethodId?.message} {...register('paymentMethodId')}>
          <option value="">اختر وسيلة الدفع...</option>
          {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
        <Input label="المبلغ (ج)" type="number" step="0.01" error={errors.amount?.message} {...register('amount')} />
        {remaining > 0 && (
          <p className="text-xs text-gray-500">المتبقي: {formatMoney(remaining)} ج</p>
        )}
      </div>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//   Create modal — captures the minimum to open a ticket; details edited later
// ═══════════════════════════════════════════════════════════════════════════

const createSchema = z.object({
  branchId: z.string().uuid('اختر الفرع'),
  itemType: z.enum(['device', 'vehicle', 'appointment', 'other']),
  customerId: z.string().uuid().optional().or(z.literal('')),
  assignedUserId: z.string().uuid().optional().or(z.literal('')),
  scheduledAt: z.string().optional(),
  deposit: z.coerce.number().min(0).default(0),

  // Per-itemType fields. Stored into itemDetails JSON server-side.
  brand: z.string().optional(),
  model: z.string().optional(),
  imei: z.string().optional(),
  serialNumber: z.string().optional(),
  conditionNotes: z.string().optional(),

  plate: z.string().optional(),
  make: z.string().optional(),
  year: z.coerce.number().int().optional().or(z.literal('')),
  mileage: z.coerce.number().int().optional().or(z.literal('')),
  vin: z.string().optional(),

  appointmentNotes: z.string().optional(),
  description: z.string().optional(),

  customerNotes: z.string().optional(),
})
type CreateForm = z.infer<typeof createSchema>

function CreateWorkOrderModal({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get<{ data: Branch[] }>('/branches')).data.data,
    enabled: open,
  })
  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers-quick'],
    queryFn: async () => (await api.get<{ data: Customer[] }>('/customers', { params: { limit: 200 } })).data.data ?? [],
    enabled: open,
  })
  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['users-quick'],
    queryFn: async () => (await api.get<{ data: User[] }>('/auth/users')).data.data ?? [],
    enabled: open,
  })

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { itemType: 'device', deposit: 0 },
  })
  const itemType = watch('itemType')

  const { mutate, isPending } = useMutation({
    mutationFn: async (form: CreateForm) => {
      // Build per-itemType details object — backend validates its shape against itemType.
      let itemDetails: Record<string, unknown> = {}
      if (form.itemType === 'device') {
        itemDetails = {
          ...(form.brand ? { brand: form.brand } : {}),
          ...(form.model ? { model: form.model } : {}),
          ...(form.imei ? { imei: form.imei } : {}),
          ...(form.serialNumber ? { serialNumber: form.serialNumber } : {}),
          ...(form.conditionNotes ? { conditionNotes: form.conditionNotes } : {}),
        }
      } else if (form.itemType === 'vehicle') {
        itemDetails = {
          ...(form.make ? { make: form.make } : {}),
          ...(form.model ? { model: form.model } : {}),
          ...(form.plate ? { plate: form.plate } : {}),
          ...(form.vin ? { vin: form.vin } : {}),
          ...(form.year !== '' && form.year != null ? { year: Number(form.year) } : {}),
          ...(form.mileage !== '' && form.mileage != null ? { mileage: Number(form.mileage) } : {}),
        }
      } else if (form.itemType === 'appointment') {
        itemDetails = { ...(form.appointmentNotes ? { notes: form.appointmentNotes } : {}) }
      } else {
        itemDetails = { ...(form.description ? { description: form.description } : {}) }
      }

      const body = {
        branchId: form.branchId,
        itemType: form.itemType,
        itemDetails,
        customerId: form.customerId || undefined,
        assignedUserId: form.assignedUserId || undefined,
        scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : undefined,
        deposit: form.deposit,
        customerNotes: form.customerNotes || undefined,
      }
      const res = await api.post<{ data: { id: string } }>('/work-orders', body)
      return res.data.data
    },
    onSuccess: (created) => {
      toast.success('تم إنشاء الطلب')
      reset()
      onCreated(created.id)
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="طلب عمل جديد"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button loading={isPending} onClick={handleSubmit((d) => mutate(d))}>إنشاء</Button>
        </>
      }
    >
      <form className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Select label="الفرع" error={errors.branchId?.message} {...register('branchId')}>
          <option value="">اختر الفرع...</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Select label="نوع العنصر" {...register('itemType')}>
          <option value="device">جهاز (موبايل / إلكترونيات)</option>
          <option value="vehicle">مركبة</option>
          <option value="appointment">موعد (بدون عنصر مادي)</option>
          <option value="other">أخرى</option>
        </Select>

        <Select label="العميل (اختياري)" {...register('customerId')}>
          <option value="">بدون عميل</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.fullName}{c.phone ? ` — ${c.phone}` : ''}</option>
          ))}
        </Select>
        <Select label="الفنّي المسؤول (اختياري)" {...register('assignedUserId')}>
          <option value="">غير محدّد</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
        </Select>

        {/* Per-itemType fields */}
        {itemType === 'device' && (
          <>
            <Input label="الماركة" {...register('brand')} />
            <Input label="الموديل" {...register('model')} />
            <Input label="IMEI" {...register('imei')} />
            <Input label="الرقم التسلسلي" {...register('serialNumber')} />
            <div className="sm:col-span-2">
              <label className="text-sm text-gray-400 block mb-1">ملاحظات الحالة</label>
              <textarea {...register('conditionNotes')} rows={2}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)] resize-none" />
            </div>
          </>
        )}
        {itemType === 'vehicle' && (
          <>
            <Input label="الماركة" {...register('make')} />
            <Input label="الموديل" {...register('model')} />
            <Input label="رقم اللوحة" {...register('plate')} />
            <Input label="VIN" {...register('vin')} />
            <Input label="سنة الصنع" type="number" {...register('year')} />
            <Input label="الكيلومترات" type="number" {...register('mileage')} />
          </>
        )}
        {itemType === 'appointment' && (
          <>
            <Input label="موعد الحجز" type="datetime-local" {...register('scheduledAt')} />
            <div className="sm:col-span-2">
              <label className="text-sm text-gray-400 block mb-1">ملاحظات الموعد</label>
              <textarea {...register('appointmentNotes')} rows={2}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)] resize-none" />
            </div>
          </>
        )}
        {itemType === 'other' && (
          <div className="sm:col-span-2">
            <label className="text-sm text-gray-400 block mb-1">وصف الخدمة المطلوبة</label>
            <textarea {...register('description')} rows={2}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)] resize-none" />
          </div>
        )}

        {itemType !== 'appointment' && (
          <Input label="موعد التسليم المتوقع (اختياري)" type="datetime-local" {...register('scheduledAt')} />
        )}

        <Input label="عربون (ج)" type="number" step="0.01" {...register('deposit')} />

        <div className="sm:col-span-2">
          <label className="text-sm text-gray-400 block mb-1">ملاحظات العميل (اختياري)</label>
          <textarea {...register('customerNotes')} rows={2}
            className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)] resize-none" />
        </div>
      </form>
    </Modal>
  )
}
