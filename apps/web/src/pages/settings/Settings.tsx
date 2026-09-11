import { useState, useEffect, Fragment } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, ToggleLeft, ToggleRight, Shield, Tag, RefreshCw, Check, Trash2, Download, Eye, EyeOff, Sparkles, XCircle, Receipt } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { AppShell } from '@/components/layout/AppShell'
import { Button, Input, Badge, Table, Drawer, Pagination, Modal, Alert, DateRangePicker, Select, ConfirmDialog } from '@/components/ui'
import { api } from '@/api/client'
import { cn } from '@/lib/cn'
import { passwordSchema } from '@/lib/validation'
import type { PaginationMeta } from '@/types/api'
import { exportRowsToExcel } from '@/lib/export'
import { formatDate, formatDateTime } from '@/lib/format'
import { getApiErrorMessage, getApiErrorCode } from '@/lib/api-error'
import { useMe } from '@/hooks/useMe'
import { useSubscriptionStatus, type SubscriptionStatus as SubStatus } from '@/hooks/useSubscription'
import type { BadgeVariant } from '@/components/ui/Badge'

const tabs = [
  { id: 'store', label: 'بيانات المتجر' },
  { id: 'billing', label: 'الفوترة والاشتراك' },
  { id: 'branches', label: 'الفروع' },
  { id: 'payment', label: 'طرق الدفع' },
  { id: 'categories', label: 'فئات المنتجات' },
  { id: 'tax', label: 'معدلات الضريبة' },
  { id: 'expense-categories', label: 'فئات المصروفات' },
  { id: 'users', label: 'المستخدمون' },
  { id: 'coupons', label: 'الكوبونات' },
  { id: 'eta', label: 'التقارير الضريبية' },
  { id: 'print-template', label: 'قالب الطباعة' },
  { id: 'audit', label: 'سجل التدقيق' },
  { id: 'password', label: 'كلمة المرور' },
]

const validTabIds = new Set(tabs.map((t) => t.id))

export default function Settings() {
  // Read the active tab from ?tab=… so external CTAs (banner, UsageBanner) can
  // deep-link straight into a section. Falls back to "store" for unknown values
  // so a stray query param can't blank out the page.
  const [searchParams, setSearchParams] = useSearchParams()
  const urlTab = searchParams.get('tab')
  const tab = urlTab && validTabIds.has(urlTab) ? urlTab : 'store'
  const setTab = (id: string) => {
    const next = new URLSearchParams(searchParams)
    if (id === 'store') next.delete('tab')
    else next.set('tab', id)
    setSearchParams(next, { replace: true })
  }
  return (
    <AppShell title="الإعدادات">
      <div className="flex gap-6">
        <nav className="w-48 flex flex-col gap-1 shrink-0">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn('text-right px-3 py-2 rounded-lg text-sm transition-all duration-fast', tab === t.id ? 'bg-brand-500/12 text-brand-400 font-medium shadow-[inset_3px_0_0_0_#1FA971]' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-750')}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 bg-white rounded-xl border border-gray-700 p-6 shadow-sm">
          {tab === 'store' && <StoreSettings />}
          {tab === 'billing' && <BillingSettings />}
          {tab === 'branches' && <BranchesSettings />}
          {tab === 'payment' && <PaymentMethodsSettings />}
          {tab === 'categories' && <ProductCategoriesSettings />}
          {tab === 'tax' && <TaxRatesSettings />}
          {tab === 'expense-categories' && <ExpenseCategoriesSettings />}
          {tab === 'users' && <UsersSettings />}
          {tab === 'coupons' && <CouponsSettings />}
          {tab === 'eta' && <EtaSettings />}
          {tab === 'print-template' && <PrintTemplateSettings />}
          {tab === 'audit' && <AuditLogSettings />}
          {tab === 'password' && <ChangePasswordSettings />}
        </div>
      </div>
    </AppShell>
  )
}

// ─── Store Settings ───────────────────────────────────────────────────────────
interface TenantSetting {
  id: string
  currencyDefault: string
  vatEnabled: boolean
  vatRate: number | string
  timezone: string
  language: string
  loyaltyEnabled: boolean
  loyaltyPointsPerUnit: number
  loyaltyPointValue: number | string
  dailySalesTarget: number | string
}

const storeSchema = z.object({
  vatEnabled: z.boolean(),
  vatRate: z.coerce.number().min(0).max(100),
  timezone: z.string().min(1),
  currencyDefault: z.string().min(1),
  loyaltyEnabled: z.boolean(),
  loyaltyPointsPerUnit: z.coerce.number().int().min(1),
  loyaltyPointValue: z.coerce.number().min(0),
  dailySalesTarget: z.coerce.number().min(0),
})
type StoreFormData = z.infer<typeof storeSchema>

function StoreSettings() {
  const qc = useQueryClient()
  const { data: settings, isLoading } = useQuery<TenantSetting>({
    queryKey: ['tenant-settings'],
    queryFn: async () => (await api.get<{ data: TenantSetting }>('/settings')).data.data,
  })

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<StoreFormData>({
    resolver: zodResolver(storeSchema),
    values: settings ? {
      vatEnabled: settings.vatEnabled,
      vatRate: Number(settings.vatRate),
      timezone: settings.timezone,
      currencyDefault: settings.currencyDefault,
      loyaltyEnabled: settings.loyaltyEnabled ?? false,
      loyaltyPointsPerUnit: settings.loyaltyPointsPerUnit ?? 1,
      loyaltyPointValue: Number(settings.loyaltyPointValue ?? 0.01),
      dailySalesTarget: Number(settings.dailySalesTarget ?? 0),
    } : undefined,
  })

  const vatEnabled = watch('vatEnabled')
  const loyaltyEnabled = watch('loyaltyEnabled')

  const { mutate: save, isPending } = useMutation({
    mutationFn: async (data: StoreFormData) => api.patch('/settings', data),
    onSuccess: () => { toast.success('تم حفظ الإعدادات'); qc.invalidateQueries({ queryKey: ['tenant-settings'] }) },
    onError: () => toast.error('فشل حفظ الإعدادات'),
  })

  if (isLoading) return <div className="h-40 bg-gray-800 rounded-xl animate-pulse" />

  return (
    <form onSubmit={handleSubmit((d) => save(d))} className="flex flex-col gap-6 max-w-lg">
      <h3 className="text-lg font-semibold text-gray-100">إعدادات المتجر</h3>

      <div className="flex flex-col gap-4">
        <Select label="العملة الافتراضية" {...register('currencyDefault')}>
          <option value="EGP">EGP — جنيه مصري</option>
          <option value="USD">USD — دولار</option>
          <option value="EUR">EUR — يورو</option>
          <option value="SAR">SAR — ريال سعودي</option>
          <option value="AED">AED — درهم إماراتي</option>
        </Select>

        <Select label="المنطقة الزمنية" {...register('timezone')}>
          <option value="Africa/Cairo">Africa/Cairo (GMT+2)</option>
          <option value="Asia/Riyadh">Asia/Riyadh (GMT+3)</option>
          <option value="Asia/Dubai">Asia/Dubai (GMT+4)</option>
          <option value="Europe/London">Europe/London (GMT+0)</option>
        </Select>

        <div className="flex items-center justify-between bg-white border border-gray-700 rounded-md px-4 py-3 shadow-sm">
          <div>
            <p className="text-sm text-gray-200">ضريبة القيمة المضافة (VAT)</p>
            <p className="text-xs text-gray-500">تطبيق الضريبة تلقائياً على الفواتير</p>
          </div>
          <button
            type="button"
            onClick={() => setValue('vatEnabled', !vatEnabled)}
            className={cn('w-10 h-6 rounded-full transition-colors relative', vatEnabled ? 'bg-brand-500' : 'bg-gray-600')}
          >
            <span className={cn('absolute top-1 w-4 h-4 bg-white rounded-full transition-transform', vatEnabled ? 'translate-x-5' : 'translate-x-1')} />
          </button>
        </div>

        {vatEnabled && (
          <Input
            label="نسبة الضريبة (%)"
            type="number"
            step="0.01"
            min="0"
            max="100"
            error={errors.vatRate?.message}
            {...register('vatRate')}
          />
        )}

        <Input
          label="هدف المبيعات اليومي (ج)"
          type="number"
          step="1"
          min="0"
          placeholder="0 = غير محدد"
          error={errors.dailySalesTarget?.message}
          {...register('dailySalesTarget')}
        />

        <div className="flex items-center justify-between bg-white border border-gray-700 rounded-md px-4 py-3 shadow-sm">
          <div>
            <p className="text-sm text-gray-200">نقاط الولاء</p>
            <p className="text-xs text-gray-500">اكسب نقاط عند كل عملية شراء</p>
          </div>
          <button
            type="button"
            onClick={() => setValue('loyaltyEnabled', !loyaltyEnabled)}
            className={cn('w-10 h-6 rounded-full transition-colors relative', loyaltyEnabled ? 'bg-brand-500' : 'bg-gray-600')}
          >
            <span className={cn('absolute top-1 w-4 h-4 bg-white rounded-full transition-transform', loyaltyEnabled ? 'translate-x-5' : 'translate-x-1')} />
          </button>
        </div>

        {loyaltyEnabled && (
          <div className="flex gap-3">
            <Input
              label="نقطة لكل (ج)"
              type="number"
              min="1"
              error={errors.loyaltyPointsPerUnit?.message}
              {...register('loyaltyPointsPerUnit')}
            />
            <Input
              label="قيمة النقطة (ج)"
              type="number"
              step="0.01"
              min="0"
              error={errors.loyaltyPointValue?.message}
              {...register('loyaltyPointValue')}
            />
          </div>
        )}

        <Button type="submit" loading={isPending} className="w-fit">حفظ الإعدادات</Button>
      </div>
    </form>
  )
}

// ─── Billing Settings ─────────────────────────────────────────────────────────

interface PaymentAttempt {
  id: string
  amount: string | number
  currency: string
  status: 'SUCCESS' | 'FAILED' | 'PENDING'
  attemptType: string
  attemptedAt: string
  providerTransactionId?: string | null
}

interface PortalResponse {
  subscription: {
    id: string
    status: SubStatus
    priceAtSubscription: string | number
    plan: { name: string; priceMonthly: string | number; priceYearly: string | number }
  } | null
  history: PaymentAttempt[]
}

const STATUS_LABEL: Record<SubStatus, { label: string; variant: BadgeVariant }> = {
  ACTIVE: { label: 'نشط', variant: 'success' },
  TRIALING: { label: 'تجريبي', variant: 'brand' },
  PAST_DUE: { label: 'متأخر السداد', variant: 'warning' },
  SUSPENDED: { label: 'معلَّق', variant: 'danger' },
  CANCELLED: { label: 'ملغى', variant: 'gray' },
}

const ATTEMPT_STATUS_LABEL: Record<PaymentAttempt['status'], { label: string; variant: BadgeVariant }> = {
  SUCCESS: { label: 'ناجح', variant: 'success' },
  FAILED: { label: 'فاشل', variant: 'danger' },
  PENDING: { label: 'قيد المعالجة', variant: 'warning' },
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: parts[0] ?? '' }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] }
}

const checkoutSchema = z.object({
  firstName: z.string().min(1, 'الاسم الأول مطلوب'),
  lastName: z.string().min(1, 'اسم العائلة مطلوب'),
  email: z.string().email('بريد إلكتروني غير صحيح'),
  phone: z.string().min(8, 'رقم الهاتف مطلوب'),
})
type CheckoutFormData = z.infer<typeof checkoutSchema>

function UpgradeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: me } = useMe()
  const prefill = me?.user.fullName ? splitName(me.user.fullName) : { firstName: '', lastName: '' }

  const { register, handleSubmit, formState: { errors } } = useForm<CheckoutFormData>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      firstName: prefill.firstName,
      lastName: prefill.lastName,
      email: me?.user.email ?? '',
      phone: '',
    },
  })

  const { mutate: startCheckout, isPending } = useMutation({
    mutationFn: async (data: CheckoutFormData) => {
      const res = await api.post<{ iframeUrl: string }>('/billing/checkout', data)
      return res.data
    },
    onSuccess: ({ iframeUrl }) => {
      // Redirect into Paymob's hosted iframe. The webhook flips the
      // subscription to ACTIVE once the user completes payment.
      window.location.href = iframeUrl
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="تأكيد بيانات الدفع"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button type="submit" form="upgrade-form" loading={isPending}>المتابعة إلى الدفع</Button>
        </>
      }
    >
      <form id="upgrade-form" onSubmit={handleSubmit((d) => startCheckout(d))} className="flex flex-col gap-4">
        <p className="text-xs text-gray-400">
          سيتم تحويلك إلى صفحة الدفع الآمنة (Paymob) لإتمام الاشتراك. لن تُحفظ بيانات بطاقتك على خوادمنا.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Input label="الاسم الأول" error={errors.firstName?.message} {...register('firstName')} />
          <Input label="اسم العائلة" error={errors.lastName?.message} {...register('lastName')} />
        </div>
        <Input label="البريد الإلكتروني" type="email" error={errors.email?.message} {...register('email')} />
        <Input label="رقم الهاتف" type="tel" placeholder="01XXXXXXXXX" error={errors.phone?.message} {...register('phone')} />
      </form>
    </Modal>
  )
}

