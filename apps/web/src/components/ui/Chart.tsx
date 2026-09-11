import type { ReactNode } from 'react'
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'

// Theme tokens mirroring tailwind.config.ts (light theme) so charts stay on-brand
export const chartTheme = {
  grid: '#E6EDE7',        // light line
  axisText: '#5C726A',    // gray-400 (muted)
  axisLine: '#D8E2DB',    // gray-700 (light border)
  tooltipBg: '#FFFFFF',   // surface
  tooltipBorder: '#D8E2DB',
  tooltipText: '#12261E', // gray-50 (ink)
} as const

export const chartPalette = [
  '#1FA971', // brand green
  '#F5A623', // warm amber
  '#3B82F6', // info blue
  '#8B5CF6', // violet
  '#14B8A6', // teal
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#EF4444', // red (semantic — last so it isn't a default series colour)
] as const

const tooltipStyle = {
  backgroundColor: chartTheme.tooltipBg,
  border: `1px solid ${chartTheme.tooltipBorder}`,
  borderRadius: 8,
  color: chartTheme.tooltipText,
  fontFamily: 'IBM Plex Sans Arabic, sans-serif',
  fontSize: 12,
  padding: '8px 12px',
}
const tooltipLabelStyle = { color: chartTheme.axisText, marginBottom: 4 }
const tooltipItemStyle = { color: chartTheme.tooltipText }
const axisProps = {
  stroke: chartTheme.axisLine,
  tick: { fill: chartTheme.axisText, fontSize: 11, fontFamily: 'IBM Plex Mono' },
  tickLine: false,
}

// ─── Card wrapper ──────────────────────────────────────────────────────────────
interface ChartCardProps {
  title?: string
  subtitle?: string
  height?: number
  children: ReactNode
  actions?: ReactNode
}
export function ChartCard({ title, subtitle, height = 280, children, actions }: ChartCardProps) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-700">
      {(title || actions) && (
        <div className="flex items-center justify-between mb-3">
          <div>
            {title && <h3 className="text-sm font-semibold text-gray-200">{title}</h3>}
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div role="img" aria-label={title ?? 'رسم بياني'} style={{ width: '100%', height }}>{children}</div>
    </div>
  )
}

// ─── Series-based charts ───────────────────────────────────────────────────────
export interface ChartSeries {
  key: string
  name: string
  color?: string
}

interface SeriesChartProps<T> {
  data: T[]
  xKey: keyof T & string
  series: ChartSeries[]
  formatY?: (v: number) => string
  formatTooltip?: (v: number, name: string) => string
  emptyMessage?: string
}

function isEmpty<T>(data: T[]) {
  return !data || data.length === 0
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="w-full h-full flex items-center justify-center text-sm text-gray-500">
      {message}
    </div>
  )
}

// Line chart — best for time-series trends
export function LineChartView<T>({
  data, xKey, series, formatY, formatTooltip, emptyMessage = 'لا توجد بيانات',
}: SeriesChartProps<T>) {
  if (isEmpty(data)) return <EmptyState message={emptyMessage} />
  return (
    <ResponsiveContainer>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} tickFormatter={formatY} width={70} />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabelStyle}
          itemStyle={tooltipItemStyle}
          formatter={formatTooltip ? (v: number, n: string) => [formatTooltip(v, n), n] : undefined}
          cursor={{ stroke: chartTheme.grid }}
        />
        {series.length > 1 && (
          <Legend wrapperStyle={{ fontSize: 11, color: chartTheme.axisText }} />
        )}
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color ?? chartPalette[i % chartPalette.length]}
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

// Area chart — softer alternative to line for revenue trends
export function AreaChartView<T>({
  data, xKey, series, formatY, formatTooltip, emptyMessage = 'لا توجد بيانات',
}: SeriesChartProps<T>) {
  if (isEmpty(data)) return <EmptyState message={emptyMessage} />
  return (
    <ResponsiveContainer>
      <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s, i) => {
            const color = s.color ?? chartPalette[i % chartPalette.length]
            return (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.4} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            )
          })}
        </defs>
        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} tickFormatter={formatY} width={70} />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabelStyle}
          itemStyle={tooltipItemStyle}
          formatter={formatTooltip ? (v: number, n: string) => [formatTooltip(v, n), n] : undefined}
          cursor={{ stroke: chartTheme.grid }}
        />
        {series.map((s, i) => {
          const color = s.color ?? chartPalette[i % chartPalette.length]
          return (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={color}
              strokeWidth={2}
              fill={`url(#grad-${s.key})`}
            />
          )
        })}
      </AreaChart>
    </ResponsiveContainer>
  )
}

