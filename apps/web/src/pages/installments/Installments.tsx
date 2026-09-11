import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, X, Search, Plus, Trash2, Printer, Download, Clock, AlertCircle, Send, Table2, LayoutList, CreditCard } from 'lucide-react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { AppShell } from '@/components/layout/AppShell'
import { Table, Badge, Money, SkeletonTable, Button, Modal, Drawer, Input, Select, Pagination, BulkActionBar } from '@/components/ui'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth.store'
import type { PaginationMeta } from '@/types/api'
import { useSelection } from '@/hooks/useSelection'
import { exportRowsToExcel } from '@/lib/export'
import { formatNumber, formatMoney, formatDate } from '@/lib/format'
import { getApiErrorMessage, getApiErrorCode } from '@/lib/api-error'
import { cn } from '@/lib/cn'

interface Payment {
  id: string
  dueDate: string
  amountPaid: number
  status: 'pending' | 'paid' | 'overdue'
  paidDate?: string
  paymentMethod?: { id: string; name: string }
}

interface InstallmentContract {
  id: string
  contractNumber: string
  customer?: { fullName: string; phone?: string }
  totalAmount: number
  downPayment: number
  remainingAmount: number
  status: 'pending_approval' | 'active' | 'overdue' | 'completed' | 'cancelled'
  nextDueDate?: string
  installmentsCount: number
  payments?: Payment[]
}

const statusMap: Record<string, { label: string; variant: 'warning' | 'success' | 'danger' | 'gray' | 'info' }> = {
  pending_approval: { label: 'انتظار موافقة', variant: 'warning' },
  active: { label: 'نشط', variant: 'success' },
  overdue: { label: 'متأخر', variant: 'danger' },
  completed: { label: 'مكتمل', variant: 'info' },
  cancelled: { label: 'ملغي', variant: 'gray' },
}

// ─── Day-relative label ───────────────────────────────────────────────────────

/**
 * Human label for a date relative to today, e.g. "اليوم", "متأخر 3 أيام", "بعد 12 يوم".
 * Returns the absolute date string for anything outside ±60 days.
 */
function dayRelative(dateIso: string): string {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(dateIso); due.setHours(0, 0, 0, 0)
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000)
  if (diffDays === 0) return 'اليوم'
  if (diffDays === 1) return 'غداً'
  if (diffDays === -1) return 'أمس'
  if (diffDays < 0 && diffDays >= -60) return `متأخر ${-diffDays} يوم`
  if (diffDays > 0 && diffDays <= 60) return `بعد ${diffDays} يوم`
  return formatDate(dateIso)
}

// ─── Payment-schedule timeline ────────────────────────────────────────────────

interface ScheduleTimelineProps {
  contract: InstallmentContract
  onRecord: (paymentId: string) => void
  isRecording: boolean
}

