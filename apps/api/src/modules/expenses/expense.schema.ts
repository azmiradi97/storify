import { z } from 'zod'
import { amountPositive } from '../../shared/validation'

export const createExpenseSchema = z.object({
  branchId: z.string().uuid(),
  categoryId: z.string().uuid(),
  description: z.string().min(1),
  amount: amountPositive,
  paymentMethod: z.string().max(50).optional(),
  receiptUrl: z.string().url().optional(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD'),
})

export const updateExpenseSchema = z.object({
  description: z.string().min(1).optional(),
  amount: amountPositive.optional(),
  paymentMethod: z.string().max(50).optional().nullable(),
  receiptUrl: z.string().url().optional().nullable(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  categoryId: z.string().uuid().optional(),
})

export const listExpensesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  branchId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>
