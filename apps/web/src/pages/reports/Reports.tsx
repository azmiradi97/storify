import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Filter } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import {
  StatCard, Button, SkeletonTable, Table, Money, Badge,
  ChartCard, AreaChartView, BarChartView, DonutChartView,
  chartPalette, DateRangePicker, Select,
} from '@/components/ui'
import { api } from '@/api/client'
import { downloadFromApi } from '@/lib/download'
import { exportRowsToExcel } from '@/lib/export'
import { formatNumber } from '@/lib/format'
import { useAuthStore } from '@/stores/auth.store'

// ─── Types ────────────────────────────────────────────────────────────────────
interface SalesSummary { totalRevenue: number; subtotal: number; taxTotal: number; discountTotal: number; feeTotal: number; invoiceCount: number }
interface ByPeriod { period: string; revenue: number; count: number }
interface SalesReport { summary: SalesSummary; byPeriod: ByPeriod[] }

interface StockItem { variantId: string; branchId: string; product: { name: string }; branch: { name: string }; sku: string; quantity: number; minQuantity: number; isLowStock: boolean; stockValue: number }
interface StockSummary { totalVariants: number; lowStockCount: number; totalStockValue: number }
interface StockReport { summary: StockSummary; items: StockItem[] }

interface InstallmentSummary { active: number; overdue: number; completed: number; pendingApproval: number; totalReceivables: number }
interface InstallmentReport { summary: InstallmentSummary }

interface PnLReport {
  revenue: number
  invoiceRevenue: number
  servicesRevenue: number
  cogs: number
  grossProfit: number
  grossMargin: number
  operatingExpenses: number
  netProfit: number
  netMargin: number
}

interface FeeSummary { totalMerchantFees: number; totalCustomerFees: number; totalFees: number }
interface FeeByPM { paymentMethod: { id: string; name?: string; type?: string }; feeBearer: string; totalFees: number; count: number }
interface FeesReport { summary: FeeSummary; byPaymentMethod: FeeByPM[] }

interface TopProduct { productName: string; variantSku: string; totalQty: number; totalRevenue: number }

interface ReturnsSummary {
  totalAmount: number
  totalCount: number
  refundAmount: number
  refundCount: number
  creditAmount: number
  creditCount: number
}
interface ReturnPeriod { period: string; amount: number; count: number }
interface ReturnReason { reason: string; count: number; amount: number }
interface ReturnTopItem { variantId: string; sku: string; productName: string; totalReturnedQty: number; occurrences: number }
interface ReturnsReport {
  summary: ReturnsSummary
  byPeriod: ReturnPeriod[]
  topReasons: ReturnReason[]
  topItems: ReturnTopItem[]
}

interface Branch { id: string; name: string }

// ─── Date helpers ─────────────────────────────────────────────────────────────
function today() { return new Date().toISOString().slice(0, 10) }
function monthStart() { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10) }

// ─── Number formatters ───────────────────────────────────────────────────────
function formatCurrency(v: number) {
  if (Math.abs(v) >= 1_000_000) return `${formatNumber(v / 1_000_000, { maximumFractionDigits: 1 })}M ج`
  if (Math.abs(v) >= 1_000) return `${formatNumber(v / 1_000, { maximumFractionDigits: 1 })}K ج`
  return `${formatNumber(v)} ج`
}

// ─── Filter bar ───────────────────────────────────────────────────────────────
interface Filters {
  from: string
  to: string
  branchId: string
  groupBy: 'day' | 'week' | 'month'
  lowStockOnly: boolean
}

function FilterBar({
  filters,
  onChange,
  showGroupBy = false,
  showLowStock = false,
  branches,
  isSuperAdmin,
}: {
  filters: Filters
  onChange: (f: Partial<Filters>) => void
  showGroupBy?: boolean
  showLowStock?: boolean
  branches: Branch[]
  isSuperAdmin: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-3 bg-gray-800 border border-gray-700 rounded-lg">
      <Filter className="w-4 h-4 text-gray-500 shrink-0" />
      <DateRangePicker
        value={{ from: filters.from, to: filters.to }}
        onChange={(v) => onChange({ from: v.from, to: v.to })}
      />
      {isSuperAdmin && branches.length > 1 && (
        <Select
          value={filters.branchId}
          onChange={(e) => onChange({ branchId: e.target.value })}
        >
          <option value="">كل الفروع</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
      )}
      {showGroupBy && (
        <div className="flex gap-1">
          {(['day', 'week', 'month'] as const).map((g) => (
            <button
              key={g}
              onClick={() => onChange({ groupBy: g })}
              className={`px-2 py-1 rounded text-xs transition-colors ${filters.groupBy === g ? 'bg-brand-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-gray-200'}`}
            >
              {g === 'day' ? 'يومي' : g === 'week' ? 'أسبوعي' : 'شهري'}
            </button>
          ))}
        </div>
      )}
      {showLowStock && (
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
          <input type="checkbox" checked={filters.lowStockOnly} onChange={(e) => onChange({ lowStockOnly: e.target.checked })} className="accent-brand-500" />
          منخفض المخزون فقط
        </label>
      )}
    </div>
  )
}

