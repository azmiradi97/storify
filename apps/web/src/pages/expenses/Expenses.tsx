import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Check, X, Download, Wallet, Trash2, Edit2, Copy, FileText } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { AppShell } from '@/components/layout/AppShell'
import { Table, Money, Badge, SkeletonTable, Button, Drawer, Modal, Input, Select, Pagination, BulkActionBar, ConfirmDialog } from '@/components/ui'
import { api } from '@/api/client'
import { cn } from '@/lib/cn'
import { useAuthStore } from '@/stores/auth.store'
import type { PaginationMeta } from '@/types/api'
import { useSelection } from '@/hooks/useSelection'
import { exportRowsToExcel } from '@/lib/export'
import { formatNumber, formatDate } from '@/lib/format'

interface Expense {
  id: string
  description: string
  amount: number
  status: 'pending' | 'approved' | 'rejected'
  expenseDate: string
  createdAt: string
  category?: { id: string; name: string }
}

interface Category { id: string; name: string }
interface Branch { id: string; name: string; isMain: boolean }

interface Budget {
  id: string
  categoryId: string
  period: 'monthly' | 'yearly'
  amount: string
  spent: string
  category: { id: string; name: string; color?: string }
}

interface ExpenseTemplate {
  id: string
  name: string
  description: string
  amount: string
  categoryId: string
  branchId?: string | null
  paymentMethod?: string | null
  lastUsedAt?: string | null
  category: { id: string; name: string; color?: string }
  branch?: { id: string; name: string } | null
}

const LIMIT = 20

const schema = z.object({
  description: z.string().min(1, 'الوصف مطلوب'),
  amount: z.coerce.number().positive('يجب أن يكون أكبر من صفر'),
  categoryId: z.string().uuid('اختر فئة'),
  branchId: z.string().uuid('اختر الفرع'),
  expenseDate: z.string().min(1, 'التاريخ مطلوب'),
  paymentMethod: z.string().optional(),
})
type FormData = z.infer<typeof schema>

const statusMap = {
  pending: { label: 'انتظار', variant: 'warning' as const },
  approved: { label: 'موافق', variant: 'success' as const },
  rejected: { label: 'مرفوض', variant: 'danger' as const },
}

