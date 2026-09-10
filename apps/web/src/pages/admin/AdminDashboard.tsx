import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Building2, CreditCard, TrendingUp, Users, AlertTriangle, CheckCircle2, XCircle, Database } from 'lucide-react'
import { AdminShell } from '@/components/admin/AdminShell'
import { StatCard, Card, Skeleton, Alert, Button } from '@/components/ui'
import { adminApi } from '@/api/admin-client'
import { formatMoney, formatNumber } from '@/lib/format'
import { getApiErrorMessage } from '@/lib/api-error'
import toast from 'react-hot-toast'

interface RevenueData {
  mrr: number
  arpu: number
  activePayingSubs: number
  trialingSubs: number
  totalTenants: number
  activeTenants: number
  suspendedTenants: number
  cancelledLast30Days: number
  churnRate: number
  revenueLast30Days: number
  successfulPaymentsLast30Days: number
  failedPaymentsLast30Days: number
}

interface MigrationResult { ok: number; failed: number; errors: Array<{ tenantId: string; err: string }> }

export default function AdminDashboard() {
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'revenue'],
    queryFn: async () => {
      const res = await adminApi.get<{ success: true; data: RevenueData }>('/revenue')
      return res.data.data
    },
  })

  const { mutate: runMigrations, isPending: migratingDb } = useMutation({
    mutationFn: async () => {
      const res = await adminApi.post<{ success: true; data: MigrationResult }>('/run-migrations', {})
      return res.data.data
    },
    onSuccess: (result) => {
      setMigrationResult(result)
      if (result.failed === 0) {
        toast.success(`✅ ${result.ok} متجر — تمت الترقية بنجاح`)
      } else {
        toast.error(`${result.failed} متجر فشل — راجع التفاصيل أدناه`)
      }
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'فشل تشغيل الترقيات')),
  })

  return (
    <AdminShell title="لوحة التحكم">
      {error ? (
        <Alert variant="danger">{getApiErrorMessage(error, 'تعذر تحميل البيانات')}</Alert>
      ) : isLoading || !data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="MRR (شهري متكرر)"
              value={`${formatMoney(data.mrr)} ج.م`}
              accentColor="bg-success-500"
              icon={<TrendingUp className="w-4 h-4" />}
            />
            <StatCard
              label="ARPU (متوسط لكل مشترك)"
              value={`${formatMoney(data.arpu)} ج.م`}
              accentColor="bg-brand-500"
              icon={<CreditCard className="w-4 h-4" />}
            />
            <StatCard
              label="اشتراكات نشطة (دافعة)"
              value={formatNumber(data.activePayingSubs)}
              accentColor="bg-success-500"
              icon={<CheckCircle2 className="w-4 h-4" />}
            />
            <StatCard
              label="اشتراكات تجريبية"
              value={formatNumber(data.trialingSubs)}
              accentColor="bg-warning-500"
              icon={<Users className="w-4 h-4" />}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
            <StatCard
              label="إجمالي المتاجر"
              value={formatNumber(data.totalTenants)}
              icon={<Building2 className="w-4 h-4" />}
            />
            <StatCard
              label="متاجر نشطة"
              value={formatNumber(data.activeTenants)}
              accentColor="bg-success-500"
              icon={<CheckCircle2 className="w-4 h-4" />}
            />
            <StatCard
              label="متاجر معلّقة"
              value={formatNumber(data.suspendedTenants)}
              accentColor="bg-warning-500"
              icon={<AlertTriangle className="w-4 h-4" />}
            />
            <StatCard
              label="إلغاءات آخر 30 يوم"
              value={formatNumber(data.cancelledLast30Days)}
              accentColor="bg-danger-500"
              icon={<XCircle className="w-4 h-4" />}
            />
          </div>

          {/* DB Migrations panel */}
          <div className="mt-6 bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-start gap-4">
            <Database className="w-5 h-5 text-brand-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-gray-100 mb-1">ترقيات قاعدة البيانات (Tenant Migrations)</h3>
              <p className="text-xs text-gray-500 mb-3">تطبيق أي ملفات SQL جديدة على جميع المتاجر — آمن للتشغيل مرات متعددة (idempotent).</p>
              {migrationResult && (
                <div className={`text-xs rounded-lg px-3 py-2 mb-3 ${migrationResult.failed === 0 ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700'}`}>
                  ✅ {migrationResult.ok} متجر نجح · {migrationResult.failed > 0 ? `❌ ${migrationResult.failed} فشل` : '0 فشل'}
                  {migrationResult.errors.map((e) => (
                    <div key={e.tenantId} className="mt-1 text-danger-400 font-mono truncate">{e.tenantId}: {e.err}</div>
                  ))}
                </div>
              )}
              <Button size="sm" loading={migratingDb} onClick={() => runMigrations()}>
                <Database className="w-3 h-3" /> تشغيل الترقيات الآن
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
            <Card>
              <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">إيرادات آخر 30 يوم</h3>
              <p className="font-mono text-3xl font-bold text-success-400">
                {formatMoney(data.revenueLast30Days)} <span className="text-base text-gray-500">ج.م</span>
              </p>
              <p className="text-xs text-gray-500 mt-2">
                {formatNumber(data.successfulPaymentsLast30Days)} عملية ناجحة
              </p>
            </Card>

            <Card>
              <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">معدّل الإلغاء (شهري)</h3>
              <p className="font-mono text-3xl font-bold text-gray-100">
                {(data.churnRate * 100).toFixed(1)}<span className="text-base text-gray-500">%</span>
              </p>
              <p className="text-xs text-gray-500 mt-2">
                {formatNumber(data.cancelledLast30Days)} / {formatNumber(data.activePayingSubs + data.cancelledLast30Days)}
              </p>
            </Card>

            <Card>
              <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">مدفوعات فاشلة آخر 30 يوم</h3>
              <p className="font-mono text-3xl font-bold text-danger-400">
                {formatNumber(data.failedPaymentsLast30Days)}
              </p>
              <p className="text-xs text-gray-500 mt-2">قد تحتاج تدخّل (dunning)</p>
            </Card>
          </div>
        </>
      )}
    </AdminShell>
  )
}
