import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, ChevronDown, ChevronUp, Edit2, PlusCircle, ToggleLeft, ToggleRight, Tag, Trash2, Upload, Download, Barcode, Package } from 'lucide-react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { AppShell } from '@/components/layout/AppShell'
import { Button, Input, Badge, Table, Drawer, Modal, Money, SkeletonTable, Pagination, BulkActionBar, Select, ConfirmDialog } from '@/components/ui'
import { api } from '@/api/client'
import { getApiErrorMessage } from '@/lib/api-error'
import type { PaginationMeta } from '@/types/api'
import { useSelection } from '@/hooks/useSelection'
import { exportRowsToExcel } from '@/lib/export'
import { formatDate } from '@/lib/format'
import { printBarcodeLabels } from '@/lib/print'

// ─── Types ────────────────────────────────────────────────────────────────────
interface ProductVariant {
  id: string
  sku?: string
  barcode?: string
  attributes: Record<string, string>
  costPrice: string | number
  sellPrice: string | number
  isActive: boolean
}

interface Product {
  id: string
  name: string
  description?: string
  unit: string
  hasVariants: boolean
  isActive: boolean
  category?: { id: string; name: string }
  taxRate?: { id: string; name: string; rate: string | number }
  variants: ProductVariant[]
}

interface Category { id: string; name: string }
interface TaxRate { id: string; name: string; rate: string | number; isDefault: boolean }
interface ProductDiscount { id: string; discountType: 'percentage' | 'fixed'; discountValue: string | number; startDate: string; endDate: string; isActive: boolean }

const LIMIT = 20

const unitLabels: Record<string, string> = { piece: 'قطعة', kg: 'كيلو', liter: 'لتر', box: 'صندوق' }

// ─── Create product form schema ───────────────────────────────────────────────
const variantSchema = z.object({
  sku: z.string().optional(),
  barcode: z.string().optional(),
  costPrice: z.coerce.number().positive('يجب أن يكون أكبر من صفر'),
  sellPrice: z.coerce.number().positive('يجب أن يكون أكبر من صفر'),
  attrKey: z.string().optional(),
  attrValue: z.string().optional(),
})

const createSchema = z.object({
  name: z.string().min(1, 'الاسم مطلوب'),
  description: z.string().optional(),
  unit: z.enum(['piece', 'kg', 'liter', 'box']).default('piece'),
  categoryId: z.string().uuid().optional().or(z.literal('')),
  taxRateId: z.string().uuid().optional().or(z.literal('')),
  hasVariants: z.boolean().default(false),
  variants: z.array(variantSchema).min(1, 'أضف متغيراً واحداً على الأقل'),
})
type CreateFormData = z.infer<typeof createSchema>

const editProductSchema = z.object({
  name: z.string().min(1, 'الاسم مطلوب'),
  description: z.string().optional(),
  unit: z.enum(['piece', 'kg', 'liter', 'box']),
  categoryId: z.string().uuid().optional().or(z.literal('')),
  taxRateId: z.string().uuid().optional().or(z.literal('')),
  isActive: z.boolean(),
})
type EditProductData = z.infer<typeof editProductSchema>

const variantFormSchema = z.object({
  sku: z.string().optional(),
  barcode: z.string().optional(),
  costPrice: z.coerce.number().positive('يجب أن يكون أكبر من صفر'),
  sellPrice: z.coerce.number().positive('يجب أن يكون أكبر من صفر'),
  attrKey: z.string().optional(),
  attrValue: z.string().optional(),
})
type VariantFormData = z.infer<typeof variantFormSchema>

