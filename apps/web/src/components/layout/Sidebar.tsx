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

// Each entry is gated by a (resource, action) the user must have to see it.
// Super-admin bypasses these via `hasPermission`. The backend enforces the
// same checks per-route, so this is purely UX — hides menu items the user
// would 403 on anyway. POS / settings/password are visible to everyone.
// `feature` adds a second layer for plan-gated items (suppliers, expenses…).
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
  // Settings is split — most pages need settings.read, but every user can
  // still reach the password tab via direct URL. Filter on settings.read
  // for the nav, and route-level guard allows password tab regardless.
  { to: '/settings', icon: Settings, label: 'الإعدادات', permission: { resource: 'settings', action: 'read' } },
]

interface SidebarProps {
  /** Whether the mobile drawer is open. Ignored on lg+ (always visible there). */
  open: boolean
  /** Close handler — called after navigation on mobile so the drawer auto-dismisses. */
  onClose: () => void
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const asideRef = useRef<HTMLElement>(null)
  const { user, logout, hasPermission } = useAuthStore()
  const { data: me } = useMe()
  const features = me?.tenant.plan.features ?? {}

  // Track large-screen breakpoint so we never aria-hide a visible sidebar
  const [isLg, setIsLg] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const handler = (e: MediaQueryListEvent) => setIsLg(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const isVisible = open || isLg

  // Set inert imperatively (not a React prop in React 18 types)
  useEffect(() => {
    const el = asideRef.current
    if (!el) return
    el.inert = !isVisible
  }, [isVisible])

  const visibleItems = navItems.filter((item) => {
    if (item.permission && !hasPermission(item.permission.resource, item.permission.action)) return false
    // Hide plan-gated items until `useMe` resolves to avoid flicker — Sidebar
    // re-renders when `me` loads, so the items reappear if the feature is on.
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
        'fixed top-0 right-0 h-full w-60 bg-white border-l border-gray-700 flex flex-col z-40',
        'transition-transform duration-slow lg:translate-x-0',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      {/* Logo */}
      <div className="px-6 py-5 border-b border-gray-700">
        <h1 className="font-display text-2xl font-bold text-brand-400">حِسبة</h1>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 overflow-y-auto" aria-label="القائمة الرئيسية">
        {visibleItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-4 py-2.5 text-sm transition-all duration-fast mx-2 rounded-lg',
                isActive
                  ? 'bg-brand-500/12 text-brand-400 font-medium shadow-[inset_3px_0_0_0_#1FA971]'
                  : 'text-gray-400 hover:bg-gray-750 hover:text-gray-200',
              )
            }
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User + Logout */}
      <div className="border-t border-gray-700 p-4 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-200 truncate">{user?.fullName}</p>
          <p className="text-xs text-gray-500 truncate">{user?.email}</p>
        </div>
        <button
          onClick={handleLogout}
          className="text-gray-500 hover:text-danger-500 transition-colors duration-fast p-1"
          aria-label="تسجيل الخروج"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </aside>
  )
}
