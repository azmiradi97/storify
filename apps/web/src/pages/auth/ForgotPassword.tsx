import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Button, Input, Alert } from '@/components/ui'
import { api } from '@/api/client'

const schema = z.object({
  email: z.string().email('بريد إلكتروني غير صالح'),
  subdomain: z.string().min(1, 'مطلوب'),
})

type FormData = z.infer<typeof schema>

export default function ForgotPassword() {
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const { mutate, isPending, isSuccess } = useMutation({
    mutationFn: async (data: FormData) => {
      await api.post(
        '/auth/forgot-password',
        { email: data.email },
        { headers: { 'X-Tenant-Subdomain': data.subdomain } },
      )
    },
  })

  return (
    <div className="min-h-dvh bg-app flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-display text-4xl font-bold text-brand-400 mb-2">حِسبة</h1>
          <p className="text-gray-400 text-sm">إعادة تعيين كلمة المرور</p>
        </div>

        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 shadow-xl">
          {isSuccess ? (
            <Alert variant="success">
              إذا كان البريد الإلكتروني مسجلاً، ستصلك رسالة إعادة تعيين خلال دقائق.
            </Alert>
          ) : (
            <form onSubmit={handleSubmit((d) => mutate(d))} className="flex flex-col gap-5">
              <Input
                label="اسم المتجر (Subdomain)"
                placeholder="my-store"
                error={errors.subdomain?.message}
                {...register('subdomain')}
              />
              <Input
                label="البريد الإلكتروني"
                type="email"
                placeholder="owner@store.com"
                error={errors.email?.message}
                {...register('email')}
              />
              <Button type="submit" loading={isPending} size="lg" className="w-full">
                إرسال رابط إعادة التعيين
              </Button>
            </form>
          )}

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