// ─── Budget panel ─────────────────────────────────────────────────────────────
// Reads budgets (with computed spent figures) and renders progress bars per
// category. The "ميزانية" button opens a modal that upserts a (category, period)
// budget row.
function BudgetUpsertModal({
  open, onClose, categories, existing,
}: {
  open: boolean
  onClose: () => void
  categories: Category[]
  existing: Budget | null
}) {
  const qc = useQueryClient()
  const [categoryId, setCategoryId] = useState('')
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly')
  const [amount, setAmount] = useState('')

  useEffect(() => {
    if (existing) {
      setCategoryId(existing.categoryId)
      setPeriod(existing.period)
      setAmount(existing.amount)
    } else {
      setCategoryId('')
      setPeriod('monthly')
      setAmount('')
    }
  }, [existing, open])

  const { mutate, isPending } = useMutation({
    mutationFn: async () => api.post('/expenses/budgets', { categoryId, period, amount: Number(amount) }),
    onSuccess: () => {
      toast.success(existing ? 'تم تحديث الميزانية' : 'تم إنشاء الميزانية')
      qc.invalidateQueries({ queryKey: ['expense-budgets'] })
      onClose()
    },
    onError: () => toast.error('فشل حفظ الميزانية'),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? 'تعديل الميزانية' : 'ميزانية جديدة'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>إلغاء</Button>
          <Button loading={isPending} disabled={!categoryId || !amount} onClick={() => mutate()}>
            <Check className="w-4 h-4" />حفظ
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="الفئة"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          disabled={!!existing}
        >
          <option value="">— اختر فئة —</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <div>
          <label className="text-sm text-gray-400 block mb-1">الفترة</label>
          <div className="flex gap-2">
            {(['monthly', 'yearly'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                disabled={!!existing}
                className={cn(
                  'flex-1 px-3 py-2 rounded-md text-sm border transition-colors disabled:opacity-60',
                  period === p ? 'border-brand-500 bg-brand-600/10 text-brand-300' : 'border-gray-600 text-gray-400',
                )}
              >
                {p === 'monthly' ? 'شهرياً' : 'سنوياً'}
              </button>
            ))}
          </div>
        </div>
        <Input
          label="المبلغ (ج)"
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
    </Modal>
  )
}

function BudgetPanel({ categories }: { categories: Category[] }) {
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Budget | null>(null)
  const [deletingBudget, setDeletingBudget] = useState<Budget | null>(null)

  const { data: budgets = [], isLoading } = useQuery<Budget[]>({
    queryKey: ['expense-budgets'],
    queryFn: async () => (await api.get<{ data: Budget[] }>('/expenses/budgets')).data.data,
  })

  const { mutate: deleteBudget } = useMutation({
    mutationFn: async (id: string) => api.delete(`/expenses/budgets/${id}`),
    onSuccess: () => {
      toast.success('تم حذف الميزانية')
      qc.invalidateQueries({ queryKey: ['expense-budgets'] })
    },
    onError: () => toast.error('فشل الحذف'),
  })

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (b: Budget) => { setEditing(b); setModalOpen(true) }

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-gray-100 flex items-center gap-2">
          <Wallet className="w-4 h-4 text-brand-400" />الميزانيات
        </h3>
        <Button variant="outline" size="sm" onClick={openCreate}>
          <Plus className="w-3 h-3" />ميزانية جديدة
        </Button>
      </div>
      <div className="p-4">
        {isLoading ? (
          <div className="text-gray-500 text-sm">جارٍ التحميل...</div>
        ) : budgets.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">
            لم تُحدَّد ميزانيات بعد. أضف ميزانية لتتبّع الإنفاق لكل فئة.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {budgets.map((b) => {
              const amount = Number(b.amount)
              const spent = Number(b.spent)
              const pct = amount > 0 ? Math.min(100, (spent / amount) * 100) : 0
              const overBudget = spent > amount
              const tone = overBudget ? 'bg-danger-500' : pct >= 80 ? 'bg-warning-500' : 'bg-success-500'
              return (
                <div key={b.id} className="bg-gray-900 border border-gray-700 rounded-md p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-100 truncate">{b.category.name}</p>
                      <p className="text-[10px] text-gray-500">{b.period === 'monthly' ? 'هذا الشهر' : 'هذا العام'}</p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(b)} className="text-gray-500 hover:text-gray-200 transition-colors p-1" aria-label="تعديل">
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setDeletingBudget(b)}
                        className="text-gray-500 hover:text-danger-400 transition-colors p-1"
                        aria-label="حذف"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className={cn('h-full transition-all duration-slow', tone)} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className={cn('font-numeric num', overBudget ? 'text-danger-400 font-semibold' : 'text-gray-300')}>
                      {formatNumber(spent, { maximumFractionDigits: 0 })} / {formatNumber(amount, { maximumFractionDigits: 0 })} ج
                    </span>
                    <span className={cn('font-numeric num', overBudget ? 'text-danger-400 font-semibold' : pct >= 80 ? 'text-warning-400' : 'text-gray-500')}>
                      {formatNumber(pct, { maximumFractionDigits: 0 })}%
                    </span>
                  </div>
                  {overBudget && (
                    <p className="text-[10px] text-danger-400">
                      تجاوزت الميزانية بـ {formatNumber(spent - amount, { maximumFractionDigits: 0 })} ج
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <BudgetUpsertModal open={modalOpen} onClose={() => setModalOpen(false)} categories={categories} existing={editing} />
      <ConfirmDialog
        open={!!deletingBudget}
        title="حذف الميزانية"
        message={`حذف ميزانية ${deletingBudget?.category.name ?? ''}؟`}
        confirmLabel="حذف"
        onConfirm={() => { if (deletingBudget) deleteBudget(deletingBudget.id); setDeletingBudget(null) }}
        onCancel={() => setDeletingBudget(null)}
      />
    </div>
  )
}

// ─── Templates panel ─────────────────────────────────────────────────────────
const templateFormSchema = z.object({
  name: z.string().min(1, 'الاسم مطلوب'),
  description: z.string().min(1, 'الوصف مطلوب'),
  amount: z.coerce.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  categoryId: z.string().uuid('اختر فئة'),
  paymentMethod: z.string().optional(),
})
type TemplateFormData = z.infer<typeof templateFormSchema>

function TemplateUpsertDrawer({
  open, onClose, categories, existing,
}: {
  open: boolean
  onClose: () => void
  categories: Category[]
  existing: ExpenseTemplate | null
}) {
  const qc = useQueryClient()
  const { register, handleSubmit, reset, formState: { errors } } = useForm<TemplateFormData>({
    resolver: zodResolver(templateFormSchema),
  })

  useEffect(() => {
    if (existing) {
      reset({
        name: existing.name,
        description: existing.description,
        amount: Number(existing.amount),
        categoryId: existing.categoryId,
        paymentMethod: existing.paymentMethod ?? '',
      })
    } else {
      reset({ name: '', description: '', amount: 0, categoryId: '', paymentMethod: '' })
    }
  }, [existing, open, reset])

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: TemplateFormData) => {
      const payload = {
        name: data.name,
        description: data.description,
        amount: data.amount,
        categoryId: data.categoryId,
        paymentMethod: data.paymentMethod || undefined,
      }
      if (existing) {
        await api.patch(`/expenses/templates/${existing.id}`, payload)
      } else {
        await api.post('/expenses/templates', payload)
      }
    },
    onSuccess: () => {
      toast.success(existing ? 'تم تحديث القالب' : 'تم إنشاء القالب')
      qc.invalidateQueries({ queryKey: ['expense-templates'] })
      onClose()
    },
    onError: () => toast.error('فشل حفظ القالب'),
  })

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={existing ? 'تعديل القالب' : 'قالب جديد'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>إلغاء</Button>
          <Button loading={isPending} onClick={handleSubmit((d) => mutate(d))}>
            <Check className="w-4 h-4" />حفظ
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4">
        <Input label="اسم القالب" placeholder="مثال: إيجار المحل" error={errors.name?.message} {...register('name')} />
        <div>
          <label className="text-sm text-gray-400 block mb-1">الوصف</label>
          <textarea {...register('description')} rows={2} className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 resize-none" />
          {errors.description && <p className="text-xs text-danger-400 mt-1">{errors.description.message}</p>}
        </div>
        <Input label="المبلغ (ج)" type="number" step="0.01" error={errors.amount?.message} {...register('amount')} />
        <Select label="الفئة" error={errors.categoryId?.message} {...register('categoryId')}>
          <option value="">— اختر فئة —</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Input label="طريقة الدفع (اختياري)" placeholder="نقدي / تحويل بنكي / ..." {...register('paymentMethod')} />
      </form>
    </Drawer>
  )
}

function TemplatesPanel({ categories }: { categories: Category[] }) {
  const qc = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<ExpenseTemplate | null>(null)
  const [deletingTemplate, setDeletingTemplate] = useState<ExpenseTemplate | null>(null)

  const { data: templates = [], isLoading } = useQuery<ExpenseTemplate[]>({
    queryKey: ['expense-templates'],
    queryFn: async () => (await api.get<{ data: ExpenseTemplate[] }>('/expenses/templates')).data.data,
  })

  const { mutate: instantiate, isPending: isInstantiating, variables: instantiatingId } = useMutation({
    mutationFn: async (id: string) => api.post(`/expenses/templates/${id}/instantiate`),
    onSuccess: () => {
      toast.success('تم إنشاء المصروف من القالب')
      qc.invalidateQueries({ queryKey: ['expenses'] })
      qc.invalidateQueries({ queryKey: ['expense-templates'] })
    },
    onError: () => toast.error('فشل إنشاء المصروف'),
  })

  const { mutate: deleteTemplate } = useMutation({
    mutationFn: async (id: string) => api.delete(`/expenses/templates/${id}`),
    onSuccess: () => {
      toast.success('تم حذف القالب')
      qc.invalidateQueries({ queryKey: ['expense-templates'] })
    },
    onError: () => toast.error('فشل الحذف'),
  })

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-gray-100 flex items-center gap-2">
          <FileText className="w-4 h-4 text-brand-400" />القوالب
        </h3>
        <Button variant="outline" size="sm" onClick={() => { setEditing(null); setDrawerOpen(true) }}>
          <Plus className="w-3 h-3" />قالب جديد
        </Button>
      </div>
      <div className="p-4">
        {isLoading ? (
          <div className="text-gray-500 text-sm">جارٍ التحميل...</div>
        ) : templates.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">
            لا توجد قوالب. أنشئ قالباً للمصاريف المتكررة (مثل الإيجار أو فواتير الكهرباء) لإضافتها بضغطة واحدة.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {templates.map((t) => {
              const isBusy = isInstantiating && instantiatingId === t.id
              return (
                <div key={t.id} className="bg-gray-900 border border-gray-700 rounded-md p-3 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-100 truncate">{t.name}</p>
                      <p className="text-[10px] text-gray-500 truncate">{t.category.name}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => { setEditing(t); setDrawerOpen(true) }} className="text-gray-500 hover:text-gray-200 transition-colors p-1" aria-label="تعديل" title="تعديل">
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setDeletingTemplate(t)}
                        className="text-gray-500 hover:text-danger-400 transition-colors p-1"
                        aria-label="حذف"
                        title="حذف"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 truncate">{t.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-base font-mono font-bold text-brand-400 num">
                      {formatNumber(Number(t.amount), { maximumFractionDigits: 2 })} ج
                    </span>
                    <Button size="sm" loading={isBusy} onClick={() => instantiate(t.id)}>
                      <Copy className="w-3 h-3" />استخدام
                    </Button>
                  </div>
                  {t.lastUsedAt && (
                    <p className="text-[10px] text-gray-600">آخر استخدام: {formatDate(t.lastUsedAt)}</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <TemplateUpsertDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} categories={categories} existing={editing} />
      <ConfirmDialog
        open={!!deletingTemplate}
        title="حذف القالب"
        message={`حذف القالب "${deletingTemplate?.name ?? ''}"؟`}
        confirmLabel="حذف"
        onConfirm={() => { if (deletingTemplate) deleteTemplate(deletingTemplate.id); setDeletingTemplate(null) }}
        onCancel={() => setDeletingTemplate(null)}
      />
    </div>
  )
}

export default function Expenses() {
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [page, setPage] = useState(1)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{ expense: Expense; type: 'approve' | 'reject' } | null>(null)

  const { data: expenseData, isLoading } = useQuery<{ data: Expense[]; meta: PaginationMeta }>({
    queryKey: ['expenses', page],
    queryFn: async () => (await api.get<{ data: Expense[]; meta: PaginationMeta }>('/expenses', { params: { limit: LIMIT, page } })).data,
  })

  const data = expenseData?.data ?? []
  const meta = expenseData?.meta

  const selection = useSelection(data.map((e) => e.id))

  const bulkExport = async () => {
    const selected = data.filter((e) => selection.isSelected(e.id))
    await exportRowsToExcel(
      selected,
      [
        { header: 'الوصف', accessor: 'description', width: 32 },
        { header: 'الفئة', accessor: (e) => e.category?.name ?? '', width: 16 },
        { header: 'المبلغ', accessor: 'amount', width: 14 },
        { header: 'تاريخ المصروف', accessor: 'expenseDate', width: 14 },
        { header: 'الحالة', accessor: (e) => statusMap[e.status].label, width: 12 },
        { header: 'أُنشئ', accessor: (e) => formatDate(e.createdAt), width: 14 },
      ],
      `expenses-${selected.length}.xlsx`,
      'المصروفات',
    )
  }

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['expense-categories'],
    queryFn: async () => (await api.get<{ data: Category[] }>('/expenses/categories')).data.data,
  })

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get<{ data: Branch[] }>('/branches')).data.data,
  })

  const defaultBranch = branches.find((b) => b.isMain) ?? branches[0]

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { expenseDate: new Date().toISOString().slice(0, 10) },
  })

  const { mutate: create, isPending: isCreating } = useMutation({
    mutationFn: async (data: FormData) => api.post('/expenses', data),
    onSuccess: () => {
      toast.success('تم إضافة المصروف')
      qc.invalidateQueries({ queryKey: ['expenses'] })
      setDrawerOpen(false)
      reset()
    },
    onError: () => toast.error('حدث خطأ، حاول مرة أخرى'),
  })

  const { mutate: reviewExpense, isPending: isReviewing } = useMutation({
    mutationFn: async ({ expense, type }: { expense: Expense; type: 'approve' | 'reject' }) =>
      api.patch(`/expenses/${expense.id}/${type}`),
    onSuccess: (_, { type }) => {
      toast.success(type === 'approve' ? 'تم الاعتماد' : 'تم الرفض')
      qc.invalidateQueries({ queryKey: ['expenses'] })
      setConfirmAction(null)
    },
    onError: () => toast.error('حدث خطأ'),
  })

  const canApprove = user?.roleSlug === 'super_admin' || user?.permissions?.expenses?.includes('approve')

  return (
    <AppShell title="المصروفات">
      <div className="flex flex-col gap-6">
        <BudgetPanel categories={categories} />
        <TemplatesPanel categories={categories} />
        <div className="flex justify-end">
          <Button onClick={() => { reset({ expenseDate: new Date().toISOString().slice(0, 10), branchId: defaultBranch?.id }); setDrawerOpen(true) }}>
            <Plus className="w-4 h-4" />مصروف جديد
          </Button>
        </div>

        {isLoading ? <SkeletonTable rows={8} cols={5} /> : (
          <>
          <Table
            selection={{
              isSelected: (e) => selection.isSelected(e.id),
              onToggle: (e) => selection.toggle(e.id),
              onToggleAll: selection.toggleAllVisible,
              allSelected: selection.allVisibleSelected,
              someSelected: selection.someVisibleSelected,
            }}
            columns={[
              { key: 'description', header: 'الوصف', render: (e) => <span className="font-medium text-gray-100">{e.description}</span> },
              { key: 'category', header: 'الفئة', render: (e) => <span className="text-gray-400">{e.category?.name ?? '—'}</span> },
              { key: 'amount', header: 'المبلغ', render: (e) => <Money value={e.amount} /> },
              { key: 'expenseDate', header: 'التاريخ', render: (e) => <span className="font-numeric num num-muted text-xs">{e.expenseDate}</span> },
              { key: 'status', header: 'الحالة', render: (e) => {
                const s = statusMap[e.status]
                return <Badge variant={s.variant} dot>{s.label}</Badge>
              }},
              { key: 'actions', header: '', render: (e) => e.status === 'pending' && canApprove ? (
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="text-success-500" onClick={() => setConfirmAction({ expense: e, type: 'approve' })}>
                    <Check className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-danger-500" onClick={() => setConfirmAction({ expense: e, type: 'reject' })}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ) : null },
            ]}
            data={data} keyExtractor={(e) => e.id} emptyMessage="لا توجد مصروفات"
          />
            {meta && <Pagination page={meta.page} pages={meta.pages} total={meta.total} limit={meta.limit} onPage={setPage} />}
          </>
        )}
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="مصروف جديد"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>إلغاء</Button>
            <Button loading={isCreating} onClick={handleSubmit((d) => create(d))}>حفظ</Button>
          </>
        }
      >
        <form className="flex flex-col gap-5">
          <Select label="الفرع" error={errors.branchId?.message} {...register('branchId')}>
            <option value="">اختر الفرع</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>

          <Select label="الفئة" error={errors.categoryId?.message} {...register('categoryId')}>
            <option value="">اختر الفئة</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>

          <Input label="الوصف" error={errors.description?.message} {...register('description')} />
          <Input label="المبلغ (ج)" type="number" step="0.01" error={errors.amount?.message} {...register('amount')} />
          <Input label="تاريخ المصروف" type="date" error={errors.expenseDate?.message} {...register('expenseDate')} />
          <Input label="طريقة الدفع (اختياري)" placeholder="نقدي، تحويل، ..." {...register('paymentMethod')} />
        </form>
      </Drawer>

      <Modal
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        title={confirmAction?.type === 'approve' ? 'اعتماد المصروف' : 'رفض المصروف'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmAction(null)}>إلغاء</Button>
            <Button
              variant={confirmAction?.type === 'approve' ? 'primary' : 'danger'}
              loading={isReviewing}
              onClick={() => confirmAction && reviewExpense(confirmAction)}
            >
              {confirmAction?.type === 'approve' ? 'اعتماد' : 'رفض'}
            </Button>
          </>
        }
      >
        <p className="text-gray-300">
          {confirmAction?.type === 'approve' ? 'هل تريد اعتماد مصروف' : 'هل تريد رفض مصروف'}
          {' '}<strong className="text-gray-100">{confirmAction?.expense.description}</strong>
          {' '}بقيمة <strong className="text-gray-100">{confirmAction?.expense.amount} ج</strong>؟
        </p>
      </Modal>
      <BulkActionBar count={selection.count} onClear={selection.clear}>
        <Button variant="outline" size="sm" onClick={bulkExport}>
          <Download className="w-4 h-4" />تصدير
        </Button>
      </BulkActionBar>
    </AppShell>
  )
}
