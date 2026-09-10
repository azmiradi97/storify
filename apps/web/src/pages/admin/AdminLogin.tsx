import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, useLocation } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { Button, Input, Alert } from '@/components/ui'
import { adminApi } from '@/api/admin-client'
import { getApiErrorMessage } from '@/lib/api-error'
import { useAdminAuthStore, type PlatformAdmin } from '@/stores/admin-auth.store'

const schema = z.object({
  email: z.string().email('بريد إلكتروني غير صالح'),
  password: z.string().min(1, 'مطلوب'),
})

type FormData = z.infer<typeof schema>

export default function AdminLogin() {
  const [showPwd, setShowPwd] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { setAuth } = useAdminAuthStore()
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/admin'

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const { mutate, isPending, error } = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await adminApi.post<{
        success: boolean
        data: { accessToken: string; admin: PlatformAdmin }
      }>('/login', data)
      return res.data.data
    },
    onSuccess: ({ accessToken, admin }) => {
      setAuth(admin, accessToken)
      toast.success(`أهلاً ${admin.fullName}`)
      navigate(from, { replace: true })
    },
  })

  return (
    <div className="min-h-dvh bg-app flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-brand-600/20 mb-4">
            <ShieldCheck className="w-7 h-7 text-brand-400" />
          </div>
          <h1 className="font-display text-3xl font-bold text-brand-400 mb-1">حِسبة Admin</h1>
          <p className="text-gray-400 text-sm">لوحة إدارة المنصة</p>
        </div>

        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 shadow-xl">
          {Boolean(error) && (
            <Alert variant="danger" className="mb-6">
              {getApiErrorMessage(error, 'خطأ في تسجيل الدخول')}
            </Alert>
          )}

          <form onSubmit={handleSubmit((d) => mutate(d))} className="flex flex-col gap-5">
            <Input
              label="البريد الإلكتروني"
              type="email"
              placeholder="owner@hesbaapp.com"
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

            <Button type="submit" loading={isPending} size="lg" className="w-full">
              دخول
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          هذه صفحة دخول مالكي المنصة فقط. لو كنت صاحب متجر، استخدم{' '}
          <a href="/login" className="text-brand-400 hover:text-brand-300">صفحة دخول المتاجر</a>.
        </p>
      </div>
    </div>
  )
}