// Bar chart — supports horizontal layout via `layout='vertical'` prop
interface BarChartViewProps<T> extends SeriesChartProps<T> {
  layout?: 'horizontal' | 'vertical'
  /** When provided, each bar uses its own color from this array (per-row coloring). */
  colorByIndex?: readonly string[]
}
export function BarChartView<T>({
  data, xKey, series, formatY, formatTooltip, layout = 'horizontal', colorByIndex,
  emptyMessage = 'لا توجد بيانات',
}: BarChartViewProps<T>) {
  if (isEmpty(data)) return <EmptyState message={emptyMessage} />
  const isVertical = layout === 'vertical'
  return (
    <ResponsiveContainer>
      <BarChart
        data={data}
        layout={layout}
        margin={{ top: 8, right: 16, left: isVertical ? 80 : 0, bottom: 0 }}
      >
        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" horizontal={isVertical} vertical={!isVertical} />
        {isVertical ? (
          <>
            <XAxis type="number" {...axisProps} tickFormatter={formatY} />
            <YAxis type="category" dataKey={xKey} {...axisProps} width={160} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} tickFormatter={formatY} width={70} />
          </>
        )}
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabelStyle}
          itemStyle={tooltipItemStyle}
          formatter={formatTooltip ? (v: number, n: string) => [formatTooltip(v, n), n] : undefined}
          cursor={{ fill: 'rgba(31, 169, 113, 0.08)' }}
        />
        {series.length > 1 && (
          <Legend wrapperStyle={{ fontSize: 11, color: chartTheme.axisText }} />
        )}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            fill={s.color ?? chartPalette[i % chartPalette.length]}
            radius={isVertical ? [0, 4, 4, 0] : [4, 4, 0, 0]}
          >
            {colorByIndex && data.map((_, idx) => (
              <Cell key={idx} fill={colorByIndex[idx % colorByIndex.length]} />
            ))}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

// Donut chart — best for status breakdowns and category share
export interface DonutDatum { name: string; value: number; color?: string }
interface DonutChartViewProps {
  data: DonutDatum[]
  formatValue?: (v: number) => string
  emptyMessage?: string
  centerLabel?: string
  centerValue?: string
}
export function DonutChartView({
  data, formatValue, emptyMessage = 'لا توجد بيانات', centerLabel, centerValue,
}: DonutChartViewProps) {
  const filtered = data.filter((d) => d.value > 0)
  if (filtered.length === 0) return <EmptyState message={emptyMessage} />
  return (
    <ResponsiveContainer>
      <PieChart>
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabelStyle}
          itemStyle={tooltipItemStyle}
          formatter={(v: number, n: string) => [formatValue ? formatValue(v) : v, n]}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, color: chartTheme.axisText, paddingTop: 8 }}
          iconType="circle"
        />
        <Pie
          data={filtered}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="45%"
          innerRadius="55%"
          outerRadius="80%"
          paddingAngle={2}
          stroke={chartTheme.tooltipBg}
          strokeWidth={2}
        >
          {filtered.map((d, i) => (
            <Cell key={d.name} fill={d.color ?? chartPalette[i % chartPalette.length]} />
          ))}
        </Pie>
        {(centerLabel || centerValue) && (
          <>
            <text
              x="50%" y="42%" textAnchor="middle" dominantBaseline="middle"
              fill={chartTheme.axisText}
              style={{ fontSize: 11, fontFamily: 'IBM Plex Sans Arabic, sans-serif' }}
            >{centerLabel}</text>
            <text
              x="50%" y="50%" textAnchor="middle" dominantBaseline="middle"
              fill={chartTheme.tooltipText}
              style={{ fontSize: 18, fontWeight: 700, fontFamily: 'IBM Plex Mono' }}
            >{centerValue}</text>
          </>
        )}
      </PieChart>
    </ResponsiveContainer>
  )
}