function BillingSettings() {
  const qc = useQueryClient()
  const { data: status, isLoading: statusLoading } = useSubscriptionStatus()
  const { data: portal } = useQuery<PortalResponse>({
    queryKey: ['billing', 'portal'],
    queryFn: async () => {
      const res = await api.get<PortalResponse>('/billing/portal')
      return res.data
    },
    // Skip the call (and its 404) when there's no subscription to look up.
    enabled: !!status,
  })
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)

  const { mutate: cancelSub, isPending: cancelling } = useMutation({
    mutationFn: () => api.post('/billing/cancel'),
    onSuccess: () => {
      toast.success('تم جدولة إلغاء الاشتراك في نهاية الفترة الحالية')
      qc.invalidateQueries({ queryKey: ['subscription'] })
      qc.invalidateQueries({ queryKey: ['billing'] })
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err)),
  })

  const { mutate: resumeSub, isPending: resuming } = useMutation({
    mutationFn: () => api.post('/billing/resume'),
    onSuccess: () => {
      toast.success('تم استئناف الاشتراك')
      qc.invalidateQueries({ queryKey: ['subscription'] })
      qc.invalidateQueries({ queryKey: ['billing'] })
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err)),
  })

  if (statusLoading) return <div className="h-48 bg-gray-750 rounded-md animate-pulse" />

  if (!status) {
    return (
      <Alert variant="warning">
        لا يوجد اشتراك مرتبط بحسابك حالياً. الرجاء التواصل مع الدعم لإعداد اشتراكك.
      </Alert>
    )
  }

  const isTrialing = status.status === 'TRIALING'
  const needsPayment = isTrialing || status.status === 'PAST_DUE' || status.status === 'SUSPENDED' || status.status === 'CANCELLED'
  const canCancel = status.status === 'ACTIVE' && !status.cancelAtPeriodEnd
  const canResume = status.cancelAtPeriodEnd && status.status !== 'CANCELLED'
  const periodEndLabel = status.cancelAtPeriodEnd ? 'سينتهي في' : 'يتجدد في'

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-100">الفوترة والاشتراك</h3>
        <p className="text-xs text-gray-500 mt-1">إدارة الاشتراك والمدفوعات</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-750 border border-gray-700 rounded-md p-4">
          <p className="text-xs text-gray-500 mb-2">الحالة</p>
          <Badge variant={STATUS_LABEL[status.status].variant} dot>
            {STATUS_LABEL[status.status].label}
          </Badge>
        </div>
        <div className="bg-gray-750 border border-gray-700 rounded-md p-4">
          <p className="text-xs text-gray-500 mb-2">الباقة</p>
          <p className="text-sm text-gray-100 font-medium">{status.planName}</p>
        </div>
        <div className="bg-gray-750 border border-gray-700 rounded-md p-4">
          <p className="text-xs text-gray-500 mb-2">دورة الفوترة</p>
          <p className="text-sm text-gray-100">{status.billingCycle === 'YEARLY' ? 'سنوية' : 'شهرية'}</p>
        </div>
        <div className="bg-gray-750 border border-gray-700 rounded-md p-4">
          <p className="text-xs text-gray-500 mb-2">
            {isTrialing ? 'تنتهي الفترة التجريبية' : periodEndLabel}
          </p>
          <p className="text-sm text-gray-100">
            {formatDate(isTrialing ? (status.trialEndsAt ?? status.currentPeriodEnd) : status.currentPeriodEnd)}
          </p>
        </div>
      </div>

      {status.cancelAtPeriodEnd && (
        <Alert variant="warning">
          اشتراكك مجدول للإلغاء بتاريخ {formatDate(status.currentPeriodEnd)}. يمكنك استئنافه قبل ذلك في أي وقت.
        </Alert>
      )}
      {status.status === 'PAST_DUE' && (
        <Alert variant="danger">
          تأخر دفع الاشتراك. جدّد الدفع لتجنب تعليق الحساب.
        </Alert>
      )}
      {status.status === 'SUSPENDED' && (
        <Alert variant="danger">
          تم تعليق الاشتراك بسبب فشل الدفع المتكرر. حدّث طريقة الدفع لاستئناف الخدمة.
        </Alert>
      )}

      <div className="flex flex-wrap gap-3">
        {needsPayment && (
          <Button onClick={() => setUpgradeOpen(true)}>
            <Sparkles className="w-4 h-4" />
            {isTrialing ? 'الاشتراك الآن' : 'تجديد الدفع'}
          </Button>
        )}
        {canResume && (
          <Button loading={resuming} onClick={() => resumeSub()}>
            <RefreshCw className="w-4 h-4" />
            استئناف الاشتراك
          </Button>
        )}
        {canCancel && (
          <Button
            variant="secondary"
            loading={cancelling}
            onClick={() => setCancelConfirm(true)}
          >
            <XCircle className="w-4 h-4" />
            إلغاء الاشتراك
          </Button>
        )}
        <ConfirmDialog
          open={cancelConfirm}
          title="إلغاء الاشتراك"
          message="سيستمر الاشتراك حتى نهاية الفترة الحالية ثم يُلغى. هل تريد المتابعة؟"
          confirmLabel="تأكيد الإلغاء"
          onConfirm={() => { setCancelConfirm(false); cancelSub() }}
          onCancel={() => setCancelConfirm(false)}
        />
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
          <Receipt className="w-4 h-4 text-gray-400" />
          سجل المدفوعات
        </h4>
        {portal && portal.history.length > 0 ? (
          <Table<PaymentAttempt>
            columns={[
              {
                key: 'attemptedAt',
                header: 'التاريخ',
                render: (p) => <span className="text-sm text-gray-300">{formatDateTime(p.attemptedAt)}</span>,
              },
              {
                key: 'amount',
                header: 'المبلغ',
                render: (p) => (
                  <span className="num num-strong text-sm">
                    {Number(p.amount).toFixed(2)} {p.currency}
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'الحالة',
                render: (p) => (
                  <Badge variant={ATTEMPT_STATUS_LABEL[p.status].variant} dot>
                    {ATTEMPT_STATUS_LABEL[p.status].label}
                  </Badge>
                ),
              },
              {
                key: 'providerTransactionId',
                header: 'رقم العملية',
                render: (p) => (
                  <span className="text-xs text-gray-500 font-mono">
                    {p.providerTransactionId ?? '—'}
                  </span>
                ),
              },
            ]}
            data={portal.history}
            keyExtractor={(p) => p.id}
          />
        ) : (
          <p className="text-sm text-gray-500">لا توجد عمليات دفع سابقة.</p>
        )}
      </div>

      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </div>
  )
}

// ─── Branches Settings ────────────────────────────────────────────────────────
interface Branch { id: string; name: string; isMain: boolean; isActive: boolean; address?: string; phone?: string }

const branchSchema = z.object({
  name: z.string().min(1, 'الاسم مطلوب'),
  address: z.string().optional(),
  phone: z.string().optional(),
})
type BranchFormData = z.infer<typeof branchSchema>

function BranchesSettings() {
  const qc = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Branch | null>(null)

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches-settings'],
    queryFn: async () => (await api.get<{ data: Branch[] }>('/branches')).data.data,
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<BranchFormData>({ resolver: zodResolver(branchSchema) })

  const openNew = () => { setEditing(null); reset({}); setDrawerOpen(true) }
  const openEdit = (b: Branch) => { setEditing(b); reset({ name: b.name, address: b.address ?? '', phone: b.phone ?? '' }); setDrawerOpen(true) }

  const { mutate: save, isPending } = useMutation({
    mutationFn: async (data: BranchFormData) => {
      if (editing) await api.patch(`/branches/${editing.id}`, data)
      else await api.post('/branches', data)
    },
    onSuccess: () => {
      toast.success(editing ? 'تم تحديث الفرع' : 'تم إضافة الفرع')
      qc.invalidateQueries({ queryKey: ['branches-settings'] })
      qc.invalidateQueries({ queryKey: ['branches'] })
      setDrawerOpen(false)
    },
    onError: () => toast.error('حدث خطأ'),
  })

  const { mutate: toggleActive } = useMutation({
    mutationFn: async (b: Branch) => api.patch(`/branches/${b.id}`, { isActive: !b.isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['branches-settings'] })
      qc.invalidateQueries({ queryKey: ['branches'] })
    },
    onError: () => toast.error('حدث خطأ'),
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-100">الفروع</h3>
        <Button onClick={openNew}><Plus className="w-4 h-4" />فرع جديد</Button>
      </div>

      <Table
        columns={[
          { key: 'name', header: 'الفرع', render: (b) => (
            <div>
              <span className="font-medium text-gray-100">{b.name}</span>
              {b.isMain && <Badge variant="info" className="mr-2">رئيسي</Badge>}
            </div>
          )},
          { key: 'address', header: 'العنوان', render: (b) => <span className="text-gray-400 text-sm">{b.address ?? '—'}</span> },
          { key: 'phone', header: 'الهاتف', className: 'font-mono text-gray-500 text-sm' },
          { key: 'isActive', header: 'الحالة', render: (b) => <Badge variant={b.isActive ? 'success' : 'gray'} dot>{b.isActive ? 'نشط' : 'معطّل'}</Badge> },
          { key: 'actions', header: '', render: (b) => (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => openEdit(b)} disabled={b.isMain}><Edit2 className="w-3 h-3" /></Button>
              <Button variant="ghost" size="sm" onClick={() => toggleActive(b)} disabled={b.isMain}>
                {b.isActive ? <ToggleRight className="w-4 h-4 text-success-500" /> : <ToggleLeft className="w-4 h-4 text-gray-500" />}
              </Button>
            </div>
          )},
        ]}
        data={branches} keyExtractor={(b) => b.id} emptyMessage="لا توجد فروع"
      />

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={editing ? 'تعديل الفرع' : 'فرع جديد'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>إلغاء</Button>
            <Button loading={isPending} onClick={handleSubmit((d) => save(d))}>حفظ</Button>
          </>
        }
      >
        <form className="flex flex-col gap-5">
          <Input label="اسم الفرع" error={errors.name?.message} {...register('name')} />
          <Input label="العنوان" {...register('address')} />
          <Input label="رقم الهاتف" type="tel" {...register('phone')} />
        </form>
      </Drawer>
    </div>
  )
}

// ─── Payment Methods Settings ─────────────────────────────────────────────────
interface PaymentMethod {
  id: string; name: string; type: string
  feeType: string; feePercentage: string | number; feeFixed: string | number
  feeBearer: string; isActive: boolean
}

const pmSchema = z.object({
  name: z.string().min(1, 'الاسم مطلوب'),
  type: z.enum(['cash', 'card', 'ewallet', 'bnpl', 'bank_transfer']),
  feeType: z.enum(['none', 'percentage', 'fixed', 'both']).default('none'),
  feePercentage: z.coerce.number().min(0).default(0),
  feeFixed: z.coerce.number().min(0).default(0),
  feeBearer: z.enum(['customer', 'merchant', 'negotiable']).default('merchant'),
})
type PmFormData = z.infer<typeof pmSchema>

const typeLabels: Record<string, string> = { cash: 'نقدي', card: 'بطاقة', ewallet: 'محفظة', bnpl: 'تقسيط', bank_transfer: 'تحويل بنكي' }
const feeTypeLabels: Record<string, string> = { none: 'بدون', percentage: 'نسبة مئوية', fixed: 'مبلغ ثابت', both: 'نسبة + ثابت' }

