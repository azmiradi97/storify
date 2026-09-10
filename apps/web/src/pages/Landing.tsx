import { Fragment, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ShoppingCart,
  Package,
  FileText,
  CreditCard,
  BarChart3,
  Users,
  Wallet,
  Building2,
  Check,
  ChevronDown,
  ArrowLeft,
  Sparkles,
  AlertTriangle,
  Receipt,
  Banknote,
  Calculator,
  Repeat,
  Award,
  Globe,
} from 'lucide-react'
import { Button } from '@/components/ui'
import { useAuthStore } from '@/stores/auth.store'
import { api } from '@/api/client'
import { track } from '@/lib/analytics'
import { SALES_MESSAGES, whatsappLink } from '@/lib/contact'

interface Plan {
  id: string
  name: string
  slug: string
  description: string | null
  priceMonthly: string | number
  priceYearly: string | number
  maxProducts: number
  maxOrders: number
  maxUsers: number
  maxInstallmentPlansMonthly?: number
  features: Record<string, boolean | number>
}

// Value-anchor copy per plan slug (under the price headline).
// Reframes "199 EGP/mo" from cost to compared-value.
const PRICE_ANCHORS: Record<string, string> = {
  starter: 'أقل من 7 جنيه/يوم — ثمن قهوتين',
  professional: 'أرخص من نص ساعة من محاسب شاطر',
  enterprise: 'بنسعّر حسب حجم نشاطك وعدد فروعك',
}

// Display price for Enterprise — anchor only, real price quoted via sales.
const ENTERPRISE_ANCHOR_PRICE = 2499

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Landing() {
  const user = useAuthStore((s) => s.user)

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['landing-plans'],
    queryFn: async () => {
      const res = await api.get('/plans')
      return (res.data?.data ?? []) as Plan[]
    },
    staleTime: 5 * 60 * 1000,
  })

  return (
    <div className="min-h-dvh bg-app text-gray-100 font-body">
      <Header user={user} />
      <Hero />
      <TrustBar />
      <PainPoints />
      <Features />
      <MidCTA />
      <Pricing plans={plans} />
      {/* Testimonials removed — re-add once we have real customer quotes.
          Fake testimonials hurt trust and violate Google review policies. */}
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  )
}

// ─── Header ──────────────────────────────────────────────────────────────────

