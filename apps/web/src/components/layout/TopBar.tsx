import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bell, PackageOpen, Clock, AlertTriangle, Menu } from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'
import { Badge } from '@/components/ui'
import { api } from '@/api/client'
import { cn } from '@/lib/cn'

interface DashboardData {
  pending: { installmentApprovals: number; overdueInstallmentPayments: number; expenseApprovals: number }
  lowStockAlerts: number
  etaFailures?: number
}

function NotificationPanel({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)

  const { data } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get<{ data: DashboardData }>('/reports/dashboard')).data.data,
    staleTime: 60_000,
  })

  useEffect(() => {
    const clickHandler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', clickHandler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', clickHandler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [onClose])

  const items: { label: string; count: number; icon: React.ReactNode; path: string }[] = [
    { label: 'تنبيهات مخزون منخفض', count: data?.lowStockAlerts ?? 0, icon: <PackageOpen className="w-4 h-4" />, path: '/stock' },
    { label: 'أقساط تنتظر موافقة', count: data?.pending.installmentApprovals ?? 0, icon: <Clock className="w-4 h-4" />, path: '/installments' },
    { label: 'أقساط متأخرة', count: data?.pending.overdueInstallmentPayments ?? 0, icon: <AlertTriangle className="w-4 h-4" />, path: '/installments' },
    { label: 'مصاريف تنتظر اعتماداً', count: data?.pending.expenseApprovals ?? 0, icon: <Clock className="w-4 h-4" />, path: '/expenses' },
    { label: 'فشل إرسال ضريبي (ETA)', count: data?.etaFailures ?? 0, icon: <AlertTriangle className="w-4 h-4" />, path: '/settings' },
  ].filter((i) => i.count > 0)

  return (
    <div
      ref={ref}
      id="notification-panel"
      role="dialog"
      aria-label="الإشعارات"
      className="absolute left-0 top-full mt-2 w-80 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-gray-700">
        <p className="text-sm font-semibold text-gray-100">الإشعارات</p>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-8 text-center text-gray-500 text-sm">لا توجد تنبيهات</div>
      ) : (
        <div className="flex flex-col">
          {items.map((item, i) => (
            <button
              key={i}
              onClick={() => { navigate(item.path); onClose() }}
              className="flex items-center gap-3 px-4 py-3 hover:bg-gray-750 border-b border-gray-700/50 last:border-0 text-right transition-colors"
            >
              <span className="w-8 h-8 rounded-full bg-warning-500/10 flex items-center justify-center text-warning-500 shrink-0">
                {item.icon}
              </span>
              <p className="flex-1 text-sm text-gray-300">{item.label}</p>
              <span className="font-mono font-bold text-warning-600">{item.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function TopBar({ title, onMenuClick }: { title?: string; onMenuClick?: () => void }) {
  const { tenantSubdomain } = useAuthStore()
  const [open, setOpen] = useState(false)

  const { data } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get<{ data: DashboardData }>('/reports/dashboard')).data.data,
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  })

  const totalAlerts =
    (data?.lowStockAlerts ?? 0) +
    (data?.pending.installmentApprovals ?? 0) +
    (data?.pending.overdueInstallmentPayments ?? 0) +
    (data?.pending.expenseApprovals ?? 0) +
    (data?.etaFailures ?? 0)

  return (
    <header className="h-14 bg-white border-b border-gray-800 flex items-center px-4 sm:px-6 gap-3 sm:gap-4 shadow-sm">
      {onMenuClick && (
        <button
          onClick={onMenuClick}
          aria-label="فتح القائمة"
          className="lg:hidden w-8 h-8 rounded-md text-gray-400 hover:text-gray-100 hover:bg-gray-800 flex items-center justify-center transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}
      {title && <h2 className="text-base font-semibold text-gray-100 flex-1 truncate">{title}</h2>}
      {!title && <div className="flex-1" />}

      {tenantSubdomain && <Badge variant="brand" dot>{tenantSubdomain}</Badge>}

      {/* Notification bell */}
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'w-8 h-8 rounded-full flex items-center justify-center transition-colors relative',
            open ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800',
          )}
          aria-label="الإشعارات"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={open ? 'notification-panel' : undefined}
        >
          <Bell className="w-4 h-4" />
          {totalAlerts > 0 && (
            <span className="absolute -top-0.5 -left-0.5 w-4 h-4 bg-danger-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">
              {totalAlerts > 9 ? '9+' : totalAlerts}
            </span>
          )}
        </button>
        {open && <NotificationPanel onClose={() => setOpen(false)} />}
      </div>
    </header>
  )
}
