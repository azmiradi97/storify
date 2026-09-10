import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { passwordSchema } from '@/lib/validation'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Eye, EyeOff } from 'lucide-react'
import { Button, Input, Alert } from '@/components/ui'
import { api } from '@/api/client'
import { getApiErrorMessage } from '@/lib/api-error'

const schema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'كلمتا المرور غير متطابقتين',
    path: ['confirmPassword'],
  })

type FormData = z.infer<typeof schema>

export default function ResetPassword() {
  const [showPwd, setShowPwd] = useState(false)
  const [showConfirmPwd, setShowConfirmPwd] = useState(false)
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const subdomain = params.get('subdomain') ?? ''

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const { mutate, isPending, error } = useMutation({
    mutationFn: async (data: FormData) => {
      await api.post(
        '/auth/reset-password',
        { token, newPassword: data.password },
        { headers: { 'X-Tenant-Subdomain': subdomain } },
      )
    },
    onSuccess: () => {
      toast.success('تم تغيير كلمة المرور بنجاح')
      navigate('/login')
    },
  })

  if (!token) {
    return (
      <div className="min-h-dvh bg-app flex items-center justify-center p-4">
        <Alert variant="danger">رابط إعادة التعيين غير صالح أو منتهي الصلاحية.</Alert>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-app flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-display text-4xl font-bold text-brand-400 mb-2">حِسبة</h1>
          <p className="text-gray-400 text-sm">تعيين كلمة مرور جديدة</p>
        </div>

        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 shadow-xl">
          {error && (
            <Alert variant="danger" className="mb-6">
              {getApiErrorMessage(error, 'الرابط منتهي الصلاحية أو غير صالح')}
            </Alert>
          )}
          <form onSubmit={handleSubmit((d) => mutate(d))} className="flex flex-col gap-5">
            <Input
              label="كلمة المرور الجديدة"
              type={showPwd ? 'text' : 'password'}
              placeholder="••••••••"
              autoComplete="new-password"
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
            <Input
              label="تأكيد كلمة المرور"
              type={showConfirmPwd ? 'text' : 'password'}
              placeholder="••••••••"
              autoComplete="new-password"
              error={errors.confirmPassword?.message}
              endIcon={
                <button
                  type="button"
                  onClick={() => setShowConfirmPwd((v) => !v)}
                  className="text-gray-400 hover:text-gray-200 transition-colors"
                  aria-label={showConfirmPwd ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                >
                  {showConfirmPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
              {...register('confirmPassword')}
            />
            <Button type="submit" loading={isPending} size="lg" className="w-full">
              حفظ كلمة المرور
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            <Link to="/login" className="text-brand-400 hover:text-brand-600 transition-colors">
              العودة لتسجيل الدخول
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
