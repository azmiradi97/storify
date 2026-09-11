import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { passwordSchema } from '@/lib/validation'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Eye, EyeOff } from 'lucide-react'
import { Button, Input, Alert, Select } from '@/components/ui'
import { api } from '@/api/client'
import { getApiErrorMessage } from '@/lib/api-error'
import { formatNumber } from '@/lib/format'
import { track } from '@/lib/analytics'

interface Plan {
  id: string
  name: string
  slug: string
  priceMonthly: number
}

const schema = z.object({
  name: z.string().min(2, 'اسم المتجر مطلوب'),
  subdomain: z
    .string()
    .min(3, 'الاسم يجب أن يكون 3 أحرف على الأقل')
    .regex(/^[a-z0-9-]+$/, 'يسمح فقط بالأحرف الإنجليزية الصغيرة والأرقام والشرطة'),
  planSlug: z.string().min(1, 'اختر الباقة'),
  ownerName: z.string().min(2, 'الاسم مطلوب'),
  ownerEmail: z.string().email('بريد إلكتروني غير صالح'),
  ownerPassword: passwordSchema,
})

type FormData = z.infer<typeof schema>

export default function Register() {
  const [showPwd, setShowPwd] = useState(false)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Pre-fill plan from Landing.tsx pricing CTA: /register?plan=<slug>
  const initialPlan = searchParams.get('plan') ?? ''

  // Funnel entry — fire once on mount with the plan they arrived with
  useEffect(() => {
    track('register_start', { plan_slug: initialPlan || 'none' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { data: plans } = useQuery<Plan[]>({
    queryKey: ['plans'],
    queryFn: async () => {
      const res = await api.get<{ data: Plan[] }>('/plans')
      return res.data.data
    },
  })

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { planSlug: initialPlan },
  })

  const { mutate, isPending, error } = useMutation({
    mutationFn: async (data: FormData) => {
      track('register_submit', { plan_slug: data.planSlug })
      await api.post('/tenants/register', {
        name: data.name,
        subdomain: data.subdomain,
        planSlug: data.planSlug,
        ownerName: data.ownerName,
        ownerEmail: data.ownerEmail,
        ownerPassword: data.ownerPassword,
      })
      return { plan_slug: data.planSlug }
    },
    onSuccess: (result) => {
      track('register_success', { plan_slug: result.plan_slug })
      toast.success('تم إنشاء المتجر بنجاح!')
      navigate('/login')
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { code?: string } } } }
      track('register_failure', {
        error_code: e?.response?.data?.error?.code ?? 'unknown',
      })
    },
  })

  return (
    <div className="min-h-dvh bg-app flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="font-display text-4xl font-bold text-brand-400 mb-2">حِسبة</h1>
          <p className="text-gray-400 text-sm">أنشئ متجرك الآن — مجاناً لأول 14 يوم</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-700 p-8 shadow-xl">
          {Boolean(error) && (
            <Alert variant="danger" className="mb-6">
              {getApiErrorMessage(error)}
            </Alert>
          )}

          <form onSubmit={handleSubmit((d) => mutate(d))} className="flex flex-col gap-5">
            <fieldset disabled={isPending} className="contents">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="اسم المتجر"
                placeholder="متجري الإلكتروني"
                autoComplete="organization"
                error={errors.name?.message}
                {...register('name')}
              />
              <Input
                label="معرف المتجر"
                placeholder="my-store"
                hint="حروف صغيرة وأرقام فقط — هيظهر في الفواتير"
                autoComplete="off"
                error={errors.subdomain?.message}
                {...register('subdomain')}
              />
            </div>

            <Select
              label="الباقة"
              error={errors.planSlug?.message}
              {...register('planSlug')}
            >
              <option value="">اختر الباقة</option>
              {plans?.map((p) => (
                <option key={p.id} value={p.slug}>
                  {p.name} — {formatNumber(p.priceMonthly)} ج.م / شهر
                </option>
              ))}
            </Select>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="اسمك"
                placeholder="محمد أحمد"
                autoComplete="name"
                error={errors.ownerName?.message}
                {...register('ownerName')}
              />
              <Input
                label="البريد الإلكتروني"
                type="email"
                placeholder="owner@store.com"
                autoComplete="email"
                error={errors.ownerEmail?.message}
                {...register('ownerEmail')}
              />
            </div>

            <Input
              label="كلمة المرور"
              type={showPwd ? 'text' : 'password'}
              placeholder="••••••••"
              autoComplete="new-password"
              error={errors.ownerPassword?.message}
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
              {...register('ownerPassword')}
            />

            <Button type="submit" loading={isPending} size="lg" className="w-full">
              إنشاء المتجر
            </Button>
            </fieldset>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            لديك متجر؟{' '}
            <Link to="/login" className="text-brand-400 hover:text-brand-600 transition-colors">
              تسجيل الدخول
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
