import { useState, useEffect, type ReactNode } from 'react'
import { NavLink, useLocation, Navigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Building2,
  Package2,
  CreditCard,
  Users,
  ScrollText,
  LogOut,
  Menu,
  ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useAdminAuthStore } from '@/stores/admin-auth.store'
import { adminApi } from '@/api/admin-client'

interface NavItem {
  to: string
  icon: typeof LayoutDashboard
  label: string
  ownerOnly?: boolean
}

const navItems: NavItem[] = [
  { to: '/admin', icon: LayoutDashboard, label: 'لوحة التحكم' },
  { to: '/admin/tenants', icon: Building2, label: 'المتاجر' },
  { to: '/admin/plans', icon: Package2, label: 'الباقات' },
  { to: '/admin/subscriptions', icon: CreditCard, label: 'الاشتراكات' },
  { to: '/admin/admins', icon: Users, label: 'المسؤولون', ownerOnly: true },
  { to: '/admin/audit-logs', icon: ScrollText, label: 'سجل النشاط' },
]

export function AdminAuthGuard({ children }: { children: ReactNode }) {
  const { admin } = useAdminAuthStore()
  const location = useLocation()
  if (!admin) return <Navigate to="/admin/login" state={{ from: location }} replace />
  return <>{children}</>
}

export function AdminGuestGuard({ children }: { children: ReactNode }) {
  const { admin } = useAdminAuthStore()
  if (admin) return <Navigate to="/admin" replace />
  return <>{children}</>
}

interface AdminShellProps {
  children: ReactNode
  title?: string
}

export function AdminShell({ children, title }: AdminShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { admin, logout, isOwner } = useAdminAuthStore()
  const location = useLocation()

  useEffect(() => setSidebarOpen(false), [location.pathname])

  const visibleItems = navItems.filter((i) => !i.ownerOnly || isOwner())

  const handleLogout = async () => {
    try {
      await adminApi.post('/logout')
    } finally {
      logout()
    }
  }

  return (
    <div className="min-h-dvh bg-app">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 right-0 h-full w-60 bg-[#0D4E36] shadow-xl flex flex-col z-40',
          'transition-transform duration-200 lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="px-5 py-5 border-b border-white/10 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center shrink-0 shadow-md">
            <ShieldCheck className="w-[18px] h-[18px] text-white" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold text-white leading-none">حِسبة</h1>
            <p className="text-[10px] text-white/40 mt-0.5 tracking-wider uppercase">Admin Panel</p>
          </div>
        </div>

        <nav className="flex-1 py-3 overflow-y-auto" aria-label="القائمة">
          {visibleItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/admin'}
              onClick={() => setSidebarOpen(false)}
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

        <div className="border-t border-white/10 p-4 flex items-center gap-3 bg-black/20">
          <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-white">
              {admin?.fullName?.charAt(0) ?? '؟'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{admin?.fullName}</p>
            <p className="text-xs text-white/45 truncate">{admin?.email}</p>
            <p className="text-[10px] text-brand-300 mt-0.5">{admin?.role === 'OWNER' ? 'مالك' : 'مسؤول'}</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-white/40 hover:text-white transition-colors p-1"
            aria-label="تسجيل الخروج"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="lg:mr-60 flex flex-col min-h-dvh">
        {/* Top bar */}
        <header className="h-14 bg-white border-b border-gray-700 shadow-sm flex items-center px-4 sm:px-6 gap-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-gray-400 hover:text-gray-100"
            aria-label="فتح القائمة"
          >
            <Menu className="w-5 h-5" />
          </button>
          <h2 className="text-sm font-semibold text-gray-100">{title ?? 'لوحة الإدارة'}</h2>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 animate-fade-in">{children}</main>
      </div>
    </div>
  )
}
