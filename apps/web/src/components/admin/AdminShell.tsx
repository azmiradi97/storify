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
          'fixed top-0 right-0 h-full w-60 bg-gray-900 border-l border-gray-800 flex flex-col z-40',
          'transition-transform duration-200 lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="px-6 py-5 border-b border-gray-800 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-brand-400" />
          <div>
            <h1 className="font-display text-lg font-bold text-brand-400 leading-tight">حِسبة</h1>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest">Admin</p>
          </div>
        </div>

        <nav className="flex-1 py-4 overflow-y-auto" aria-label="القائمة">
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
                    ? 'bg-brand-500/12 text-brand-400 font-medium shadow-[inset_3px_0_0_0_#1FA971]'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200',
                )
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-gray-800 p-4 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-200 truncate">{admin?.fullName}</p>
            <p className="text-xs text-gray-500 truncate">{admin?.email}</p>
            <p className="text-[10px] text-brand-400 mt-0.5">{admin?.role === 'OWNER' ? 'مالك' : 'مسؤول'}</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-gray-500 hover:text-danger-500 transition-colors p-1"
            aria-label="تسجيل الخروج"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-gray-900/70 backdrop-blur-sm z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="lg:mr-60 flex flex-col min-h-dvh">
        {/* Top bar */}
        <header className="h-14 bg-gray-900 border-b border-gray-800 flex items-center px-4 sm:px-6 gap-4">
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
