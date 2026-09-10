import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, ShoppingBag, AlertTriangle, Clock, PackageOpen, FileX, Wrench } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { StatCard, Badge, Alert, Skeleton, Money } from '@/components/ui'
import { UsageBanner } from '@/components/UsageBanner'
import { api } from '@/api/client'
import { cn } from '@/lib/cn'
import { formatNumber, formatDate, formatTime } from '@/lib/format'
import { useFeature } from '@/hooks/useMe'
import { invoiceStatusMap, getStatus } from '@/constants/status'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardData {
  today: {
    revenue: number
    invoiceCount: number
    feeExpenses: number
    servicesRevenue: number
    servicesCount: number
  }
  pending: { installmentApprovals: number; overdueInstallmentPayments: number; expenseApprovals: number }
  lowStockAlerts: number
  etaFailures?: number
}

interface SalesDay { date: string; revenue: number; invoiceCount: number }
interface TopProduct { productName: string; variantSku: string; totalQty: number; totalRevenue: number }

interface RecentInvoice {
  id: string
  invoiceNumber: string
  totalAmount: number
  status: string
  createdAt: string
  customer?: { fullName: string }
  paymentMethod?: { name: string }
}

// ─── Sparkline (inline SVG) ───────────────────────────────────────────────────

function Sparkline({ data }: { data: SalesDay[] }) {
  if (data.length < 2) return null
  const values = data.map((d) => d.revenue)
  const max = Math.max(...values, 1)
  const W = 240
  const H = 48
  const pad = 4

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (W - pad * 2)
    const y = H - pad - ((v / max) * (H - pad * 2))
    return `${x},${y}`
  }).join(' ')

  const area = `M${pad},${H - pad} L${points.split(' ').map((p) => p).join(' L')} L${W - pad},${H - pad} Z`

  const trend = values[values.length - 1] >= values[0] ? 'صاعد' : 'هابط'
  return (
    <svg
      width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="opacity-70"
      role="img"
      aria-label={`مخطط المبيعات خلال ${data.length} أيام — اتجاه ${trend}`}
    >
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1FA971" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#1FA971" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkGrad)" />
      <polyline points={points} fill="none" stroke="#1FA971" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Pending Card ─────────────────────────────────────────────────────────────

function PendingCard({ label, count, icon, onClick }: { label: string; count: number; icon: React.ReactNode; onClick?: () => void }) {
  if (count === 0) return null
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 hover:border-warning-500/50 transition-colors text-right w-full"
    >
      <span className="w-8 h-8 rounded-full bg-warning-500/10 flex items-center justify-center text-warning-500 shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-300">{label}</p>
      </div>
      <span className="font-numeric num num-warn font-bold text-lg">{count}</span>
    </button>
  )
}

