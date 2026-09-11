import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AdminShell } from '@/components/admin/AdminShell'
import { Card, Table, Badge, Select, Input, Pagination, Skeleton, Alert } from '@/components/ui'
import { adminApi } from '@/api/admin-client'
import { formatDateTime } from '@/lib/format'
import { getApiErrorMessage } from '@/lib/api-error'

interface AuditRow {
  id: string
  entity: string
  entityId: string | null
  action: string
  before: unknown
  after: unknown
  ip: string | null
  createdAt: string
  actor: { id: string; email: string; fullName: string }
}

export default function AdminAuditLogs() {
  const [page, setPage] = useState(1)
  const [entity, setEntity] = useState('')
  const [action, setAction] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'audit-logs', { page, entity, action }],
    queryFn: async () => {
      const res = await adminApi.get<{
        success: true
        data: AuditRow[]
        meta: { total: number; page: number; limit: number; pages: number }
      }>('/audit-logs', { params: { page, entity: entity || undefined, action: action || undefined } })
      return res.data
    },
  })

  return (
    <AdminShell title="سجل النشاط">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Select value={entity} onChange={(e) => { setPage(1); setEntity(e.target.value) }}>
          <option value="">كل الكيانات</option>
          <option value="tenant">المتاجر</option>
          <option value="plan">الباقات</option>
          <option value="admin">المسؤولون</option>
          <option value="subscription">الاشتراكات</option>
        </Select>
        <Input
          placeholder="إجراء (مثلاً: suspend)"
          value={action}
          onChange={(e) => { setPage(1); setAction(e.target.value) }}
        />
      </div>

      {error ? (
        <Alert variant="danger">{getApiErrorMessage(error, 'تعذر التحميل')}</Alert>
      ) : isLoading || !data ? (
        <Skeleton className="h-96" />
      ) : (
        <Card>
          <Table<AuditRow>
            data={data.data}
            keyExtractor={(r) => r.id}
            emptyMessage="لا يوجد نشاط مسجّل"
            columns={[
              { key: 'time', header: 'الوقت', render: (r) => (
                <span className="text-xs text-gray-400">{formatDateTime(r.createdAt)}</span>
              ) },
              { key: 'actor', header: 'المستخدم', render: (r) => (
                <div className="text-xs">
                  <div className="text-gray-200">{r.actor.fullName}</div>
                  <div className="text-gray-500" dir="ltr">{r.actor.email}</div>
                </div>
              ) },
              { key: 'entity', header: 'كيان', render: (r) => (
                <Badge variant="gray">{r.entity}</Badge>
              ) },
              { key: 'action', header: 'إجراء', render: (r) => (
                <Badge variant={
                  r.action === 'delete' || r.action === 'suspend' ? 'danger' :
                  r.action === 'create' || r.action === 'unsuspend' ? 'success' :
                  r.action === 'login' ? 'info' :
                  'brand'
                }>
                  {r.action}
                </Badge>
              ) },
              { key: 'entityId', header: 'معرّف', render: (r) => (
                <span className="text-xs text-gray-500 font-mono" dir="ltr">{r.entityId ?? '—'}</span>
              ) },
              { key: 'ip', header: 'IP', render: (r) => (
                <span className="text-xs text-gray-500 font-mono" dir="ltr">{r.ip ?? '—'}</span>
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
        </Card>
      )}
    </AdminShell>
  )
}
