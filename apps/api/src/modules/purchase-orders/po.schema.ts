import { z } from 'zod'
import { amountPositive } from '../../shared/validation'

export const createPoSchema = z.object({
  supplierId: z.string().uuid(),
  branchId: z.string().uuid(),
  expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  paymentType: z.string().max(50).optional(),
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        quantity: z.number().int().positive(),
        unitCost: amountPositive,
      }),
    )
    .min(1),
})

// Amend a draft PO. All fields optional; items, when provided, replace the
// existing line set wholesale. Frozen once status leaves 'draft'.
export const updatePoSchema = z.object({
  supplierId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  paymentType: z.string().max(50).nullable().optional(),
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        quantity: z.number().int().positive(),
        unitCost: amountPositive,
      }),
    )
    .min(1)
    .optional(),
}).refine(
  (v) => Object.keys(v).length > 0,
  { message: 'لا توجد تغييرات' },
)

// Partial receipts: omit `items` to receive the full outstanding quantity for
// every line (backwards-compatible with the original full-receive UI).
// Pass `items` with per-line quantities to record a partial receipt; only
// listed items are advanced, others stay outstanding.
export const receivePoSchema = z.object({
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().optional(),
  invoiceImageUrl: z.string().url().optional(),
  items: z.array(z.object({
    id: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).optional(),
})

export const poPaymentSchema = z.object({
  amount: amountPositive,
  paymentMethod: z.string().max(50).optional(),
  receiptUrl: z.string().url().optional(),
})

export const listPoSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  supplierId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
})

export type CreatePoInput = z.infer<typeof createPoSchema>
export type ReceivePoInput = z.infer<typeof receivePoSchema>
export type PoPaymentInput = z.infer<typeof poPaymentSchema>
