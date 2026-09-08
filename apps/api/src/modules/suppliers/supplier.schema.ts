import { z } from 'zod'
import { amountPositive } from '../../shared/validation'

export const createSupplierSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().max(50).optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  taxNumber: z.string().max(100).optional(),
  bankAccount: z.string().optional(),
  notes: z.string().optional(),
})

export const updateSupplierSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  taxNumber: z.string().max(100).optional().nullable(),
  bankAccount: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
})

export const listSuppliersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  isActive: z.enum(['true', 'false']).optional(),
})

export const createTransactionSchema = z.object({
  branchId: z.string().uuid(),
  type: z.enum(['payment', 'purchase', 'return']),
  amount: amountPositive,
  reference: z.string().optional(),
  note: z.string().optional(),
})

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>
