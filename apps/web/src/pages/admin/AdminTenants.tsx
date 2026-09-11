import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { AdminShell } from '@/components/admin/AdminShell'
import { Table, Badge, Input, Select, Pagination, Skeleton, Alert } from '@/components/ui'
import { adminApi } from '@/api/admin-client'
import { formatDate } from '@/lib/format'
import { getApiErrorMessage } from '@/lib/api-error'

interface TenantRow {
  id: string
  name: string
  subdomain: string
  ownerEmail: string
  status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'PROVISIONING'
  plan: { id: string; name: string; slug: string; priceMonthly: string }
  currentSubscription: { status: string; billingCycle: string; currentPeriodEnd: string } | null
  suspendedAt: string | null
  createdAt: string
}

const statusVariant: Record<TenantRow['status'], 'success' | 'warning' | 'danger' | 'gray'> = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  CANCELLED: 'danger',
  PROVISIONING: 'gray',
}

const statusLabel: Record<TenantRow['status'], string> = {
  ACTIVE: 'نشط',
  SUSPENDED: 'معلّق',
  CANCELLED: 'ملغى',
  PROVISIONING: 'قيد التجهيز',
}

export default function AdminTenants() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string>('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'tenants', { page, search, status }],
    queryFn: async () => {
      const res = await adminApi.get<{
        success: true
        data: TenantRow[]
        meta: { total: number; page: number; limit: number; pages: number }
      }>('/tenants', { params: { page, search: search || undefined, status: status || undefined } })
      return res.data
    },
  })

  return (
    <AdminShell title="المتاجر">
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1">
          <Input
            placeholder="بحث بالاسم، الـ subdomain، البريد"
            value={search}
            onChange={(e) => {
              setPage(1)
              setSearch(e.target.value)
            }}
            startIcon={<Search className="w-4 h-4 text-gray-400" />}
          />
        </div>
        <div className="sm:w-48">
          <Select
            value={status}
            onChange={(e) => {
              setPage(1)
              setStatus(e.target.value)
            }}
          >
            <option value="">كل الحالات</option>
            <option value="ACTIVE">نشط</option>
            <option value="SUSPENDED">معلّق</option>
            <option value="CANCELLED">ملغى</option>
            <option value="PROVISIONING">قيد التجهيز</option>
          </Select>
        </div>
      </div>

      {error ? (
        <Alert variant="danger">{getApiErrorMessage(error, 'تعذر تحميل المتاجر')}</Alert>
      ) : isLoading || !data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <Table<TenantRow>
            data={data.data}
            keyExtractor={(t) => t.id}
            onRowClick={(t) => navigate(`/admin/tenants/${t.id}`)}
            emptyMessage="لا توجد متاجر مطابقة"
            columns={[
              { key: 'name', header: 'المتجر', render: (t) => (
                <div>
                  <div className="text-gray-100 font-medium">{t.name}</div>
                  <div className="text-xs text-gray-500" dir="ltr">{t.subdomain}</div>
                </div>
              ) },
              { key: 'ownerEmail', header: 'المالك', render: (t) => (
                <span className="text-gray-300 text-xs" dir="ltr">{t.ownerEmail}</span>
              ) },
              { key: 'plan', header: 'الباقة', render: (t) => (
                <Badge variant="brand">{t.plan.name}</Badge>
              ) },
              { key: 'status', header: 'الحالة', render: (t) => (
                <Badge variant={statusVariant[t.status]}>{statusLabel[t.status]}</Badge>
              ) },
              { key: 'subStatus', header: 'الاشتراك', render: (t) =>
                t.currentSubscription ? (
                  <span className="text-xs text-gray-400">{t.currentSubscription.status}</span>
                ) : (
                  <span className="text-xs text-gray-500">—</span>
                ),
              },
              { key: 'createdAt', header: 'التسجيل', render: (t) => (
                <span className="text-xs text-gray-500">{formatDate(t.createdAt)}</span>
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
