import { z } from 'zod'

// SEC-03: mirror the API's password policy (apps/api/src/shared/validation.ts)
// so the form rejects a weak password with a clear message before submit,
// instead of the user hitting a server-side rejection. Login is intentionally
// NOT bound to this — it must still accept accounts created under the old
// 8-char rule.
export const passwordSchema = z
  .string()
  .min(12, 'كلمة المرور يجب ألا تقل عن 12 حرفاً')
  .regex(/[A-Za-z]/, 'كلمة المرور يجب أن تحتوي على حرف إنجليزي واحد على الأقل')
  .regex(/[0-9]/, 'كلمة المرور يجب أن تحتوي على رقم واحد على الأقل')
