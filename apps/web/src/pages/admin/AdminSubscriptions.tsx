import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AdminShell } from '@/components/admin/AdminShell'
import { Table, Badge, Select, Pagination, Skeleton, Alert } from '@/components/ui'
import { adminApi } from '@/api/admin-client'
import { formatDate, formatMoney } from '@/lib/format'
import { getApiErrorMessage } from '@/lib/api-error'

interface SubscriptionRow {
  id: string
  status: 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELLED' | 'SUSPENDED'
  billingCycle: 'MONTHLY' | 'YEARLY'
  currentPeriodEnd: string
  priceAtSubscription: string
  failedAttempts: number
  lastPaymentAt: string | null
  nextBillingAt: string | null
  createdAt: string
  tenant: { id: string; name: string; subdomain: string }
  plan: { id: string; name: string; slug: string }
}

const statusVariant = {
  ACTIVE: 'success',
  TRIALING: 'info',
  PAST_DUE: 'warning',
  CANCELLED: 'danger',
  SUSPENDED: 'warning',
} as const

export default function AdminSubscriptions() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<string>('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'subscriptions', { page, status }],
    queryFn: async () => {
      const res = await adminApi.get<{
        success: true
        data: SubscriptionRow[]
        meta: { total: number; page: number; limit: number; pages: number }
      }>('/subscriptions', { params: { page, status: status || undefined } })
      return res.data
    },
  })

  return (
    <AdminShell title="الاشتراكات">
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-400">كل اشتراكات المنصة</p>
        <div className="w-48">
          <Select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value) }}>
            <option value="">كل الحالات</option>
            <option value="ACTIVE">نشط</option>
            <option value="TRIALING">تجريبي</option>
            <option value="PAST_DUE">متأخر</option>
            <option value="CANCELLED">ملغى</option>
            <option value="SUSPENDED">معلّق</option>
          </Select>
        </div>
      </div>

      {error ? (
        <Alert variant="danger">{getApiErrorMessage(error, 'تعذر التحميل')}</Alert>
      ) : isLoading || !data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <Table<SubscriptionRow>
            data={data.data}
            keyExtractor={(s) => s.id}
            emptyMessage="لا توجد اشتراكات"
            columns={[
              { key: 'tenant', header: 'المتجر', render: (s) => (
                <Link to={`/admin/tenants/${s.tenant.id}`} className="text-brand-400 hover:text-brand-600">
                  {s.tenant.name}
                </Link>
              ) },
              { key: 'plan', header: 'الباقة', render: (s) => <Badge variant="brand">{s.plan.name}</Badge> },
              { key: 'status', header: 'الحالة', render: (s) => (
                <Badge variant={statusVariant[s.status]} dot>{s.status}</Badge>
              ) },
              { key: 'cycle', header: 'الدورة', render: (s) => (
                <span className="text-xs">{s.billingCycle === 'YEARLY' ? 'سنوي' : 'شهري'}</span>
              ) },
              { key: 'price', header: 'السعر', render: (s) => (
                <span className="font-mono text-brand-600" dir="ltr">{formatMoney(Number(s.priceAtSubscription))}</span>
              ) },
              { key: 'failed', header: 'محاولات فاشلة', render: (s) =>
                s.failedAttempts > 0 ? (
                  <Badge variant="danger">{s.failedAttempts}</Badge>
                ) : (
                  <span className="text-xs text-gray-500">—</span>
                ),
              },
              { key: 'periodEnd', header: 'نهاية الدورة', render: (s) => (
                <span className="text-xs text-gray-400">{formatDate(s.currentPeriodEnd)}</span>
              ) },
            ]}
          />
          <div className="mt-4">
            <Pagination
              page={data.meta.page}
              pages={data.meta.pages}
              total={data.meta.total}
              limit={data.meta.limit}
              onPage={setPage}
            />
          </div>
        </>
      )}
    </AdminShell>
  )
}
