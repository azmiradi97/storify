import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { passwordSchema } from '@/lib/validation'
import toast from 'react-hot-toast'
import { Plus, ShieldX } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { AdminShell } from '@/components/admin/AdminShell'
import { Card, Table, Badge, Button, Modal, Input, Select, Skeleton, Alert } from '@/components/ui'
import { adminApi } from '@/api/admin-client'
import { useAdminAuthStore } from '@/stores/admin-auth.store'
import { formatDateTime } from '@/lib/format'
import { getApiErrorMessage } from '@/lib/api-error'

interface AdminRow {
  id: string
  email: string
  fullName: string
  role: 'OWNER' | 'ADMIN'
  isActive: boolean
  lastLogin: string | null
  createdAt: string
}

const createSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  password: passwordSchema,
  role: z.enum(['OWNER', 'ADMIN']).default('ADMIN'),
})
type CreateForm = z.infer<typeof createSchema>

export default function AdminAdmins() {
  const qc = useQueryClient()
  const { admin: currentAdmin, isOwner } = useAdminAuthStore()
  const [creating, setCreating] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'admins'],
    queryFn: async () => {
      const res = await adminApi.get<{ success: true; data: AdminRow[] }>('/admins')
      return res.data.data
    },
    // Query disabled for non-owners — the early return below ensures we never
    // actually render the data, but we must call the hook unconditionally.
    enabled: isOwner(),
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      await adminApi.patch(`/admins/${id}`, { isActive })
    },
    onSuccess: () => {
      toast.success('تم التحديث')
      qc.invalidateQueries({ queryKey: ['admin', 'admins'] })
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })

  if (!isOwner()) return <Navigate to="/admin" replace />

  return (
    <AdminShell title="المسؤولون">
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-400">المسؤولون عن إدارة المنصة. متاح للمالك فقط.</p>
        <Button onClick={() => setCreating(true)}>
          <Plus className="w-4 h-4" />
          مسؤول جديد
        </Button>
      </div>

      {error ? (
        <Alert variant="danger">{getApiErrorMessage(error, 'تعذر التحميل')}</Alert>
      ) : isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : (
        <Card>
          <Table<AdminRow>
            data={data}
            keyExtractor={(a) => a.id}
            emptyMessage="لا يوجد مسؤولون"
            columns={[
              { key: 'name', header: 'الاسم', render: (a) => (
                <div>
                  <div className="text-gray-100">{a.fullName}</div>
                  <div className="text-xs text-gray-500" dir="ltr">{a.email}</div>
                </div>
              ) },
              { key: 'role', header: 'الدور', render: (a) => (
                <Badge variant={a.role === 'OWNER' ? 'brand' : 'gray'}>
                  {a.role === 'OWNER' ? 'مالك' : 'مسؤول'}
                </Badge>
              ) },
              { key: 'active', header: 'الحالة', render: (a) => (
                <Badge variant={a.isActive ? 'success' : 'danger'} dot>
                  {a.isActive ? 'مفعّل' : 'معطّل'}
                </Badge>
              ) },
              { key: 'lastLogin', header: 'آخر دخول', render: (a) => (
                <span className="text-xs text-gray-500">
                  {a.lastLogin ? formatDateTime(a.lastLogin) : '—'}
                </span>
              ) },
              { key: 'actions', header: '', render: (a) => (
                a.id === currentAdmin?.id ? (
                  <span className="text-xs text-gray-600">(أنت)</span>
                ) : (
                  <Button
                    variant={a.isActive ? 'ghost' : 'success'}
                    size="sm"
                    loading={toggleMutation.isPending && toggleMutation.variables?.id === a.id}
                    onClick={() => toggleMutation.mutate({ id: a.id, isActive: !a.isActive })}
                  >
                    {a.isActive ? <><ShieldX className="w-4 h-4 text-danger-400" />تعطيل</> : 'تفعيل'}
                  </Button>
                )
              ) },
            ]}
          />
        </Card>
      )}

      {creating && (
        <CreateAdminModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['admin', 'admins'] })
            setCreating(false)
          }}
        />
      )}
    </AdminShell>
  )
}

function CreateAdminModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateForm>({ resolver: zodResolver(createSchema), defaultValues: { role: 'ADMIN' } })

  const mutation = useMutation({
    mutationFn: async (data: CreateForm) => {
      await adminApi.post('/admins', { ...data, email: data.email.toLowerCase() })
    },
    onSuccess: () => {
      toast.success('تم إنشاء المسؤول')
      onCreated()
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="مسؤول جديد"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button onClick={handleSubmit((d) => mutation.mutate(d))} loading={mutation.isPending}>
            إنشاء
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input label="الاسم الكامل" error={errors.fullName?.message} {...register('fullName')} />
        <Input label="البريد الإلكتروني" type="email" error={errors.email?.message} {...register('email')} />
        <Input label="كلمة المرور" type="password" error={errors.password?.message} {...register('password')} hint="12 حرفاً على الأقل، مع حرف ورقم" />
        <Select label="الدور" {...register('role')}>
          <option value="ADMIN">مسؤول (وصول كامل، لا يدير مسؤولين)</option>
          <option value="OWNER">مالك (يدير المسؤولين)</option>
        </Select>
      </div>
    </Modal>
  )
}
