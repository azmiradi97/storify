import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, Trash2, Search, Settings2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { AppShell } from '@/components/layout/AppShell'
import { Table, Money, SkeletonTable, Badge, Button, Drawer, Modal, Input, Select, Pagination } from '@/components/ui'
import { api } from '@/api/client'
import { getApiErrorMessage } from '@/lib/api-error'
import type { PaginationMeta } from '@/types/api'

interface ServiceCategory {
  id: string
  name: string
  isActive: boolean
}

interface Service {
  id: string
  name: string
  description: string | null
  categoryId: string | null
  defaultPrice: string | number
  estimatedDurationMinutes: number | null
  isActive: boolean
  category?: { id: string; name: string } | null
}

const LIMIT = 20

const serviceSchema = z.object({
  name: z.string().min(1, 'الاسم مطلوب'),
  description: z.string().optional(),
  categoryId: z.string().uuid().optional().or(z.literal('')),
  defaultPrice: z.coerce.number().min(0, 'السعر يجب أن يكون موجباً'),
  estimatedDurationMinutes: z.coerce.number().int().min(0).optional().or(z.literal('')),
  isActive: z.boolean().default(true),
})
type ServiceForm = z.infer<typeof serviceSchema>

const categorySchema = z.object({
  name: z.string().min(1, 'الاسم مطلوب').max(100),
})
type CategoryForm = z.infer<typeof categorySchema>

export default function Services() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Service | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null)
  const [catModalOpen, setCatModalOpen] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading } = useQuery<{ data: Service[]; meta: PaginationMeta }>({
    queryKey: ['services', page, debouncedSearch, categoryFilter],
    queryFn: async () =>
      (await api.get<{ data: Service[]; meta: PaginationMeta }>('/services', {
        params: {
          limit: LIMIT,
          page,
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(categoryFilter ? { categoryId: categoryFilter } : {}),
        },
      })).data,
  })

  const { data: categories = [] } = useQuery<ServiceCategory[]>({
    queryKey: ['service-categories'],
    queryFn: async () => (await api.get<{ data: ServiceCategory[] }>('/services/categories')).data.data,
  })

  const services = data?.data ?? []
  const meta = data?.meta

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ServiceForm>({
    resolver: zodResolver(serviceSchema),
    defaultValues: { isActive: true },
  })

  const openNew = () => {
    setEditing(null)
    reset({ name: '', description: '', categoryId: '', defaultPrice: 0, isActive: true })
    setDrawerOpen(true)
  }
  const openEdit = (s: Service) => {
    setEditing(s)
    reset({
      name: s.name,
      description: s.description ?? '',
      categoryId: s.categoryId ?? '',
      defaultPrice: Number(s.defaultPrice),
      estimatedDurationMinutes: s.estimatedDurationMinutes ?? undefined,
      isActive: s.isActive,
    })
    setDrawerOpen(true)
  }

  const { mutate: save, isPending } = useMutation({
    mutationFn: async (form: ServiceForm) => {
      const body = {
        name: form.name,
        description: form.description || null,
        categoryId: form.categoryId || null,
        defaultPrice: form.defaultPrice,
        estimatedDurationMinutes:
          form.estimatedDurationMinutes === '' || form.estimatedDurationMinutes == null
            ? null
            : Number(form.estimatedDurationMinutes),
        isActive: form.isActive,
      }
      if (editing) await api.patch(`/services/${editing.id}`, body)
      else await api.post('/services', body)
    },
    onSuccess: () => {
      toast.success(editing ? 'تم تحديث الخدمة' : 'تم إضافة الخدمة')
      qc.invalidateQueries({ queryKey: ['services'] })
      setDrawerOpen(false)
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })

  const { mutate: removeService, isPending: isDeleting } = useMutation({
    mutationFn: async (id: string) => api.delete(`/services/${id}`),
    onSuccess: () => {
      toast.success('تم إلغاء تفعيل الخدمة')
      qc.invalidateQueries({ queryKey: ['services'] })
      setDeleteTarget(null)
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })

  return (
    <AppShell title="الخدمات">
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative w-72 max-w-full">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث باسم الخدمة..."
                className="w-full bg-gray-800 border border-gray-700 rounded-md pr-9 pl-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-brand-500"
              />
            </div>
            <Select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1) }} className="w-48">
              <option value="">كل الفئات</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setCatModalOpen(true)}>
              <Settings2 className="w-4 h-4" /> الفئات
            </Button>
            <Button onClick={openNew}><Plus className="w-4 h-4" /> خدمة جديدة</Button>
          </div>
        </div>

        {isLoading ? (
          <SkeletonTable rows={8} cols={5} />
        ) : (
          <>
            <Table
              columns={[
                { key: 'name', header: 'الخدمة', render: (s) => (
                  <div>
                    <p className="font-medium text-gray-100">{s.name}</p>
                    {s.description && <p className="text-xs text-gray-500 truncate max-w-md">{s.description}</p>}
                  </div>
                )},
                { key: 'category', header: 'الفئة', render: (s) => s.category ? <Badge variant="info">{s.category.name}</Badge> : <span className="text-gray-500">—</span> },
                { key: 'defaultPrice', header: 'السعر الافتراضي', render: (s) => <Money value={Number(s.defaultPrice)} /> },
                { key: 'duration', header: 'المدة (دقيقة)', render: (s) => (
                  <span className="font-mono num">{s.estimatedDurationMinutes ?? '—'}</span>
                )},
                { key: 'status', header: 'الحالة', render: (s) => (
                  <Badge variant={s.isActive ? 'success' : 'gray'} dot>{s.isActive ? 'مفعّلة' : 'معطّلة'}</Badge>
                )},
                { key: 'actions', header: '', render: (s) => (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(s)}><Edit2 className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(s)} className="text-danger-500"><Trash2 className="w-3 h-3" /></Button>
                  </div>
                )},
              ]}
              data={services}
              keyExtractor={(s) => s.id}
              emptyMessage="لا توجد خدمات بعد" emptyIcon={<Settings2 className="w-8 h-8" />} emptyDescription="أضف خدماتك وأسعارها"
            />
            {meta && <Pagination page={meta.page} pages={meta.pages} total={meta.total} limit={meta.limit} onPage={setPage} />}
          </>
        )}
      </div>

      {/* Create / edit service */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? 'تعديل الخدمة' : 'خدمة جديدة'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>إلغاء</Button>
            <Button loading={isPending} onClick={handleSubmit((d) => save(d))}>حفظ</Button>
          </>
        }
      >
        <form className="flex flex-col gap-5">
          <Input label="اسم الخدمة" error={errors.name?.message} {...register('name')} />
          <div>
            <label className="text-sm text-gray-400 block mb-1">الوصف</label>
            <textarea {...register('description')} rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)] resize-none" />
          </div>
          <Select label="الفئة (اختياري)" {...register('categoryId')}>
            <option value="">بدون فئة</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Input label="السعر الافتراضي (ج)" type="number" step="0.01" error={errors.defaultPrice?.message} {...register('defaultPrice')} />
          <Input label="المدة المقدّرة (دقيقة)" type="number" {...register('estimatedDurationMinutes')} />
          <label className="inline-flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-brand-500" {...register('isActive')} />
            مفعّلة
          </label>
        </form>
      </Drawer>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="إلغاء تفعيل الخدمة"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button variant="danger" loading={isDeleting} onClick={() => deleteTarget && removeService(deleteTarget.id)}>
              إلغاء التفعيل
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-300">
          سيتم إلغاء تفعيل الخدمة <strong>{deleteTarget?.name}</strong> ولن تظهر في طلبات العمل الجديدة.
          البيانات في الطلبات السابقة لن تتأثر.
        </p>
      </Modal>

      <CategoriesModal open={catModalOpen} onClose={() => setCatModalOpen(false)} categories={categories} />
    </AppShell>
  )
}

