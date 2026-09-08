import { z } from 'zod'
import { amountNonNeg, amountPositive, percent } from '../../shared/validation'

export const createInstallmentSchema = z.object({
  branchId: z.string().uuid(),
  paymentMethodId: z.string().uuid(),
  currencyId: z.string().uuid(),
  customerId: z.string().uuid(),
  downPayment: amountNonNeg,
  installmentsCount: z.number().int().min(1).max(120),
  interestRate: percent.default(0),
  firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD'),
  guarantorName: z.string().max(200).optional(),
  guarantorPhone: z.string().max(50).optional(),
  signatureUrl: z.string().url().optional(),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        quantity: z.number().int().positive(),
        unitPrice: amountPositive,
      }),
    )
    .min(1),
})

export const recordPaymentSchema = z.object({
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  paymentMethodId: z.string().uuid().optional(),
  receiptUrl: z.string().url().optional(),
})

export const listInstallmentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  customerId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
})

export type CreateInstallmentInput = z.infer<typeof createInstallmentSchema>
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>
