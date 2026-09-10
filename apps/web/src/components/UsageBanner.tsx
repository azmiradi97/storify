import { Link } from 'react-router-dom'
import { TriangleAlert, Sparkles } from 'lucide-react'
import { useUsage, type UsageItem } from '@/hooks/useMe'

const LABELS: Record<string, string> = {
  users: 'المستخدمين',
  products: 'المنتجات',
  invoicesThisMonth: 'الفواتير هذا الشهر',
  installmentPlansThisMonth: 'خطط الأقساط هذا الشهر',
}

interface AlertRow {
  key: string
  label: string
  used: number
  limit: number
  pct: number
  exceeded: boolean
}

function ratio(item: UsageItem): number {
  if (item.limit <= 0) return 0
  return item.used / item.limit
}

/**
 * Renders a banner when any tracked usage metric crosses 80% of its plan limit
 * (or is already exceeded). Returns null when usage is healthy or hasn't loaded
 * yet — safe to mount unconditionally on the dashboard.
 */
export function UsageBanner() {
  const { data } = useUsage()
  if (!data) return null

  const items: AlertRow[] = (
    Object.entries(data) as Array<[keyof typeof data, UsageItem]>
  )
    .filter(([, item]) => item.limit > 0)
    .map(([key, item]) => ({
      key: String(key),
      label: LABELS[String(key)] ?? String(key),
      used: item.used,
      limit: item.limit,
      pct: ratio(item),
      exceeded: item.used >= item.limit,
    }))
    .filter((r) => r.pct >= 0.8)

  if (items.length === 0) return null

  const anyExceeded = items.some((r) => r.exceeded)

  return (
    <div
      role="alert"
      className={`mb-4 rounded-md border p-3 flex items-start gap-3 ${
        anyExceeded
          ? 'bg-danger-500/10 border-danger-500/30 text-danger-700'
          : 'bg-warning-500/10 border-warning-500/30 text-warning-700'
      }`}
    >
      <TriangleAlert className="w-5 h-5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium mb-1">
          {anyExceeded ? 'تجاوزت حد باقتك' : 'اقتربت من حد باقتك'}
        </p>
        <ul className="text-xs space-y-0.5">
          {items.map((r) => (
            <li key={r.key}>
              {r.label}: <span className="font-mono">{r.used}</span> / {r.limit}
              <span className="text-gray-400 mr-1">({Math.round(r.pct * 100)}%)</span>
            </li>
          ))}
        </ul>
      </div>
      <Link
        to="/settings?tab=billing"
        className="shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-md bg-brand-500/80 text-white hover:bg-brand-500"
      >
        <Sparkles className="w-3 h-3" />
        ترقية الباقة
      </Link>
    </div>
  )
}
