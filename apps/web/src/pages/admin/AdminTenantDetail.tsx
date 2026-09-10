import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowRight, AlertTriangle, CheckCircle2, Package2, RotateCw, CalendarPlus, Ban, PlayCircle } from 'lucide-react'
import { AdminShell } from '@/components/admin/AdminShell'
import { Card, StatCard, Badge, Button, Skeleton, Alert, Modal, Select, Input } from '@/components/ui'
import { adminApi } from '@/api/admin-client'
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format'
import { getApiErrorMessage } from '@/lib/api-error'

interface TenantDetail {
  id: string
  name: string
  subdomain: string
  schemaName: string
  email: string
  ownerName: string
  ownerEmail: string
  status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'PROVISIONING'
  suspendedAt: string | null
  cancelledAt: string | null
  createdAt: string
  planId: string
  plan: { id: string; name: string; slug: string; priceMonthly: string; priceYearly: string }
  subscriptions: Array<{
    id: string
    status: string
    billingCycle: string
    currentPeriodStart: string
    currentPeriodEnd: string
    priceAtSubscription: string
    trialEndsAt: string | null
    cancelledAt: string | null
    paymentAttempts: Array<{
      id: string
      amount: string
      status: string
      attemptType: string
      attemptedAt: string
      errorMessage: string | null
    }>
  }>
  usage: { users: number; products: number; invoices: number; customers: number } | null
}

interface Plan {
  id: string
  name: string
  slug: string
  priceMonthly: string
}

const statusVariant = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  CANCELLED: 'danger',
  PROVISIONING: 'gray',
} as const

const statusLabel = {
  ACTIVE: 'نشط',
  SUSPENDED: 'معلّق',
  CANCELLED: 'ملغى',
  PROVISIONING: 'قيد التجهيز',
}

type SubAction = 'extend' | 'cancel' | 'reactivate'