function PaymentMethodsSettings() {
  const qc = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<PaymentMethod | null>(null)

  const { data: methods = [] } = useQuery<PaymentMethod[]>({
    queryKey: ['payment-methods'],
    queryFn: async () => (await api.get<{ data: PaymentMethod[] }>('/payment-methods')).data.data,
  })

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<PmFormData>({ resolver: zodResolver(pmSchema) })
  const feeType = watch('feeType')

  const openNew = () => { setEditing(null); reset({ feeType: 'none', feeBearer: 'merchant', feePercentage: 0, feeFixed: 0 }); setDrawerOpen(true) }
  const openEdit = (pm: PaymentMethod) => {
    setEditing(pm)
    reset({ name: pm.name, type: pm.type as PmFormData['type'], feeType: pm.feeType as PmFormData['feeType'], feePercentage: Number(pm.feePercentage), feeFixed: Number(pm.feeFixed), feeBearer: pm.feeBearer as PmFormData['feeBearer'] })
    setDrawerOpen(true)
  }

  const { mutate: save, isPending } = useMutation({
    mutationFn: async (data: PmFormData) => {
      if (editing) await api.patch(`/payment-methods/${editing.id}`, data)
      else await api.post('/payment-methods', data)
    },
    onSuccess: () => {
      toast.success(editing ? 'تم التحديث' : 'تم الإضافة')
      qc.invalidateQueries({ queryKey: ['payment-methods'] })
      setDrawerOpen(false)
    },
    onError: () => toast.error('حدث خطأ'),
  })

  const { mutate: toggleActive } = useMutation({
    mutationFn: async (pm: PaymentMethod) => api.patch(`/payment-methods/${pm.id}`, { isActive: !pm.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payment-methods'] }),
    onError: () => toast.error('حدث خطأ'),
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-100">طرق الدفع</h3>
        <Button onClick={openNew}><Plus className="w-4 h-4" />إضافة طريقة</Button>
      </div>

      <Table
        columns={[
          { key: 'name', header: 'الاسم', render: (pm) => <span className="font-medium text-gray-100">{pm.name}</span> },
          { key: 'type', header: 'النوع', render: (pm) => <Badge variant="gray">{typeLabels[pm.type] ?? pm.type}</Badge> },
          { key: 'feeType', header: 'نوع الرسوم', render: (pm) => <span className="text-gray-400 text-sm">{feeTypeLabels[pm.feeType] ?? pm.feeType}</span> },
          { key: 'fee', header: 'الرسوم', render: (pm) => (
            <span className="font-mono text-sm text-gray-300">
              {pm.feeType === 'none' ? '—' : pm.feeType === 'percentage' ? `${Number(pm.feePercentage)}%` : pm.feeType === 'fixed' ? `${Number(pm.feeFixed)} ج` : `${Number(pm.feePercentage)}% + ${Number(pm.feeFixed)} ج`}
            </span>
          )},
          { key: 'isActive', header: 'الحالة', render: (pm) => <Badge variant={pm.isActive ? 'success' : 'gray'} dot>{pm.isActive ? 'نشط' : 'معطّل'}</Badge> },
          { key: 'actions', header: '', render: (pm) => (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => openEdit(pm)}><Edit2 className="w-3 h-3" /></Button>
              <Button variant="ghost" size="sm" onClick={() => toggleActive(pm)}>
                {pm.isActive ? <ToggleRight className="w-4 h-4 text-success-500" /> : <ToggleLeft className="w-4 h-4 text-gray-500" />}
              </Button>
            </div>
          )},
        ]}
        data={methods} keyExtractor={(pm) => pm.id} emptyMessage="لا توجد طرق دفع"
      />

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={editing ? 'تعديل طريقة الدفع' : 'طريقة دفع جديدة'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>إلغاء</Button>
            <Button loading={isPending} onClick={handleSubmit((d) => save(d))}>حفظ</Button>
          </>
        }
      >
        <form className="flex flex-col gap-5">
          <Input label="الاسم" error={errors.name?.message} {...register('name')} />
          <Select label="النوع" disabled={!!editing} {...register('type')}>
            <option value="cash">نقدي</option>
            <option value="card">بطاقة بنكية</option>
            <option value="ewallet">محفظة إلكترونية</option>
            <option value="bnpl">تقسيط (BNPL)</option>
            <option value="bank_transfer">تحويل بنكي</option>
          </Select>
          <Select label="نوع الرسوم" {...register('feeType')}>
            <option value="none">بدون رسوم</option>
            <option value="percentage">نسبة مئوية</option>
            <option value="fixed">مبلغ ثابت</option>
            <option value="both">نسبة + مبلغ ثابت</option>
          </Select>
          {(feeType === 'percentage' || feeType === 'both') && (
            <Input label="نسبة الرسوم (%)" type="number" step="0.01" {...register('feePercentage')} />
          )}
          {(feeType === 'fixed' || feeType === 'both') && (
            <Input label="مبلغ الرسوم الثابت (ج)" type="number" step="0.01" {...register('feeFixed')} />
          )}
          <Select label="من يتحمل الرسوم" {...register('feeBearer')}>
            <option value="merchant">المتجر</option>
            <option value="customer">العميل</option>
            <option value="negotiable">قابل للتفاوض</option>
          </Select>
        </form>
      </Drawer>
    </div>
  )
}

// ─── Users Settings ───────────────────────────────────────────────────────────
interface TenantUser { id: string; fullName: string; email: string; role: { id: string; name: string; slug: string }; isActive: boolean; lastLogin?: string }
interface Role {
  id: string
  name: string
  slug: string
  permissions?: Record<string, string[]>
  isSystem?: boolean
}

const userSchema = z.object({
  fullName: z.string().min(1, 'الاسم مطلوب'),
  email: z.string().email('بريد غير صالح'),
  password: passwordSchema,
  roleId: z.string().uuid('اختر دوراً'),
  branchId: z.string().uuid().optional().or(z.literal('')),
})
type UserFormData = z.infer<typeof userSchema>

// ─── Permission matrix (read-only) ──────────────────────────────────────────
// Arabic labels for entity/action keys used in role.permissions JSON.
// Unknown keys fall back to the raw string so new backend additions still render.
// Names are prefixed to avoid colliding with the audit-log `entityLabels` /
// `actionLabels` below, which use different keys and value shapes.
const permEntityLabels: Record<string, string> = {
  products: 'المنتجات',
  customers: 'العملاء',
  suppliers: 'الموردون',
  invoices: 'الفواتير',
  installments: 'الأقساط',
  expenses: 'المصروفات',
  purchase_orders: 'أوامر الشراء',
  stock: 'المخزون',
  reports: 'التقارير',
  settings: 'الإعدادات',
  users: 'المستخدمون',
  billing: 'الفوترة',
  eta: 'الضرائب',
}
const permActionLabels: Record<string, string> = {
  read: 'قراءة',
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
  approve: 'اعتماد',
  adjust: 'تعديل المخزون',
  transfer: 'تحويل',
  receive: 'استلام',
  manage: 'إدارة',
}

type PermissionsMap = Record<string, string[]>

function CreateRoleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reset = () => { setName(''); setSlug(''); setError(null) }

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      await api.post('/auth/roles', { name: name.trim(), slug: slug.trim(), permissions: {} })
    },
    onSuccess: () => {
      toast.success('تم إنشاء الدور')
      qc.invalidateQueries({ queryKey: ['roles'] })
      reset()
      onClose()
    },
    onError: (e: unknown) => setError(getApiErrorMessage(e, 'فشل إنشاء الدور')),
  })

  // Auto-derive a sensible slug suggestion from the name (transliteration is
  // out of scope — admins can edit before submitting).
  const handleNameChange = (v: string) => {
    setName(v)
    if (slug === '' || slug === suggestSlug(name)) {
      setSlug(suggestSlug(v))
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose() }}
      title="دور جديد"
      footer={
        <>
          <Button variant="secondary" onClick={() => { reset(); onClose() }} disabled={isPending}>إلغاء</Button>
          <Button loading={isPending} disabled={!name.trim() || !slug.trim()} onClick={() => { setError(null); mutate() }}>
            <Plus className="w-4 h-4" />إنشاء
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="اسم الدور"
          placeholder="مثال: مدير فرع"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          autoFocus
        />
        <Input
          label="المعرّف"
          placeholder="branch_manager"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
          hint="حروف لاتينية صغيرة وأرقام و _ - فقط"
        />
        {error && <Alert variant="danger">{error}</Alert>}
        <p className="text-xs text-gray-500">
          يُنشأ الدور بدون أي صلاحيات. استخدم زر "تعديل" بعد الإنشاء لتفعيل الصلاحيات.
        </p>
      </div>
    </Modal>
  )
}

function suggestSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '')
}