// ─── Categories management modal ─────────────────────────────────────────────
function CategoriesModal({
  open, onClose, categories,
}: {
  open: boolean
  onClose: () => void
  categories: ServiceCategory[]
}) {
  const qc = useQueryClient()
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CategoryForm>({ resolver: zodResolver(categorySchema) })

  const { mutate: createCategory, isPending } = useMutation({
    mutationFn: async (form: CategoryForm) => api.post('/services/categories', form),
    onSuccess: () => {
      toast.success('تم إضافة الفئة')
      qc.invalidateQueries({ queryKey: ['service-categories'] })
      reset({ name: '' })
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })

  const { mutate: toggleActive } = useMutation({
    mutationFn: async (c: ServiceCategory) => api.patch(`/services/categories/${c.id}`, { isActive: !c.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service-categories'] }),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="فئات الخدمات"
      footer={<Button variant="secondary" onClick={onClose}>إغلاق</Button>}
    >
      <div className="flex flex-col gap-4">
        <form className="flex items-end gap-2" onSubmit={handleSubmit((d) => createCategory(d))}>
          <div className="flex-1">
            <Input label="اسم فئة جديدة" error={errors.name?.message} {...register('name')} />
          </div>
          <Button type="submit" loading={isPending}>إضافة</Button>
        </form>
        <div className="border-t border-gray-700 pt-3">
          {categories.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-3">لا توجد فئات بعد</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-750">
                  <span className={c.isActive ? 'text-gray-200' : 'text-gray-500 line-through'}>{c.name}</span>
                  <Button variant="ghost" size="sm" onClick={() => toggleActive(c)}>
                    {c.isActive ? 'تعطيل' : 'تفعيل'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}
