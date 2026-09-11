import { useState, useEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'
import {
  ShoppingCart,
  Package,
  Warehouse,
  Users,
  FileText,
  CreditCard,
  BarChart3,
  Settings,
  Truck,
  Receipt,
  LogOut,
  ClipboardList,
  RotateCcw,
  CalendarCheck,
  Wrench,
  Hammer,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useAuthStore } from '@/stores/auth.store'
import { api } from '@/api/client'
import { useMe, type PlanFeatures } from '@/hooks/useMe'

const navItems: Array<{
  to: string
  icon: typeof ShoppingCart
  label: string
  permission?: { resource: string; action: string }
  feature?: keyof PlanFeatures
}> = [
  { to: '/pos', icon: ShoppingCart, label: 'نقطة البيع', permission: { resource: 'invoices', action: 'create' } },
  { to: '/day-close', icon: CalendarCheck, label: 'إغلاق اليوم', permission: { resource: 'reports', action: 'read' } },
  { to: '/products', icon: Package, label: 'المنتجات', permission: { resource: 'products', action: 'read' } },
  { to: '/stock', icon: Warehouse, label: 'المخزون', permission: { resource: 'stock', action: 'read' } },
  { to: '/customers', icon: Users, label: 'العملاء', permission: { resource: 'customers', action: 'read' } },
  { to: '/invoices', icon: FileText, label: 'الفواتير', permission: { resource: 'invoices', action: 'read' } },
  { to: '/returns', icon: RotateCcw, label: 'المرتجعات', permission: { resource: 'invoices', action: 'read' } },
  { to: '/installments', icon: CreditCard, label: 'الأقساط', permission: { resource: 'installments', action: 'read' } },
  { to: '/suppliers', icon: Truck, label: 'الموردون', permission: { resource: 'suppliers', action: 'read' }, feature: 'suppliers' },
  { to: '/purchase-orders', icon: ClipboardList, label: 'أوامر الشراء', permission: { resource: 'purchase_orders', action: 'read' }, feature: 'suppliers' },
  { to: '/expenses', icon: Receipt, label: 'المصروفات', permission: { resource: 'expenses', action: 'read' }, feature: 'expenses' },
  { to: '/services', icon: Wrench, label: 'الخدمات', permission: { resource: 'services', action: 'read' }, feature: 'services' },
  { to: '/work-orders', icon: Hammer, label: 'طلبات العمل', permission: { resource: 'work_orders', action: 'read' }, feature: 'services' },
  { to: '/reports', icon: BarChart3, label: 'التقارير', permission: { resource: 'reports', action: 'read' } },
  { to: '/settings', icon: Settings, label: 'الإعدادات', permission: { resource: 'settings', action: 'read' } },
]

interface SidebarProps {
  open: boolean
  onClose: () => void
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const asideRef = useRef<HTMLElement>(null)
  const { user, logout, hasPermission } = useAuthStore()
  const { data: me } = useMe()
  const features = me?.tenant.plan.features ?? {}

  const [isLg, setIsLg] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const handler = (e: MediaQueryListEvent) => setIsLg(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const isVisible = open || isLg

  useEffect(() => {
    const el = asideRef.current
    if (!el) return
    el.inert = !isVisible
  }, [isVisible])

  const visibleItems = navItems.filter((item) => {
    if (item.permission && !hasPermission(item.permission.resource, item.permission.action)) return false
    if (item.feature && me && !features[item.feature]) return false
    return true
  })

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      logout()
    }
  }

  return (
    <aside
      ref={asideRef}
      aria-hidden={!isVisible}
      className={cn(
        'fixed top-0 right-0 h-full w-60 flex flex-col z-40',
        'bg-[#0D4E36] shadow-xl',
        'transition-transform duration-slow lg:translate-x-0',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center shrink-0 shadow-md">
          <span className="font-display font-bold text-white text-base leading-none">ح</span>
        </div>
        <div>
          <h1 className="font-display text-lg font-bold text-white leading-none">حِسبة</h1>
          <p className="text-[10px] text-white/40 mt-0.5 tracking-wider uppercase">Hesba</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 overflow-y-auto" aria-label="القائمة الرئيسية">
        {visibleItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-4 py-2.5 text-sm transition-all duration-fast mx-2 rounded-lg',
                isActive
                  ? 'bg-white/[0.14] text-white font-semibold shadow-[inset_3px_0_0_0_#1FA971]'
                  : 'text-white/65 hover:bg-white/[0.08] hover:text-white',
              )
            }
          >
            <Icon className="w-[18px] h-[18px] shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User + Logout */}
      <div className="border-t border-white/10 p-4 flex items-center gap-3 bg-black/20">
        <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center shrink-0">
          <span className="text-xs font-semibold text-white">
            {user?.fullName?.charAt(0) ?? '?'}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{user?.fullName}</p>
          <p className="text-xs text-white/45 truncate">{user?.email}</p>
        </div>
        <button
          onClick={handleLogout}
          className="text-white/40 hover:text-white transition-colors duration-fast p-1"
          aria-label="تسجيل الخروج"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </aside>
  )
}
