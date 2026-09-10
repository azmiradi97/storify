import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Lock, Sparkles } from 'lucide-react'
import { Card, Button } from '@/components/ui'
import { useMe, useFeature, type PlanFeatures } from '@/hooks/useMe'

interface FeatureGateProps {
  feature: keyof PlanFeatures
  /** Visible feature title for the upgrade card (e.g. "الموردين"). */
  title: string
  /** Optional description shown above the upgrade CTA. */
  description?: string
  children: ReactNode
}

/**
 * Renders `children` only if the tenant's plan has `feature` enabled. Otherwise
 * shows a centered upgrade card pointing to the billing/upgrade flow. Mirrors
 * the backend `requireFeature(name)` middleware so users see a useful empty
 * state instead of a broken page hitting a 403.
 */
export function FeatureGate({ feature, title, description, children }: FeatureGateProps) {
  const enabled = useFeature(feature)
  const { data, isLoading } = useMe()

  if (isLoading) return null
  if (enabled) return <>{children}</>

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <Card className="max-w-md w-full text-center p-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand-500/10 text-brand-400 mb-4">
          <Lock className="w-5 h-5" />
        </div>
        <h2 className="text-xl font-semibold text-gray-100 mb-2">
          ميزة <span className="text-brand-600">{title}</span> غير متاحة في باقتك
        </h2>
        <p className="text-sm text-gray-400 mb-5 leading-relaxed">
          {description ?? 'هذه الميزة متاحة في الباقات الأعلى — قم بالترقية لتفعيلها فوراً.'}
        </p>
        {data?.tenant.plan.name && (
          <p className="text-xs text-gray-500 mb-4">
            باقتك الحالية: <span className="text-gray-300">{data.tenant.plan.name}</span>
          </p>
        )}
        <Link to="/settings?tab=billing">
          <Button>
            <Sparkles className="w-4 h-4" />
            عرض خطط الترقية
          </Button>
        </Link>
      </Card>
    </div>
  )
}