export default function AdminTenantDetail() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [suspendOpen, setSuspendOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [selectedPlanId, setSelectedPlanId] = useState<string>('')
  const [subAction, setSubAction] = useState<{ id: string; type: SubAction } | null>(null)
  const [extendDays, setExtendDays] = useState(14)
  const [subReason, setSubReason] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'tenant', id],
    queryFn: async () => {
      const res = await adminApi.get<{ success: true; data: TenantDetail }>(`/tenants/${id}`)
      return res.data.data
    },
  })

  const { data: plans } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: async () => {
      const res = await adminApi.get<{ success: true; data: Plan[] }>('/plans')
      return res.data.data
    },
  })

  const suspendMutation = useMutation({
    mutationFn: async (suspended: boolean) => {
      await adminApi.patch(`/tenants/${id}/suspend`, { suspended, reason: reason || undefined })
    },
    onSuccess: (_data, suspended) => {
      toast.success(suspended ? 'تم تعليق المتجر' : 'تم إلغاء التعليق')
      setSuspendOpen(false)
      setReason('')
      qc.invalidateQueries({ queryKey: ['admin', 'tenant', id] })
      qc.invalidateQueries({ queryKey: ['admin', 'tenants'] })
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })

  const planMutation = useMutation({
    mutationFn: async (planId: string) => {
      await adminApi.patch(`/tenants/${id}/plan`, { planId })
    },
    onSuccess: () => {
      toast.success('تم تغيير الباقة')
      setPlanOpen(false)
      qc.invalidateQueries({ queryKey: ['admin', 'tenant', id] })
      qc.invalidateQueries({ queryKey: ['admin', 'tenants'] })
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })

  const closeSubModal = () => {
    setSubAction(null)
    setSubReason('')
    setExtendDays(14)
  }

  const refetchTenant = () => qc.invalidateQueries({ queryKey: ['admin', 'tenant', id] })

  const extendTrialMutation = useMutation({
    mutationFn: async ({ subId, days, reason: r }: { subId: string; days: number; reason?: string }) => {
      await adminApi.patch(`/subscriptions/${subId}/extend-trial`, { days, reason: r || undefined })
    },
    onSuccess: () => { toast.success('تم تمديد الفترة التجريبية'); closeSubModal(); refetchTenant() },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })

  const cancelSubMutation = useMutation({
    mutationFn: async ({ subId, reason: r }: { subId: string; reason?: string }) => {
      await adminApi.patch(`/subscriptions/${subId}/cancel`, { reason: r || undefined })
    },
    onSuccess: () => { toast.success('تم إلغاء الاشتراك'); closeSubModal(); refetchTenant() },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })

  const reactivateMutation = useMutation({
    mutationFn: async ({ subId }: { subId: string }) => {
      await adminApi.patch(`/subscriptions/${subId}/reactivate`, {})
    },
    onSuccess: () => { toast.success('تم إعادة تفعيل الاشتراك'); closeSubModal(); refetchTenant() },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })

  if (error) {
    return (
      <AdminShell title="تفاصيل المتجر">
        <Alert variant="danger">{getApiErrorMessage(error, 'تعذر التحميل')}</Alert>
      </AdminShell>
    )
  }
  if (isLoading || !data) {
    return (
      <AdminShell title="تفاصيل المتجر">
        <Skeleton className="h-96" />
      </AdminShell>
    )
  }

  const isSuspended = data.status === 'SUSPENDED'

  return (
    <AdminShell title={data.name}>
      <Link to="/admin/tenants" className="inline-flex items-center gap-1 text-sm text-brand-400 hover:text-brand-600 mb-4">
        <ArrowRight className="w-4 h-4" />
        كل المتاجر
      </Link>

      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">{data.name}</h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge variant={statusVariant[data.status]} dot>{statusLabel[data.status]}</Badge>
            <Badge variant="brand">{data.plan.name}</Badge>
            <span className="text-xs text-gray-500" dir="ltr">{data.subdomain}.hesbaapp.com</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setSelectedPlanId(data.planId); setPlanOpen(true) }}>
            <RotateCw className="w-4 h-4" />
            تغيير الباقة
          </Button>
          {isSuspended ? (
            <Button variant="success" onClick={() => setSuspendOpen(true)}>
              <CheckCircle2 className="w-4 h-4" />
              إلغاء التعليق
            </Button>
          ) : (
            <Button variant="danger" onClick={() => setSuspendOpen(true)}>
              <AlertTriangle className="w-4 h-4" />
              تعليق المتجر
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-3">بيانات المالك</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">الاسم</dt>
              <dd className="text-gray-200">{data.ownerName}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">البريد</dt>
              <dd className="text-gray-200" dir="ltr">{data.ownerEmail}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">تاريخ التسجيل</dt>
              <dd className="text-gray-200">{formatDate(data.createdAt)}</dd>
            </div>
            {data.suspendedAt && (
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">تاريخ التعليق</dt>
                <dd className="text-warning-600">{formatDateTime(data.suspendedAt)}</dd>
              </div>
            )}
          </dl>
        </Card>

        <Card>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-3">معلومات الباقة</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">الباقة الحالية</dt>
              <dd className="text-gray-200">{data.plan.name}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">السعر الشهري</dt>
              <dd className="text-gray-200" dir="ltr">{formatMoney(Number(data.plan.priceMonthly))} EGP</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">السعر السنوي</dt>
              <dd className="text-gray-200" dir="ltr">{formatMoney(Number(data.plan.priceYearly))} EGP</dd>
            </div>
          </dl>
        </Card>
      </div>

      {data.usage && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard label="مستخدمون" value={formatNumber(data.usage.users)} />
          <StatCard label="منتجات" value={formatNumber(data.usage.products)} />
          <StatCard label="فواتير" value={formatNumber(data.usage.invoices)} />
          <StatCard label="عملاء" value={formatNumber(data.usage.customers)} />
        </div>
      )}

      <h2 className="text-lg font-semibold text-gray-100 mb-3">الاشتراكات</h2>
      {data.subscriptions.length === 0 ? (
        <Card><p className="text-sm text-gray-500">لا توجد اشتراكات</p></Card>
      ) : (
        <div className="space-y-3">
          {data.subscriptions.map((s) => (
            <Card key={s.id}>
              <div className="flex justify-between items-start mb-3 flex-wrap gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant={s.status === 'ACTIVE' ? 'success' : s.status === 'TRIALING' ? 'info' : s.status === 'PAST_DUE' ? 'warning' : 'gray'} dot>
                      {s.status}
                    </Badge>
                    <span className="text-xs text-gray-500">{s.billingCycle === 'YEARLY' ? 'سنوي' : 'شهري'}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    {formatDate(s.currentPeriodStart)} → {formatDate(s.currentPeriodEnd)}
                  </p>
                  {s.trialEndsAt && s.status === 'TRIALING' && (
                    <p className="text-xs text-info-600 mt-1">تنتهي التجربة: {formatDate(s.trialEndsAt)}</p>
                  )}
                </div>
                <div className="text-left">
                  <p className="font-mono text-base text-brand-600" dir="ltr">{formatMoney(Number(s.priceAtSubscription))} EGP</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mb-3">
                {(s.status === 'TRIALING' || s.status === 'PAST_DUE') && (
                  <Button variant="outline" size="sm" onClick={() => setSubAction({ id: s.id, type: 'extend' })}>
                    <CalendarPlus className="w-3.5 h-3.5" />
                    تمديد التجربة
                  </Button>
                )}
                {(s.status === 'PAST_DUE' || s.status === 'SUSPENDED') && (
                  <Button variant="outline" size="sm" onClick={() => setSubAction({ id: s.id, type: 'reactivate' })}>
                    <PlayCircle className="w-3.5 h-3.5" />
                    إعادة تفعيل
                  </Button>
                )}
                {s.status !== 'CANCELLED' && (
                  <Button variant="ghost" size="sm" className="text-danger-600" onClick={() => setSubAction({ id: s.id, type: 'cancel' })}>
                    <Ban className="w-3.5 h-3.5" />
                    إلغاء
                  </Button>
                )}
              </div>

              {s.paymentAttempts.length > 0 && (
                <div className="border-t border-gray-700 pt-3 mt-3">
                  <p className="text-[10px] uppercase text-gray-600 mb-2">آخر المحاولات</p>
                  <ul className="text-xs space-y-1">
                    {s.paymentAttempts.map((p) => (
                      <li key={p.id} className="flex justify-between gap-2">
                        <span className="text-gray-500">{formatDateTime(p.attemptedAt)}</span>
                        <span className={p.status === 'SUCCESS' ? 'text-success-600' : p.status === 'FAILED' ? 'text-danger-600' : 'text-gray-400'}>
                          {p.status}
                        </span>
                        <span className="text-gray-300 font-mono" dir="ltr">{formatMoney(Number(p.amount))}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* ─── Suspend / Unsuspend Modal ─── */}
      <Modal
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        title={isSuspended ? 'إلغاء تعليق المتجر' : 'تعليق المتجر'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSuspendOpen(false)}>إلغاء</Button>
            <Button
              variant={isSuspended ? 'success' : 'danger'}
              loading={suspendMutation.isPending}
              onClick={() => suspendMutation.mutate(!isSuspended)}
            >
              {isSuspended ? 'تأكيد إلغاء التعليق' : 'تأكيد التعليق'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-300 mb-4">
          {isSuspended
            ? 'هذا الإجراء سيعيد المتجر للحالة النشطة ويسمح للمستخدمين بالدخول.'
            : 'هذا الإجراء سيمنع كل المستخدمين من الدخول إلى المتجر فوراً.'}
        </p>
        {!isSuspended && (
          <textarea
            className="w-full rounded-md border-[1.5px] bg-gray-800 px-3 py-2 text-sm text-gray-100 border-gray-600 focus:border-brand-500 focus:outline-none"
            rows={3}
            placeholder="السبب (اختياري) — يُحفظ في سجل النشاط"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Modal>

      {/* ─── Change Plan Modal ─── */}
      <Modal
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        title="تغيير الباقة"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPlanOpen(false)}>إلغاء</Button>
            <Button
              variant="primary"
              loading={planMutation.isPending}
              disabled={!selectedPlanId || selectedPlanId === data.planId}
              onClick={() => planMutation.mutate(selectedPlanId)}
            >
              <Package2 className="w-4 h-4" />
              تطبيق
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-400 mb-4">
          الباقة الحالية: <span className="text-gray-100">{data.plan.name}</span>
        </p>
        <Select value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)} label="الباقة الجديدة">
          {plans?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({formatMoney(Number(p.priceMonthly))} EGP/شهر)
            </option>
          ))}
        </Select>
        <p className="text-xs text-gray-500 mt-3">
          ملاحظة: تغيير الباقة لا يُنشئ اشتراكاً جديداً بشكل تلقائي — استخدمه لتعديل الباقة الافتراضية للمتجر.
        </p>
      </Modal>

      {/* ─── Extend Trial Modal ─── */}
      <Modal
        open={subAction?.type === 'extend'}
        onClose={closeSubModal}
        title="تمديد الفترة التجريبية"
        footer={
          <>
            <Button variant="ghost" onClick={closeSubModal}>إلغاء</Button>
            <Button
              loading={extendTrialMutation.isPending}
              disabled={!extendDays || extendDays < 1 || extendDays > 180}
              onClick={() => subAction && extendTrialMutation.mutate({ subId: subAction.id, days: extendDays, reason: subReason })}
            >
              <CalendarPlus className="w-4 h-4" />
              تمديد
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-300 mb-4">
          سيتم تمديد الفترة التجريبية بعدد الأيام المحدد (يُحفظ الإجراء في سجل النشاط).
        </p>
        <Input
          label="عدد الأيام"
          type="number"
          min={1}
          max={180}
          value={extendDays}
          onChange={(e) => setExtendDays(Number(e.target.value) || 0)}
        />
        <textarea
          className="w-full mt-3 rounded-md border-[1.5px] bg-gray-800 px-3 py-2 text-sm text-gray-100 border-gray-600 focus:border-brand-500 focus:outline-none"
          rows={3}
          placeholder="السبب (اختياري)"
          value={subReason}
          onChange={(e) => setSubReason(e.target.value)}
        />
      </Modal>

      {/* ─── Cancel Subscription Modal ─── */}
      <Modal
        open={subAction?.type === 'cancel'}
        onClose={closeSubModal}
        title="إلغاء الاشتراك"
        footer={
          <>
            <Button variant="ghost" onClick={closeSubModal}>تراجع</Button>
            <Button
              variant="danger"
              loading={cancelSubMutation.isPending}
              onClick={() => subAction && cancelSubMutation.mutate({ subId: subAction.id, reason: subReason })}
            >
              <Ban className="w-4 h-4" />
              تأكيد الإلغاء
            </Button>
          </>
        }
      >
        <Alert variant="warning" className="mb-3">
          الإلغاء فوري ولا يمكن التراجع — استخدم إعادة التفعيل لاحقاً إذا احتجت.
        </Alert>
        <textarea
          className="w-full rounded-md border-[1.5px] bg-gray-800 px-3 py-2 text-sm text-gray-100 border-gray-600 focus:border-brand-500 focus:outline-none"
          rows={3}
          placeholder="السبب (اختياري) — يُحفظ في سجل النشاط"
          value={subReason}
          onChange={(e) => setSubReason(e.target.value)}
        />
      </Modal>

      {/* ─── Reactivate Subscription Modal ─── */}
      <Modal
        open={subAction?.type === 'reactivate'}
        onClose={closeSubModal}
        title="إعادة تفعيل الاشتراك"
        footer={
          <>
            <Button variant="ghost" onClick={closeSubModal}>إلغاء</Button>
            <Button
              variant="success"
              loading={reactivateMutation.isPending}
              onClick={() => subAction && reactivateMutation.mutate({ subId: subAction.id })}
            >
              <PlayCircle className="w-4 h-4" />
              إعادة التفعيل
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-300">
          سيُعاد ضبط حالة الاشتراك إلى <strong>ACTIVE</strong> وستُصفّر محاولات الدفع الفاشلة. تأكد أن المتجر قد سدد بطريقة بديلة أو تم منحه رصيد قبل التفعيل.
        </p>
      </Modal>
    </AdminShell>
  )
}