function ScheduleTimeline({ contract, onRecord, isRecording }: ScheduleTimelineProps) {
  const [view, setView] = useState<'table' | 'timeline'>('table')
  const payments = contract.payments ?? []
  if (payments.length === 0) {
    return <p className="text-sm text-gray-500">لم يتم إنشاء جدول السداد بعد.</p>
  }

  const paidCount = payments.filter((p) => p.status === 'paid').length
  const paidTotal = payments.filter((p) => p.status === 'paid').reduce((s, p) => s + Number(p.amountPaid), 0)
  const remainingTotal = payments.filter((p) => p.status !== 'paid').reduce((s, p) => s + Number(p.amountPaid), 0)
  const nextDue = payments.find((p) => p.status !== 'paid')
  const progressPct = payments.length > 0 ? (paidCount / payments.length) * 100 : 0

  return (
    <div className="flex flex-col gap-4">
      {/* Progress + summary */}
      <div className="bg-white rounded-lg border border-gray-700 p-4 flex flex-col gap-3 shadow-sm">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400">التقدم</span>
          <span className="font-mono text-gray-300">
            <span className="text-success-600">{paidCount}</span> / {payments.length} قسط
          </span>
        </div>
        <div className="h-2 bg-gray-750 rounded-full overflow-hidden">
          <div
            className="h-full bg-success-500 transition-all duration-slow"
            style={{ width: `${progressPct}%` }}
            role="progressbar"
            aria-valuenow={Math.round(progressPct)}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
        <div className="grid grid-cols-3 gap-3 pt-1">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500">مدفوع</p>
            <p className="text-sm font-mono text-success-600 num">{formatMoney(paidTotal)} ج</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500">متبقي</p>
            <p className="text-sm font-mono text-gray-200 num">{formatMoney(remainingTotal)} ج</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500">القسط التالي</p>
            <p className="text-sm font-mono text-brand-400">{nextDue ? dayRelative(nextDue.dueDate) : '—'}</p>
          </div>
        </div>
      </div>

      {/* View toggle header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">جدول السداد · {payments.length} قسط</p>
        <div className="flex items-center bg-gray-750 border border-gray-700 rounded-md p-0.5">
          <button
            type="button"
            onClick={() => setView('table')}
            aria-label="عرض جدول"
            className={cn('px-2 py-1 rounded transition-colors flex items-center', view === 'table' ? 'bg-white text-gray-200 shadow-sm' : 'text-gray-400 hover:text-gray-200')}
          >
            <Table2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setView('timeline')}
            aria-label="عرض خط زمني"
            className={cn('px-2 py-1 rounded transition-colors flex items-center', view === 'timeline' ? 'bg-white text-gray-200 shadow-sm' : 'text-gray-400 hover:text-gray-200')}
          >
            <LayoutList className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {view === 'table' ? (
        /* ── Table view ── */
        <div className="overflow-x-auto rounded-lg border border-gray-700">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-750 border-b border-gray-700">
                <th className="text-right px-3 py-2.5 text-[11px] text-gray-500 font-medium w-10">#</th>
                <th className="text-right px-3 py-2.5 text-[11px] text-gray-500 font-medium">الاستحقاق</th>
                <th className="text-right px-3 py-2.5 text-[11px] text-gray-500 font-medium">المبلغ</th>
                <th className="text-right px-3 py-2.5 text-[11px] text-gray-500 font-medium">الحالة</th>
                <th className="text-right px-3 py-2.5 text-[11px] text-gray-500 font-medium">تاريخ الدفع</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {payments.map((p, idx) => {
                const isPaid = p.status === 'paid'
                const isOverdue = p.status === 'overdue'
                const isNext = !isPaid && nextDue?.id === p.id
                return (
                  <tr
                    key={p.id}
                    className={cn(
                      'border-b border-gray-700/60 last:border-0 transition-colors',
                      isPaid ? 'bg-success-500/5' : isOverdue ? 'bg-danger-500/5' : isNext ? 'bg-brand-500/5' : '',
                    )}
                  >
                    <td className="px-3 py-2.5 font-numeric num num-muted text-xs">{idx + 1}</td>
                    <td className="px-3 py-2.5 font-numeric num num-muted text-xs">{formatDate(p.dueDate)}</td>
                    <td className="px-3 py-2.5 font-numeric num num-strong text-sm">{formatMoney(Number(p.amountPaid))} ج</td>
                    <td className="px-3 py-2.5">
                      {isPaid
                        ? <Badge variant="success" dot>مدفوع</Badge>
                        : isOverdue
                        ? <Badge variant="danger" dot>متأخر</Badge>
                        : isNext
                        ? <Badge variant="brand" dot>التالي</Badge>
                        : <Badge variant="gray">معلق</Badge>}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-numeric num num-muted">
                      {p.paidDate ? formatDate(p.paidDate) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-left">
                      {isNext && contract.status === 'active' && (
                        <Button size="sm" loading={isRecording} onClick={() => onRecord(p.id)}>
                          <Check className="w-3 h-3" />تسجيل
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── Timeline view ── */
        <ol className="relative flex flex-col gap-3 pr-6 border-r border-gray-700">
          {payments.map((p, idx) => {
            const isPaid = p.status === 'paid'
            const isOverdue = p.status === 'overdue'
            const isNext = !isPaid && nextDue?.id === p.id
            const dot = isPaid
              ? { bg: 'bg-success-500', ring: 'ring-success-500/30', icon: <Check className="w-3 h-3 text-white" /> }
              : isOverdue
              ? { bg: 'bg-danger-500', ring: 'ring-danger-500/30', icon: <AlertCircle className="w-3 h-3 text-white" /> }
              : { bg: 'bg-gray-750', ring: 'ring-gray-700/30', icon: <Clock className="w-3 h-3 text-gray-400" /> }

            return (
              <li key={p.id} className="relative">
                <span
                  className={`absolute -right-[34px] top-2.5 w-6 h-6 rounded-full ${dot.bg} ring-4 ${dot.ring} flex items-center justify-center`}
                  aria-hidden="true"
                >
                  {dot.icon}
                </span>
                <div className={`flex items-center justify-between rounded-md px-3 py-2 border ${isNext ? 'bg-brand-500/5 border-brand-500/30' : isOverdue ? 'bg-danger-500/5 border-danger-500/30' : 'bg-gray-750 border-gray-700'}`}>
                  <div>
                    <p className="text-sm font-mono text-gray-200">
                      <span className="text-gray-500 ml-2">#{idx + 1}</span>
                      {formatDate(p.dueDate)}
                    </p>
                    <p className={`text-xs mt-0.5 ${isPaid ? 'text-success-600' : isOverdue ? 'text-danger-600' : 'text-gray-500'}`}>
                      {isPaid
                        ? p.paidDate
                          ? `مدفوع · ${formatDate(p.paidDate)}`
                          : 'مدفوع'
                        : dayRelative(p.dueDate)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Money value={p.amountPaid} />
                    {isNext && contract.status === 'active' && (
                      <Button size="sm" loading={isRecording} onClick={() => onRecord(p.id)}>
                        <Check className="w-3 h-3" />تسجيل
                      </Button>
                    )}
                    {isPaid && <Badge variant="success" dot>مدفوع</Badge>}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

// ─── Interfaces for create form ───────────────────────────────────────────────

interface Customer { id: string; fullName: string; phone?: string }
interface Branch { id: string; name: string }
interface PaymentMethod { id: string; name: string }
interface Currency { id: string; code: string; name: string; isBase: boolean }

const contractSchema = z.object({
  customerId: z.string().uuid('اختر العميل'),
  branchId: z.string().uuid('اختر الفرع'),
  paymentMethodId: z.string().uuid('اختر طريقة الدفع'),
  currencyId: z.string().uuid('اختر العملة'),
  downPayment: z.coerce.number().min(0, 'يجب أن يكون صفراً أو أكثر'),
  installmentsCount: z.coerce.number().int().min(1).max(120),
  interestRate: z.coerce.number().min(0).max(100).default(0),
  firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'اختر تاريخاً صحيحاً'),
  paymentDay: z.coerce.number().int().min(1).max(28, 'أقصى يوم هو 28'),
  guarantorName: z.string().optional(),
  guarantorPhone: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    variantId: z.string().uuid(),
    variantLabel: z.string().optional(),
    quantity: z.coerce.number().int().positive('الكمية موجبة'),
    unitPrice: z.coerce.number().positive('السعر يجب أن يكون أكبر من صفر'),
  })).min(1, 'أضف صنفاً واحداً على الأقل'),
})
type ContractForm = z.infer<typeof contractSchema>

function VariantSearchField({ index, register, setValue }: {
  index: number
  register: ReturnType<typeof useForm<ContractForm>>['register']
  setValue: ReturnType<typeof useForm<ContractForm>>['setValue']
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ id: string; sku: string; sellPrice: number; product: { name: string } }[]>([])
  const [selected, setSelected] = useState('')

  const search = async (query: string) => {
    setQ(query)
    if (query.length < 2) { setResults([]); return }
    const res = await api.get<{ data: { id: string; sku: string; sellPrice: number; product: { name: string } }[] }>('/products/search', { params: { q: query, limit: 6 } })
    setResults(res.data.data)
  }

  const pick = (v: { id: string; sku: string; sellPrice: number; product: { name: string } }) => {
    setValue(`items.${index}.variantId`, v.id, { shouldValidate: true })
    setValue(`items.${index}.unitPrice`, Number(v.sellPrice))
    const label = `${v.product.name} (${v.sku})`
    setValue(`items.${index}.variantLabel`, label)
    setSelected(label)
    setResults([])
    setQ('')
  }

  return (
    <div className="relative flex-1">
      <input
        value={selected || q}
        placeholder="بحث عن منتج..."
        onChange={(e) => { setSelected(''); search(e.target.value) }}
        className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)]"
      />
      <input type="hidden" {...register(`items.${index}.variantId`)} />
      <input type="hidden" {...register(`items.${index}.variantLabel`)} />
      {results.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-gray-800 border border-gray-700 rounded-md shadow-lg overflow-hidden">
          {results.map((v) => (
            <button key={v.id} type="button" onClick={() => pick(v)}
              className="w-full text-right px-3 py-2 hover:bg-gray-700 flex justify-between text-sm border-b border-gray-700/50 last:border-0">
              <span className="text-gray-100">{v.product.name}</span>
              <span className="num-code text-xs">{v.sku}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CreateContractDrawer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers-all'],
    queryFn: async () => (await api.get<{ data: Customer[] }>('/customers', { params: { limit: 200 } })).data.data,
  })
  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get<{ data: Branch[] }>('/branches')).data.data,
  })
  const { data: paymentMethods = [] } = useQuery<PaymentMethod[]>({
    queryKey: ['payment-methods'],
    queryFn: async () => (await api.get<{ data: PaymentMethod[] }>('/payment-methods')).data.data,
  })
  const { data: currencies = [] } = useQuery<Currency[]>({
    queryKey: ['currencies'],
    queryFn: async () => (await api.get<{ data: Currency[] }>('/installments/currencies')).data.data,
  })

  const { register, handleSubmit, control, watch, setValue, formState: { errors } } = useForm<ContractForm>({
    resolver: zodResolver(contractSchema),
    defaultValues: { installmentsCount: 12, interestRate: 0, downPayment: 0, paymentDay: 1, items: [{ variantId: '', variantLabel: '', quantity: 1, unitPrice: 0 }] },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })

  const items = watch('items')
  const downPayment = Number(watch('downPayment') ?? 0)
  const installmentsCount = Number(watch('installmentsCount') ?? 1)
  const interestRate = Number(watch('interestRate') ?? 0)
  const subtotal = items.reduce((s, i) => s + (Number(i.unitPrice) * Number(i.quantity) || 0), 0)
  const financed = Math.max(0, subtotal - downPayment)
  const years = installmentsCount / 12
  const totalInterest = financed * (interestRate / 100) * years
  const totalWithInterest = financed + totalInterest
  const installmentAmount = installmentsCount > 0 ? totalWithInterest / installmentsCount : 0

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: ContractForm) => {
      await api.post('/installments', {
        customerId: data.customerId,
        branchId: data.branchId,
        paymentMethodId: data.paymentMethodId,
        currencyId: data.currencyId,
        downPayment: data.downPayment,
        installmentsCount: data.installmentsCount,
        interestRate: data.interestRate,
        firstDueDate: data.firstDueDate,
        paymentDay: data.paymentDay,
        guarantorName: data.guarantorName || undefined,
        guarantorPhone: data.guarantorPhone || undefined,
        notes: data.notes || undefined,
        items: data.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, unitPrice: i.unitPrice })),
      })
    },
    onSuccess: () => {
      toast.success('تم إنشاء عقد القسط')
      qc.invalidateQueries({ queryKey: ['installments'] })
      onClose()
    },
    onError: (e: unknown) => {
      toast.error(getApiErrorCode(e) === 'insufficient_stock' ? 'المخزون غير كافٍ' : 'فشل إنشاء العقد')
    },
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Select label="العميل" error={errors.customerId?.message} {...register('customerId')}>
            <option value="">اختر العميل...</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.fullName}{c.phone ? ` — ${c.phone}` : ''}</option>)}
          </Select>
        </div>
        <div>
          <Select label="الفرع" error={errors.branchId?.message} {...register('branchId')}>
            <option value="">اختر...</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
        <div>
          <Select label="طريقة الدفع" error={errors.paymentMethodId?.message} {...register('paymentMethodId')}>
            <option value="">اختر...</option>
            {paymentMethods.map((pm) => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
          </Select>
        </div>
        <div>
          <Select label="العملة" error={errors.currencyId?.message} {...register('currencyId')}>
            <option value="">اختر...</option>
            {currencies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </Select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-gray-300">الأصناف</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => append({ variantId: '', variantLabel: '', quantity: 1, unitPrice: 0 })}>
            <Plus className="w-3 h-3" />إضافة صنف
          </Button>
        </div>
        {errors.items?.root && <p className="text-danger-500 text-xs mb-2">{errors.items.root.message}</p>}
        <div className="flex flex-col gap-2">
          {fields.map((field, idx) => (
            <div key={field.id} className="bg-gray-750 border border-gray-700 rounded-md p-3 flex flex-col gap-2">
              <div className="flex gap-2 items-center">
                <VariantSearchField index={idx} register={register} setValue={setValue} />
                <Button type="button" variant="ghost" size="sm" className="text-danger-500" onClick={() => remove(idx)}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input label="الكمية" type="number" min={1} {...register(`items.${idx}.quantity`)} />
                <Input label="سعر الوحدة (ج)" type="number" step="0.01" {...register(`items.${idx}.unitPrice`)} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Input label="المقدم (ج)" type="number" step="0.01" {...register('downPayment')} />
        <Input label="عدد الأقساط" type="number" min={1} max={120} {...register('installmentsCount')} />
        <Input label="الفائدة السنوية %" type="number" step="0.1" min={0} max={100} {...register('interestRate')} />
      </div>

      <div className="bg-gray-750 border border-gray-700 rounded-md p-3 text-sm flex flex-col gap-1">
        <div className="flex justify-between text-gray-400"><span>إجمالي الأصناف</span><Money value={subtotal} /></div>
        <div className="flex justify-between text-gray-400"><span>المقدم</span><span className="text-danger-600">- <Money value={downPayment} /></span></div>
        {interestRate > 0 && <div className="flex justify-between text-gray-400"><span>الفائدة السنوية ({interestRate}% × {formatNumber(years, { maximumFractionDigits: 2 })} سنة)</span><Money value={totalInterest} /></div>}
        <div className="flex justify-between text-gray-100 font-semibold border-t border-gray-600 pt-1 mt-1">
          <span>القسط الشهري (× {installmentsCount})</span>
          <Money value={installmentAmount} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="تاريخ أول قسط"
          type="date"
          error={errors.firstDueDate?.message}
          {...register('firstDueDate', {
            onChange: (e) => {
              const day = new Date(e.target.value).getUTCDate()
              if (day >= 1 && day <= 28) setValue('paymentDay', day)
            },
          })}
        />
        <Input
          label="يوم الدفع كل شهر"
          type="number"
          min={1}
          max={28}
          hint="من 1 إلى 28"
          error={errors.paymentDay?.message}
          {...register('paymentDay')}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input label="اسم الضامن (اختياري)" {...register('guarantorName')} />
        <Input label="هاتف الضامن (اختياري)" {...register('guarantorPhone')} />
      </div>

      <div>
        <label className="text-sm text-gray-400 block mb-1">ملاحظات (اختياري)</label>
        <textarea {...register('notes')} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)] resize-none" />
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>إلغاء</Button>
        <Button loading={isPending} className="flex-1" onClick={handleSubmit((d) => mutate(d))}>إنشاء العقد</Button>
      </div>
    </div>
  )
}

const LIMIT = 20

function printContract(c: InstallmentContract) {
  const fmt = (n: number) => formatMoney(n)
  const paymentRows = (c.payments ?? []).map((p, i) => `
    <tr>
      <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${i + 1}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb">${formatDate(p.dueDate)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;text-align:left">${fmt(Number(p.amountPaid))} ج</td>
      <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${p.status === 'paid' ? '✓ مدفوع' : p.status === 'overdue' ? '⚠ متأخر' : '—'}</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
    <title>عقد قسط ${c.contractNumber}</title>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'IBM Plex Sans Arabic',Arial,sans-serif;font-size:13px;color:#111;background:#fff;padding:32px}
      h1{font-size:20px;font-weight:700}
      .meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:20px 0;padding:14px;background:#f9fafb;border-radius:8px}
      .meta-item label{font-size:11px;color:#6b7280;display:block;margin-bottom:2px}
      .meta-item p{font-weight:600}
      table{width:100%;border-collapse:collapse;margin-top:16px}
      th{background:#f3f4f6;padding:8px 10px;font-size:12px;color:#374151;text-align:right}
      .sig{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:60px}
      .sig-box{border-top:1px solid #374151;padding-top:8px;font-size:12px;color:#6b7280}
      .footer{margin-top:30px;text-align:center;font-size:11px;color:#9ca3af}
      @media print{body{padding:16px}}
    </style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div><h1>عقد بيع بالتقسيط</h1><p style="color:#6b7280;font-size:12px">حِسبة POS</p></div>
      <div style="text-align:left">
        <p style="font-size:16px;font-weight:700;font-family:'IBM Plex Mono',monospace">${c.contractNumber}</p>
        <p style="font-size:12px;color:#6b7280">${formatDate(new Date())}</p>
      </div>
    </div>
    <div class="meta">
      <div class="meta-item"><label>العميل</label><p>${c.customer?.fullName ?? '—'}</p></div>
      <div class="meta-item"><label>الهاتف</label><p>${c.customer?.phone ?? '—'}</p></div>
      <div class="meta-item"><label>إجمالي العقد</label><p>${fmt(Number(c.totalAmount))} ج</p></div>
      <div class="meta-item"><label>المقدم</label><p>${fmt(Number(c.downPayment))} ج</p></div>
      <div class="meta-item"><label>المبلغ الممول</label><p>${fmt(Number(c.remainingAmount))} ج</p></div>
      <div class="meta-item"><label>عدد الأقساط</label><p>${c.installmentsCount} قسط</p></div>
    </div>
    <h2 style="font-size:14px;font-weight:600;margin-bottom:8px">جدول السداد</h2>
    <table>
      <thead><tr>
        <th style="text-align:center">#</th><th>تاريخ الاستحقاق</th><th style="text-align:left">المبلغ</th><th style="text-align:center">الحالة</th>
      </tr></thead>
      <tbody>${paymentRows}</tbody>
    </table>
    <div class="sig">
      <div class="sig-box">توقيع العميل: ${c.customer?.fullName ?? ''}</div>
      <div class="sig-box">توقيع البائع</div>
    </div>
    <div class="footer"><p>تم الإنشاء بواسطة حِسبة — هذا العقد ملزم قانونياً</p></div>
  </body></html>`

  const win = window.open('', '_blank', 'width=800,height=1100')
  if (!win) return
  win.document.write(html)
  win.document.close()
  setTimeout(() => { win.print(); setTimeout(() => win.close(), 500) }, 300)
}

export default function Installments() {
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{ contract: InstallmentContract; type: 'approve' | 'reject' } | null>(null)
  const [detailContract, setDetailContract] = useState<InstallmentContract | null>(null)
  const [recordModal, setRecordModal] = useState<{ contractId: string; paymentId: string } | null>(null)
  const [recordPM, setRecordPM] = useState('')
  const [recordDate, setRecordDate] = useState(new Date().toISOString().slice(0, 10))

  const { mutate: sendReminders, isPending: isSendingReminders } = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: { sent: number; skippedNoEmail: number; skippedRecentlyReminded: number; errors: number } }>('/installments/send-reminders')
      return res.data.data
    },
    onSuccess: (s) => {
      const parts: string[] = []
      parts.push(`أُرسل ${s.sent}`)
      if (s.skippedNoEmail) parts.push(`${s.skippedNoEmail} بدون بريد`)
      if (s.skippedRecentlyReminded) parts.push(`${s.skippedRecentlyReminded} مُذكَّر سابقاً`)
      if (s.errors) parts.push(`${s.errors} خطأ`)
      toast.success(parts.join(' · '))
    },
    onError: () => toast.error('فشل إرسال التذكيرات'),
  })

  const { data: listData, isLoading } = useQuery<{ data: InstallmentContract[]; meta: PaginationMeta }>({
    queryKey: ['installments', search, page, statusFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit: LIMIT, page }
      if (search) params.search = search
      if (statusFilter) params.status = statusFilter
      return (await api.get<{ data: InstallmentContract[]; meta: PaginationMeta }>('/installments', { params })).data
    },
  })
  const data = listData?.data ?? []

  const { data: paymentMethods = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['payment-methods'],
    queryFn: async () => (await api.get<{ data: { id: string; name: string }[] }>('/payment-methods')).data.data,
  })

  const selection = useSelection(data.map((c) => c.id))

  const bulkExport = async () => {
    const selected = data.filter((c) => selection.isSelected(c.id))
    await exportRowsToExcel(
      selected,
      [
        { header: 'رقم العقد', accessor: 'contractNumber', width: 20 },
        { header: 'العميل', accessor: (c) => c.customer?.fullName ?? '', width: 24 },
        { header: 'الهاتف', accessor: (c) => c.customer?.phone ?? '', width: 16 },
        { header: 'الإجمالي', accessor: 'totalAmount', width: 14 },
        { header: 'المقدم', accessor: 'downPayment', width: 14 },
        { header: 'المتبقي', accessor: 'remainingAmount', width: 14 },
        { header: 'عدد الأقساط', accessor: 'installmentsCount', width: 12 },
        { header: 'الحالة', accessor: (c) => statusMap[c.status]?.label ?? c.status, width: 14 },
        { header: 'القسط التالي', accessor: (c) => c.nextDueDate ?? '', width: 14 },
      ],
      `installments-${selected.length}.xlsx`,
      'عقود الأقساط',
    )
  }
  const meta = listData?.meta

  const { mutate: reviewContract, isPending: isReviewing } = useMutation({
    mutationFn: async ({ contract, type }: { contract: InstallmentContract; type: 'approve' | 'reject' }) =>
      api.patch(`/installments/${contract.id}/${type}`),
    onSuccess: (_, { type }) => {
      toast.success(type === 'approve' ? 'تمت الموافقة على العقد' : 'تم رفض العقد')
      qc.invalidateQueries({ queryKey: ['installments'] })
      setConfirmAction(null)
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err)),
  })

  const { mutate: recordPayment, isPending: isRecording } = useMutation({
    mutationFn: async ({ contractId, paymentId, paymentMethodId, paidDate }: { contractId: string; paymentId: string; paymentMethodId?: string; paidDate?: string }) =>
      api.post(`/installments/${contractId}/payments/${paymentId}`, { paidDate: paidDate ?? new Date().toISOString().slice(0, 10), paymentMethodId: paymentMethodId || undefined }),
    onSuccess: () => {
      toast.success('تم تسجيل الدفعة')
      setRecordModal(null)
      setRecordPM('')
      setRecordDate(new Date().toISOString().slice(0, 10))
      qc.invalidateQueries({ queryKey: ['installments'] })
      if (detailContract) {
        api.get<{ data: InstallmentContract }>(`/installments/${detailContract.id}`)
          .then((r) => setDetailContract(r.data.data))
      }
    },
    onError: (e: unknown) => toast.error(
      getApiErrorCode(e) === 'previous_installments_not_paid'
        ? 'يجب سداد الأقساط السابقة أولاً'
        : 'حدث خطأ في تسجيل الدفعة'
    ),
  })

  const openDetail = async (contract: InstallmentContract) => {
    const res = await api.get<{ data: InstallmentContract }>(`/installments/${contract.id}`)
    setDetailContract(res.data.data)
  }

  const canApprove = user?.roleSlug === 'super_admin' || user?.permissions?.installments?.includes('approve')

  return (
    <AppShell title="الأقساط">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 max-w-xs">
            <Input placeholder="بحث بالعميل أو رقم العقد..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} startIcon={<Search className="w-4 h-4" />} />
          </div>
          <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
            <option value="">كل الحالات</option>
            <option value="pending_approval">انتظار موافقة</option>
            <option value="active">نشط</option>
            <option value="overdue">متأخر</option>
            <option value="completed">مكتمل</option>
            <option value="cancelled">ملغي</option>
          </Select>
          <div className="flex-1" />
          <Button variant="outline" loading={isSendingReminders} onClick={() => sendReminders()}>
            <Send className="w-4 h-4" />إرسال تذكيرات
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" />عقد جديد
          </Button>
        </div>
        {isLoading ? <SkeletonTable rows={8} cols={6} /> : (
          <>
          <Table
            selection={{
              isSelected: (c) => selection.isSelected(c.id),
              onToggle: (c) => selection.toggle(c.id),
              onToggleAll: selection.toggleAllVisible,
              allSelected: selection.allVisibleSelected,
              someSelected: selection.someVisibleSelected,
            }}
            onRowClick={(c) => openDetail(c)}
            columns={[
              { key: 'contractNumber', header: 'رقم العقد', render: (c) => (
                <span className="font-mono text-brand-400">{c.contractNumber || `#${c.id.slice(-6).toUpperCase()}`}</span>
              )},
              { key: 'customer', header: 'العميل', render: (c) => <span className="font-medium text-gray-100">{c.customer?.fullName ?? '—'}</span> },
              { key: 'totalAmount', header: 'إجمالي العقد', render: (c) => <Money value={c.totalAmount} /> },
              { key: 'remainingAmount', header: 'المتبقي', render: (c) => <Money value={c.remainingAmount} /> },
              { key: 'status', header: 'الحالة', render: (c) => {
                const s = statusMap[c.status]
                return s ? <Badge variant={s.variant} dot>{s.label}</Badge> : <span>{c.status}</span>
              }},
              { key: 'nextDueDate', header: 'الاستحقاق القادم', render: (c) => c.nextDueDate
                ? <span className="text-gray-500 text-xs">{formatDate(c.nextDueDate)}</span>
                : <span className="text-gray-500">—</span>
              },
              { key: 'actions', header: '', render: (c) => (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button variant="outline" size="sm" onClick={() => openDetail(c)}>
                    عرض جدول الأقساط
                  </Button>
                  {c.status === 'pending_approval' && canApprove && (
                    <>
                      <Button variant="ghost" size="sm" className="text-success-500" onClick={() => setConfirmAction({ contract: c, type: 'approve' })}>
                        <Check className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-danger-500" onClick={() => setConfirmAction({ contract: c, type: 'reject' })}>
                        <X className="w-3 h-3" />
                      </Button>
                    </>
                  )}
                </div>
              )},
            ]}
            data={data} keyExtractor={(c) => c.id} emptyMessage="لا توجد عقود أقساط" emptyIcon={<CreditCard className="w-8 h-8" />} emptyDescription="أنشئ عقد أقساط من صفحة الفواتير"
          />
          {meta && <Pagination page={meta.page} pages={meta.pages} total={meta.total} limit={meta.limit} onPage={setPage} />}
          </>
        )}
      </div>

      {/* Detail Drawer */}
      <Drawer
        open={!!detailContract}
        onClose={() => setDetailContract(null)}
        title={`عقد ${detailContract?.contractNumber || (detailContract ? `#${detailContract.id.slice(-6).toUpperCase()}` : '')}`}
        width="w-[480px]"
        footer={
          <Button variant="ghost" onClick={() => detailContract && printContract(detailContract)}>
            <Printer className="w-4 h-4" />طباعة العقد
          </Button>
        }
      >
        {detailContract && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">العميل</span><p className="text-gray-100 font-medium">{detailContract.customer?.fullName ?? '—'}</p></div>
              <div><span className="text-gray-500">الهاتف</span><p className="num-code">{detailContract.customer?.phone ?? '—'}</p></div>
              <div><span className="text-gray-500">إجمالي العقد</span><p className="text-gray-100"><Money value={detailContract.totalAmount} /></p></div>
              <div><span className="text-gray-500">المقدم</span><p className="text-gray-100"><Money value={detailContract.downPayment} /></p></div>
              <div><span className="text-gray-500">المتبقي</span><p className="text-gray-100"><Money value={detailContract.remainingAmount} /></p></div>
              <div><span className="text-gray-500">عدد الأقساط</span><p className="text-gray-100">{detailContract.installmentsCount}</p></div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-3">جدول السداد</h4>
              <ScheduleTimeline
                contract={detailContract}
                isRecording={isRecording}
                onRecord={(paymentId) => { setRecordDate(new Date().toISOString().slice(0, 10)); setRecordModal({ contractId: detailContract.id, paymentId }) }}
              />
            </div>
          </div>
        )}
      </Drawer>

      {/* Create contract drawer */}
      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="عقد قسط جديد" width="w-[580px]">
        {createOpen && <CreateContractDrawer onClose={() => setCreateOpen(false)} />}
      </Drawer>

      {/* Approve/Reject confirmation */}
      <Modal
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        title={confirmAction?.type === 'approve' ? 'موافقة على العقد' : 'رفض العقد'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmAction(null)}>إلغاء</Button>
            <Button
              variant={confirmAction?.type === 'approve' ? 'primary' : 'danger'}
              loading={isReviewing}
              onClick={() => confirmAction && reviewContract(confirmAction)}
            >
              {confirmAction?.type === 'approve' ? 'موافقة' : 'رفض'}
            </Button>
          </>
        }
      >
        <p className="text-gray-300">
          {confirmAction?.type === 'approve'
            ? `هل تريد الموافقة على عقد ${confirmAction.contract.contractNumber || `#${confirmAction.contract.id.slice(-6).toUpperCase()}`}؟ سيتم خصم المخزون عند الاعتماد.`
            : `هل تريد رفض عقد ${confirmAction?.contract.contractNumber || `#${confirmAction?.contract.id.slice(-6).toUpperCase()}`}؟`}
        </p>
      </Modal>
      {/* Record payment modal */}
      <Modal
        open={!!recordModal}
        onClose={() => setRecordModal(null)}
        title="تسجيل دفعة قسط"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRecordModal(null)}>إلغاء</Button>
            <Button
              loading={isRecording}
              disabled={!recordPM || recordDate > new Date().toISOString().slice(0, 10)}
              onClick={() => recordModal && recordPayment({ ...recordModal, paymentMethodId: recordPM, paidDate: recordDate })}
            >
              تسجيل الدفعة
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Select label="طريقة الدفع" value={recordPM} onChange={(e) => setRecordPM(e.target.value)}>
            <option value="">اختر طريقة الدفع...</option>
            {paymentMethods.map((pm) => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
          </Select>
          <Input
            label="تاريخ الدفع"
            type="date"
            value={recordDate}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setRecordDate(e.target.value)}
            error={
              recordDate > new Date().toISOString().slice(0, 10)
                ? 'لا يمكن تسجيل دفعة بتاريخ مستقبلي'
                : undefined
            }
          />
        </div>
      </Modal>

      <BulkActionBar count={selection.count} onClear={selection.clear}>
        <Button variant="outline" size="sm" onClick={bulkExport}>
          <Download className="w-4 h-4" />تصدير
        </Button>
      </BulkActionBar>
    </AppShell>
  )
}