// ─── Barcode label printer ────────────────────────────────────────────────────
// ─── Helper ───────────────────────────────────────────────────────────────────
function buildVariantPayload(v: { sku?: string; barcode?: string; costPrice: number; sellPrice: number; attrKey?: string; attrValue?: string }) {
  const attributes: Record<string, string> = {}
  if (v.attrKey && v.attrValue) attributes[v.attrKey] = v.attrValue
  return { sku: v.sku || undefined, barcode: v.barcode || undefined, costPrice: v.costPrice, sellPrice: v.sellPrice, attributes }
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Products() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)
  const [importResult, setImportResult] = useState<{ created: number; skipped: number; errors: { row: number; reason: string }[] } | null>(null)
  const [labelCopies, setLabelCopies] = useState(1)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.post<{ data: { created: number; skipped: number; errors: { row: number; reason: string }[] } }>('/products/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return res.data.data
    },
    onSuccess: (result) => {
      setImportResult(result)
      qc.invalidateQueries({ queryKey: ['products'] })
      toast.success(`تم استيراد ${result.created} منتج`)
    },
    onError: () => toast.error('فشل الاستيراد'),
  })

  const downloadSampleCsv = () => {
    const csv = 'name,sku,sell_price,cost_price,barcode,unit,category,quantity,branch_id\nمنتج تجريبي,SKU001,100,70,,piece,,0,'
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'sample-products.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const { data, isLoading } = useQuery<{ data: Product[]; meta: PaginationMeta }>({
    queryKey: ['products', search, page],
    queryFn: async () => (await api.get<{ data: Product[]; meta: PaginationMeta }>('/products', { params: { search, limit: LIMIT, page } })).data,
  })

  const products = data?.data ?? []
  const meta = data?.meta

  const selection = useSelection(products.map((p) => p.id))

  const bulkDelete = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => api.delete(`/products/${id}`)))
    },
    onSuccess: (_, ids) => {
      toast.success(`تم حذف ${ids.length} منتج`)
      selection.clear()
      qc.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'فشل الحذف الجماعي')),
  })

  const bulkExport = async () => {
    const selected = products.filter((p) => selection.isSelected(p.id))
    await exportRowsToExcel(
      selected,
      [
        { header: 'الاسم', accessor: 'name', width: 28 },
        { header: 'الفئة', accessor: (p) => p.category?.name ?? '', width: 16 },
        { header: 'الوحدة', accessor: 'unit', width: 10 },
        { header: 'متغيرات', accessor: (p) => p.variants.length, width: 10 },
        { header: 'SKU الأول', accessor: (p) => p.variants[0]?.sku ?? '', width: 18 },
        { header: 'السعر الأدنى', accessor: (p) => Math.min(...p.variants.map((v) => Number(v.sellPrice))), width: 14 },
        { header: 'نشط', accessor: (p) => (p.isActive ? 'نعم' : 'لا'), width: 8 },
      ],
      `products-${selected.length}.xlsx`,
      'المنتجات',
    )
  }

  const bulkPrintLabels = () => {
    const labels = products
      .filter((p) => selection.isSelected(p.id))
      .flatMap((p) => p.variants.map((v) => ({
        name: p.name,
        sku: v.sku ?? '',
        barcode: v.barcode ?? v.sku ?? '',
        price: Number(v.sellPrice),
      })))
    printBarcodeLabels(labels, labelCopies)
  }

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['product-categories'],
    queryFn: async () => (await api.get<{ data: Category[] }>('/products/categories')).data.data,
  })

  const { data: taxRates = [] } = useQuery<TaxRate[]>({
    queryKey: ['tax-rates'],
    queryFn: async () => (await api.get<{ data: TaxRate[] }>('/products/tax-rates')).data.data,
  })

  const openDetail = async (p: Product) => {
    const res = await api.get<{ data: Product }>(`/products/${p.id}`)
    setDetailProduct(res.data.data)
  }

  return (
    <AppShell title="المنتجات">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <div className="flex-1 max-w-xs">
            <Input
              placeholder="بحث بالاسم..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              startIcon={<Search className="w-4 h-4" />}
            />
          </div>
          <Button variant="outline" size="sm" onClick={downloadSampleCsv}><Download className="w-4 h-4" />نموذج CSV</Button>
          <Button
            variant="outline" size="sm"
            onClick={() => fileInputRef.current?.click()}
            loading={importMutation.isPending}
          >
            <Upload className="w-4 h-4" />استيراد CSV
          </Button>
          <input
            ref={fileInputRef} type="file" accept=".csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { importMutation.mutate(f); e.target.value = '' } }}
          />
          <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />منتج جديد</Button>
        </div>

        {isLoading ? <SkeletonTable rows={8} cols={6} /> : (
          <>
            <Table
              selection={{
                isSelected: (p) => selection.isSelected(p.id),
                onToggle: (p) => selection.toggle(p.id),
                onToggleAll: selection.toggleAllVisible,
                allSelected: selection.allVisibleSelected,
                someSelected: selection.someVisibleSelected,
              }}
              columns={[
                { key: 'name', header: 'المنتج', render: (p) => (
                  <div>
                    <button className="font-medium text-gray-100 hover:text-brand-400 text-right" onClick={() => openDetail(p)}>{p.name}</button>
                    {p.category && <p className="text-xs text-gray-500 mt-0.5">{p.category.name}</p>}
                  </div>
                )},
                { key: 'variants', header: 'المتغيرات', render: (p) => (
                  p.hasVariants
                    ? <Badge variant="info">{p.variants.length} متغير</Badge>
                    : <span className="num-code text-sm">{p.variants[0]?.sku ?? '—'}</span>
                )},
                { key: 'price', header: 'سعر البيع', render: (p) => {
                  const prices = p.variants.map((v) => Number(v.sellPrice))
                  if (prices.length === 0) return <span className="text-gray-500">—</span>
                  const min = Math.min(...prices)
                  const max = Math.max(...prices)
                  return min === max
                    ? <Money value={min} />
                    : <span className="text-sm text-gray-300"><Money value={min} /> – <Money value={max} /></span>
                }},
                { key: 'stock', header: 'نشط/إجمالي', render: (p) => {
                  const active = p.variants.filter((v) => v.isActive).length
                  const total = p.variants.length
                  return <span className="font-numeric num num-strong">{active}/{total}</span>
                }},
                { key: 'unit', header: 'الوحدة', render: (p) => <span className="text-gray-500 text-sm">{unitLabels[p.unit] ?? p.unit}</span> },
                { key: 'isActive', header: 'الحالة', render: (p) => <Badge variant={p.isActive ? 'success' : 'gray'} dot>{p.isActive ? 'نشط' : 'معطّل'}</Badge> },
                { key: 'actions', header: '', render: (p) => (
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openDetail(p) }}>
                    <Edit2 className="w-3 h-3" />
                  </Button>
                )},
              ]}
              data={products} keyExtractor={(p) => p.id} emptyMessage="لا توجد منتجات" emptyIcon={<Package className="w-8 h-8" />} emptyDescription="أضف أول منتج لتبدأ البيع"
            />
            {meta && <Pagination page={meta.page} pages={meta.pages} total={meta.total} limit={meta.limit} onPage={setPage} />}
          </>
        )}
      </div>

      <CreateProductDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        categories={categories}
        taxRates={taxRates}
        onSuccess={() => { qc.invalidateQueries({ queryKey: ['products'] }); setCreateOpen(false) }}
      />

      <ProductDetailDrawer
        product={detailProduct}
        onClose={() => setDetailProduct(null)}
        categories={categories}
        taxRates={taxRates}
        onSuccess={(updated) => {
          qc.invalidateQueries({ queryKey: ['products'] })
          setDetailProduct(updated)
        }}
      />

      {importResult && (
        <Modal open title="نتيجة الاستيراد" onClose={() => setImportResult(null)}>
          <div className="space-y-4">
            <div className="flex gap-6 text-center">
              <div className="flex-1 bg-success-50 border border-success-500/30 rounded-lg p-4">
                <p className="text-2xl font-bold text-success-600">{importResult.created}</p>
                <p className="text-sm text-gray-400 mt-1">تم إنشاؤه</p>
              </div>
              <div className="flex-1 bg-warning-50 border border-warning-500/30 rounded-lg p-4">
                <p className="text-2xl font-bold text-warning-600">{importResult.skipped}</p>
                <p className="text-sm text-gray-400 mt-1">تم تخطيه</p>
              </div>
              {importResult.errors.length > 0 && (
                <div className="flex-1 bg-danger-50 border border-danger-500/30 rounded-lg p-4">
                  <p className="text-2xl font-bold text-danger-600">{importResult.errors.length}</p>
                  <p className="text-sm text-gray-400 mt-1">أخطاء</p>
                </div>
              )}
            </div>
            {importResult.errors.length > 0 && (
              <div className="max-h-48 overflow-y-auto space-y-1">
                <p className="text-sm font-medium text-gray-300 mb-2">تفاصيل الأخطاء:</p>
                {importResult.errors.map((e) => (
                  <div key={e.row} className="text-xs text-danger-600 bg-danger-50 rounded px-3 py-1.5">
                    صف {e.row}: {e.reason}
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={() => setImportResult(null)}>إغلاق</Button>
            </div>
          </div>
        </Modal>
      )}
      <BulkActionBar count={selection.count} onClear={selection.clear}>
        <Button variant="outline" size="sm" onClick={bulkExport}>
          <Download className="w-4 h-4" />تصدير
        </Button>
        <div className="flex items-center gap-1.5">
          <input
            type="number" min={1} max={50} value={labelCopies}
            onChange={(e) => setLabelCopies(Math.max(1, Number(e.target.value)))}
            className="w-14 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 text-center"
            aria-label="عدد النسخ"
          />
          <Button variant="outline" size="sm" onClick={bulkPrintLabels}>
            <Barcode className="w-4 h-4" />طباعة ملصقات
          </Button>
        </div>
        <Button
          variant="danger" size="sm"
          loading={bulkDelete.isPending}
          onClick={() => setBulkDeleteConfirm(true)}
        >
          <Trash2 className="w-4 h-4" />حذف
        </Button>
      </BulkActionBar>
      <ConfirmDialog
        open={bulkDeleteConfirm}
        title="تأكيد الحذف"
        message={`هل تريد حذف ${selection.count} منتج؟ لا يمكن التراجع.`}
        confirmLabel="حذف"
        onConfirm={() => { setBulkDeleteConfirm(false); bulkDelete.mutate(selection.ids) }}
        onCancel={() => setBulkDeleteConfirm(false)}
      />
    </AppShell>
  )
}

// ─── Create product drawer ────────────────────────────────────────────────────
function CreateProductDrawer({ open, onClose, categories, taxRates, onSuccess }: {
  open: boolean
  onClose: () => void
  categories: Category[]
  taxRates: TaxRate[]
  onSuccess: () => void
}) {
  const { register, handleSubmit, control, watch, reset, formState: { errors } } = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: { unit: 'piece', hasVariants: false, variants: [{ costPrice: 0, sellPrice: 0 }] },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'variants' })
  const hasVariants = watch('hasVariants')

  const { mutate: create, isPending } = useMutation({
    mutationFn: async (data: CreateFormData) => api.post('/products', {
      name: data.name,
      description: data.description || undefined,
      unit: data.unit,
      categoryId: data.categoryId || undefined,
      taxRateId: data.taxRateId || undefined,
      hasVariants: data.hasVariants,
      variants: data.variants.map(buildVariantPayload),
    }),
    onSuccess: () => { toast.success('تم إنشاء المنتج'); reset(); onSuccess() },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err)),
  })

  return (
    <Drawer open={open} onClose={onClose} title="منتج جديد" width="w-[560px]"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button loading={isPending} onClick={handleSubmit((d) => create(d))}>حفظ</Button>
        </>
      }
    >
      <form className="flex flex-col gap-5">
        {/* Product info */}
        <Input label="اسم المنتج" error={errors.name?.message} {...register('name')} />
        <div>
          <label className="text-sm text-gray-400 block mb-1">الوصف (اختياري)</label>
          <textarea {...register('description')} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)] resize-none" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Select label="الوحدة" {...register('unit')}>
            <option value="piece">قطعة</option>
            <option value="kg">كيلوجرام</option>
            <option value="liter">لتر</option>
            <option value="box">صندوق</option>
          </Select>
          <Select label="الفئة (اختياري)" {...register('categoryId')}>
            <option value="">بدون فئة</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>

        <Select label="معدل الضريبة (اختياري)" {...register('taxRateId')}>
          <option value="">بدون ضريبة</option>
          {taxRates.map((t) => <option key={t.id} value={t.id}>{t.name} ({Number(t.rate)}%)</option>)}
        </Select>

        <label className="flex items-center gap-3 text-sm text-gray-300 cursor-pointer select-none">
          <input type="checkbox" {...register('hasVariants')} className="w-4 h-4 accent-brand-500" />
          منتج متعدد المتغيرات (مقاسات، ألوان...)
        </label>

        {/* Variants */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-300">{hasVariants ? 'المتغيرات' : 'بيانات المنتج'}</span>
            {hasVariants && (
              <Button type="button" variant="ghost" size="sm" onClick={() => append({ costPrice: 0, sellPrice: 0 })}>
                <PlusCircle className="w-3 h-3" />إضافة متغير
              </Button>
            )}
          </div>
          {fields.map((field, idx) => (
            <div key={field.id} className="bg-gray-750 border border-gray-700 rounded-md p-3 flex flex-col gap-3">
              {hasVariants && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">متغير {idx + 1}</span>
                  {fields.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" className="text-danger-500 text-xs" onClick={() => remove(idx)}>حذف</Button>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Input label="SKU" placeholder="اختياري" {...register(`variants.${idx}.sku`)} />
                <Input label="باركود" placeholder="اختياري" {...register(`variants.${idx}.barcode`)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="سعر التكلفة (ج)"
                  type="number" step="0.01"
                  error={(errors.variants?.[idx]?.costPrice as { message?: string } | undefined)?.message}
                  {...register(`variants.${idx}.costPrice`)}
                />
                <Input
                  label="سعر البيع (ج)"
                  type="number" step="0.01"
                  error={(errors.variants?.[idx]?.sellPrice as { message?: string } | undefined)?.message}
                  {...register(`variants.${idx}.sellPrice`)}
                />
              </div>
              {hasVariants && (
                <div className="grid grid-cols-2 gap-3">
                  <Input label="خاصية (مثال: اللون)" placeholder="اختياري" {...register(`variants.${idx}.attrKey`)} />
                  <Input label="القيمة (مثال: أحمر)" placeholder="اختياري" {...register(`variants.${idx}.attrValue`)} />
                </div>
              )}
            </div>
          ))}
        </div>
      </form>
    </Drawer>
  )
}

// ─── Product detail / edit drawer ─────────────────────────────────────────────
// ─── Product discounts sub-section ────────────────────────────────────────────
function ProductDiscountsSection({ productId }: { productId: string }) {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage')
  const [discountValue, setDiscountValue] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const { data: discounts = [], isLoading } = useQuery<ProductDiscount[]>({
    queryKey: ['product-discounts', productId],
    queryFn: async () => (await api.get<{ data: ProductDiscount[] }>('/products/discounts', { params: { productId } })).data.data,
  })

  // The query already filters by productId server-side.
  const activeDiscounts = discounts

  const { mutate: addDiscount, isPending: adding } = useMutation({
    mutationFn: async () => {
      if (!discountValue || !startDate || !endDate) throw new Error('جميع الحقول مطلوبة')
      await api.post(`/products/${productId}/discounts`, { discountType, discountValue: Number(discountValue), startDate, endDate })
    },
    onSuccess: () => {
      toast.success('تم إضافة الخصم')
      qc.invalidateQueries({ queryKey: ['product-discounts', productId] })
      setShowForm(false)
      setDiscountValue('')
      setStartDate('')
      setEndDate('')
    },
    onError: (e: unknown) => toast.error((e as Error).message === 'جميع الحقول مطلوبة' ? (e as Error).message : 'حدث خطأ'),
  })

  const { mutate: removeDiscount } = useMutation({
    mutationFn: async (id: string) => api.delete(`/products/discounts/${id}`),
    onSuccess: () => { toast.success('تم حذف الخصم'); qc.invalidateQueries({ queryKey: ['product-discounts', productId] }) },
    onError: () => toast.error('حدث خطأ'),
  })

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-1.5"><Tag className="w-4 h-4 text-brand-400" />خصومات المنتج</h4>
        <Button variant="ghost" size="sm" onClick={() => setShowForm(!showForm)}>
          <PlusCircle className="w-3 h-3" />إضافة خصم
        </Button>
      </div>

      {showForm && (
        <div className="bg-gray-750 border border-gray-700 rounded-md p-3 mb-3 flex flex-col gap-3">
          <div className="flex gap-2">
            <Select value={discountType} onChange={(e) => setDiscountType(e.target.value as 'percentage' | 'fixed')}>
              <option value="percentage">نسبة %</option>
              <option value="fixed">مبلغ ثابت ج</option>
            </Select>
            <input type="number" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} placeholder="القيمة" className="flex-1 bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-brand-500" />
          </div>
          <div className="flex gap-2">
            <input type="date" value={startDate} min={today} onChange={(e) => setStartDate(e.target.value)} className="flex-1 bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-brand-500" />
            <span className="text-gray-500 self-center">—</span>
            <input type="date" value={endDate} min={startDate || today} onChange={(e) => setEndDate(e.target.value)} className="flex-1 bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-brand-500" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => setShowForm(false)}>إلغاء</Button>
            <Button size="sm" className="flex-1" loading={adding} onClick={() => addDiscount()}>حفظ</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="h-8 bg-gray-700 rounded animate-pulse" />
      ) : activeDiscounts.length === 0 ? (
        <p className="text-xs text-gray-500 py-2">لا توجد خصومات مجدولة</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {activeDiscounts.map((d) => {
            const isLive = d.startDate <= today && d.endDate >= today
            const isPast = d.endDate < today
            return (
              <div key={d.id} className="flex items-center justify-between text-sm bg-gray-800 rounded-md px-3 py-2">
                <div>
                  <span className={`font-mono font-semibold ${isLive ? 'text-success-600' : isPast ? 'text-gray-500' : 'text-brand-400'}`}>
                    {d.discountType === 'percentage' ? `${Number(d.discountValue)}%` : `${Number(d.discountValue)} ج`}
                  </span>
                  <span className="text-gray-500 text-xs mr-2">
                    {formatDate(d.startDate)} — {formatDate(d.endDate)}
                  </span>
                  {isLive && <span className="text-xs text-success-500 font-medium mr-1">● نشط</span>}
                  {isPast && <span className="text-xs text-gray-500 mr-1">منتهي</span>}
                </div>
                <Button variant="ghost" size="sm" className="text-danger-500" onClick={() => removeDiscount(d.id)}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ProductDetailDrawer({ product, onClose, categories, taxRates, onSuccess }: {
  product: Product | null
  onClose: () => void
  categories: Category[]
  taxRates: TaxRate[]
  onSuccess: (updated: Product) => void
}) {
  const qc = useQueryClient()
  const [editMode, setEditMode] = useState(false)
  const [addVariantOpen, setAddVariantOpen] = useState(false)
  const [editVariant, setEditVariant] = useState<ProductVariant | null>(null)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<EditProductData>({
    resolver: zodResolver(editProductSchema),
  })

  const { mutate: saveProduct, isPending: isSavingProduct } = useMutation({
    mutationFn: async (data: EditProductData) => {
      if (!product) return
      const res = await api.patch<{ data: Product }>(`/products/${product.id}`, {
        name: data.name,
        description: data.description || null,
        unit: data.unit,
        categoryId: data.categoryId || null,
        taxRateId: data.taxRateId || null,
        isActive: data.isActive,
      })
      return res.data.data
    },
    onSuccess: async () => {
      toast.success('تم تحديث المنتج')
      qc.invalidateQueries({ queryKey: ['products'] })
      const res = await api.get<{ data: Product }>(`/products/${product!.id}`)
      onSuccess(res.data.data)
      setEditMode(false)
    },
    onError: () => toast.error('حدث خطأ'),
  })

  const { mutate: toggleActive } = useMutation({
    mutationFn: async (v: ProductVariant) => api.patch(`/products/${product!.id}/variants/${v.id}`, { isActive: !v.isActive }),
    onSuccess: async () => {
      const res = await api.get<{ data: Product }>(`/products/${product!.id}`)
      onSuccess(res.data.data)
    },
    onError: () => toast.error('حدث خطأ'),
  })

  const openEdit = () => {
    if (!product) return
    reset({
      name: product.name,
      description: product.description ?? '',
      unit: product.unit as EditProductData['unit'],
      categoryId: product.category?.id ?? '',
      taxRateId: product.taxRate?.id ?? '',
      isActive: product.isActive,
    })
    setEditMode(true)
  }

  if (!product) return null

  return (
    <>
      <Drawer
        open={!!product}
        onClose={() => { onClose(); setEditMode(false) }}
        title={editMode ? `تعديل: ${product.name}` : product.name}
        width="w-[560px]"
        footer={editMode ? (
          <>
            <Button variant="secondary" onClick={() => setEditMode(false)}>إلغاء</Button>
            <Button loading={isSavingProduct} onClick={handleSubmit((d) => saveProduct(d))}>حفظ</Button>
          </>
        ) : (
          <Button variant="ghost" onClick={openEdit}><Edit2 className="w-3 h-3" />تعديل بيانات المنتج</Button>
        )}
      >
        {editMode ? (
          <form className="flex flex-col gap-5">
            <Input label="اسم المنتج" error={errors.name?.message} {...register('name')} />
            <div>
              <label className="text-sm text-gray-400 block mb-1">الوصف</label>
              <textarea {...register('description')} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)] resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Select label="الوحدة" {...register('unit')}>
                <option value="piece">قطعة</option>
                <option value="kg">كيلوجرام</option>
                <option value="liter">لتر</option>
                <option value="box">صندوق</option>
              </Select>
              <Select label="الفئة" {...register('categoryId')}>
                <option value="">بدون فئة</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <Select label="معدل الضريبة" {...register('taxRateId')}>
              <option value="">بدون ضريبة</option>
              {taxRates.map((t) => <option key={t.id} value={t.id}>{t.name} ({Number(t.rate)}%)</option>)}
            </Select>
            <label className="flex items-center gap-3 text-sm text-gray-300 cursor-pointer">
              <input type="checkbox" {...register('isActive')} className="w-4 h-4 accent-brand-500" />
              منتج نشط
            </label>
          </form>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Product summary */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">الفئة</span><p className="text-gray-100">{product.category?.name ?? '—'}</p></div>
              <div><span className="text-gray-500">الوحدة</span><p className="text-gray-100">{unitLabels[product.unit] ?? product.unit}</p></div>
              <div><span className="text-gray-500">الضريبة</span><p className="text-gray-100">{product.taxRate ? `${product.taxRate.name} (${Number(product.taxRate.rate)}%)` : '—'}</p></div>
              <div><span className="text-gray-500">الحالة</span><p><Badge variant={product.isActive ? 'success' : 'gray'} dot>{product.isActive ? 'نشط' : 'معطّل'}</Badge></p></div>
              {product.description && (
                <div className="col-span-2"><span className="text-gray-500">الوصف</span><p className="text-gray-300 text-sm">{product.description}</p></div>
              )}
            </div>

            {/* Variants */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-gray-300">المتغيرات ({product.variants.length})</h4>
                <Button variant="ghost" size="sm" onClick={() => setAddVariantOpen(true)}>
                  <PlusCircle className="w-3 h-3" />إضافة متغير
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                {product.variants.map((v) => (
                  <VariantRow
                    key={v.id}
                    variant={v}
                    onToggleActive={() => toggleActive(v)}
                    onEdit={() => setEditVariant(v)}
                  />
                ))}
                {product.variants.length === 0 && (
                  <p className="text-gray-500 text-sm">لا توجد متغيرات</p>
                )}
              </div>
            </div>

            {/* Discounts */}
            <ProductDiscountsSection productId={product.id} />
          </div>
        )}
      </Drawer>

      <AddVariantModal
        open={addVariantOpen}
        productId={product.id}
        hasVariants={product.hasVariants}
        onClose={() => setAddVariantOpen(false)}
        onSuccess={async () => {
          const res = await api.get<{ data: Product }>(`/products/${product.id}`)
          onSuccess(res.data.data)
          setAddVariantOpen(false)
        }}
      />

      <EditVariantModal
        variant={editVariant}
        productId={product.id}
        onClose={() => setEditVariant(null)}
        onSuccess={async () => {
          const res = await api.get<{ data: Product }>(`/products/${product.id}`)
          onSuccess(res.data.data)
          setEditVariant(null)
        }}
      />
    </>
  )
}

// ─── Variant row ──────────────────────────────────────────────────────────────
function VariantRow({ variant, onToggleActive, onEdit }: {
  variant: ProductVariant
  onToggleActive: () => void
  onEdit: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const attrEntries = Object.entries(variant.attributes ?? {})

  return (
    <div className={`bg-gray-750 border rounded-md ${variant.isActive ? 'border-gray-700' : 'border-gray-700/50 opacity-60'}`}>
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-gray-300">{variant.sku || '—'}</span>
          {attrEntries.length > 0 && attrEntries.map(([k, v]) => (
            <Badge key={k} variant="gray">{k}: {v}</Badge>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-gray-100"><Money value={Number(variant.sellPrice)} /></span>
          <button onClick={() => setExpanded((e) => !e)} className="text-gray-500 hover:text-gray-300">
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          <Button variant="ghost" size="sm" onClick={onEdit}><Edit2 className="w-3 h-3" /></Button>
          <button onClick={onToggleActive} className="text-gray-400 hover:text-gray-200">
            {variant.isActive ? <ToggleRight className="w-4 h-4 text-success-500" /> : <ToggleLeft className="w-4 h-4 text-gray-500" />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-3 grid grid-cols-3 gap-3 text-xs border-t border-gray-700 pt-2">
          {variant.barcode && <div><span className="text-gray-500">باركود</span><p className="num-code">{variant.barcode}</p></div>}
          <div><span className="text-gray-500">سعر التكلفة</span><p><Money value={Number(variant.costPrice)} /></p></div>
          <div><span className="text-gray-500">سعر البيع</span><p><Money value={Number(variant.sellPrice)} /></p></div>
        </div>
      )}
    </div>
  )
}

// ─── Add variant modal ────────────────────────────────────────────────────────
function AddVariantModal({ open, productId, hasVariants, onClose, onSuccess }: {
  open: boolean
  productId: string
  hasVariants: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<VariantFormData>({
    resolver: zodResolver(variantFormSchema),
    defaultValues: { costPrice: 0, sellPrice: 0 },
  })

  const { mutate: addVariant, isPending } = useMutation({
    mutationFn: async (data: VariantFormData) =>
      api.post(`/products/${productId}/variants`, buildVariantPayload(data)),
    onSuccess: () => { toast.success('تم إضافة المتغير'); reset(); onSuccess() },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err)),
  })

  return (
    <Modal open={open} onClose={onClose} title="إضافة متغير جديد"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button loading={isPending} onClick={handleSubmit((d) => addVariant(d))}>إضافة</Button>
        </>
      }
    >
      <form className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="SKU" placeholder="اختياري" {...register('sku')} />
          <Input label="باركود" placeholder="اختياري" {...register('barcode')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="سعر التكلفة (ج)" type="number" step="0.01" error={errors.costPrice?.message} {...register('costPrice')} />
          <Input label="سعر البيع (ج)" type="number" step="0.01" error={errors.sellPrice?.message} {...register('sellPrice')} />
        </div>
        {hasVariants && (
          <div className="grid grid-cols-2 gap-3">
            <Input label="خاصية (مثال: اللون)" placeholder="اختياري" {...register('attrKey')} />
            <Input label="القيمة (مثال: أحمر)" placeholder="اختياري" {...register('attrValue')} />
          </div>
        )}
      </form>
    </Modal>
  )
}

// ─── Edit variant modal ───────────────────────────────────────────────────────
function EditVariantModal({ variant, productId, onClose, onSuccess }: {
  variant: ProductVariant | null
  productId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<VariantFormData>({ resolver: zodResolver(variantFormSchema) })

  useEffect(() => {
    if (variant) {
      const firstAttr = Object.entries(variant.attributes ?? {})[0]
      reset({
        sku: variant.sku ?? '',
        barcode: variant.barcode ?? '',
        costPrice: Number(variant.costPrice),
        sellPrice: Number(variant.sellPrice),
        attrKey: firstAttr?.[0] ?? '',
        attrValue: firstAttr?.[1] ?? '',
      })
    }
  }, [variant, reset])

  const { mutate: editVariant, isPending } = useMutation({
    mutationFn: async (data: VariantFormData) => {
      if (!variant) return
      return api.patch(`/products/${productId}/variants/${variant.id}`, {
        sku: data.sku || undefined,
        barcode: data.barcode || undefined,
        costPrice: data.costPrice,
        sellPrice: data.sellPrice,
        attributes: data.attrKey && data.attrValue ? { [data.attrKey]: data.attrValue } : undefined,
      })
    },
    onSuccess: () => { toast.success('تم تحديث المتغير'); onSuccess() },
    onError: () => toast.error('حدث خطأ'),
  })

  if (!variant) return null

  return (
    <Modal open={!!variant} onClose={onClose} title={`تعديل المتغير: ${variant.sku || 'بدون SKU'}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button loading={isPending} onClick={handleSubmit((d) => editVariant(d))}>حفظ</Button>
        </>
      }
    >
      <form className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="SKU" {...register('sku')} />
          <Input label="باركود" {...register('barcode')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="سعر التكلفة (ج)" type="number" step="0.01" error={errors.costPrice?.message} {...register('costPrice')} />
          <Input label="سعر البيع (ج)" type="number" step="0.01" error={errors.sellPrice?.message} {...register('sellPrice')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="خاصية" placeholder="اختياري" {...register('attrKey')} />
          <Input label="القيمة" placeholder="اختياري" {...register('attrValue')} />
        </div>
      </form>
    </Modal>
  )
}
