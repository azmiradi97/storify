import { Link } from 'react-router-dom'
import { Sparkles, TriangleAlert, Clock, CreditCard, XCircle } from 'lucide-react'
import {
  useSubscriptionStatus,
  type SubscriptionStatusData,
} from '@/hooks/useSubscription'
import { cn } from '@/lib/cn'

type Level = 'info' | 'warning' | 'danger'

interface BannerState {
  level: Level
  icon: React.ReactNode
  message: React.ReactNode
  ctaLabel: string
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function daysUntil(iso: string | null | undefined): number {
  if (!iso) return Infinity
  const target = new Date(iso).getTime()
  if (Number.isNaN(target)) return Infinity
  return Math.max(0, Math.ceil((target - Date.now()) / MS_PER_DAY))
}

// Arabic plural rules for "day" — distinguishes singular/dual/few/many so the
// banner reads naturally ("متبقي 3 أيام" not "متبقي 3 يوم"). The number itself
// is rendered separately inside a `.num` span for LTR tabular-nums display.
function dayWord(n: number): string {
  if (n === 1) return 'يوم'
  if (n === 2) return 'يومان'
  if (n >= 3 && n <= 10) return 'أيام'
  return 'يوماً'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ar-EG-u-nu-latn', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function bannerFor(sub: SubscriptionStatusData): BannerState | null {
  // Terminal state — resume isn't valid, so steer the user to a new checkout
  // instead of showing the "scheduled cancellation" banner below.
  if (sub.status === 'CANCELLED') {
    return {
      level: 'danger',
      icon: <XCircle className="w-4 h-4" />,
      message: 'تم إلغاء الاشتراك. اشترك مجدداً لمتابعة استخدام النظام',
      ctaLabel: 'اشترك الآن',
    }
  }

  if (sub.status === 'SUSPENDED') {
    return {
      level: 'danger',
      icon: <XCircle className="w-4 h-4" />,
      message: 'تم تعليق الاشتراك بسبب فشل الدفع. حدّث طريقة الدفع لاستئناف الخدمة',
      ctaLabel: 'تحديث الدفع',
    }
  }

  if (sub.status === 'PAST_DUE') {
    return {
      level: 'danger',
      icon: <CreditCard className="w-4 h-4" />,
      message: 'تأخر دفع الاشتراك. الرجاء تحديث طريقة الدفع لتجنب التعليق',
      ctaLabel: 'تحديث الدفع',
    }
  }

  if (sub.status === 'TRIALING') {
    const days = daysUntil(sub.trialEndsAt ?? sub.currentPeriodEnd)
    if (days <= 0) {
      return {
        level: 'danger',
        icon: <Sparkles className="w-4 h-4" />,
        message: 'انتهت الفترة التجريبية. اشترك الآن لمتابعة استخدام النظام',
        ctaLabel: 'اشترك الآن',
      }
    }
    if (days <= 3) {
      return {
        level: 'warning',
        icon: <Sparkles className="w-4 h-4" />,
        message: (
          <>
            ستنتهي الفترة التجريبية خلال{' '}
            <span className="num font-semibold">{days}</span>{' '}
            {dayWord(days)}
          </>
        ),
        ctaLabel: 'اشترك الآن',
      }
    }
    return {
      level: 'info',
      icon: <Sparkles className="w-4 h-4" />,
      message: (
        <>
          أنت في الفترة التجريبية — متبقي{' '}
          <span className="num font-semibold">{days}</span>{' '}
          {dayWord(days)}
        </>
      ),
      ctaLabel: 'اشترك الآن',
    }
  }

  if (sub.cancelAtPeriodEnd) {
    return {
      level: 'warning',
      icon: <TriangleAlert className="w-4 h-4" />,
      message: `اشتراكك مجدول للإلغاء في ${formatDate(sub.currentPeriodEnd)}`,
      ctaLabel: 'استئناف الاشتراك',
    }
  }

  if (sub.status === 'ACTIVE') {
    const days = daysUntil(sub.currentPeriodEnd)
    if (days <= 7) {
      return {
        level: 'info',
        icon: <Clock className="w-4 h-4" />,
        message: (
          <>
            سيتجدد اشتراكك خلال{' '}
            <span className="num font-semibold">{days}</span>{' '}
            {dayWord(days)}
          </>
        ),
        ctaLabel: 'إدارة الاشتراك',
      }
    }
  }

  return null
}

const LEVEL_STYLES: Record<Level, string> = {
  info: 'bg-brand-500/10 border-brand-500/30 text-brand-600',
  warning: 'bg-warning-500/10 border-warning-500/30 text-warning-700',
  danger: 'bg-danger-500/10 border-danger-500/30 text-danger-700',
}

const LEVEL_ICON: Record<Level, string> = {
  info: 'text-brand-500',
  warning: 'text-warning-500',
  danger: 'text-danger-500',
}

const LEVEL_CTA: Record<Level, string> = {
  info: 'bg-brand-500 hover:bg-brand-600 text-white',
  warning: 'bg-warning-500 hover:bg-warning-600 text-gray-50',
  danger: 'bg-danger-500 hover:bg-danger-600 text-white',
}

/**
 * Thin top strip above the TopBar showing trial countdown, payment-failure,
 * scheduled-cancellation, or upcoming-renewal warnings. Renders nothing when
 * the subscription is healthy or hasn't loaded yet.
 */
export function SubscriptionBanner() {
  const { data: sub } = useSubscriptionStatus()
  if (!sub) return null

  const state = bannerFor(sub)
  if (!state) return null

  return (
    <div
      role="alert"
      className={cn(
        'border-b px-4 sm:px-6 py-2 flex items-center gap-3 text-sm',
        LEVEL_STYLES[state.level],
      )}
    >
      <span className={cn('shrink-0', LEVEL_ICON[state.level])}>{state.icon}</span>
      <p className="flex-1 min-w-0 truncate">{state.message}</p>
      <Link
        to="/settings?tab=billing"
        className={cn(
          'shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md transition-colors',
          LEVEL_CTA[state.level],
        )}
      >
        {state.ctaLabel}
      </Link>
    </div>
  )
}