// ─── Excel download helper ────────────────────────────────────────────────────
function buildParams(filters: Filters, extra?: Record<string, string>) {
  const p: Record<string, string> = {}
  if (filters.from) p.from = filters.from
  if (filters.to) p.to = filters.to
  if (filters.branchId) p.branchId = filters.branchId
  return { ...p, ...extra }
}

function downloadExcel(path: string, params: Record<string, string>, filename: string) {
  return downloadFromApi(path, filename, { ...params, format: 'excel' })
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Reports() {
  const user = useAuthStore((s) => s.user)
  const isSuperAdmin = user?.roleSlug === 'super_admin'

  const [tab, setTab] = useState<'sales' | 'stock' | 'installments' | 'pnl' | 'fees' | 'top' | 'returns'>('sales')
  const [filters, setFilters] = useState<Filters>({
    from: monthStart(),
    to: today(),
    branchId: '',
    groupBy: 'day',
    lowStockOnly: false,
  })

  const patchFilters = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))

  const tabs = [
    { id: 'sales', label: 'المبيعات' },
    { id: 'stock', label: 'المخزون' },
    { id: 'installments', label: 'الأقساط' },
    { id: 'pnl', label: 'الأرباح والخسائر' },
    { id: 'fees', label: 'رسوم الدفع' },
    { id: 'top', label: 'أكثر المنتجات مبيعاً' },
    { id: 'returns', label: 'المرتجعات' },
  ] as const

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get<{ data: Branch[] }>('/branches')).data.data,
    enabled: isSuperAdmin,
  })

  // ── Sales ────────────────────────────────────────────────────────────────────
  const salesParams = buildParams(filters, { groupBy: filters.groupBy })
  const { data: salesData, isLoading: salesLoading } = useQuery<SalesReport>({
    queryKey: ['reports-sales', salesParams],
    queryFn: async () => (await api.get<{ data: SalesReport }>('/reports/sales', { params: salesParams })).data.data,
    enabled: tab === 'sales',
  })

  // ── Stock ────────────────────────────────────────────────────────────────────
  const stockParams = buildParams({ ...filters, from: '', to: '' }, { lowStockOnly: filters.lowStockOnly ? 'true' : 'false' })
  const { data: stockData, isLoading: stockLoading } = useQuery<StockReport>({
    queryKey: ['reports-stock', stockParams],
    queryFn: async () => (await api.get<{ data: StockReport }>('/reports/stock', { params: stockParams })).data.data,
    enabled: tab === 'stock',
  })

  // ── Installments ─────────────────────────────────────────────────────────────
  const installParams = buildParams({ ...filters, from: '', to: '' })
  const { data: installData, isLoading: installLoading } = useQuery<InstallmentReport>({
    queryKey: ['reports-installments', installParams],
    queryFn: async () => (await api.get<{ data: InstallmentReport }>('/reports/installments', { params: installParams })).data.data,
    enabled: tab === 'installments',
  })

  // ── P&L ──────────────────────────────────────────────────────────────────────
  const pnlParams = buildParams(filters)
  const { data: pnlData, isLoading: pnlLoading } = useQuery<PnLReport>({
    queryKey: ['reports-pnl', pnlParams],
    queryFn: async () => (await api.get<{ data: PnLReport }>('/reports/profit-loss', { params: pnlParams })).data.data,
    enabled: tab === 'pnl',
  })

  const feesParams = buildParams(filters)
  const { data: feesData, isLoading: feesLoading } = useQuery<FeesReport>({
    queryKey: ['reports-fees', feesParams],
    queryFn: async () => (await api.get<{ data: FeesReport }>('/reports/fees', { params: feesParams })).data.data,
    enabled: tab === 'fees',
  })

  const topParams = buildParams(filters, { limit: '20' })
  const { data: topData, isLoading: topLoading } = useQuery<TopProduct[]>({
    queryKey: ['reports-top', topParams],
    queryFn: async () => (await api.get<{ data: TopProduct[] }>('/reports/top-products', { params: topParams })).data.data,
    enabled: tab === 'top',
  })

  const returnsParams = buildParams(filters, { groupBy: filters.groupBy })
  const { data: returnsData, isLoading: returnsLoading } = useQuery<ReturnsReport>({
    queryKey: ['reports-returns', returnsParams],
    queryFn: async () => (await api.get<{ data: ReturnsReport }>('/reports/returns', { params: returnsParams })).data.data,
    enabled: tab === 'returns',
  })

  const salesSummary = salesData?.summary
  const byPeriod = salesData?.byPeriod ?? []
  const stockSummary = stockData?.summary
  const stockItems = stockData?.items ?? []
  const installSummary = installData?.summary

  return (
    <AppShell title="التقارير">
      <div className="flex flex-col gap-5">

        {/* Tab selector */}
        <div className="flex gap-2">
          {tabs.map((t) => (
            <Button key={t.id} variant={tab === t.id ? 'primary' : 'ghost'} size="sm" onClick={() => setTab(t.id as typeof tab)}>{t.label}</Button>
          ))}
        </div>

        {/* ── Sales Tab ─────────────────────────────────────────────────────── */}
        {tab === 'sales' && (
          <>
            <FilterBar filters={filters} onChange={patchFilters} showGroupBy branches={branches} isSuperAdmin={isSuperAdmin} />
            <div className="grid grid-cols-3 gap-4">
              <StatCard label="إجمالي المبيعات" value={`${formatNumber(salesSummary?.totalRevenue ?? 0)} ج`} accentColor="bg-brand-500" />
              <StatCard label="إجمالي الرسوم" value={`${formatNumber(salesSummary?.feeTotal ?? 0)} ج`} accentColor="bg-warning-500" />
              <StatCard label="عدد الفواتير" value={salesSummary?.invoiceCount ?? 0} accentColor="bg-success-500" />
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">
                {filters.from && filters.to ? `${filters.from} — ${filters.to}` : 'كل الفترات'}
              </span>
              <Button variant="ghost" size="sm" onClick={() => downloadExcel('/reports/sales', salesParams, 'sales-report.xlsx')}>
                <Download className="w-3 h-3" />تصدير Excel
              </Button>
            </div>
            {!salesLoading && byPeriod.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2">
                  <ChartCard title="تطور الإيرادات" subtitle={filters.groupBy === 'day' ? 'يومي' : filters.groupBy === 'week' ? 'أسبوعي' : 'شهري'} height={260}>
                    <AreaChartView
                      data={byPeriod}
                      xKey="period"
                      series={[{ key: 'revenue', name: 'الإيرادات', color: chartPalette[0] }]}
                      formatY={formatCurrency}
                      formatTooltip={(v) => formatCurrency(v)}
                    />
                  </ChartCard>
                </div>
                <ChartCard title="عدد الفواتير" height={260}>
                  <BarChartView
                    data={byPeriod}
                    xKey="period"
                    series={[{ key: 'count', name: 'الفواتير', color: chartPalette[1] }]}
                    formatY={formatNumber}
                    formatTooltip={(v) => formatNumber(v)}
                  />
                </ChartCard>
              </div>
            )}
            {salesLoading ? <SkeletonTable rows={8} cols={3} /> : (
              <Table
                columns={[
                  { key: 'period', header: 'الفترة', render: (r) => <span className="font-numeric num num-strong text-sm">{r.period}</span> },
                  { key: 'count', header: 'الفواتير', className: 'font-numeric num num-strong text-center' },
                  { key: 'revenue', header: 'الإيرادات', render: (r) => <Money value={r.revenue} /> },
                ]}
                data={byPeriod} keyExtractor={(r) => r.period} emptyMessage="لا توجد بيانات في هذه الفترة"
              />
            )}
          </>
        )}

        {/* ── Stock Tab ─────────────────────────────────────────────────────── */}
        {tab === 'stock' && (
          <>
            <FilterBar filters={filters} onChange={patchFilters} showLowStock branches={branches} isSuperAdmin={isSuperAdmin} />
            <div className="grid grid-cols-3 gap-4">
              <StatCard label="إجمالي الأصناف" value={stockSummary?.totalVariants ?? 0} accentColor="bg-brand-500" />
              <StatCard label="مخزون منخفض" value={stockSummary?.lowStockCount ?? 0} accentColor="bg-warning-500" />
              <StatCard label="قيمة المخزون" value={`${formatNumber(stockSummary?.totalStockValue ?? 0)} ج`} accentColor="bg-success-500" />
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => downloadExcel('/reports/stock', stockParams, 'stock-report.xlsx')}>
                <Download className="w-3 h-3" />تصدير Excel
              </Button>
            </div>
            {!stockLoading && stockItems.length > 0 && (() => {
              const outOfStock = stockItems.filter((s) => s.quantity === 0).length
              const lowStock = stockItems.filter((s) => s.isLowStock && s.quantity > 0).length
              const healthy = stockItems.length - outOfStock - lowStock
              const topByValue = [...stockItems]
                .sort((a, b) => b.stockValue - a.stockValue)
                .slice(0, 10)
                .map((s) => ({ name: `${s.product.name} (${s.sku})`, value: s.stockValue }))
              return (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <ChartCard title="حالة المخزون" height={280}>
                    <DonutChartView
                      data={[
                        { name: 'سليم', value: healthy, color: '#10B981' },
                        { name: 'منخفض', value: lowStock, color: '#F59E0B' },
                        { name: 'نفذ', value: outOfStock, color: '#EF4444' },
                      ]}
                      formatValue={(v) => `${formatNumber(v)} صنف`}
                      centerLabel="إجمالي"
                      centerValue={formatNumber(stockItems.length)}
                    />
                  </ChartCard>
                  <div className="lg:col-span-2">
                    <ChartCard title="أعلى 10 أصناف من حيث القيمة" height={280}>
                      <BarChartView
                        data={topByValue}
                        xKey="name"
                        series={[{ key: 'value', name: 'القيمة', color: chartPalette[0] }]}
                        formatY={formatCurrency}
                        formatTooltip={(v) => formatCurrency(v)}
                        layout="vertical"
                      />
                    </ChartCard>
                  </div>
                </div>
              )
            })()}
            {stockLoading ? <SkeletonTable rows={8} cols={5} /> : (
              <Table
                columns={[
                  { key: 'product', header: 'المنتج', render: (s) => <span className="font-medium text-gray-100">{s.product.name}</span> },
                  { key: 'sku', header: 'SKU', className: 'num-code text-sm' },
                  { key: 'branch', header: 'الفرع', render: (s) => <span className="text-gray-400">{s.branch.name}</span> },
                  { key: 'quantity', header: 'الكمية', render: (s) => (
                    <span className={s.quantity === 0 ? 'text-danger-500 font-bold' : s.isLowStock ? 'text-warning-500' : 'text-success-500'}>{s.quantity}</span>
                  )},
                  { key: 'status', header: 'الحالة', render: (s) => s.quantity === 0
                    ? <Badge variant="danger" dot>نفذ</Badge>
                    : s.isLowStock ? <Badge variant="warning" dot>منخفض</Badge>
                    : null
                  },
                  { key: 'stockValue', header: 'القيمة', render: (s) => <Money value={s.stockValue} /> },
                ]}
                data={stockItems} keyExtractor={(s) => `${s.variantId}-${s.branchId}`} emptyMessage="لا توجد بيانات"
              />
            )}
          </>
        )}

        {/* ── Installments Tab ──────────────────────────────────────────────── */}
        {tab === 'installments' && (
          <>
            <FilterBar filters={filters} onChange={patchFilters} branches={branches} isSuperAdmin={isSuperAdmin} />
            <div className="flex justify-end">
              <Button
                variant="ghost" size="sm"
                disabled={!installSummary}
                onClick={() => void (installSummary && exportRowsToExcel(
                  [
                    { label: 'عقود نشطة', value: installSummary.active },
                    { label: 'متأخرة', value: installSummary.overdue },
                    { label: 'انتظار موافقة', value: installSummary.pendingApproval },
                    { label: 'مكتملة', value: installSummary.completed },
                    { label: 'إجمالي المستحقات', value: installSummary.totalReceivables },
                  ],
                  [
                    { header: 'الحالة', accessor: 'label', width: 24 },
                    { header: 'القيمة', accessor: 'value', width: 16 },
                  ],
                  'installments-summary.xlsx',
                  'الأقساط',
                ))}
              >
                <Download className="w-3 h-3" />تصدير Excel
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <StatCard label="عقود نشطة" value={installSummary?.active ?? 0} accentColor="bg-success-500" />
              <StatCard label="متأخرة" value={installSummary?.overdue ?? 0} accentColor="bg-danger-500" />
              <StatCard label="إجمالي المستحقات" value={`${formatNumber(installSummary?.totalReceivables ?? 0)} ج`} accentColor="bg-brand-500" />
            </div>
            {installLoading ? <SkeletonTable rows={4} cols={3} /> : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <StatCard label="انتظار موافقة" value={installSummary?.pendingApproval ?? 0} accentColor="bg-warning-500" />
                  <StatCard label="مكتملة" value={installSummary?.completed ?? 0} accentColor="bg-gray-500" />
                </div>
                {installSummary && (
                  <ChartCard title="توزيع عقود التقسيط" height={300}>
                    <DonutChartView
                      data={[
                        { name: 'نشطة', value: installSummary.active, color: '#10B981' },
                        { name: 'متأخرة', value: installSummary.overdue, color: '#EF4444' },
                        { name: 'انتظار موافقة', value: installSummary.pendingApproval, color: '#F59E0B' },
                        { name: 'مكتملة', value: installSummary.completed, color: '#64748B' },
                      ]}
                      formatValue={(v) => `${formatNumber(v)} عقد`}
                      centerLabel="مستحقات"
                      centerValue={formatCurrency(installSummary.totalReceivables)}
                    />
                  </ChartCard>
                )}
              </>
            )}
          </>
        )}

        {/* ── P&L Tab ───────────────────────────────────────────────────────── */}
        {tab === 'pnl' && (
          <>
            <FilterBar filters={filters} onChange={patchFilters} branches={branches} isSuperAdmin={isSuperAdmin} />
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => downloadExcel('/reports/profit-loss', pnlParams, 'profit-loss.xlsx')}>
                <Download className="w-3 h-3" />تصدير Excel
              </Button>
            </div>
            {!pnlLoading && pnlData && (
              <ChartCard title="مقارنة بنود الأرباح والخسائر" height={280}>
                <BarChartView
                  data={[
                    { label: 'الإيرادات', value: pnlData.revenue },
                    { label: 'تكلفة المبيعات', value: pnlData.cogs },
                    { label: 'إجمالي الربح', value: pnlData.grossProfit },
                    { label: 'مصروفات التشغيل', value: pnlData.operatingExpenses },
                    { label: 'صافي الربح', value: pnlData.netProfit },
                  ]}
                  xKey="label"
                  series={[{ key: 'value', name: 'القيمة' }]}
                  formatY={formatCurrency}
                  formatTooltip={(v) => formatCurrency(v)}
                  colorByIndex={['#10B981', '#EF4444', '#1FA971', '#F59E0B', pnlData.netProfit >= 0 ? '#10B981' : '#EF4444']}
                />
              </ChartCard>
            )}
            {pnlLoading ? <SkeletonTable rows={6} cols={2} /> : (
              <div className="max-w-lg bg-gray-800 rounded-xl border border-gray-700 divide-y divide-gray-700">
                {(() => {
                  // The revenue row is followed by two indented sub-rows breaking
                  // it into Invoices vs Services, but only when services revenue
                  // is non-zero — keeps the P&L clean for retail-only tenants.
                  const hasServicesRev = (pnlData?.servicesRevenue ?? 0) > 0
                  const rows: Array<{
                    label: string
                    value: number
                    cls: string
                    margin?: number
                    indent?: boolean
                  }> = [
                    { label: 'الإيرادات', value: pnlData?.revenue ?? 0, cls: 'text-success-600' },
                    ...(hasServicesRev
                      ? [
                          { label: '— مبيعات (فواتير)', value: pnlData?.invoiceRevenue ?? 0, cls: 'text-success-600/70', indent: true },
                          { label: '— خدمات (طلبات عمل)', value: pnlData?.servicesRevenue ?? 0, cls: 'text-info-600', indent: true },
                        ]
                      : []),
                    { label: 'تكلفة المبيعات (COGS)', value: -(pnlData?.cogs ?? 0), cls: 'text-danger-600' },
                    { label: 'إجمالي الربح', value: pnlData?.grossProfit ?? 0, cls: 'text-brand-400 font-semibold', margin: pnlData?.grossMargin },
                    { label: 'مصروفات التشغيل', value: -(pnlData?.operatingExpenses ?? 0), cls: 'text-danger-600' },
                    { label: 'صافي الربح', value: pnlData?.netProfit ?? 0, cls: 'text-success-600 font-bold text-base', margin: pnlData?.netMargin },
                  ]
                  return rows.map((row) => (
                    <div
                      key={row.label}
                      className={`flex justify-between items-center px-6 py-4 ${row.indent ? 'bg-gray-750/60 py-2.5 pr-10' : ''}`}
                    >
                      <div>
                        <span className={`text-sm ${row.indent ? 'text-gray-500' : 'text-gray-300'}`}>{row.label}</span>
                        {row.margin !== undefined && (
                          <span className="text-xs text-gray-500 mr-2">({formatNumber(row.margin, { maximumFractionDigits: 1 })}%)</span>
                        )}
                      </div>
                      <span className={`font-mono ${row.cls} ${row.indent ? 'text-xs' : ''}`}>
                        {formatNumber(row.value)} ج
                      </span>
                    </div>
                  ))
                })()}
              </div>
            )}
          </>
        )}

        {/* ── Fees Tab ──────────────────────────────────────────────────────── */}
        {tab === 'fees' && (
          <>
            <FilterBar filters={filters} onChange={patchFilters} branches={branches} isSuperAdmin={isSuperAdmin} />
            <div className="flex justify-end">
              <Button
                variant="ghost" size="sm"
                disabled={!feesData || feesData.byPaymentMethod.length === 0}
                onClick={() => void (feesData && exportRowsToExcel(
                  feesData.byPaymentMethod,
                  [
                    { header: 'طريقة الدفع', accessor: (r) => r.paymentMethod.name ?? '—', width: 24 },
                    { header: 'يتحمل الرسوم', accessor: (r) => r.feeBearer === 'merchant' ? 'التاجر' : 'العميل', width: 14 },
                    { header: 'عدد الفواتير', accessor: 'count', width: 12 },
                    { header: 'إجمالي الرسوم', accessor: 'totalFees', width: 16 },
                  ],
                  'fees-report.xlsx',
                  'رسوم الدفع',
                ))}
              >
                <Download className="w-3 h-3" />تصدير Excel
              </Button>
            </div>
            {feesLoading ? <SkeletonTable rows={5} cols={4} /> : (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <StatCard label="إجمالي الرسوم" value={`${formatNumber(feesData?.summary.totalFees ?? 0)} ج`} accentColor="bg-brand-500" />
                  <StatCard label="رسوم على التاجر" value={`${formatNumber(feesData?.summary.totalMerchantFees ?? 0)} ج`} accentColor="bg-danger-500" />
                  <StatCard label="رسوم على العميل" value={`${formatNumber(feesData?.summary.totalCustomerFees ?? 0)} ج`} accentColor="bg-success-500" />
                </div>
                {feesData && feesData.byPaymentMethod.length > 0 && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <ChartCard title="من يتحمل الرسوم" height={260}>
                      <DonutChartView
                        data={[
                          { name: 'التاجر', value: feesData.summary.totalMerchantFees, color: '#EF4444' },
                          { name: 'العميل', value: feesData.summary.totalCustomerFees, color: '#10B981' },
                        ]}
                        formatValue={formatCurrency}
                        centerLabel="إجمالي"
                        centerValue={formatCurrency(feesData.summary.totalFees)}
                      />
                    </ChartCard>
                    <div className="lg:col-span-2">
                      <ChartCard title="الرسوم حسب طريقة الدفع" height={260}>
                        <BarChartView
                          data={feesData.byPaymentMethod.map((r) => ({
                            name: `${r.paymentMethod.name ?? '—'} (${r.feeBearer === 'merchant' ? 'تاجر' : 'عميل'})`,
                            value: r.totalFees,
                          }))}
                          xKey="name"
                          series={[{ key: 'value', name: 'الرسوم', color: chartPalette[0] }]}
                          formatY={formatCurrency}
                          formatTooltip={(v) => formatCurrency(v)}
                          layout="vertical"
                        />
                      </ChartCard>
                    </div>
                  </div>
                )}
                <Table
                  columns={[
                    { key: 'pm', header: 'طريقة الدفع', render: (r) => <span className="font-medium text-gray-100">{r.paymentMethod.name ?? '—'}</span> },
                    { key: 'bearer', header: 'يتحمل الرسوم', render: (r) => (
                      <Badge variant={r.feeBearer === 'merchant' ? 'danger' : 'success'}>
                        {r.feeBearer === 'merchant' ? 'التاجر' : 'العميل'}
                      </Badge>
                    )},
                    { key: 'count', header: 'عدد الفواتير', render: (r) => <span className="font-numeric num num-strong">{r.count}</span> },
                    { key: 'total', header: 'إجمالي الرسوم', render: (r) => <Money value={r.totalFees} /> },
                  ]}
                  data={feesData?.byPaymentMethod ?? []}
                  keyExtractor={(r) => `${r.paymentMethod.id}-${r.feeBearer}`}
                  emptyMessage="لا توجد رسوم في هذه الفترة"
                />
              </>
            )}
          </>
        )}

        {/* ── Top Products Tab ──────────────────────────────────────────────── */}
        {tab === 'top' && (
          <>
            <FilterBar filters={filters} onChange={patchFilters} branches={branches} isSuperAdmin={isSuperAdmin} />
            <div className="flex justify-end">
              <Button
                variant="ghost" size="sm"
                disabled={!topData || topData.length === 0}
                onClick={() => void (topData && exportRowsToExcel(
                  topData,
                  [
                    { header: 'المنتج', accessor: 'productName', width: 32 },
                    { header: 'SKU', accessor: 'variantSku', width: 16 },
                    { header: 'الكمية المباعة', accessor: 'totalQty', width: 14 },
                    { header: 'الإيرادات', accessor: 'totalRevenue', width: 16 },
                  ],
                  'top-products.xlsx',
                  'أكثر المنتجات مبيعاً',
                ))}
              >
                <Download className="w-3 h-3" />تصدير Excel
              </Button>
            </div>
            {!topLoading && topData && topData.length > 0 && (
              <ChartCard title="أعلى 10 منتجات حسب الإيرادات" height={320}>
                <BarChartView
                  data={topData.slice(0, 10).map((r) => ({ name: r.productName, value: r.totalRevenue }))}
                  xKey="name"
                  series={[{ key: 'value', name: 'الإيرادات', color: chartPalette[0] }]}
                  formatY={formatCurrency}
                  formatTooltip={(v) => formatCurrency(v)}
                  layout="vertical"
                />
              </ChartCard>
            )}
            {topLoading ? <SkeletonTable rows={10} cols={4} /> : (
              <Table
                columns={[
                  { key: 'rank', header: '#', render: (r) => <span className="font-numeric num num-muted">{(topData ?? []).indexOf(r) + 1}</span> },
                  { key: 'product', header: 'المنتج', render: (r) => <span className="font-medium text-gray-100">{r.productName}</span> },
                  { key: 'sku', header: 'SKU', render: (r) => <span className="num-code text-xs">{r.variantSku}</span> },
                  { key: 'qty', header: 'الكمية المباعة', render: (r) => <span className="font-numeric num text-brand-400">{formatNumber(r.totalQty)}</span> },
                  { key: 'revenue', header: 'الإيرادات', render: (r) => <Money value={r.totalRevenue} /> },
                ]}
                data={topData ?? []}
                keyExtractor={(r) => r.variantSku}
                emptyMessage="لا توجد بيانات مبيعات في هذه الفترة"
              />
            )}
          </>
        )}

        {/* ── Returns Tab ───────────────────────────────────────────────────── */}
        {tab === 'returns' && (
          <>
            <FilterBar filters={filters} onChange={patchFilters} showGroupBy branches={branches} isSuperAdmin={isSuperAdmin} />
            <div className="flex justify-end">
              <Button
                variant="ghost" size="sm"
                disabled={!returnsData || returnsData.topReasons.length === 0}
                onClick={() => void (returnsData && exportRowsToExcel(
                  returnsData.topReasons,
                  [
                    { header: 'السبب', accessor: 'reason', width: 40 },
                    { header: 'عدد المرات', accessor: 'count', width: 12 },
                    { header: 'الإجمالي', accessor: 'amount', width: 14 },
                  ],
                  'return-reasons.xlsx',
                  'أسباب الإرجاع',
                ))}
              >
                <Download className="w-3 h-3" />تصدير الأسباب
              </Button>
            </div>

            {returnsLoading ? (
              <SkeletonTable rows={6} cols={3} />
            ) : returnsData && (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard
                    label="إجمالي الإرجاع"
                    value={formatCurrency(returnsData.summary.totalAmount)}
                    accentColor="bg-danger-500"
                  />
                  <StatCard
                    label="عدد المرتجعات"
                    value={formatNumber(returnsData.summary.totalCount)}
                    accentColor="bg-warning-500"
                  />
                  <StatCard
                    label="استرداد نقدي"
                    value={`${formatNumber(returnsData.summary.refundCount)} (${formatCurrency(returnsData.summary.refundAmount)})`}
                    accentColor="bg-info-500"
                  />
                  <StatCard
                    label="رصيد عميل"
                    value={`${formatNumber(returnsData.summary.creditCount)} (${formatCurrency(returnsData.summary.creditAmount)})`}
                    accentColor="bg-success-500"
                  />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Time-series area chart */}
                  {returnsData.byPeriod.length > 0 && (
                    <div className="lg:col-span-2">
                      <ChartCard title="المرتجعات عبر الزمن" subtitle={filters.groupBy === 'day' ? 'يومي' : filters.groupBy === 'week' ? 'أسبوعي' : 'شهري'} height={260}>
                        <AreaChartView
                          data={returnsData.byPeriod}
                          xKey="period"
                          series={[{ key: 'amount', name: 'القيمة', color: chartPalette[3] }]}
                          formatY={formatCurrency}
                          formatTooltip={(v) => formatCurrency(v)}
                        />
                      </ChartCard>
                    </div>
                  )}

                  {/* Refund vs credit donut */}
                  {returnsData.summary.totalCount > 0 && (
                    <ChartCard title="استرداد نقدي أم رصيد" height={260}>
                      <DonutChartView
                        data={[
                          { name: 'استرداد نقدي', value: returnsData.summary.refundAmount, color: '#EF4444' },
                          { name: 'رصيد عميل', value: returnsData.summary.creditAmount, color: '#10B981' },
                        ]}
                        formatValue={formatCurrency}
                        centerLabel="إجمالي"
                        centerValue={formatCurrency(returnsData.summary.totalAmount)}
                      />
                    </ChartCard>
                  )}
                </div>

                {/* Top reasons + top items side by side */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <ChartCard title="أكثر الأسباب تكراراً" height={320}>
                    {returnsData.topReasons.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-sm text-gray-500">لا توجد أسباب مسجّلة</div>
                    ) : (
                      <BarChartView
                        data={returnsData.topReasons.map((r) => ({ name: r.reason, value: r.count }))}
                        xKey="name"
                        series={[{ key: 'value', name: 'عدد المرات', color: chartPalette[3] }]}
                        formatY={formatNumber}
                        formatTooltip={(v) => `${formatNumber(v)} مرة`}
                        layout="vertical"
                      />
                    )}
                  </ChartCard>
                  <ChartCard title="أكثر الأصناف ارتجاعاً" height={320}>
                    {returnsData.topItems.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-sm text-gray-500">لا توجد بيانات</div>
                    ) : (
                      <BarChartView
                        data={returnsData.topItems.map((r) => ({ name: `${r.productName} (${r.sku})`, value: r.totalReturnedQty }))}
                        xKey="name"
                        series={[{ key: 'value', name: 'الكمية المرتجعة', color: chartPalette[2] }]}
                        formatY={formatNumber}
                        formatTooltip={(v) => `${formatNumber(v)} وحدة`}
                        layout="vertical"
                      />
                    )}
                  </ChartCard>
                </div>

                {/* Detailed reasons table */}
                {returnsData.topReasons.length > 0 && (
                  <Table
                    columns={[
                      { key: 'reason', header: 'السبب', render: (r) => <span className="text-gray-100">{r.reason}</span> },
                      { key: 'count', header: 'عدد المرات', render: (r) => <span className="font-mono text-warning-600">{r.count}</span> },
                      { key: 'amount', header: 'الإجمالي', render: (r) => <Money value={r.amount} /> },
                    ]}
                    data={returnsData.topReasons}
                    keyExtractor={(r) => r.reason}
                    emptyMessage="لا توجد أسباب"
                  />
                )}
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
