import { z } from 'zod'

export const createInvoiceSchema = z.object({
  branchId: z.string().uuid().optional(),
  paymentMethodId: z.string().uuid(),
  currencyId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  couponCode: z.string().optional(),
  creditAmount: z.coerce.number().min(0).optional(),
  // ACC-04: loyalty points to redeem on this sale (integer). Validated against
  // the customer's balance, the store's loyalty settings, and a max-fraction cap
  // server-side in createInvoice.
  redeemPoints: z.coerce.number().int().min(0).optional(),
  splitPaymentMethodId: z.string().uuid().optional(),
  splitPaymentAmount: z.coerce.number().min(0).optional(),
  feeBearer: z.enum(['customer', 'merchant']).optional(),
  notes: z.string().optional(),
  externalFinancing: z
    .object({
      companyName: z.string().min(1).max(200),
      referenceNo: z.string().max(200).optional(),
      commissionPct: z.number().min(0).max(100).default(0),
    })
    .optional(),
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        quantity: z.number().int().positive(),
        unitPrice: z.number().positive(),
      }),
    )
    .min(1),
})

export const listInvoicesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  customerId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  status: z.string().optional(),
  etaStatus: z.string().optional(),
  search: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

export const returnInvoiceSchema = z.object({
  returnType: z.enum(['refund', 'credit']),
  reason: z.string().optional(),
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        quantity: z.number().int().positive(),
        restock: z.boolean().default(true),
      }),
    )
    .min(1),
})

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>
export type ReturnInvoiceInput = z.infer<typeof returnInvoiceSchema>
