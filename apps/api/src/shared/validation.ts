import { z } from 'zod'

// SEC-03: minimum strength required for any NEW password (signup, reset, admin
// create/update, staff-user create, change-own-password). Login is intentionally
// exempt and stays `min(1)` — it must still accept accounts created under the
// old 8-char rule. 12 chars + at least one letter and one digit blocks trivial
// passwords without an onerous policy for Arabic-first SMB users.
export const passwordSchema = z
  .string()
  .min(12, 'كلمة المرور يجب ألا تقل عن 12 حرفاً')
  .regex(/[A-Za-z]/, 'كلمة المرور يجب أن تحتوي على حرف إنجليزي واحد على الأقل')
  .regex(/[0-9]/, 'كلمة المرور يجب أن تحتوي على رقم واحد على الأقل')
