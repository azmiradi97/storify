import { useNavigate } from 'react-router-dom'
import { Store, Package, ShoppingCart, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'
import { Button } from '@/components/ui'

const STEPS = [
  {
    icon: Store,
    title: 'إعداد الفروع',
    desc: 'أضف فرعك الأول وحدد عنوانه وبياناته.',
    href: '/settings',
    color: 'text-brand-400',
    bg: 'bg-brand-500/10',
  },
  {
    icon: Package,
    title: 'إضافة المنتجات',
    desc: 'أضف أصناف وأقسام منتجاتك حتى تكون جاهزًا للبيع.',
    href: '/products',
    color: 'text-success-400',
    bg: 'bg-success-500/10',
  },
  {
    icon: ShoppingCart,
    title: 'ابدأ البيع',
    desc: 'افتح نقطة البيع وأجرِ أول عملية بيع.',
    href: '/pos',
    color: 'text-warning-400',
    bg: 'bg-warning-500/10',
  },
]

export default function Onboarding() {
  const navigate = useNavigate()
  const { user, tenantSubdomain } = useAuthStore()

  function finish(destination: string) {
    if (user?.id) localStorage.setItem(`hesba_onboarded_${user.id}`, '1')
    navigate(destination, { replace: true })
  }

  return (
    <div className="min-h-dvh bg-app flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-500/10 mb-4">
            <CheckCircle2 className="w-8 h-8 text-brand-400" />
          </div>
          <h1 className="font-display text-3xl font-bold text-gray-100 mb-2">
            مرحبًا بك في حِسبة 🎉
          </h1>
          <p className="text-gray-400 text-sm">
            متجرك{' '}
            <span className="text-brand-400 font-medium">{tenantSubdomain}</span>{' '}
            جاهز. اتبع الخطوات أدناه لإعداده بسرعة.
          </p>
        </div>

        {/* Step cards */}
        <div className="flex flex-col gap-3 mb-8">
          {STEPS.map(({ icon: Icon, title, desc, href, color, bg }) => (
            <button
              key={href}
              onClick={() => finish(href)}
              className="flex items-center gap-4 p-4 rounded-xl bg-gray-800 border border-gray-700 hover:border-brand-500 hover:bg-gray-750 transition-colors text-right w-full group"
            >
              <div className={`flex-shrink-0 w-12 h-12 rounded-xl ${bg} flex items-center justify-center`}>
                <Icon className={`w-6 h-6 ${color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-gray-100 font-medium text-sm">{title}</p>
                <p className="text-gray-400 text-xs mt-0.5">{desc}</p>
              </div>
              <ArrowLeft className="w-4 h-4 text-gray-500 group-hover:text-brand-400 transition-colors flex-shrink-0 rotate-180" />
            </button>
          ))}
        </div>

        {/* Skip to dashboard */}
        <div className="text-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => finish('/dashboard')}
            className="text-gray-400 hover:text-gray-200"
          >
            تخطّ — اذهب للوحة التحكم
          </Button>
        </div>
      </div>
    </div>
  )
}
