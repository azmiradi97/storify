import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Eye, EyeOff } from 'lucide-react'
import { Button, Input, Alert } from '@/components/ui'
import { api } from '@/api/client'
import { getApiErrorMessage } from '@/lib/api-error'
import { useAuthStore, type AuthUser } from '@/stores/auth.store'
import { track } from '@/lib/analytics'

const schema = z.object({
  email: z.string().email('بريد إلكتروني غير صالح'),
  password: z.string().min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل'),
  subdomain: z.string().min(1, 'مطلوب'),
})

type FormData = z.infer<typeof schema>

export default function Login() {
  const [showPwd, setShowPwd] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { setAuth, tenantSubdomain } = useAuthStore()
  const requestedFrom = (location.state as { from?: { pathname: string } })?.from?.pathname

  /**
   * Pick the first page the user actually has permission for. Without this,
   * a clerk-only role who can't access POS would land on /pos and bounce to
   * a forbidden screen on every login. Order goes from most-likely-default
   * to fallback.
   */
  function landingFor(user: AuthUser): string {
    const can = (r: string, a: string) => user.permissions?.[r]?.includes(a) ?? false
    const onboardingKey = `hesba_onboarded_${user.id}`
    if (!localStorage.getItem(onboardingKey)) {
      localStorage.setItem(onboardingKey, '1')
      return '/settings'
    }
    if (can('invoices', 'create')) return '/pos'
    if (can('invoices', 'read')) return '/invoices'
    if (can('products', 'read')) return '/products'
    if (can('customers', 'read')) return '/customers'
    if (can('reports', 'read')) return '/reports'
    return '/dashboard'
  }

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { subdomain: tenantSubdomain ?? '' },
  })

  const { mutate, isPending, error } = useMutation({
    mutationFn: async (data: FormData) => {
      track('login_submit', {})
      const res = await api.post<{ success: boolean; data: { accessToken: string; user: AuthUser } }>(
        '/auth/login',
        { email: data.email, password: data.password },
        { headers: { 'X-Tenant-Subdomain': data.subdomain } },
      )
      return { ...res.data.data, subdomain: data.subdomain }
    },
    onSuccess: ({ accessToken, user, subdomain }) => {
      setAuth(user, accessToken, subdomain)
      track('login_success', { role: user.roleSlug })

      const baseDomain = import.meta.env.VITE_BASE_DOMAIN as string | undefined
      const onMainDomain = baseDomain && window.location.hostname === baseDomain

      if (onMainDomain && subdomain) {
        // Transfer session to the tenant subdomain via URL hash so the
        // subdomain origin can pick it up (localStorage is not shared).
        const payload = btoa(JSON.stringify({ accessToken, user, subdomain }))
        window.location.href = `https://${subdomain}.${baseDomain}/#s=${payload}`
        return
      }

      // Already on the subdomain (or dev): navigate in-app.
      toast.success('تم تسجيل الدخول بنجاح')
      navigate(requestedFrom ?? landingFor(user), { replace: true })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { status?: number; data?: { error?: { code?: string } } } }
      track('login_failure', {
        error_code: e?.response?.data?.error?.code ?? 'unknown',
        status: e?.response?.status ?? 0,
      })
    },
  })

  return (
    <div className="min-h-dvh bg-app flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-display text-4xl font-bold text-brand-400 mb-2">حِسبة</h1>
          <p className="text-gray-400 text-sm">تسجيل الدخول إلى متجرك</p>
        </div>

        <div className="bg-gray-800 rounded-r-xl border border-gray-700 p-8 shadow-xl">
          {Boolean(error) && (
            <Alert variant="danger" className="mb-6">
              {getApiErrorMessage(error, 'خطأ في تسجيل الدخول')}
            </Alert>
          )}

          <form onSubmit={handleSubmit((d) => mutate(d))} className="flex flex-col gap-5">
            <fieldset disabled={isPending} className="contents">
            <Input
              label="اسم المتجر (Subdomain)"
              placeholder="my-store"
              autoComplete="organization"
              error={errors.subdomain?.message}
              {...register('subdomain')}
            />
            <Input
              label="البريد الإلكتروني"
              type="email"
              placeholder="owner@store.com"
              autoComplete="email"
              error={errors.email?.message}
              {...register('email')}
            />
            <Input
              label="كلمة المرور"
              type={showPwd ? 'text' : 'password'}
              placeholder="••••••••"
              autoComplete="current-password"
              error={errors.password?.message}
              endIcon={
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="text-gray-400 hover:text-gray-200 transition-colors"
                  aria-label={showPwd ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
              {...register('password')}
            />

            <div className="flex items-center justify-between">
              <Link
                to="/forgot-password"
                className="text-sm text-brand-400 hover:text-brand-300 transition-colors"
              >
                نسيت كلمة المرور؟
              </Link>
            </div>

            <Button type="submit" loading={isPending} size="lg" className="w-full">
              تسجيل الدخول
            </Button>
            </fieldset>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            ليس لديك متجر؟{' '}
            <Link to="/register" className="text-brand-400 hover:text-brand-300 transition-colors">
              أنشئ متجرك الآن
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