// ─── Recent Invoices ──────────────────────────────────────────────────────────

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate()
  const servicesEnabled = useFeature('services')

  const today = new Date()
  const sevenDaysAgo = new Date(today)
  sevenDaysAgo.setDate(today.getDate() - 6)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  const { data, isLoading, error, refetch: refetchDashboard, isFetching: isRefetching } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get<{ data: DashboardData }>('/reports/dashboard')).data.data,
    refetchInterval: 2 * 60 * 1000,
  })

  const { data: salesTrend } = useQuery<SalesDay[]>({
    queryKey: ['sales-trend'],
    queryFn: async () => {
      const res = await api.get<{ data: SalesDay[] }>('/reports/sales', {
        params: { from: fmt(sevenDaysAgo), to: fmt(today), groupBy: 'day' },
      })
      return res.data.data
    },
    refetchInterval: 5 * 60 * 1000,
  })

  const { data: recentInvoices } = useQuery<RecentInvoice[]>({
    queryKey: ['recent-invoices'],
    queryFn: async () => (await api.get<{ data: RecentInvoice[] }>('/invoices', { params: { limit: 6, page: 1 } })).data.data,
    refetchInterval: 60 * 1000,
  })

  const todayStr = new Date().toISOString().slice(0, 10)
  const { data: topProducts } = useQuery<TopProduct[]>({
    queryKey: ['top-products-today'],
    queryFn: async () => (await api.get<{ data: TopProduct[] }>('/reports/top-products', { params: { from: todayStr, to: todayStr, limit: 5 } })).data.data,
    refetchInterval: 5 * 60 * 1000,
  })

  const { data: tenantSettings } = useQuery<{ dailySalesTarget: number }>({
    queryKey: ['tenant-settings'],
    queryFn: async () => (await api.get<{ data: { dailySalesTarget: number } }>('/settings')).data.data,
  })

  const dailyTarget = Number(tenantSettings?.dailySalesTarget ?? 0)
  const todayRevenue = data?.today.revenue ?? 0
  const targetProgress = dailyTarget > 0 ? Math.min(100, (todayRevenue / dailyTarget) * 100) : 0

  const pendingCount =
    (data?.pending.installmentApprovals ?? 0) +
    (data?.pending.overdueInstallmentPayments ?? 0) +
    (data?.pending.expenseApprovals ?? 0)

  return (
    <AppShell title="لوحة التحكم">
      {error && (
        <Alert variant="warning" className="mb-6">
          <div className="flex items-center justify-between gap-4">
            <span>تعذّر تحميل بيانات اللوحة.</span>
            <button
              type="button"
              onClick={() => refetchDashboard()}
              disabled={isRefetching}
              className="text-sm font-medium text-brand-300 hover:text-brand-200 disabled:opacity-50"
            >
              {isRefetching ? 'جارٍ المحاولة…' : 'إعادة المحاولة'}
            </button>
          </div>
        </Alert>
      )}

      <UsageBanner />

      {/* ── KPI Cards ── */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : (
        <div className={cn(
          'grid grid-cols-2 gap-4 mb-6',
          servicesEnabled ? 'md:grid-cols-3 xl:grid-cols-5' : 'md:grid-cols-4',
        )}>
          <StatCard
            label="مبيعات اليوم"
            value={`${formatNumber(data?.today.revenue ?? 0, { maximumFractionDigits: 0 })} ج`}
            accentColor="bg-brand-500"
            icon={<TrendingUp className="w-4 h-4" />}
            onClick={() => navigate(`/invoices?from=${fmt(today)}&to=${fmt(today)}`)}
          />
          <StatCard
            label="فواتير اليوم"
            value={data?.today.invoiceCount ?? 0}
            accentColor="bg-warning-500"
            icon={<ShoppingBag className="w-4 h-4" />}
            onClick={() => navigate(`/invoices?from=${fmt(today)}&to=${fmt(today)}`)}
          />
          {servicesEnabled && (
            <StatCard
              label="خدمات اليوم"
              value={`${formatNumber(data?.today.servicesRevenue ?? 0, { maximumFractionDigits: 0 })} ج`}
              accentColor="bg-cyan-500"
              icon={<Wrench className="w-4 h-4" />}
              onClick={() => navigate('/work-orders')}
            />
          )}
          <StatCard
            label="تنبيهات مخزون"
            value={data?.lowStockAlerts ?? 0}
            accentColor="bg-warning-500"
            icon={<PackageOpen className="w-4 h-4" />}
            onClick={() => navigate('/stock?lowStockOnly=true')}
          />
          <StatCard
            label="موافقات معلقة"
            value={pendingCount}
            accentColor="bg-success-500"
            icon={<Clock className="w-4 h-4" />}
            onClick={pendingCount > 0 ? () => navigate('/installments') : undefined}
          />
        </div>
      )}

      {/* ── Daily target progress ── */}
      {dailyTarget > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-300 font-medium">تقدم هدف اليوم</p>
            <p className="text-xs font-numeric num num-strong">
              {formatNumber(todayRevenue, { maximumFractionDigits: 0 })} / {formatNumber(dailyTarget, { maximumFractionDigits: 0 })} ج
            </p>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
            <div
              className={cn('h-3 rounded-full transition-all duration-500', targetProgress >= 100 ? 'bg-success-500' : targetProgress >= 70 ? 'bg-brand-500' : 'bg-warning-500')}
              style={{ width: `${targetProgress}%` }}
            />
          </div>
          <p className="text-xs font-numeric num num-muted mt-1">{formatNumber(targetProgress, { maximumFractionDigits: 1 })}% من الهدف</p>
        </div>
      )}

      {/* ── ETA alert ── */}
      {(data?.etaFailures ?? 0) > 0 && (
        <Alert variant="danger" title="فشل إرسال ضريبي" className="mb-6">
          <span>{data?.etaFailures} فاتورة فشل إرسالها للضريبة.</span>{' '}
          <Badge variant="danger" dot>يتطلب مراجعة</Badge>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left column: sparkline + pending actions ── */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          {/* 7-day sparkline card */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs uppercase tracking-wider text-gray-500 font-medium">المبيعات — آخر 7 أيام</p>
            </div>
            {salesTrend && salesTrend.length > 0 ? (
              <>
                <Sparkline data={salesTrend} />
                <div className="flex justify-between mt-2">
                  {salesTrend.map((d) => (
                    <div key={d.date} className="text-center">
                      <p className="text-xs text-gray-500">{formatDate(d.date, { weekday: 'narrow' })}</p>
                      <p className="text-xs font-numeric num num-strong">{d.revenue > 0 ? formatNumber(d.revenue / 1000, { maximumFractionDigits: 1 }) + 'k' : '—'}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-16 flex items-center justify-center text-gray-600 text-sm">لا توجد بيانات</div>
            )}
          </div>

          {/* Pending actions */}
          {pendingCount > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-3">إجراءات معلقة</p>
              <div className="flex flex-col gap-2">
                <PendingCard
                  label="موافقات أقساط"
                  count={data?.pending.installmentApprovals ?? 0}
                  icon={<FileX className="w-4 h-4" />}
                  onClick={() => navigate('/installments')}
                />
                <PendingCard
                  label="أقساط متأخرة"
                  count={data?.pending.overdueInstallmentPayments ?? 0}
                  icon={<AlertTriangle className="w-4 h-4" />}
                  onClick={() => navigate('/installments')}
                />
                <PendingCard
                  label="مصاريف تنتظر اعتمادًا"
                  count={data?.pending.expenseApprovals ?? 0}
                  icon={<Clock className="w-4 h-4" />}
                  onClick={() => navigate('/expenses')}
                />
              </div>
            </div>
          )}

          {/* Low stock alert */}
          {(data?.lowStockAlerts ?? 0) > 0 && (
            <button
              onClick={() => navigate('/stock')}
              className="flex items-center gap-3 bg-warning-500/10 border border-warning-500/30 rounded-xl px-4 py-3 hover:border-warning-500 transition-colors text-right w-full"
            >
              <PackageOpen className="w-5 h-5 text-warning-500 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-warning-400">{data?.lowStockAlerts} صنف منخفض المخزون</p>
                <p className="text-xs text-gray-500">اضغط لعرض المخزون المنخفض</p>
              </div>
            </button>
          )}
        </div>

        {/* ── Right column: recent invoices ── */}
        <div className="lg:col-span-2">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs uppercase tracking-wider text-gray-500 font-medium">أحدث الفواتير</p>
              <button onClick={() => navigate('/invoices')} className="text-xs text-brand-400 hover:text-brand-300 transition-colors">
                عرض الكل ←
              </button>
            </div>
            {!recentInvoices ? (
              <div className="flex flex-col gap-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 bg-gray-700 rounded animate-pulse" />)}</div>
            ) : recentInvoices.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-8">لا توجد فواتير اليوم</p>
            ) : (
              <div className="flex flex-col">
                {recentInvoices.map((inv, idx) => {
                  const s = getStatus(invoiceStatusMap, inv.status)
                  return (
                    <div key={inv.id} className={cn('flex items-center justify-between py-3', idx < recentInvoices.length - 1 && 'border-b border-gray-700')}>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-mono num-muted">
                          {inv.invoiceNumber.slice(-2)}
                        </div>
                        <div>
                          <p className="text-sm num-code">{inv.invoiceNumber}</p>
                          <p className="text-xs text-gray-500">
                            {inv.customer?.fullName ?? 'نقدي'}
                            {inv.paymentMethod && <span className="mx-1">·</span>}
                            {inv.paymentMethod?.name}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant={s.variant}>{s.label}</Badge>
                        <Money value={inv.totalAmount} />
                        <span className="text-xs text-gray-600">{formatTime(inv.createdAt)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Today's fee cost banner — only shows if > 0 */}
          {(data?.today.feeExpenses ?? 0) > 0 && (
            <div className="mt-4 bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">رسوم الدفع اليوم (على التاجر)</p>
                <Money value={data!.today.feeExpenses} size="lg" />
              </div>
              <TrendingUp className="w-6 h-6 text-gray-600" />
            </div>
          )}

          {/* Top products today */}
          {topProducts && topProducts.length > 0 && (
            <div className="mt-4 bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs uppercase tracking-wider text-gray-500 font-medium">أكثر المنتجات مبيعاً اليوم</p>
                <button onClick={() => navigate('/reports')} className="text-xs text-brand-400 hover:text-brand-300 transition-colors">التقارير ←</button>
              </div>
              <div className="flex flex-col gap-2">
                {topProducts.map((p, i) => (
                  <div key={p.variantSku} className={cn('flex items-center gap-3 py-2', i < topProducts.length - 1 && 'border-b border-gray-700/50')}>
                    <span className="w-5 text-center font-numeric num num-muted text-xs">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-200 truncate">{p.productName}</p>
                      <p className="text-xs num-code">{p.variantSku}</p>
                    </div>
                    <div className="text-left">
                      <p className="text-xs font-numeric num num-muted">× {p.totalQty}</p>
                      <Money value={p.totalRevenue} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