function RenameRoleModal({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Re-seed when the target role changes so re-opening on a different row
  // doesn't show the previous name.
  useEffect(() => { setName(role?.name ?? ''); setError(null) }, [role?.id])

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      if (!role) return
      await api.patch(`/auth/roles/${role.id}`, { name: name.trim() })
    },
    onSuccess: () => {
      toast.success('تم تحديث اسم الدور')
      qc.invalidateQueries({ queryKey: ['roles'] })
      onClose()
    },
    onError: (e: unknown) => setError(getApiErrorMessage(e, 'فشل التحديث')),
  })

  const unchanged = !!role && name.trim() === role.name

  return (
    <Modal
      open={!!role}
      onClose={onClose}
      title={`إعادة تسمية: ${role?.name ?? ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>إلغاء</Button>
          <Button loading={isPending} disabled={!name.trim() || unchanged} onClick={() => { setError(null); mutate() }}>
            <Check className="w-4 h-4" />حفظ
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="اسم الدور"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <p className="text-xs text-gray-500">
          المعرّف <span dir="ltr" className="font-mono text-gray-400">{role?.slug}</span> ثابت ولا يمكن تعديله.
        </p>
        {error && <Alert variant="danger">{error}</Alert>}
      </div>
    </Modal>
  )
}

function PermissionMatrix({ roles }: { roles: Role[] }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Role | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null)
  // Per-role draft of permissions while editing. Populated on edit-mode entry.
  const [drafts, setDrafts] = useState<Record<string, PermissionsMap>>({})

  const { mutate: deleteRole, isPending: isDeleting } = useMutation({
    mutationFn: async (id: string) => api.delete(`/auth/roles/${id}`),
    onSuccess: () => {
      toast.success('تم حذف الدور')
      qc.invalidateQueries({ queryKey: ['roles'] })
      setDeleteTarget(null)
    },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'فشل حذف الدور')),
  })

  // Build a union of all (entity → actions) seen across every role so the
  // matrix surfaces every permission the system knows about. In edit mode we
  // also include the drafts so newly-checked actions appear immediately.
  const allByEntity = new Map<string, Set<string>>()
  const sources: Array<{ permissions?: PermissionsMap }> = editing
    ? roles.map((r) => ({ permissions: drafts[r.id] ?? r.permissions }))
    : roles
  for (const src of sources) {
    for (const [entity, actions] of Object.entries(src.permissions ?? {})) {
      if (!allByEntity.has(entity)) allByEntity.set(entity, new Set())
      for (const a of actions) allByEntity.get(entity)!.add(a)
    }
  }
  const entities = Array.from(allByEntity.keys()).sort((a, b) =>
    (permEntityLabels[a] ?? a).localeCompare(permEntityLabels[b] ?? b, 'ar'),
  )

  const currentPerms = (role: Role): PermissionsMap =>
    (editing ? drafts[role.id] : undefined) ?? role.permissions ?? {}
  const has = (role: Role, entity: string, action: string) =>
    !!currentPerms(role)[entity]?.includes(action)

  const toggle = (roleId: string, entity: string, action: string) => {
    setDrafts((prev) => {
      const role = roles.find((r) => r.id === roleId)
      if (!role) return prev
      const current: PermissionsMap = JSON.parse(
        JSON.stringify(prev[roleId] ?? role.permissions ?? {}),
      )
      const list = current[entity] ?? []
      if (list.includes(action)) {
        current[entity] = list.filter((a) => a !== action)
        if (current[entity].length === 0) delete current[entity]
      } else {
        current[entity] = [...list, action]
      }
      return { ...prev, [roleId]: current }
    })
  }

  const isDirty = (role: Role): boolean => {
    const draft = drafts[role.id]
    if (!draft) return false
    return JSON.stringify(draft) !== JSON.stringify(role.permissions ?? {})
  }
  const dirtyRoles = roles.filter(isDirty)

  const enterEdit = () => { setDrafts({}); setEditing(true) }
  const cancelEdit = () => { setDrafts({}); setEditing(false) }

  const { mutate: save, isPending: isSaving } = useMutation({
    mutationFn: async () => {
      // Only PATCH roles whose draft actually differs — keeps audit log tidy.
      await Promise.all(
        dirtyRoles.map((r) => api.patch(`/auth/roles/${r.id}`, { permissions: drafts[r.id] })),
      )
    },
    onSuccess: () => {
      toast.success(`تم حفظ صلاحيات ${dirtyRoles.length} دور`)
      qc.invalidateQueries({ queryKey: ['roles'] })
      setDrafts({})
      setEditing(false)
    },
    onError: () => toast.error('فشل حفظ الصلاحيات'),
  })

  if (roles.length === 0) return null

  return (
    <div className="bg-white border border-gray-700 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-gray-100">مصفوفة الصلاحيات</h4>
        {editing ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {dirtyRoles.length > 0 ? `${dirtyRoles.length} دور معدّل` : 'لا تغييرات'}
            </span>
            <Button variant="secondary" size="sm" onClick={cancelEdit} disabled={isSaving}>إلغاء</Button>
            <Button size="sm" loading={isSaving} disabled={dirtyRoles.length === 0} onClick={() => save()}>
              <Check className="w-3 h-3" />حفظ
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="w-3 h-3" />دور جديد
            </Button>
            <Button variant="outline" size="sm" onClick={enterEdit}>
              <Edit2 className="w-3 h-3" />تعديل
            </Button>
          </div>
        )}
      </div>
      <CreateRoleModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-750">
            <tr>
              <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-gray-500 font-medium whitespace-nowrap">المورد</th>
              <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-gray-500 font-medium whitespace-nowrap">الإجراء</th>
              {roles.map((r) => (
                <th key={r.id} className="text-center px-3 py-2 text-xs text-gray-300 font-medium whitespace-nowrap">
                  <div className="flex items-center justify-center gap-1">
                    <span>{r.name}</span>
                    {!editing && !r.isSystem && (
                      <>
                        <button
                          type="button"
                          onClick={() => setRenameTarget(r)}
                          className="text-gray-500 hover:text-gray-200 transition-colors p-0.5"
                          aria-label={`إعادة تسمية ${r.name}`}
                          title="إعادة تسمية"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(r)}
                          className="text-gray-500 hover:text-danger-600 transition-colors p-0.5"
                          aria-label={`حذف ${r.name}`}
                          title="حذف"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                  {r.isSystem
                    ? <span className="block text-[10px] text-gray-500 font-normal">نظامي</span>
                    : editing && isDirty(r)
                      ? <span className="block text-[10px] text-warning-600 font-normal">معدّل</span>
                      : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entities.flatMap((entity) => {
              const actions = Array.from(allByEntity.get(entity)!).sort()
              return actions.map((action, idx) => (
                <tr key={`${entity}-${action}`} className="border-b border-gray-700/50 last:border-0">
                  {idx === 0 ? (
                    <td
                      rowSpan={actions.length}
                      className="px-4 py-2 text-gray-200 font-medium align-top bg-gray-750 whitespace-nowrap"
                    >
                      {permEntityLabels[entity] ?? entity}
                    </td>
                  ) : null}
                  <td className="px-4 py-2 text-gray-400 whitespace-nowrap">
                    {permActionLabels[action] ?? action}
                  </td>
                  {roles.map((r) => {
                    const granted = has(r, entity, action)
                    if (!editing || r.isSystem) {
                      return (
                        <td key={r.id} className="px-3 py-2 text-center">
                          {granted ? (
                            <span className="inline-flex w-5 h-5 rounded-full bg-success-500/15 text-success-600 items-center justify-center" aria-label="مسموح">
                              <Check className="w-3 h-3" />
                            </span>
                          ) : (
                            <span className="text-gray-700" aria-label="غير مسموح">—</span>
                          )}
                        </td>
                      )
                    }
                    return (
                      <td key={r.id} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={granted}
                          onChange={() => toggle(r.id, entity, action)}
                          aria-label={`${permEntityLabels[entity] ?? entity} · ${permActionLabels[action] ?? action} · ${r.name}`}
                          className="w-4 h-4 accent-brand-500 cursor-pointer"
                        />
                      </td>
                    )
                  })}
                </tr>
              ))
            })}
          </tbody>
        </table>
      </div>
      {editing && (
        <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-700">
          الأدوار النظامية للقراءة فقط. الصلاحيات المُضافة هنا تنعكس فوراً على المستخدمين بعد تسجيل دخولهم التالي.
        </p>
      )}
      <RenameRoleModal role={renameTarget} onClose={() => setRenameTarget(null)} />
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="حذف الدور"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>إلغاء</Button>
            <Button variant="danger" loading={isDeleting} onClick={() => deleteTarget && deleteRole(deleteTarget.id)}>
              <Trash2 className="w-4 h-4" />حذف
            </Button>
          </>
        }
      >
        <p className="text-gray-300">
          هل تريد حذف الدور <strong className="text-gray-100">{deleteTarget?.name}</strong>؟
        </p>
        <p className="text-xs text-gray-500 mt-2">
          سيُرفض الحذف إذا كان هناك مستخدمون مُعيّنون على هذا الدور.
        </p>
      </Modal>
    </div>
  )
}

function UsersSettings() {
  const qc = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [showPwd, setShowPwd] = useState(false)

  const { data: users = [], isLoading } = useQuery<TenantUser[]>({
    queryKey: ['tenant-users'],
    queryFn: async () => (await api.get<{ data: TenantUser[] }>('/auth/users')).data.data,
  })

  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ['roles'],
    queryFn: async () => (await api.get<{ data: Role[] }>('/auth/roles')).data.data,
  })

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get<{ data: { id: string; name: string }[] }>('/branches')).data.data,
    enabled: drawerOpen,
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<UserFormData>({ resolver: zodResolver(userSchema) })

  const { mutate: createUser, isPending } = useMutation({
    mutationFn: async (data: UserFormData) => api.post('/auth/users', { ...data, branchId: data.branchId || undefined }),
    onSuccess: () => {
      toast.success('تم إضافة المستخدم')
      qc.invalidateQueries({ queryKey: ['tenant-users'] })
      setDrawerOpen(false)
      reset()
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err)),
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-100">المستخدمون والأدوار</h3>
        <Button onClick={() => { reset({}); setDrawerOpen(true) }}><Plus className="w-4 h-4" />مستخدم جديد</Button>
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">جارٍ التحميل...</div>
      ) : (
        <Table
          columns={[
            { key: 'fullName', header: 'الاسم', render: (u) => <span className="font-medium text-gray-100">{u.fullName}</span> },
            { key: 'email', header: 'البريد الإلكتروني', className: 'text-gray-400 text-sm' },
            { key: 'role', header: 'الدور', render: (u) => <Badge variant="gray">{u.role?.name ?? u.role?.slug ?? '—'}</Badge> },
            { key: 'isActive', header: 'الحالة', render: (u) => <Badge variant={u.isActive ? 'success' : 'gray'} dot>{u.isActive ? 'نشط' : 'معطّل'}</Badge> },
            { key: 'lastLogin', header: 'آخر دخول', render: (u) => u.lastLogin
              ? <span className="text-gray-500 text-xs">{formatDate(u.lastLogin)}</span>
              : <span className="text-gray-500">—</span>
            },
          ]}
          data={users} keyExtractor={(u) => u.id} emptyMessage="لا يوجد مستخدمون"
        />
      )}

      <PermissionMatrix roles={roles} />


      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="مستخدم جديد"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>إلغاء</Button>
            <Button loading={isPending} onClick={handleSubmit((d) => createUser(d))}>حفظ</Button>
          </>
        }
      >
        <form className="flex flex-col gap-5">
          <Input label="الاسم الكامل" error={errors.fullName?.message} {...register('fullName')} />
          <Input label="البريد الإلكتروني" type="email" error={errors.email?.message} {...register('email')} />
          <Input
            label="كلمة المرور"
            type={showPwd ? 'text' : 'password'}
            autoComplete="new-password"
            error={errors.password?.message}
            endIcon={
              <button type="button" onClick={() => setShowPwd((v) => !v)} className="text-gray-400 hover:text-gray-200 transition-colors" aria-label={showPwd ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}>
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            }
            {...register('password')}
          />
          <Select label="الدور" error={errors.roleId?.message} {...register('roleId')}>
            <option value="">اختر الدور</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
          <Select label="الفرع (اختياري)" {...register('branchId')}>
            <option value="">كل الفروع</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </form>
      </Drawer>
    </div>
  )
}

// ─── Product Categories Settings ──────────────────────────────────────────────
interface ProductCategory { id: string; name: string; parentId?: string; isActive: boolean }

const catSchema = z.object({ name: z.string().min(1, 'الاسم مطلوب') })
type CatFormData = z.infer<typeof catSchema>

function ProductCategoriesSettings() {
  const qc = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<ProductCategory | null>(null)

  const { data: categories = [] } = useQuery<ProductCategory[]>({
    queryKey: ['product-categories-settings'],
    queryFn: async () => (await api.get<{ data: ProductCategory[] }>('/products/categories')).data.data,
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CatFormData>({ resolver: zodResolver(catSchema) })

  const openNew = () => { setEditing(null); reset({}); setDrawerOpen(true) }
  const openEdit = (c: ProductCategory) => { setEditing(c); reset({ name: c.name }); setDrawerOpen(true) }

  const { mutate: save, isPending } = useMutation({
    mutationFn: async (data: CatFormData) => {
      if (editing) await api.patch(`/products/categories/${editing.id}`, data)
      else await api.post('/products/categories', data)
    },
    onSuccess: () => {
      toast.success(editing ? 'تم التحديث' : 'تم الإضافة')
      qc.invalidateQueries({ queryKey: ['product-categories-settings'] })
      qc.invalidateQueries({ queryKey: ['product-categories'] })
      setDrawerOpen(false)
    },
    onError: () => toast.error('حدث خطأ'),
  })

  const { mutate: toggle } = useMutation({
    mutationFn: async (c: ProductCategory) => api.patch(`/products/categories/${c.id}`, { isActive: !c.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-categories-settings'] }),
    onError: () => toast.error('حدث خطأ'),
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-100">فئات المنتجات</h3>
        <Button onClick={openNew}><Plus className="w-4 h-4" />فئة جديدة</Button>
      </div>
      <Table
        columns={[
          { key: 'name', header: 'الفئة', render: (c) => <span className="font-medium text-gray-100">{c.name}</span> },
          { key: 'isActive', header: 'الحالة', render: (c) => <Badge variant={c.isActive ? 'success' : 'gray'} dot>{c.isActive ? 'نشطة' : 'معطّلة'}</Badge> },
          { key: 'actions', header: '', render: (c) => (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => openEdit(c)}><Edit2 className="w-3 h-3" /></Button>
              <Button variant="ghost" size="sm" onClick={() => toggle(c)}>
                {c.isActive ? <ToggleRight className="w-4 h-4 text-success-500" /> : <ToggleLeft className="w-4 h-4 text-gray-500" />}
              </Button>
            </div>
          )},
        ]}
        data={categories} keyExtractor={(c) => c.id} emptyMessage="لا توجد فئات"
      />
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={editing ? 'تعديل الفئة' : 'فئة جديدة'}
        footer={<><Button variant="secondary" onClick={() => setDrawerOpen(false)}>إلغاء</Button><Button loading={isPending} onClick={handleSubmit((d) => save(d))}>حفظ</Button></>}
      >
        <form className="flex flex-col gap-4">
          <Input label="اسم الفئة" error={errors.name?.message} {...register('name')} />
        </form>
      </Drawer>
    </div>
  )
}

// ─── Tax Rates Settings ───────────────────────────────────────────────────────
interface TaxRate { id: string; name: string; rate: string | number; isDefault: boolean; isActive: boolean }

const taxSchema = z.object({
  name: z.string().min(1, 'الاسم مطلوب'),
  rate: z.coerce.number().min(0, 'لا يمكن أن يكون سالباً').max(100, 'أقصى قيمة 100'),
  isDefault: z.boolean().default(false),
})
type TaxFormData = z.infer<typeof taxSchema>

function TaxRatesSettings() {
  const qc = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<TaxRate | null>(null)

  const { data: taxRates = [] } = useQuery<TaxRate[]>({
    queryKey: ['tax-rates-settings'],
    queryFn: async () => (await api.get<{ data: TaxRate[] }>('/products/tax-rates')).data.data,
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<TaxFormData>({ resolver: zodResolver(taxSchema) })

  const openNew = () => { setEditing(null); reset({ rate: 0, isDefault: false }); setDrawerOpen(true) }
  const openEdit = (t: TaxRate) => { setEditing(t); reset({ name: t.name, rate: Number(t.rate), isDefault: t.isDefault }); setDrawerOpen(true) }

  const { mutate: save, isPending } = useMutation({
    mutationFn: async (data: TaxFormData) => {
      if (editing) await api.patch(`/products/tax-rates/${editing.id}`, data)
      else await api.post('/products/tax-rates', data)
    },
    onSuccess: () => {
      toast.success(editing ? 'تم التحديث' : 'تم الإضافة')
      qc.invalidateQueries({ queryKey: ['tax-rates-settings'] })
      qc.invalidateQueries({ queryKey: ['tax-rates'] })
      setDrawerOpen(false)
    },
    onError: () => toast.error('حدث خطأ'),
  })

  const { mutate: toggle } = useMutation({
    mutationFn: async (t: TaxRate) => api.patch(`/products/tax-rates/${t.id}`, { isActive: !t.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tax-rates-settings'] }),
    onError: () => toast.error('حدث خطأ'),
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-100">معدلات الضريبة</h3>
        <Button onClick={openNew}><Plus className="w-4 h-4" />معدل جديد</Button>
      </div>
      <Table
        columns={[
          { key: 'name', header: 'الاسم', render: (t) => (
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-100">{t.name}</span>
              {t.isDefault && <Badge variant="info">افتراضي</Badge>}
            </div>
          )},
          { key: 'rate', header: 'النسبة', render: (t) => <span className="font-mono text-gray-300">{Number(t.rate)}%</span> },
          { key: 'isActive', header: 'الحالة', render: (t) => <Badge variant={t.isActive ? 'success' : 'gray'} dot>{t.isActive ? 'نشط' : 'معطّل'}</Badge> },
          { key: 'actions', header: '', render: (t) => (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => openEdit(t)}><Edit2 className="w-3 h-3" /></Button>
              <Button variant="ghost" size="sm" onClick={() => toggle(t)}>
                {t.isActive ? <ToggleRight className="w-4 h-4 text-success-500" /> : <ToggleLeft className="w-4 h-4 text-gray-500" />}
              </Button>
            </div>
          )},
        ]}
        data={taxRates} keyExtractor={(t) => t.id} emptyMessage="لا توجد معدلات ضريبة"
      />
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={editing ? 'تعديل معدل الضريبة' : 'معدل ضريبة جديد'}
        footer={<><Button variant="secondary" onClick={() => setDrawerOpen(false)}>إلغاء</Button><Button loading={isPending} onClick={handleSubmit((d) => save(d))}>حفظ</Button></>}
      >
        <form className="flex flex-col gap-4">
          <Input label="الاسم (مثال: ضريبة القيمة المضافة)" error={errors.name?.message} {...register('name')} />
          <Input label="النسبة %" type="number" step="0.01" error={errors.rate?.message} {...register('rate')} />
          <label className="flex items-center gap-3 text-sm text-gray-300 cursor-pointer">
            <input type="checkbox" {...register('isDefault')} className="w-4 h-4 accent-brand-500" />
            تعيين كمعدل افتراضي
          </label>
        </form>
      </Drawer>
    </div>
  )
}

// ─── Audit Log Settings ───────────────────────────────────────────────────────

interface AuditLogEntry {
  id: string
  entity: string
  entityId?: string
  action: string
  before?: unknown
  after?: unknown
  ip?: string
  createdAt: string
  actor?: { id: string; fullName: string }
}
const entityLabels: Record<string, string> = {
  invoice: 'فاتورة', product: 'منتج', user: 'مستخدم', customer: 'عميل',
  supplier: 'مورد', expense: 'مصروف', stock: 'مخزون', installment: 'قسط',
  purchase_order: 'طلب شراء', branch: 'فرع', role: 'دور',
  stock_transfer: 'تحويل مخزون', expense_budget: 'ميزانية',
  expense_template: 'قالب مصروف',
}

const actionLabels: Record<string, { label: string; color: string }> = {
  create: { label: 'إنشاء', color: 'text-success-600' },
  update: { label: 'تعديل', color: 'text-brand-400' },
  delete: { label: 'حذف', color: 'text-danger-600' },
  approve: { label: 'موافقة', color: 'text-success-600' },
  reject: { label: 'رفض', color: 'text-warning-600' },
  login: { label: 'دخول', color: 'text-gray-400' },
  rename: { label: 'إعادة تسمية', color: 'text-brand-400' },
  permissions_update: { label: 'تحديث صلاحيات', color: 'text-brand-400' },
  credit_add: { label: 'إضافة رصيد', color: 'text-success-600' },
  credit_deduct: { label: 'خصم رصيد', color: 'text-warning-600' },
  credit_used: { label: 'استخدام رصيد', color: 'text-danger-600' },
  loyalty_earned: { label: 'كسب نقاط ولاء', color: 'text-info-600' },
  loyalty_reversed: { label: 'عكس نقاط ولاء', color: 'text-warning-600' },
  cancel: { label: 'إلغاء', color: 'text-danger-600' },
  receive: { label: 'استلام', color: 'text-success-600' },
  partial_receive: { label: 'استلام جزئي', color: 'text-warning-600' },
}

function AuditLogSettings() {
  const [searchParams, setSearchParams] = useSearchParams()
  const entity = searchParams.get('entity') ?? ''
  const action = searchParams.get('action') ?? ''
  const actorId = searchParams.get('actorId') ?? ''
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<AuditLogEntry | null>(null)

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value); else next.delete(key)
    setSearchParams(next, { replace: true })
    setPage(1)
  }
  const setRange = (v: { from: string; to: string }) => {
    const next = new URLSearchParams(searchParams)
    if (v.from) next.set('from', v.from); else next.delete('from')
    if (v.to) next.set('to', v.to); else next.delete('to')
    setSearchParams(next, { replace: true })
    setPage(1)
  }
  const hasFilters = entity || action || actorId || from || to
  const clearFilters = () => { setSearchParams({}, { replace: true }); setPage(1) }

  const { data, isLoading } = useQuery<{ data: AuditLogEntry[]; meta: PaginationMeta }>({
    queryKey: ['audit-logs', page, entity, action, actorId, from, to],
    queryFn: async () => {
      const res = await api.get<{ data: AuditLogEntry[]; meta: PaginationMeta }>('/auth/audit-logs', {
        params: {
          page, limit: 20,
          ...(entity ? { entity } : {}),
          ...(action ? { action } : {}),
          ...(actorId ? { actorId } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        },
      })
      return res.data
    },
  })

  // Actor list — drives the dropdown. Single fetch, cached forever (user list
  // rarely churns and refreshes on settings revisit anyway).
  const { data: users = [] } = useQuery<TenantUser[]>({
    queryKey: ['tenant-users'],
    queryFn: async () => (await api.get<{ data: TenantUser[] }>('/auth/users')).data.data,
  })

  const logs = data?.data ?? []
  const meta = data?.meta

  // Soft cap so an unfiltered export of a long-lived tenant doesn't try to pull
  // hundreds of thousands of rows. 2000 = 20 pages × 100/page.
  const EXPORT_CAP = 2000
  const PAGE_SIZE = 100
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      const filters = {
        ...(entity ? { entity } : {}),
        ...(action ? { action } : {}),
        ...(actorId ? { actorId } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }
      const collected: AuditLogEntry[] = []
      let p = 1
      let totalPages = 1
      while (p <= totalPages && collected.length < EXPORT_CAP) {
        const res = await api.get<{ data: AuditLogEntry[]; meta: PaginationMeta }>('/auth/audit-logs', {
          params: { page: p, limit: PAGE_SIZE, ...filters },
        })
        collected.push(...res.data.data)
        totalPages = res.data.meta.pages
        p += 1
      }
      const truncated = collected.length >= EXPORT_CAP && totalPages > p - 1

      await exportRowsToExcel(
        collected,
        [
          { header: 'التاريخ', accessor: (l) => formatDateTime(l.createdAt), width: 22 },
          { header: 'الإجراء', accessor: (l) => actionLabels[l.action]?.label ?? l.action, width: 18 },
          { header: 'الكيان', accessor: (l) => entityLabels[l.entity] ?? l.entity, width: 14 },
          { header: 'بواسطة', accessor: (l) => l.actor?.fullName ?? '', width: 22 },
          { header: 'معرّف الكيان', accessor: (l) => l.entityId ?? '', width: 36 },
          { header: 'IP', accessor: (l) => l.ip ?? '', width: 16 },
          { header: 'قبل', accessor: (l) => l.before !== undefined ? JSON.stringify(l.before) : '', width: 40 },
          { header: 'بعد', accessor: (l) => l.after !== undefined ? JSON.stringify(l.after) : '', width: 40 },
        ],
        `audit-logs-${new Date().toISOString().slice(0, 10)}.xlsx`,
        'سجل التدقيق',
      )

      if (truncated) {
        toast(`تم تصدير ${EXPORT_CAP} سجل (الحد الأقصى). استخدم الفلاتر لتضييق النتائج.`, { icon: '⚠️' })
      } else {
        toast.success(`تم تصدير ${collected.length} سجل`)
      }
    } catch {
      toast.error('فشل التصدير')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
          <Shield className="w-5 h-5 text-brand-400" />سجل التدقيق
        </h3>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
              مسح الفلاتر ×
            </button>
          )}
          <Button variant="outline" size="sm" loading={exporting} onClick={handleExport} disabled={logs.length === 0}>
            <Download className="w-3 h-3" />تصدير
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={entity}
          onChange={(e) => setParam('entity', e.target.value)}
        >
          <option value="">كل الكيانات</option>
          {Object.entries(entityLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select
          value={action}
          onChange={(e) => setParam('action', e.target.value)}
        >
          <option value="">كل الإجراءات</option>
          {Object.entries(actionLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Select
          value={actorId}
          onChange={(e) => setParam('actorId', e.target.value)}
        >
          <option value="">كل المستخدمين</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
        </Select>
        <DateRangePicker
          value={{ from, to }}
          onChange={(v) => setRange(v)}
        />
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-12 bg-gray-700 rounded animate-pulse" />)}</div>
      ) : logs.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">لا توجد سجلات</p>
      ) : (
        <div className="flex flex-col divide-y divide-gray-700">
          {logs.map((log) => {
            const act = actionLabels[log.action] ?? { label: log.action, color: 'text-gray-400' }
            const hasDiff = log.before !== undefined || log.after !== undefined
            return (
              <button
                key={log.id}
                onClick={() => setDetail(log)}
                className="py-3 flex items-start justify-between gap-4 text-right hover:bg-gray-700/30 -mx-2 px-2 rounded transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn('text-sm font-medium', act.color)}>{act.label}</span>
                    <span className="text-xs text-gray-400">{entityLabels[log.entity] ?? log.entity}</span>
                    {log.actor && <span className="text-xs text-gray-500">بواسطة {log.actor.fullName}</span>}
                    {log.ip && <span className="text-xs text-gray-500 font-mono">{log.ip}</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{formatDateTime(log.createdAt)}</p>
                </div>
                {hasDiff && <span className="text-[10px] text-gray-500 self-center">تفاصيل ←</span>}
              </button>
            )
          })}
        </div>
      )}
      {meta && meta.pages > 1 && (
        <Pagination page={meta.page} pages={meta.pages} total={meta.total} limit={meta.limit} onPage={setPage} />
      )}

      <Drawer
        open={!!detail}
        onClose={() => setDetail(null)}
        title="تفاصيل السجل"
        width="w-[560px]"
      >
        {detail && (
          <div className="flex flex-col gap-5 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-gray-500 text-xs block mb-1">الإجراء</span>
                <span className={cn('font-medium', actionLabels[detail.action]?.color ?? 'text-gray-300')}>
                  {actionLabels[detail.action]?.label ?? detail.action}
                </span>
              </div>
              <div><span className="text-gray-500 text-xs block mb-1">الكيان</span>
                <span className="text-gray-200">{entityLabels[detail.entity] ?? detail.entity}</span>
              </div>
              <div><span className="text-gray-500 text-xs block mb-1">بواسطة</span>
                <span className="text-gray-200">{detail.actor?.fullName ?? '—'}</span>
              </div>
              <div><span className="text-gray-500 text-xs block mb-1">التاريخ</span>
                <span className="text-gray-200 font-mono text-xs">{formatDateTime(detail.createdAt)}</span>
              </div>
              {detail.entityId && (
                <div className="col-span-2">
                  <span className="text-gray-500 text-xs block mb-1">معرّف الكيان</span>
                  <span className="text-gray-300 font-mono text-xs break-all" dir="ltr">{detail.entityId}</span>
                </div>
              )}
              {detail.ip && (
                <div className="col-span-2">
                  <span className="text-gray-500 text-xs block mb-1">عنوان IP</span>
                  <span className="text-gray-300 font-mono text-xs" dir="ltr">{detail.ip}</span>
                </div>
              )}
            </div>

            {detail.before !== undefined && (
              <div>
                <p className="text-xs text-gray-500 mb-1.5">قبل</p>
                <pre dir="ltr" className="bg-danger-50 border border-danger-500/20 rounded-md p-3 text-xs text-danger-700 overflow-auto max-h-64 font-mono whitespace-pre-wrap break-words">
                  {JSON.stringify(detail.before, null, 2)}
                </pre>
              </div>
            )}
            {detail.after !== undefined && (
              <div>
                <p className="text-xs text-gray-500 mb-1.5">بعد</p>
                <pre dir="ltr" className="bg-success-50 border border-success-500/20 rounded-md p-3 text-xs text-success-700 overflow-auto max-h-64 font-mono whitespace-pre-wrap break-words">
                  {JSON.stringify(detail.after, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  )
}

// ─── Change Password Settings ─────────────────────────────────────────────────

const pwSchema = z.object({
  currentPassword: z.string().min(1, 'كلمة المرور الحالية مطلوبة'),
  newPassword: passwordSchema,
  confirmPassword: z.string().min(1, 'تأكيد كلمة المرور مطلوب'),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'كلمتا المرور غير متطابقتان',
  path: ['confirmPassword'],
})
type PwFormData = z.infer<typeof pwSchema>

function ChangePasswordSettings() {
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const { register, handleSubmit, reset, formState: { errors } } = useForm<PwFormData>({ resolver: zodResolver(pwSchema) })

  const { mutate: changePassword, isPending } = useMutation({
    mutationFn: async (data: PwFormData) => {
      await api.patch('/auth/me/password', { currentPassword: data.currentPassword, newPassword: data.newPassword })
    },
    onSuccess: () => {
      toast.success('تم تغيير كلمة المرور بنجاح')
      reset()
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err)),
  })

  return (
    <div className="flex flex-col gap-6 max-w-md">
      <h3 className="text-lg font-semibold text-gray-100">تغيير كلمة المرور</h3>
      <form className="flex flex-col gap-5" onSubmit={handleSubmit((d) => changePassword(d))}>
        <Input
          label="كلمة المرور الحالية"
          type={showCurrent ? 'text' : 'password'}
          autoComplete="current-password"
          error={errors.currentPassword?.message}
          endIcon={
            <button type="button" onClick={() => setShowCurrent((v) => !v)} className="text-gray-400 hover:text-gray-200 transition-colors" aria-label={showCurrent ? 'إخفاء' : 'إظهار'}>
              {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          }
          {...register('currentPassword')}
        />
        <Input
          label="كلمة المرور الجديدة"
          type={showNew ? 'text' : 'password'}
          autoComplete="new-password"
          error={errors.newPassword?.message}
          endIcon={
            <button type="button" onClick={() => setShowNew((v) => !v)} className="text-gray-400 hover:text-gray-200 transition-colors" aria-label={showNew ? 'إخفاء' : 'إظهار'}>
              {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          }
          {...register('newPassword')}
        />
        <Input
          label="تأكيد كلمة المرور الجديدة"
          type={showConfirm ? 'text' : 'password'}
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          endIcon={
            <button type="button" onClick={() => setShowConfirm((v) => !v)} className="text-gray-400 hover:text-gray-200 transition-colors" aria-label={showConfirm ? 'إخفاء' : 'إظهار'}>
              {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          }
          {...register('confirmPassword')}
        />
        <Button loading={isPending} type="submit" className="w-fit">تغيير كلمة المرور</Button>
      </form>
    </div>
  )
}

// ─── Expense Categories Settings ──────────────────────────────────────────────
interface ExpenseCategory { id: string; name: string; description?: string; isActive: boolean }

const expCatSchema = z.object({
  name: z.string().min(1, 'الاسم مطلوب'),
  description: z.string().optional(),
})
type ExpCatFormData = z.infer<typeof expCatSchema>

function ExpenseCategoriesSettings() {
  const qc = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<ExpenseCategory | null>(null)

  const { data: categories = [] } = useQuery<ExpenseCategory[]>({
    queryKey: ['expense-categories-settings'],
    queryFn: async () => (await api.get<{ data: ExpenseCategory[] }>('/expenses/categories')).data.data,
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ExpCatFormData>({ resolver: zodResolver(expCatSchema) })

  const openNew = () => { setEditing(null); reset({}); setDrawerOpen(true) }
  const openEdit = (c: ExpenseCategory) => { setEditing(c); reset({ name: c.name, description: c.description ?? '' }); setDrawerOpen(true) }

  const { mutate: save, isPending } = useMutation({
    mutationFn: async (data: ExpCatFormData) => {
      if (editing) await api.patch(`/expenses/categories/${editing.id}`, data)
      else await api.post('/expenses/categories', data)
    },
    onSuccess: () => {
      toast.success(editing ? 'تم التحديث' : 'تم الإضافة')
      qc.invalidateQueries({ queryKey: ['expense-categories-settings'] })
      qc.invalidateQueries({ queryKey: ['expense-categories'] })
      setDrawerOpen(false)
    },
    onError: () => toast.error('حدث خطأ'),
  })

  const { mutate: toggle } = useMutation({
    mutationFn: async (c: ExpenseCategory) => api.patch(`/expenses/categories/${c.id}`, { isActive: !c.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense-categories-settings'] }),
    onError: () => toast.error('حدث خطأ'),
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-100">فئات المصروفات</h3>
        <Button onClick={openNew}><Plus className="w-4 h-4" />فئة جديدة</Button>
      </div>
      <Table
        columns={[
          { key: 'name', header: 'الفئة', render: (c) => <span className="font-medium text-gray-100">{c.name}</span> },
          { key: 'description', header: 'الوصف', render: (c) => <span className="text-gray-500 text-sm">{c.description ?? '—'}</span> },
          { key: 'isActive', header: 'الحالة', render: (c) => <Badge variant={c.isActive ? 'success' : 'gray'} dot>{c.isActive ? 'نشطة' : 'معطّلة'}</Badge> },
          { key: 'actions', header: '', render: (c) => (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => openEdit(c)}><Edit2 className="w-3 h-3" /></Button>
              <Button variant="ghost" size="sm" onClick={() => toggle(c)}>
                {c.isActive ? <ToggleRight className="w-4 h-4 text-success-500" /> : <ToggleLeft className="w-4 h-4 text-gray-500" />}
              </Button>
            </div>
          )},
        ]}
        data={categories} keyExtractor={(c) => c.id} emptyMessage="لا توجد فئات"
      />
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={editing ? 'تعديل الفئة' : 'فئة مصروف جديدة'}
        footer={<><Button variant="secondary" onClick={() => setDrawerOpen(false)}>إلغاء</Button><Button loading={isPending} onClick={handleSubmit((d) => save(d))}>حفظ</Button></>}
      >
        <form className="flex flex-col gap-4">
          <Input label="اسم الفئة" error={errors.name?.message} {...register('name')} />
          <div>
            <label className="text-sm text-gray-400 block mb-1">الوصف (اختياري)</label>
            <textarea {...register('description')} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)] resize-none" />
          </div>
        </form>
      </Drawer>
    </div>
  )
}

// ─── Coupons Settings ─────────────────────────────────────────────────────────

interface Coupon {
  id: string
  code: string
  discountType: 'percentage' | 'fixed'
  discountValue: string | number
  minAmount?: string | number | null
  maxUses?: number | null
  usedCount: number
  expiresAt?: string | null
  isActive: boolean
}

const couponSchema = z.object({
  code: z.string().min(1, 'الكود مطلوب').toUpperCase(),
  discountType: z.enum(['percentage', 'fixed']),
  discountValue: z.coerce.number().positive('يجب أن تكون القيمة أكبر من صفر'),
  minAmount: z.coerce.number().min(0).optional().or(z.literal('')),
  maxUses: z.coerce.number().int().positive().optional().or(z.literal('')),
  expiresAt: z.string().optional(),
  isActive: z.boolean().default(true),
})
type CouponFormData = z.infer<typeof couponSchema>

function CouponsSettings() {
  const qc = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Coupon | null>(null)

  const { data: coupons = [], isLoading } = useQuery<Coupon[]>({
    queryKey: ['coupons'],
    queryFn: async () => (await api.get<{ data: Coupon[] }>('/coupons')).data.data,
  })

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<CouponFormData>({ resolver: zodResolver(couponSchema) })
  const discountType = watch('discountType')

  const openNew = () => { setEditing(null); reset({ discountType: 'percentage', isActive: true }); setDrawerOpen(true) }
  const openEdit = (c: Coupon) => {
    setEditing(c)
    reset({
      code: c.code,
      discountType: c.discountType,
      discountValue: Number(c.discountValue),
      minAmount: c.minAmount ? Number(c.minAmount) : '',
      maxUses: c.maxUses ?? '',
      expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString().slice(0, 16) : '',
      isActive: c.isActive,
    })
    setDrawerOpen(true)
  }

  const { mutate: save, isPending } = useMutation({
    mutationFn: async (data: CouponFormData) => {
      const body = {
        ...data,
        code: data.code.toUpperCase(),
        minAmount: data.minAmount === '' ? undefined : data.minAmount,
        maxUses: data.maxUses === '' ? undefined : data.maxUses,
        expiresAt: data.expiresAt ? new Date(data.expiresAt).toISOString() : undefined,
      }
      if (editing) await api.patch(`/coupons/${editing.id}`, body)
      else await api.post('/coupons', body)
    },
    onSuccess: () => {
      toast.success(editing ? 'تم التحديث' : 'تم إضافة الكوبون')
      qc.invalidateQueries({ queryKey: ['coupons'] })
      setDrawerOpen(false)
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err)),
  })

  const { mutate: toggle } = useMutation({
    mutationFn: async (c: Coupon) => api.patch(`/coupons/${c.id}`, { isActive: !c.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coupons'] }),
    onError: () => toast.error('حدث خطأ'),
  })

  const { mutate: deleteCoupon } = useMutation({
    mutationFn: async (id: string) => api.delete(`/coupons/${id}`),
    onSuccess: () => { toast.success('تم حذف الكوبون'); qc.invalidateQueries({ queryKey: ['coupons'] }) },
    onError: () => toast.error('لا يمكن حذف كوبون مستخدم'),
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
          <Tag className="w-5 h-5 text-brand-400" />كوبونات الخصم
        </h3>
        <Button onClick={openNew}><Plus className="w-4 h-4" />كوبون جديد</Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 bg-gray-700 rounded animate-pulse" />)}</div>
      ) : (
        <Table
          columns={[
            { key: 'code', header: 'الكود', render: (c) => <span className="font-mono font-bold text-brand-400">{c.code}</span> },
            { key: 'discount', header: 'الخصم', render: (c) => (
              <span className="font-numeric num num-strong">
                {c.discountType === 'percentage' ? `${Number(c.discountValue)}%` : `${Number(c.discountValue)} ج`}
              </span>
            )},
            { key: 'uses', header: 'الاستخدامات', render: (c) => (
              <span className="text-sm font-numeric num num-muted">
                {c.usedCount}{c.maxUses != null ? ` / ${c.maxUses}` : ''}
              </span>
            )},
            { key: 'expiresAt', header: 'الانتهاء', render: (c) => c.expiresAt
              ? <span className={cn('text-xs font-numeric num', new Date(c.expiresAt) < new Date() ? 'text-danger-600' : 'text-gray-400')}>{formatDate(c.expiresAt)}</span>
              : <span className="text-gray-500">—</span>
            },
            { key: 'isActive', header: 'الحالة', render: (c) => <Badge variant={c.isActive ? 'success' : 'gray'} dot>{c.isActive ? 'نشط' : 'معطّل'}</Badge> },
            { key: 'actions', header: '', render: (c) => (
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => openEdit(c)}><Edit2 className="w-3 h-3" /></Button>
                <Button variant="ghost" size="sm" onClick={() => toggle(c)}>
                  {c.isActive ? <ToggleRight className="w-4 h-4 text-success-500" /> : <ToggleLeft className="w-4 h-4 text-gray-500" />}
                </Button>
                <Button variant="ghost" size="sm" className="text-danger-500" onClick={() => deleteCoupon(c.id)}><Edit2 className="w-3 h-3" /></Button>
              </div>
            )},
          ]}
          data={coupons} keyExtractor={(c) => c.id} emptyMessage="لا توجد كوبونات"
        />
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={editing ? 'تعديل الكوبون' : 'كوبون جديد'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>إلغاء</Button>
            <Button loading={isPending} onClick={handleSubmit((d) => save(d))}>حفظ</Button>
          </>
        }
      >
        <form className="flex flex-col gap-5">
          <Input label="كود الخصم" placeholder="مثال: SUMMER20" error={errors.code?.message} {...register('code')} disabled={!!editing} />
          <Select label="نوع الخصم" {...register('discountType')}>
            <option value="percentage">نسبة مئوية (%)</option>
            <option value="fixed">مبلغ ثابت (ج)</option>
          </Select>
          <Input
            label={discountType === 'percentage' ? 'قيمة الخصم (%)' : 'قيمة الخصم (ج)'}
            type="number" step="0.01"
            error={errors.discountValue?.message}
            {...register('discountValue')}
          />
          <Input label="الحد الأدنى للطلب (ج) — اختياري" type="number" step="0.01" {...register('minAmount')} />
          <Input label="الحد الأقصى للاستخدام — اختياري" type="number" {...register('maxUses')} />
          <div>
            <label className="text-sm text-gray-400 block mb-1">تاريخ الانتهاء — اختياري</label>
            <input type="datetime-local" {...register('expiresAt')} className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)]" />
          </div>
          <label className="flex items-center gap-3 text-sm text-gray-300 cursor-pointer">
            <input type="checkbox" {...register('isActive')} className="w-4 h-4 accent-brand-500" />
            كوبون نشط
          </label>
        </form>
      </Drawer>
    </div>
  )
}

// ─── ETA Settings ─────────────────────────────────────────────────────────────

interface EtaInvoice {
  id: string
  invoiceNumber: string
  etaStatus: string
  etaError?: string
  totalAmount: number
  createdAt: string
  customer?: { fullName: string }
}

const etaStatusMap: Record<string, { label: string; variant: 'warning' | 'danger' | 'success' | 'gray' }> = {
  pending: { label: 'معلق', variant: 'warning' },
  failed: { label: 'فشل', variant: 'danger' },
  accepted: { label: 'مقبول', variant: 'success' },
  not_required: { label: 'غير مطلوب', variant: 'gray' },
  pending_setup: { label: 'بانتظار إعداد ETA', variant: 'warning' },
}

interface TenantSettings {
  id: string
  etaEnabled: boolean
  etaEnvironment?: string | null
  etaTaxpayerId?: string | null
  etaActivityCode?: string | null
  etaBranchCode?: string | null
  // Issuer registration — public business data, editable from this screen.
  // Must match the merchant's profile on invoicing.eta.gov.eg, otherwise ETA
  // rejects submissions.
  etaIssuerName?: string | null
  etaAddressGovernate?: string | null
  etaAddressRegionCity?: string | null
  etaAddressStreet?: string | null
  etaAddressBuilding?: string | null
  // Encrypted secrets are never sent to the client — the API returns these
  // booleans instead so the wizard can show a "configured ✓" state.
  etaClientIdSet?: boolean
  etaClientSecretSet?: boolean
  etaSigningCertSet?: boolean
}

// Egyptian governates — the ETA spec accepts these Arabic strings as-is in
// the `address.governate` field. Source: ETA codeset table 4.4.
const EG_GOVERNATES = [
  'القاهرة', 'الجيزة', 'الإسكندرية', 'الدقهلية', 'البحر الأحمر',
  'البحيرة', 'الفيوم', 'الغربية', 'الإسماعيلية', 'المنوفية',
  'المنيا', 'القليوبية', 'الوادي الجديد', 'السويس', 'أسوان',
  'أسيوط', 'بني سويف', 'بورسعيد', 'دمياط', 'الشرقية',
  'جنوب سيناء', 'كفر الشيخ', 'مطروح', 'الأقصر', 'قنا',
  'شمال سيناء', 'سوهاج',
] as const

// ─── ETA self-service setup wizard ────────────────────────────────────────────
// Three steps: (1) business/issuer data, (2) ETA credentials, (3) test + finish.
// Public fields go through PATCH /settings; the encrypted secrets (client id /
// secret / signing cert) go through PUT /settings/eta/credentials and are
// write-only — the API only tells us whether each is *set*, never its value.
function EtaSetupWizard({ settings }: { settings?: TenantSettings }) {
  const qc = useQueryClient()
  const [step, setStep] = useState(1)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  type BusinessForm = {
    etaIssuerName: string
    etaAddressGovernate: string
    etaAddressRegionCity: string
    etaAddressStreet: string
    etaAddressBuilding: string
  }
  type CredsForm = {
    etaTaxpayerId: string
    etaActivityCode: string
    etaBranchCode: string
    etaEnvironment: string
    etaClientId: string
    etaClientSecret: string
    etaSigningCert: string
  }
  const [business, setBusiness] = useState<BusinessForm>({
    etaIssuerName: '', etaAddressGovernate: '', etaAddressRegionCity: '',
    etaAddressStreet: '', etaAddressBuilding: '',
  })
  const [creds, setCreds] = useState<CredsForm>({
    etaTaxpayerId: '', etaActivityCode: '', etaBranchCode: '0',
    etaEnvironment: 'preprod', etaClientId: '', etaClientSecret: '', etaSigningCert: '',
  })

  // Hydrate from server on load. Secrets stay blank (write-only) — their saved
  // state is shown via the *Set booleans instead.
  useEffect(() => {
    if (!settings) return
    setBusiness({
      etaIssuerName: settings.etaIssuerName ?? '',
      etaAddressGovernate: settings.etaAddressGovernate ?? '',
      etaAddressRegionCity: settings.etaAddressRegionCity ?? '',
      etaAddressStreet: settings.etaAddressStreet ?? '',
      etaAddressBuilding: settings.etaAddressBuilding ?? '',
    })
    setCreds((c) => ({
      ...c,
      etaTaxpayerId: settings.etaTaxpayerId ?? '',
      etaActivityCode: settings.etaActivityCode ?? '',
      etaBranchCode: settings.etaBranchCode ?? '0',
      etaEnvironment: settings.etaEnvironment ?? 'preprod',
    }))
  }, [settings])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tenant-settings-eta'] })
    qc.invalidateQueries({ queryKey: ['tenant-settings'] })
  }

  const { mutate: saveBusiness, isPending: savingBusiness } = useMutation({
    mutationFn: async (data: BusinessForm) => api.patch('/settings', data),
    onSuccess: () => { toast.success('تم حفظ بيانات المحل'); refresh(); setStep(2) },
    onError: () => toast.error('تعذّر حفظ البيانات'),
  })

  const { mutate: saveCreds, isPending: savingCreds } = useMutation({
    mutationFn: async (data: CredsForm) => {
      // Public fields first (taxpayer id / activity / branch / environment).
      await api.patch('/settings', {
        etaTaxpayerId: data.etaTaxpayerId,
        etaActivityCode: data.etaActivityCode,
        etaBranchCode: data.etaBranchCode,
        etaEnvironment: data.etaEnvironment,
      })
      // Encrypted secrets — only send the ones the user actually typed so we
      // don't overwrite a saved value with a blank.
      const secretPayload: Record<string, string> = {}
      if (data.etaClientId.trim()) secretPayload.etaClientId = data.etaClientId.trim()
      if (data.etaClientSecret.trim()) secretPayload.etaClientSecret = data.etaClientSecret.trim()
      if (data.etaSigningCert.trim()) secretPayload.etaSigningCert = data.etaSigningCert.trim()
      if (Object.keys(secretPayload).length > 0) {
        await api.put('/settings/eta/credentials', secretPayload)
      }
    },
    onSuccess: () => {
      toast.success('تم حفظ بيانات الربط')
      // Clear the secret inputs from memory after a successful save.
      setCreds((c) => ({ ...c, etaClientId: '', etaClientSecret: '', etaSigningCert: '' }))
      refresh()
      setStep(3)
    },
    onError: () => toast.error('تعذّر حفظ بيانات الربط'),
  })

  const { mutate: runTest, isPending: testing } = useMutation({
    mutationFn: async () => (await api.post<{ success: boolean; message: string }>('/settings/eta/test')).data,
    onSuccess: (res) => {
      setTestResult({ ok: res.success, message: res.message })
      if (res.success) toast.success('الاتصال ناجح')
    },
    onError: () => setTestResult({ ok: false, message: 'تعذّر إجراء الاختبار — حاول مرة أخرى' }),
  })

  // Field-level setters keep the JSX terse.
  const setB = (k: keyof BusinessForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setBusiness((f) => ({ ...f, [k]: e.target.value }))
  const setC = (k: keyof CredsForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setCreds((f) => ({ ...f, [k]: e.target.value }))

  const STEPS = [
    { n: 1, label: 'بيانات المحل' },
    { n: 2, label: 'بيانات الربط' },
    { n: 3, label: 'الاختبار والتفعيل' },
  ]

  const credSetHint = (isSet?: boolean) =>
    isSet ? 'محفوظ مسبقاً — اتركه فارغاً للإبقاء عليه، أو اكتب قيمة جديدة لاستبداله' : undefined

  return (
    <div className="bg-white border border-gray-700 rounded-lg p-4 flex flex-col gap-5 shadow-sm">
      <div>
        <h3 className="text-base font-semibold text-gray-100">إعداد الفاتورة الإلكترونية (ETA)</h3>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
          اضبط بيانات الربط مع مصلحة الضرائب خطوة بخطوة. كل البيانات لازم تطابق
          تسجيلك على <span dir="ltr">invoicing.eta.gov.eg</span>.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <Fragment key={s.n}>
            <button
              type="button"
              onClick={() => setStep(s.n)}
              className="flex items-center gap-2 group"
            >
              <span className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
                step === s.n ? 'bg-brand-500 text-white'
                  : step > s.n ? 'bg-success-500/20 text-success-600 border border-success-500/40'
                  : 'bg-gray-750 text-gray-400 border border-gray-700',
              )}>
                {step > s.n ? <Check className="w-3.5 h-3.5" /> : s.n}
              </span>
              <span className={cn('text-xs hidden sm:inline', step === s.n ? 'text-gray-100 font-semibold' : 'text-gray-500')}>
                {s.label}
              </span>
            </button>
            {i < STEPS.length - 1 && <div className="flex-1 h-px bg-gray-700" />}
          </Fragment>
        ))}
      </div>

      {/* Step 1 — business / issuer data */}
      {step === 1 && (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); saveBusiness(business) }}>
          <Input label="الاسم القانوني للممول" placeholder="مثال: شركة الإسكندرية للتجارة ش.م.م"
            value={business.etaIssuerName} onChange={setB('etaIssuerName')} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select label="المحافظة" value={business.etaAddressGovernate} onChange={setB('etaAddressGovernate')}>
              <option value="">— اختر المحافظة —</option>
              {EG_GOVERNATES.map((g) => <option key={g} value={g}>{g}</option>)}
            </Select>
            <Input label="المدينة / المنطقة" placeholder="مثال: مدينة نصر"
              value={business.etaAddressRegionCity} onChange={setB('etaAddressRegionCity')} />
            <Input label="الشارع" placeholder="مثال: شارع التحرير"
              value={business.etaAddressStreet} onChange={setB('etaAddressStreet')} />
            <Input label="رقم العقار" placeholder="مثال: 15 أ"
              value={business.etaAddressBuilding} onChange={setB('etaAddressBuilding')} />
          </div>
          <div className="flex justify-end pt-2">
            <Button type="submit" loading={savingBusiness}>حفظ ومتابعة</Button>
          </div>
        </form>
      )}

      {/* Step 2 — credentials (public + encrypted secrets) */}
      {step === 2 && (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); saveCreds(creds) }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="رقم الممول (Taxpayer ID)" placeholder="9 أرقام" dir="ltr"
              value={creds.etaTaxpayerId} onChange={setC('etaTaxpayerId')} />
            <Select label="البيئة" value={creds.etaEnvironment} onChange={setC('etaEnvironment')}>
              <option value="preprod">اختبار (Preprod)</option>
              <option value="production">إنتاج (Production)</option>
            </Select>
            <Input label="كود النشاط (Activity Code)" placeholder="مثال: 4711" dir="ltr"
              hint="من قائمة أكواد ETA — راجع المحاسب لو مش متأكد"
              value={creds.etaActivityCode} onChange={setC('etaActivityCode')} />
            <Input label="كود الفرع (Branch Code)" placeholder="0 للفرع الرئيسي" dir="ltr"
              value={creds.etaBranchCode} onChange={setC('etaBranchCode')} />
          </div>

          <div className="border-t border-gray-700 pt-4 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-brand-400" />
              <h4 className="text-sm font-semibold text-gray-200">بيانات الاعتماد المشفّرة</h4>
            </div>
            <p className="text-xs text-gray-500 -mt-2">
              تُحفظ مشفّرة بالكامل (AES-256) ولا تظهر مرة أخرى بعد الحفظ.
            </p>
            <Input label="Client ID" dir="ltr"
              placeholder={settings?.etaClientIdSet ? '•••••••• (محفوظ)' : 'الصِق Client ID من بوابة ETA'}
              hint={credSetHint(settings?.etaClientIdSet)}
              value={creds.etaClientId} onChange={setC('etaClientId')} />
            <Input label="Client Secret" type="password" dir="ltr"
              placeholder={settings?.etaClientSecretSet ? '•••••••• (محفوظ)' : 'الصِق Client Secret'}
              hint={credSetHint(settings?.etaClientSecretSet)}
              value={creds.etaClientSecret} onChange={setC('etaClientSecret')} />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-gray-300">الشهادة الرقمية (PEM)
                {settings?.etaSigningCertSet && <span className="text-success-600 text-xs mr-2">✓ محفوظة</span>}
              </label>
              <textarea
                dir="ltr"
                rows={4}
                placeholder={settings?.etaSigningCertSet ? '•••••••• (محفوظة — اتركها فارغة للإبقاء)' : '-----BEGIN PRIVATE KEY-----'}
                value={creds.etaSigningCert}
                onChange={setC('etaSigningCert')}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-100 font-mono focus:border-brand-500 focus:outline-none"
              />
              <p className="text-xs text-gray-500">اختياري — مطلوب فقط للتوقيع المحلي بدون HSM.</p>
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <Button type="button" variant="ghost" onClick={() => setStep(1)}>السابق</Button>
            <Button type="submit" loading={savingCreds}>حفظ ومتابعة</Button>
          </div>
        </form>
      )}

      {/* Step 3 — test + finish */}
      {step === 3 && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-300 leading-relaxed">
            اختبر الاتصال بمنظومة ETA للتأكد إن بيانات الربط صحيحة قبل إصدار أول فاتورة.
          </p>

          {testResult && (
            <div className={cn(
              'rounded-md px-4 py-3 text-sm flex items-start gap-2',
              testResult.ok
                ? 'bg-success-500/10 border border-success-500/30 text-success-700'
                : 'bg-danger-500/10 border border-danger-500/30 text-danger-700',
            )}>
              {testResult.ok ? <Check className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
              <span>{testResult.message}</span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={() => runTest()} loading={testing}>
              <Sparkles className="w-4 h-4" />اختبار الاتصال
            </Button>
            <Button variant="ghost" onClick={() => setStep(2)}>تعديل البيانات</Button>
          </div>

          <div className="bg-gray-750 border border-gray-700 rounded-md px-4 py-3 text-xs text-gray-400 leading-relaxed">
            بعد نجاح الاختبار، الفواتير الجديدة هتترسل تلقائياً لمصلحة الضرائب طول ما
            الإرسال الإلكتروني مفعّل من فوق. مفيش خطوة إضافية مطلوبة.
          </div>
        </div>
      )}
    </div>
  )
}

function EtaSettings() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('failed')
  const [page, setPage] = useState(1)
  const LIMIT = 15

  // Toggle state — load the tenant's current ETA configuration so we can
  // show owners whether they're enrolled or still pending.
  const { data: settings } = useQuery<TenantSettings>({
    queryKey: ['tenant-settings-eta'],
    queryFn: async () => (await api.get<{ data: TenantSettings }>('/settings')).data.data,
  })

  const { mutate: toggleEta, isPending: isToggling } = useMutation({
    mutationFn: async (etaEnabled: boolean) => api.patch('/settings', { etaEnabled }),
    onSuccess: (_, etaEnabled) => {
      toast.success(etaEnabled
        ? 'تم تفعيل إرسال الإيصالات الإلكترونية'
        : 'تم إيقاف إرسال الإيصالات الإلكترونية')
      qc.invalidateQueries({ queryKey: ['tenant-settings-eta'] })
      qc.invalidateQueries({ queryKey: ['tenant-settings'] })
    },
    onError: () => toast.error('تعذّر تحديث الإعداد'),
  })

  const { data, isLoading } = useQuery<{ data: EtaInvoice[]; meta: { total: number; page: number; limit: number; pages: number } }>({
    queryKey: ['eta-invoices', statusFilter, page],
    queryFn: async () => (await api.get<{ data: EtaInvoice[]; meta: { total: number; page: number; limit: number; pages: number } }>('/invoices', {
      params: { etaStatus: statusFilter || undefined, limit: LIMIT, page },
    })).data,
  })

  const { mutate: retry, isPending: isRetrying } = useMutation({
    mutationFn: async (invoiceId: string) => api.post(`/admin/eta/resubmit/${invoiceId}`),
    onSuccess: () => {
      toast.success('تم إعادة الإرسال إلى منظومة الإيصالات')
      qc.invalidateQueries({ queryKey: ['eta-invoices'] })
    },
    onError: (e: unknown) => {
      toast.error(getApiErrorCode(e) === 'invoice_already_accepted' ? 'الفاتورة مقبولة بالفعل' : 'فشلت إعادة الإرسال')
    },
  })

  const invoices = data?.data ?? []
  const meta = data?.meta

  // Three states for the banner: opted-out, enabled-but-unconfigured, fully-set-up.
  // "Fully set up" now requires both credentials AND issuer registration — both
  // are prerequisites for the job to actually submit anything to ETA (see the
  // missingCredentials / missingIssuer guards in eta-submission.job.ts).
  const etaEnabled = settings?.etaEnabled ?? true
  const hasCredentials = !!(settings?.etaTaxpayerId && settings?.etaClientIdSet && settings?.etaClientSecretSet)
  const hasIssuer = !!(
    settings?.etaIssuerName &&
    settings?.etaAddressGovernate &&
    settings?.etaAddressRegionCity &&
    settings?.etaAddressStreet &&
    settings?.etaAddressBuilding
  )
  const fullySetUp = hasCredentials && hasIssuer

  return (
    <div className="flex flex-col gap-6">
      {/* Enable/disable toggle + setup status */}
      <div className="bg-white border border-gray-700 rounded-lg p-4 flex flex-col gap-4 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-gray-100">إرسال الإيصالات الإلكترونية (ETA)</h3>
            <p className="text-xs text-gray-500 mt-1">
              مصلحة الضرائب المصرية تشترط على الشركات المسجلة لضريبة القيمة المضافة إرسال إيصالات إلكترونية. أوقفه فقط إذا كنت غير مسجل لضريبة القيمة المضافة.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={etaEnabled}
              disabled={isToggling}
              onChange={(e) => toggleEta(e.target.checked)}
              className="w-5 h-5 rounded accent-brand-500"
            />
            <span className="text-sm text-gray-200">{etaEnabled ? 'مفعّل' : 'موقوف'}</span>
          </label>
        </div>

        {etaEnabled && !fullySetUp && (
          <div className="bg-warning-500/10 border border-warning-500/30 rounded-md px-4 py-3 text-sm text-warning-700">
            <p className="font-semibold mb-1">بانتظار إكمال إعداد ETA</p>
            <p className="text-warning-600 text-xs leading-relaxed">
              متجرك مفعّل لإرسال الإيصالات الإلكترونية، لكن الإعداد لسه ناقص.
              {!hasIssuer && ' املأ بيانات الممول والعنوان في النموذج بالأسفل.'}
              {!hasCredentials && ' بيانات الاعتماد المشفّرة (Client ID و Client Secret والشهادة الرقمية) لازم يدخلها فريق الدعم بعد تسجيلك على بوابة ETA.'}
              {' '}الفواتير الجديدة هتفضل في حالة «بانتظار إعداد ETA» لحد ما البيانات تكمل.
            </p>
          </div>
        )}

        {!etaEnabled && (
          <div className="bg-gray-750 border border-gray-700 rounded-md px-4 py-3 text-xs text-gray-400 leading-relaxed">
            الإرسال الإلكتروني موقوف لهذا المتجر. الفواتير الجديدة ستُسجّل كـ «غير مطلوب».
            تأكد أن متجرك معفى من ضريبة القيمة المضافة قبل الإيقاف.
          </div>
        )}

        {etaEnabled && fullySetUp && (
          <div className="bg-success-500/10 border border-success-500/30 rounded-md px-4 py-3 text-xs text-success-700 leading-relaxed">
            تم إعداد ETA — الفواتير تُرسَل تلقائياً إلى مصلحة الضرائب.
          </div>
        )}
      </div>

      {/* Self-service setup wizard — issuer data, encrypted credentials, test. */}
      {etaEnabled && <EtaSetupWizard settings={settings} />}

      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-100">حالة إرسال الإيصالات الإلكترونية (ETA)</h3>
        <Select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
        >
          <option value="">الكل</option>
          <option value="failed">فشل</option>
          <option value="pending">معلق</option>
          <option value="pending_setup">بانتظار إعداد ETA</option>
          <option value="accepted">مقبول</option>
          <option value="not_required">غير مطلوب</option>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-gray-700 rounded animate-pulse" />)}</div>
      ) : invoices.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-12">لا توجد فواتير بهذه الحالة</p>
      ) : (
        <div className="flex flex-col gap-3">
          {invoices.map((inv) => {
            const s = etaStatusMap[inv.etaStatus] ?? { label: inv.etaStatus, variant: 'gray' as const }
            return (
              <div key={inv.id} className="bg-gray-750 border border-gray-700 rounded-md p-4 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-mono text-gray-100 text-sm">{inv.invoiceNumber}</span>
                    <Badge variant={s.variant}>{s.label}</Badge>
                  </div>
                  <p className="text-xs text-gray-500">{inv.customer?.fullName ?? 'نقدي'} · {formatDate(inv.createdAt)}</p>
                  {inv.etaError && (
                    <p className="text-xs text-danger-600 mt-1 bg-danger-500/10 rounded px-2 py-1 font-mono break-all">{inv.etaError}</p>
                  )}
                </div>
                {(inv.etaStatus === 'failed' || inv.etaStatus === 'pending') && (
                  <Button size="sm" variant="ghost" loading={isRetrying} onClick={() => retry(inv.id)}>
                    <RefreshCw className="w-3 h-3" />إعادة إرسال
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {meta && meta.pages > 1 && (
        <Pagination page={meta.page} pages={meta.pages} total={meta.total} limit={meta.limit} onPage={setPage} />
      )}
    </div>
  )
}

// ─── Print Template Settings ──────────────────────────────────────────────────
const DEFAULT_PRINT_TEMPLATE = `<!DOCTYPE html>
<html dir="rtl">
<head><meta charset="utf-8"><style>
  body{font-family:'IBM Plex Sans Arabic',Arial,sans-serif;font-size:12px;width:80mm;margin:0 auto;padding:8px}
  .center{text-align:center}table{width:100%;border-collapse:collapse}
  td{padding:2px}.dashed{border-bottom:1px dashed #000;margin:4px 0}
  .total td{font-weight:bold;border-top:1px dashed #000}
</style></head>
<body>
  <div class="center"><h2>{{storeName}}</h2></div>
  <div class="dashed"></div>
  <p>رقم الفاتورة: <b>{{invoiceNumber}}</b></p>
  <p>التاريخ: {{date}}</p>
  <p>العميل: {{customerName}}</p>
  <div class="dashed"></div>{{itemsTable}}<div class="dashed"></div>
  <table>
    <tr><td>المجموع الفرعي</td><td>{{subtotal}}</td></tr>
    <tr class="total"><td>الإجمالي</td><td>{{total}}</td></tr>
  </table>
  <div class="center" style="margin-top:8px">شكراً لتعاملكم معنا</div>
</body></html>`

function PrintTemplateSettings() {
  const qc = useQueryClient()
  const { data: settings } = useQuery<{ printTemplate?: string }>({
    queryKey: ['tenant-settings'],
    queryFn: async () => (await api.get<{ data: { printTemplate?: string } }>('/settings')).data.data,
  })
  const [template, setTemplate] = useState(DEFAULT_PRINT_TEMPLATE)

  // Set template when settings loads for the first time
  useEffect(() => {
    if (settings?.printTemplate) setTemplate(settings.printTemplate)
  }, [settings?.printTemplate])

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => api.patch('/settings', { printTemplate: template }),
    onSuccess: () => { toast.success('تم حفظ القالب'); qc.invalidateQueries({ queryKey: ['tenant-settings'] }) },
    onError: () => toast.error('فشل الحفظ'),
  })

  const previewPrint = () => {
    const win = window.open('', '_blank', 'width=420,height=640')
    if (!win) return
    const preview = template
      .replace('{{storeName}}', 'حِسبة')
      .replace('{{invoiceNumber}}', 'INV-20260101-ABCDEF')
      .replace('{{date}}', formatDateTime(new Date()))
      .replace('{{customerName}}', 'عميل تجريبي')
      .replace('{{subtotal}}', '500.00 ج')
      .replace('{{total}}', '500.00 ج')
      .replace('{{itemsTable}}', '<table><tr><td>منتج تجريبي × 5</td><td>100.00 ج</td></tr></table>')
    win.document.write(preview)
    win.document.close()
    setTimeout(() => win.print(), 500)
  }

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-100">قالب الطباعة</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setTemplate(DEFAULT_PRINT_TEMPLATE)}><RefreshCw className="w-3 h-3" />إعادة تعيين</Button>
          <Button variant="outline" size="sm" onClick={previewPrint}>معاينة طباعة</Button>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        المتغيرات المتاحة: {`{{storeName}} {{invoiceNumber}} {{date}} {{customerName}} {{subtotal}} {{total}} {{itemsTable}}`}
      </p>
      <textarea
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
        className="w-full h-96 bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-xs text-gray-300 font-mono focus:outline-none focus:border-brand-500 resize-none"
        dir="ltr" spellCheck={false}
      />
      <Button onClick={() => save()} loading={isPending} className="w-fit">حفظ القالب</Button>
    </div>
  )
}
