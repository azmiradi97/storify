import { z } from 'zod'
import { amountNonNeg, percent } from '../../shared/validation'

export const createPmSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['cash', 'card', 'ewallet', 'bnpl', 'bank_transfer']),
  feeType: z.enum(['none', 'percentage', 'fixed', 'both']).default('none'),
  feePercentage: percent.default(0),
  feeFixed: amountNonNeg.default(0),
  feeBearer: z.enum(['customer', 'merchant', 'negotiable']).default('merchant'),
  notes: z.string().optional(),
})

export const updatePmSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  feeType: z.enum(['none', 'percentage', 'fixed', 'both']).optional(),
  feePercentage: percent.optional(),
  feeFixed: amountNonNeg.optional(),
  feeBearer: z.enum(['customer', 'merchant', 'negotiable']).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional().nullable(),
})

export type CreatePmInput = z.infer<typeof createPmSchema>
export type UpdatePmInput = z.infer<typeof updatePmSchema>
