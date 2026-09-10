import {
  Button,
  Input,
  Badge,
  Card,
  StatCard,
  Money,
  Skeleton,
  Alert,
  Table,
} from '@/components/ui'
import { Package, TrendingUp } from 'lucide-react'

const sampleData = [
  { id: '1', name: 'تيشيرت قطن', sku: 'TS-001', price: 150, qty: 24 },
  { id: '2', name: 'بنطلون جينز', sku: 'JN-002', price: 350, qty: 0 },
  { id: '3', name: 'حذاء رياضي', sku: 'SH-003', price: 890, qty: 5 },
]

export default function ComponentsShowcase() {
  return (
    <div className="min-h-dvh bg-app p-8 flex flex-col gap-12 max-w-5xl mx-auto">
      <h1 className="font-display text-4xl font-bold text-brand-400">مكتبة المكونات — حِسبة</h1>

      {/* Buttons */}
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold text-gray-200">الأزرار</h2>
        <div className="flex flex-wrap gap-3">
          {(['primary', 'secondary', 'outline', 'ghost', 'danger', 'success'] as const).map((v) => (
            <Button key={v} variant={v}>{v}</Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((s) => (
            <Button key={s} size={s}>حجم {s}</Button>
          ))}
        </div>
        <div className="flex gap-3">
          <Button loading>جاري التحميل</Button>
          <Button disabled>معطّل</Button>
        </div>
      </section>

      {/* Badges */}
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold text-gray-200">الشارات</h2>
        <div className="flex flex-wrap gap-3">
          <Badge variant="brand" dot>باقة Pro</Badge>
          <Badge variant="success" dot>مكتمل</Badge>
          <Badge variant="warning" dot>انتظار موافقة</Badge>
          <Badge variant="danger" dot>نفذ المخزون</Badge>
          <Badge variant="info" dot>تمويل خارجي</Badge>
          <Badge variant="gray" dot>معطّل</Badge>
        </div>
        <div className="flex flex-wrap gap-3">
          <Badge variant="success" icon={<Package className="w-3 h-3" />}>مع أيقونة</Badge>
          <Badge variant="warning" icon={<TrendingUp className="w-3 h-3" />}>مع أيقونة</Badge>
        </div>
      </section>

      {/* Input */}
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold text-gray-200">حقول الإدخال</h2>
        <div className="grid grid-cols-2 gap-4">
          <Input label="الاسم" placeholder="أدخل الاسم" />
          <Input label="مع خطأ" placeholder="أدخل القيمة" error="هذا الحقل مطلوب" />
          <Input label="مع تلميح" placeholder="اسم المتجر" hint="my-store.hesbaapp.com" />
          <Input label="معطّل" placeholder="لا يمكن التعديل" disabled />
        </div>
      </section>

      {/* Money */}
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold text-gray-200">عرض المبالغ</h2>
        <div className="flex gap-6 items-baseline">
          <Money value={1250} size="xl" />
          <Money value={99.5} size="lg" />
          <Money value={0} size="base" />
          <Money value={-150} size="sm" />
        </div>
      </section>

      {/* Cards */}
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold text-gray-200">البطاقات</h2>
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            label="مبيعات اليوم"
            value="12,500 ج"
            change={{ value: '8.2%', positive: true }}
            accentColor="bg-brand-500"
          />
          <StatCard
            label="أقساط معلقة"
            value="7"
            change={{ value: '2 جديد', positive: false }}
            accentColor="bg-warning-500"
          />
          <StatCard
            label="منتجات نفذت"
            value="3"
            accentColor="bg-danger-500"
          />
          <StatCard
            label="إجمالي الإيرادات"
            value="89,200 ج"
            change={{ value: '12.1%', positive: true }}
            accentColor="bg-success-500"
          />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Card>بطاقة افتراضية</Card>
          <Card variant="elevated">بطاقة مرتفعة</Card>
          <Card variant="brand">بطاقة العلامة</Card>
        </div>
      </section>

      {/* Alerts */}
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold text-gray-200">التنبيهات</h2>
        <Alert variant="success" title="تمت العملية">تم حفظ البيانات بنجاح.</Alert>
        <Alert variant="warning" title="تنبيه">المخزون منخفض لـ 3 منتجات.</Alert>
        <Alert variant="danger" title="خطأ" onDismiss={() => {}}>فشل إرسال الفاتورة للضريبة.</Alert>
        <Alert variant="info">الاشتراك ينتهي خلال 7 أيام.</Alert>
      </section>

      {/* Skeleton */}
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold text-gray-200">هيكل التحميل</h2>
        <div className="flex gap-4">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-8 w-24" />
        </div>
      </section>

      {/* Table */}
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold text-gray-200">الجداول</h2>
        <Table
          columns={[
            { key: 'name', header: 'المنتج' },
            { key: 'sku', header: 'الكود', className: 'font-mono text-gray-500' },
            {
              key: 'price',
              header: 'السعر',
              render: (row) => <Money value={row.price} />,
            },
            {
              key: 'qty',
              header: 'الكمية',
              render: (row) => (
                <span
                  className={
                    row.qty === 0
                      ? 'text-danger-600 font-bold'
                      : row.qty <= 5
                      ? 'text-warning-600'
                      : 'text-success-600'
                  }
                >
                  {row.qty}
                </span>
              ),
            },
          ]}
          data={sampleData}
          keyExtractor={(r) => r.id}
        />
      </section>
    </div>
  )
}