function Header({ user }: { user: ReturnType<typeof useAuthStore.getState>['user'] }) {
  const [open, setOpen] = useState(false)

  const NavLinks = (
    <>
      <a href="#features" className="text-sm text-gray-400 hover:text-gray-100 transition-colors">
        المميزات
      </a>
      <a href="#pricing" className="text-sm text-gray-400 hover:text-gray-100 transition-colors">
        الباقات
      </a>
      <a href="#faq" className="text-sm text-gray-400 hover:text-gray-100 transition-colors">
        الأسئلة الشائعة
      </a>
    </>
  )

  return (
    <header className="sticky top-0 z-50 bg-app/80 backdrop-blur border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-brand-500 flex items-center justify-center font-display font-bold text-white">
            ح
          </div>
          <span className="font-display text-xl font-bold text-gray-100">حِسبة</span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-warning-500/15 text-warning-500 border border-warning-500/30">
            BETA
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-6">{NavLinks}</nav>

        <div className="hidden md:flex items-center gap-2">
          {user ? (
            <Link
              to="/dashboard"
              onClick={() => track('secondary_cta_click', { location: 'header', destination: '/dashboard' })}
            >
              <Button variant="primary" size="md">
                افتح لوحة التحكم
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              </Button>
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                onClick={() => track('secondary_cta_click', { location: 'header', destination: '/login' })}
              >
                <Button variant="ghost" size="md">
                  تسجيل دخول
                </Button>
              </Link>
              <Link
                to="/register"
                onClick={() => track('secondary_cta_click', { location: 'header', destination: '/register' })}
              >
                <Button variant="primary" size="md">
                  ابدأ مجاناً
                </Button>
              </Link>
            </>
          )}
        </div>

        <button
          className="md:hidden p-2 text-gray-300"
          onClick={() => setOpen((v) => !v)}
          aria-label="القائمة"
        >
          <ChevronDown className={`w-5 h-5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-gray-800 px-4 py-3 flex flex-col gap-3 bg-app">
          {NavLinks}
          <div className="flex gap-2 pt-2 border-t border-gray-800">
            {user ? (
              <Link to="/dashboard" className="flex-1">
                <Button variant="primary" size="md" className="w-full">
                  افتح لوحة التحكم
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/login" className="flex-1">
                  <Button variant="ghost" size="md" className="w-full">
                    تسجيل دخول
                  </Button>
                </Link>
                <Link to="/register" className="flex-1">
                  <Button variant="primary" size="md" className="w-full">
                    ابدأ مجاناً
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  )
}

// ─── Hero ────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-brand-900/20 via-app to-app pointer-events-none" />
      <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-brand-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 py-20 md:py-28 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-900/40 border border-brand-500/30 text-brand-300 text-xs mb-6">
          <Sparkles className="w-3.5 h-3.5" />
          نظام إدارة متاجر متكامل — مصري بالكامل
        </div>

        <h1 className="font-display text-4xl md:text-6xl font-bold text-gray-50 leading-tight mb-6">
          كل اللي تجارتك محتاجاه
          <br />
          <span className="bg-gradient-to-r from-brand-400 to-brand-300 bg-clip-text text-transparent">
            في مكان واحد.
          </span>
        </h1>

        <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          نقطة بيع، مخزون، أقساط، فاتورة إلكترونية معتمدة من ETA، تقارير لحظية.
          <br />
          لمتجرك أو سلسلة فروعك في مصر.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-4">
          <Link to="/register" onClick={() => track('hero_cta_click', { destination: '/register' })}>
            <Button variant="primary" size="xl">
              ابدأ تجربتك المجانية
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            </Button>
          </Link>
          <a
            href="#pricing"
            onClick={() => track('secondary_cta_click', { location: 'hero', destination: '#pricing' })}
          >
            <Button variant="outline" size="xl">
              شوف الباقات
            </Button>
          </a>
        </div>

        <p className="text-sm text-gray-500 mb-8">
          ابدأ من <span className="font-mono num text-gray-300">199</span> جنيه/شهر
          <span className="mx-2 text-gray-700">·</span>
          أو جرب <span className="text-gray-300">30 يوم</span> مجاناً
        </p>

        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-gray-500">
          <span className="flex items-center gap-1.5">
            <Check className="w-4 h-4 text-success-500" />
            شهر تجريبي مجاني
          </span>
          <span className="flex items-center gap-1.5">
            <Check className="w-4 h-4 text-success-500" />
            بدون كارت ائتمان
          </span>
          <span className="flex items-center gap-1.5">
            <Check className="w-4 h-4 text-success-500" />
            إعداد في 5 دقايق
          </span>
        </div>
      </div>
    </section>
  )
}

// ─── Trust bar ───────────────────────────────────────────────────────────────

function TrustBar() {
  const items = [
    { label: 'الفاتورة الإلكترونية', value: 'SDK ETA الرسمي' },
    { label: 'الدفع', value: 'Paymob + 6 طرق' },
    { label: 'الأمان', value: 'نسخ احتياطي يومي' },
    { label: 'الفروع', value: 'بلا حدود' },
  ]
  return (
    <section className="border-y border-gray-800 bg-gray-900/40">
      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-2 md:grid-cols-4 gap-6">
        {items.map((it) => (
          <div key={it.label} className="text-center">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{it.label}</div>
            <div className="text-sm font-semibold text-gray-200">{it.value}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Pain points ─────────────────────────────────────────────────────────────

function PainPoints() {
  const pains = [
    {
      icon: Receipt,
      title: 'ضايع وقتك في الفواتير اليدوية؟',
      body: 'كل فاتورة بتاخد منك دقايق، وبتغلط، والعملاء بيستنوا في الطابور.',
    },
    {
      icon: Package,
      title: 'مش عارف بضاعتك راحت فين؟',
      body: 'مخزون بلا متابعة = خسارة فعلية. نقص، فقد، وعدم القدرة تطلب الكميات الصح.',
    },
    {
      icon: AlertTriangle,
      title: 'متخوف من غرامات ETA؟',
      body: 'الفاتورة الإلكترونية مش اختياري. غرامة عدم الالتزام بتبدأ من 20 ألف جنيه.',
    },
    {
      icon: Calculator,
      title: 'أقساط بتديرها على ورق؟',
      body: 'دفتر أقساط ضايع = أقساط مش متحصلة. ومتأخرات بتتراكم بدون ما تحس.',
    },
    {
      icon: Building2,
      title: 'فروع متعددة بدون رؤية؟',
      body: 'كل فرع له نظامه. مش قادر تقارن، أو تنقل بضاعة، أو تشوف الصورة الكاملة.',
    },
    {
      icon: Wallet,
      title: 'بتخسر عملاء عشان طرق دفع محدودة؟',
      body: 'العميل عاوز يدفع فيزا أو فلوسة أو InstaPay. أنت بتاخد كاش بس.',
    },
  ]

  return (
    <section className="py-20 md:py-28">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <div className="inline-block px-3 py-1 rounded-full bg-danger-500/10 text-danger-500 text-xs font-medium mb-4">
            المشاكل اللي بتقابلك
          </div>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-gray-50 mb-4">
            عارفين تماماً اللي بيوجعك في إدارة المتجر.
          </h2>
          <p className="text-gray-400 leading-relaxed">
            مش بس نظام. نظام مبني خصيصاً للسوق المصري — بكل تحدياته.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {pains.map((p) => (
            <div
              key={p.title}
              className="bg-gray-800/60 border border-gray-800 rounded-xl p-6 hover:border-gray-700 transition-colors"
            >
              <div className="w-10 h-10 rounded-md bg-danger-500/10 text-danger-500 flex items-center justify-center mb-4">
                <p.icon className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-gray-100 mb-2">{p.title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Features ────────────────────────────────────────────────────────────────

function Features() {
  const features = [
    {
      icon: ShoppingCart,
      title: 'نقطة بيع سريعة',
      body: 'POS يشتغل على موبايل وتابلت وكمبيوتر. بحث فوري، خصومات، واختصارات كيبورد للسرعة.',
      tag: 'POS',
    },
    {
      icon: Package,
      title: 'مخزون متعدد الفروع',
      body: 'تتبع لحظي لكل قطعة. تنبيهات نفاد، نقل بين الفروع، وجرد دقيق.',
      tag: 'Stock',
    },
    {
      icon: FileText,
      title: 'فاتورة إلكترونية ETA',
      body: 'تكامل مباشر مع مصلحة الضرائب. كل فاتورة تتأرشف وتُرسل تلقائياً.',
      tag: 'ETA',
    },
    {
      icon: Calculator,
      title: 'نظام أقساط كامل',
      body: 'إنشاء، متابعة، وتذكيرات تلقائية للأقساط. تقارير متأخرات لحظية.',
      tag: 'Installments',
    },
    {
      icon: CreditCard,
      title: '6 طرق دفع جاهزة',
      body: 'نقدي، فيزا/ماستر، فلوسة، InstaPay، فاليو، تحويل بنكي — مع رسوم تلقائية.',
      tag: 'Payments',
    },
    {
      icon: BarChart3,
      title: 'تقارير وتحليلات',
      body: 'مبيعات يومية، أرباح، أداء الموظفين، حركة المخزون — كله في لوحة واحدة.',
      tag: 'Reports',
    },
    {
      icon: Award,
      title: 'برنامج ولاء',
      body: 'نقاط لكل عملية شراء، استبدال، وتخصيص قواعدك حسب نشاطك.',
      tag: 'Loyalty',
    },
    {
      icon: Users,
      title: 'إدارة العملاء',
      body: 'سجل كامل لكل عميل: مشترياته، أقساطه، رصيده — وتواصل مباشر بالواتساب.',
      tag: 'CRM',
    },
    {
      icon: Globe,
      title: 'متعدد العملات',
      body: 'بِع وفوتر بأي عملة. تحويل تلقائي، وأسعار صرف محدّثة.',
      tag: 'Multi-Currency',
    },
    {
      icon: Repeat,
      title: 'مرتجعات ومصروفات',
      body: 'استرداد بضاعة بضغطة، وتسجيل مصروفات بـ 6 فئات وميزانيات.',
      tag: 'Returns',
    },
    {
      icon: Building2,
      title: 'موردين وأوامر شراء',
      body: 'أوامر شراء، استلام جزئي، ومتابعة موردين مع شروط دفعهم.',
      tag: 'Suppliers',
    },
    {
      icon: Banknote,
      title: 'تقفيل يومي',
      body: 'Day-close تلقائي. مقارنة الكاش الفعلي بالنظام، وفروقات موثقة.',
      tag: 'Day Close',
    },
  ]

  return (
    <section id="features" className="py-20 md:py-28 bg-gray-900/40 border-y border-gray-800">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <div className="inline-block px-3 py-1 rounded-full bg-brand-500/10 text-brand-300 text-xs font-medium mb-4">
            المميزات
          </div>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-gray-50 mb-4">
            مش مجرد نظام. منظومة كاملة لإدارة تجارتك.
          </h2>
          <p className="text-gray-400 leading-relaxed">
            12 وحدة متكاملة، بتشتغل مع بعض، وبتغطي كل جانب من جوانب البيع بالتجزئة.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="group bg-gray-800/60 border border-gray-800 rounded-xl p-6 hover:border-brand-500/40 hover:bg-gray-800 transition-all"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-md bg-brand-500/10 text-brand-400 flex items-center justify-center group-hover:bg-brand-500 group-hover:text-white transition-colors">
                  <f.icon className="w-5 h-5" />
                </div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-gray-600" dir="ltr">
                  {f.tag}
                </span>
              </div>
              <h3 className="font-semibold text-gray-100 mb-2">{f.title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Mid-page CTA — bridges Features → Pricing ───────────────────────────────

function MidCTA() {
  return (
    <section className="py-10">
      <div className="max-w-3xl mx-auto px-4">
        <div className="bg-gradient-to-l from-brand-900/40 to-gray-900/40 border border-brand-500/30 rounded-xl px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-center sm:text-right">
            <div className="font-semibold text-gray-100 mb-1">
              عجبتك المميزات؟ ابدأ تجربتك في 5 دقايق.
            </div>
            <div className="text-sm text-gray-400">شهر مجاني · بدون كارت ائتمان</div>
          </div>
          <Link
            to="/register"
            className="shrink-0"
            onClick={() => track('midcta_cta_click', { destination: '/register' })}
          >
            <Button variant="primary" size="lg">
              ابدأ مجاناً
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  )
}

// ─── Pricing ─────────────────────────────────────────────────────────────────

function Pricing({ plans }: { plans: Plan[] }) {
  const [yearly, setYearly] = useState(false)
  const sectionRef = useRef<HTMLElement | null>(null)
  const viewedRef = useRef(false)

  // Fire plan_card_view once when the pricing section scrolls into view.
  // IntersectionObserver gives us cheap, accurate "did the user actually
  // see this section" data — useful for funnel drop-off analysis.
  useEffect(() => {
    if (!sectionRef.current || viewedRef.current) return
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !viewedRef.current) {
            viewedRef.current = true
            track('plan_card_view', { plan_count: plans.length })
            obs.disconnect()
          }
        }
      },
      { threshold: 0.3 },
    )
    obs.observe(sectionRef.current)
    return () => obs.disconnect()
  }, [plans.length])

  // Sort by sortOrder if provided, fall back to API order
  const sorted = [...plans].sort((a, b) =>
    String(a.priceMonthly).localeCompare(String(b.priceMonthly), undefined, { numeric: true }),
  )

  return (
    <section id="pricing" ref={sectionRef} className="py-20 md:py-28">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <div className="inline-block px-3 py-1 rounded-full bg-brand-500/10 text-brand-300 text-xs font-medium mb-4">
            الباقات
          </div>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-gray-50 mb-4">
            باقات بسيطة. اختار اللي يناسب حجم متجرك.
          </h2>
          <p className="text-gray-400 leading-relaxed">
            كل الباقات بتجي بشهر تجريبي مجاني. تقدر تغير أو تلغي في أي وقت.
          </p>

          <div role="group" aria-label="فترة الفواتير" className="inline-flex items-center gap-1 mt-6 p-1 bg-gray-800 rounded-md border border-gray-700">
            <button
              type="button"
              aria-pressed={!yearly}
              onClick={() => {
                setYearly(false)
                track('pricing_toggle_yearly', { billing: 'monthly' })
              }}
              className={`px-4 py-1.5 text-sm rounded transition-colors ${
                !yearly ? 'bg-brand-500 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              شهري
            </button>
            <button
              type="button"
              aria-pressed={yearly}
              onClick={() => {
                setYearly(true)
                track('pricing_toggle_yearly', { billing: 'yearly' })
              }}
              className={`px-4 py-1.5 text-sm rounded transition-colors ${
                yearly ? 'bg-brand-500 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              سنوي
              <span className="mr-2 text-[10px] bg-success-500/20 text-success-500 px-1.5 py-0.5 rounded">
                وفر ~17%
              </span>
            </button>
          </div>
        </div>

        <VsAlternativesStrip />

        {sorted.length === 0 ? (
          <div className="text-center text-gray-500 py-12">جاري تحميل الباقات…</div>
        ) : (
          <div className="grid md:grid-cols-3 gap-4 max-w-5xl mx-auto">
            {sorted.map((plan, idx) => {
              const isFeatured = idx === 1
              const isEnterprise = plan.slug === 'enterprise'
              const price = yearly ? Number(plan.priceYearly) / 12 : Number(plan.priceMonthly)
              return (
                <div
                  key={plan.id}
                  className={`relative bg-gray-800/60 border rounded-xl p-6 flex flex-col ${
                    isFeatured
                      ? 'border-brand-500 ring-2 ring-brand-500/30 lg:scale-105'
                      : 'border-gray-800'
                  }`}
                >
                  {isFeatured && (
                    <div className="absolute -top-3 right-6 px-3 py-1 bg-brand-500 text-white text-xs font-medium rounded">
                      الأكثر شعبية
                    </div>
                  )}

                  <div className="mb-6">
                    <h3 className="font-display text-xl font-bold text-gray-100 mb-1">{plan.name}</h3>
                    <p className="text-sm text-gray-400">{plan.description ?? ''}</p>
                  </div>

                  <div className="mb-4">
                    {isEnterprise ? (
                      <>
                        <div className="text-xs text-gray-500 mb-1">ابتداءً من</div>
                        <div className="flex items-baseline gap-1">
                          <span className="font-numeric text-4xl font-bold num num-primary">
                            {ENTERPRISE_ANCHOR_PRICE.toLocaleString('ar-EG-u-nu-latn')}
                          </span>
                          <span className="text-gray-400 text-sm">جنيه / شهر</span>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-1">
                          سعر أساسي — السعر النهائي حسب عدد الفروع والمستخدمين
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-1">
                          <span className="font-numeric text-4xl font-bold num num-primary">
                            {Math.round(price)}
                          </span>
                          <span className="text-gray-400 text-sm">جنيه / شهر</span>
                        </div>
                        {yearly && (() => {
                          const annual = Number(plan.priceYearly)
                          const monthly = Number(plan.priceMonthly)
                          const yearlyEquivOfMonthly = monthly * 12
                          const savings = Math.max(0, yearlyEquivOfMonthly - annual)
                          return (
                            <p className="text-xs text-success-500 mt-1">
                              فاتورة سنوية {annual.toLocaleString('ar-EG-u-nu-latn')} جنيه
                              {savings > 0 && (
                                <span className="mr-1 text-gray-400">
                                  (توفير {savings.toLocaleString('ar-EG-u-nu-latn')} جنيه/سنة)
                                </span>
                              )}
                            </p>
                          )
                        })()}
                      </>
                    )}
                    {PRICE_ANCHORS[plan.slug] && (
                      <p className="text-xs text-gray-500 mt-2">{PRICE_ANCHORS[plan.slug]}</p>
                    )}
                  </div>

                  {/* Limits strip — scannable comparison across plans */}
                  <div className="grid grid-cols-3 gap-2 mb-6 py-3 border-y border-gray-700/50">
                    <LimitStat
                      value={
                        plan.maxProducts >= 999_999
                          ? '∞'
                          : formatCompact(plan.maxProducts)
                      }
                      label="منتج"
                    />
                    <LimitStat
                      value={
                        plan.maxOrders >= 999_999
                          ? '∞'
                          : formatCompact(plan.maxOrders)
                      }
                      label="طلب / شهر"
                    />
                    <LimitStat
                      value={
                        plan.maxUsers >= 999_999 ? '∞' : String(plan.maxUsers)
                      }
                      label="مستخدمين"
                    />
                  </div>

                  <ul className="space-y-2 mb-8 flex-1 text-sm text-gray-300">
                    <FeatureLine enabled={(plan.maxInstallmentPlansMonthly ?? 0) > 0}>
                      أقساط
                      {(plan.maxInstallmentPlansMonthly ?? 0) > 0 && (
                        <span className="text-xs text-gray-500 mr-1">
                          {plan.maxInstallmentPlansMonthly! >= 999_999
                            ? '— بلا حدود'
                            : `— حتى ${plan.maxInstallmentPlansMonthly} خطة/شهر`}
                        </span>
                      )}
                    </FeatureLine>
                    <FeatureLine enabled={Boolean(plan.features?.multi_currency)}>عملات متعددة</FeatureLine>
                    <FeatureLine enabled={Boolean(plan.features?.suppliers)}>موردين وأوامر شراء</FeatureLine>
                    <FeatureLine enabled={Boolean(plan.features?.expenses)}>مصروفات</FeatureLine>
                    <FeatureLine enabled={Boolean(plan.features?.advanced_reports)}>تقارير متقدمة</FeatureLine>
                    <FeatureLine enabled={Boolean(plan.features?.api_access)}>API access</FeatureLine>
                  </ul>

                  {isEnterprise ? (
                    <a
                      href={whatsappLink(SALES_MESSAGES.enterprise)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() =>
                        track('enterprise_contact_click', {
                          channel: 'whatsapp',
                          source: 'pricing_card',
                          position: idx,
                        })
                      }
                    >
                      <Button variant="outline" size="lg" className="w-full">
                        تواصل معنا
                        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                      </Button>
                    </a>
                  ) : (
                    <Link
                      to={`/register?plan=${plan.slug}`}
                      onClick={() =>
                        track('plan_card_click', {
                          plan_slug: plan.slug,
                          plan_name: plan.name,
                          billing: yearly ? 'yearly' : 'monthly',
                          position: idx,
                          is_featured: isFeatured,
                        })
                      }
                    >
                      <Button variant={isFeatured ? 'primary' : 'outline'} size="lg" className="w-full">
                        ابدأ بـ {plan.name}
                      </Button>
                    </Link>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <p className="text-center text-xs text-gray-500 mt-8">
          الأسعار بالجنيه المصري وشاملة ضريبة القيمة المضافة.
        </p>
      </div>
    </section>
  )
}

function FeatureLine({ children, enabled = true }: { children: React.ReactNode; enabled?: boolean }) {
  return (
    <li className={`flex items-center gap-2 ${enabled ? '' : 'opacity-40 line-through'}`}>
      <Check
        className={`w-4 h-4 ${enabled ? 'text-success-500' : 'text-gray-600'}`}
        aria-hidden="true"
      />
      <span>{children}</span>
    </li>
  )
}

function LimitStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="font-mono text-lg font-bold text-gray-100 num leading-none mb-1">
        {value}
      </div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
    </div>
  )
}

// 1234 -> "1.2K", 50000 -> "50K", 500 -> "500"
function formatCompact(n: number): string {
  if (n >= 1000) {
    const k = n / 1000
    return (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + 'K'
  }
  return String(n)
}

// ─── vs-Alternatives strip ───────────────────────────────────────────────────
// Reframes the price by comparing to the real alternatives Egyptian retail
// uses today: paper/Excel (free but slow + ETA risk) and a manual accountant
// (1.5-3k EGP/mo). Anchors Hesba Starter as the obvious value.

function VsAlternativesStrip() {
  const rows = [
    {
      label: 'السرعة',
      paper: 'بطيء',
      accountant: '2-3 أيام',
      hesba: 'لحظي',
      hesbaGood: true,
    },
    {
      label: 'ETA معتمد',
      paper: 'لا (غرامة 20,000+ جنيه)',
      accountant: 'جزئي',
      hesba: 'بالكامل',
      hesbaGood: true,
    },
    {
      label: 'أقساط',
      paper: 'يدوي / دفتر',
      accountant: 'لا',
      hesba: 'نظام كامل',
      hesbaGood: true,
    },
    {
      label: 'التكلفة الشهرية',
      paper: 'وقتك (4-6 ساعات/يوم)',
      accountant: '1,500–3,000 جنيه',
      hesba: 'من 199 جنيه',
      hesbaGood: true,
    },
  ]
  return (
    <div className="max-w-5xl mx-auto mb-12 bg-gray-800/40 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-800 bg-gray-900/40">
        <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">قارن بنفسك</div>
        <div className="text-sm text-gray-300">
          منافسنا الحقيقي مش نظام تاني — منافسنا هو الورقة والمحاسب.
        </div>
      </div>
      <div className="grid grid-cols-4 text-xs sm:text-sm">
        <div className="px-3 py-3 bg-gray-900/30 border-b border-gray-800 text-gray-500 text-[10px] uppercase tracking-wider">
          المعيار
        </div>
        <div className="px-3 py-3 bg-gray-900/30 border-b border-gray-800 text-center text-gray-400">
          📓 ورق / Excel
        </div>
        <div className="px-3 py-3 bg-gray-900/30 border-b border-gray-800 text-center text-gray-400">
          🧾 محاسب يدوي
        </div>
        <div className="px-3 py-3 bg-brand-900/40 border-b border-brand-500/40 text-center font-semibold text-brand-300">
          ⚡ حِسبة
        </div>

        {rows.map((r, i) => (
          <Fragment key={r.label}>
            <div
              className={`px-3 py-3 text-gray-300 ${
                i < rows.length - 1 ? 'border-b border-gray-800/60' : ''
              }`}
            >
              {r.label}
            </div>
            <div
              className={`px-3 py-3 text-center text-gray-500 ${
                i < rows.length - 1 ? 'border-b border-gray-800/60' : ''
              }`}
            >
              {r.paper}
            </div>
            <div
              className={`px-3 py-3 text-center text-gray-500 ${
                i < rows.length - 1 ? 'border-b border-gray-800/60' : ''
              }`}
            >
              {r.accountant}
            </div>
            <div
              className={`px-3 py-3 text-center font-medium ${
                r.hesbaGood ? 'text-success-500' : 'text-gray-300'
              } ${i < rows.length - 1 ? 'border-b border-brand-500/20 bg-brand-900/20' : 'bg-brand-900/20'}`}
            >
              {r.hesba}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────

function FAQ() {
  const items = [
    {
      q: 'هل التجربة المجانية بتحتاج كارت ائتمان؟',
      a: 'لا، أبداً. سجّل، استخدم كل المميزات لشهر كامل، وادفع بس لما تقتنع. وقتها تختار طريقة الدفع.',
    },
    {
      q: 'هل النظام بيدعم الفاتورة الإلكترونية ETA؟',
      a: 'آه — تكامل مباشر مع مصلحة الضرائب. كل فاتورة بتترسل تلقائياً وبتستلم رد ETA. متاح في كل الباقات.',
    },
    {
      q: 'ممكن أنقل بياناتي من نظام تاني؟',
      a: 'أيوة. عندنا أدوات استيراد للمنتجات والعملاء والموردين عبر CSV. وفريقنا بيساعدك في النقل لو محتاج.',
    },
    {
      q: 'هل بيشتغل بدون إنترنت؟',
      a: 'نقطة البيع بتشتغل offline تلقائياً وتزامن لما الإنترنت يرجع. متاح في باقة Enterprise.',
    },
    {
      q: 'هل أقدر أغير الباقة بعدين؟',
      a: 'في أي وقت. ترقّى أو نزّل — والفرق بيتحسب تلقائياً.',
    },
    {
      q: 'كم فرع أقدر أضيف؟',
      a: 'Starter: فرع واحد. Professional: حتى 5 فروع. Enterprise: فروع بلا حدود.',
    },
    {
      q: 'البيانات بتاعتي آمنة؟',
      a: 'كل بياناتك مشفّرة في قاعدة معزولة لمتجرك لوحده. نسخ احتياطية يومية تلقائية، وحقك في تحميل كل بياناتك متى ما طلبت.',
    },
    {
      q: 'هل في دعم فني بالعربي؟',
      a: 'طبعاً. فريق دعم مصري، عبر الواتساب والإيميل، طول أيام الأسبوع.',
    },
  ]

  const [openIdx, setOpenIdx] = useState<number | null>(0)

  return (
    <section id="faq" className="py-20 md:py-28">
      <div className="max-w-3xl mx-auto px-4">
        <div className="text-center mb-12">
          <div className="inline-block px-3 py-1 rounded-full bg-brand-500/10 text-brand-300 text-xs font-medium mb-4">
            الأسئلة الشائعة
          </div>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-gray-50 mb-4">
            أكتر الأسئلة اللي بتتسألنا.
          </h2>
        </div>

        <div className="space-y-2">
          {items.map((it, i) => {
            const open = openIdx === i
            return (
              <div
                key={it.q}
                className="bg-gray-800/60 border border-gray-800 rounded-md overflow-hidden"
              >
                <button
                  onClick={() => {
                    const next = open ? null : i
                    setOpenIdx(next)
                    if (next !== null) {
                      // Truncate question for clean GA UI; keep index for sorting
                      track('faq_open', { question_index: i, question: it.q.slice(0, 80) })
                    }
                  }}
                  className="w-full px-5 py-4 flex items-center justify-between text-right gap-4 hover:bg-gray-800 transition-colors"
                >
                  <span className="font-medium text-gray-100">{it.q}</span>
                  <ChevronDown
                    className={`w-5 h-5 text-gray-400 shrink-0 transition-transform ${
                      open ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {open && (
                  <div className="px-5 pb-4 text-sm text-gray-400 leading-relaxed border-t border-gray-800 pt-3">
                    {it.a}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ─── Final CTA ───────────────────────────────────────────────────────────────

function FinalCTA() {
  return (
    <section className="py-20 md:py-28 bg-gradient-to-b from-brand-900/30 to-app border-y border-gray-800">
      <div className="max-w-3xl mx-auto px-4 text-center">
        <h2 className="font-display text-3xl md:text-5xl font-bold text-gray-50 mb-4">
          جاهز تبدأ؟
        </h2>
        <p className="text-lg text-gray-400 mb-8">
          5 دقايق إعداد. شهر مجاني كامل. مفيش كارت ائتمان مطلوب.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/register"
            onClick={() => track('finalcta_cta_click', { destination: '/register' })}
          >
            <Button variant="primary" size="xl">
              ابدأ تجربتك المجانية
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            </Button>
          </Link>
          <Link
            to="/login"
            onClick={() => track('secondary_cta_click', { location: 'finalcta', destination: '/login' })}
          >
            <Button variant="outline" size="xl">
              لدي حساب بالفعل
            </Button>
          </Link>
        </div>
        {/* TODO: re-add WhatsApp CTA once a real business number is connected.
            Previously hard-coded to wa.me/201000000000 which is a placeholder. */}
      </div>
    </section>
  )
}

// ─── Footer ──────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="py-10 bg-gray-800 border-t border-gray-700">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-brand-500 flex items-center justify-center font-display font-bold text-white">
              ح
            </div>
            <span className="font-display text-lg font-bold text-gray-100">حِسبة</span>
            <span className="text-xs text-gray-500 mr-2">© {new Date().getFullYear()}</span>
          </div>

          <div className="flex items-center gap-5 text-sm text-gray-500">
            <a href="#features" className="hover:text-gray-300 transition-colors">
              المميزات
            </a>
            <a href="#pricing" className="hover:text-gray-300 transition-colors">
              الباقات
            </a>
            <a href="#faq" className="hover:text-gray-300 transition-colors">
              الأسئلة
            </a>
            <Link to="/login" className="hover:text-gray-300 transition-colors">
              تسجيل دخول
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
