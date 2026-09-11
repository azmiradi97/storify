import type { ReactNode } from 'react'
import { Navigate, useLocation, Link } from 'react-router-dom'
import { ShieldOff } from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'

export function AuthGuard({ children }: { children: ReactNode }) {
  const { user } = useAuthStore()
  const location = useLocation()

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}

export function GuestGuard({ children }: { children: ReactNode }) {
  const { user } = useAuthStore()

  if (user) {
    return <Navigate to="/pos" replace />
  }

  return <>{children}</>
}

/**
 * Mirror of the backend `requirePermission` middleware. Pair with `AuthGuard`
 * (place RoleGuard inside it) so we know `user` is present.
 *
 * Backend also enforces — this guard exists for UX: avoid the broken half-loaded
 * state when a user navigates by URL to a page they can't actually use.
 */
export function RoleGuard({
  resource,
  action,
  children,
}: {
  resource: string
  action: string
  children: ReactNode
}) {
  const { hasPermission } = useAuthStore()
  if (!hasPermission(resource, action)) return <ForbiddenView resource={resource} action={action} />
  return <>{children}</>
}

// Maps backend resource:action pairs to human-friendly Arabic phrasing.
// Keep this small — the fallback covers anything not in the table.
const RESOURCE_LABEL: Record<string, string> = {
  invoices: 'الفواتير',
  products: 'المنتجات',
  customers: 'العملاء',
  suppliers: 'الموردين',
  purchase_orders: 'أوامر الشراء',
  installments: 'الأقساط',
  expenses: 'المصروفات',
  reports: 'التقارير',
  stock: 'المخزون',
  users: 'المستخدمين',
  payment_methods: 'طرق الدفع',
  billing: 'الاشتراك',
  coupons: 'الكوبونات',
  services: 'الخدمات',
  work_orders: 'طلبات العمل',
}
const ACTION_LABEL: Record<string, string> = {
  read: 'عرض',
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
  approve: 'الموافقة على',
  refund: 'استرداد',
}

function ForbiddenView({ resource, action }: { resource: string; action: string }) {
  const resourceLabel = RESOURCE_LABEL[resource] ?? resource
  const actionLabel = ACTION_LABEL[action] ?? action
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-white border border-gray-700 rounded-xl p-6 flex flex-col items-center text-center gap-4 shadow-sm">
        <div className="w-14 h-14 rounded-full bg-warning-500/10 flex items-center justify-center">
          <ShieldOff className="w-7 h-7 text-warning-500" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-100">صلاحية غير كافية</h2>
          <p className="text-sm text-gray-400 mt-1">
            ليس لديك صلاحية {actionLabel} {resourceLabel}. تواصل مع مدير الحساب لطلب الصلاحية.
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm rounded-md transition-colors"
        >
          الرئيسية
        </Link>
      </div>
    </div>
  )
}
