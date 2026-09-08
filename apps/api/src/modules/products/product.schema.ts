import { z } from 'zod'
import { amountPositive } from '../../shared/validation'

// ─── Variant ──────────────────────────────────────────────────────────────────

export const variantInputSchema = z.object({
  sku: z.string().max(100).optional(),
  barcode: z.string().max(100).optional(),
  attributes: z.record(z.string()).default({}),
  costPrice: amountPositive,
  sellPrice: amountPositive,
  imageUrl: z.string().url().optional(),
})

export const variantUpdateSchema = z.object({
  sku: z.string().max(100).optional(),
  barcode: z.string().max(100).optional(),
  attributes: z.record(z.string()).optional(),
  costPrice: amountPositive.optional(),
  sellPrice: amountPositive.optional(),
  imageUrl: z.string().url().optional().nullable(),
  isActive: z.boolean().optional(),
})

// ─── Product ──────────────────────────────────────────────────────────────────

export const createProductSchema = z.object({
  name: z.string().min(1).max(300),
  categoryId: z.string().uuid().optional(),
  taxRateId: z.string().uuid().optional(),
  description: z.string().optional(),
  unit: z.enum(['piece', 'kg', 'liter', 'box']).default('piece'),
  imageUrl: z.string().url().optional(),
  hasVariants: z.boolean().default(false),
  variants: z.array(variantInputSchema).min(1),
})

export const updateProductSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  categoryId: z.string().uuid().optional().nullable(),
  taxRateId: z.string().uuid().optional().nullable(),
  description: z.string().optional().nullable(),
  unit: z.enum(['piece', 'kg', 'liter', 'box']).optional(),
  imageUrl: z.string().url().optional().nullable(),
  isActive: z.boolean().optional(),
})

export const listProductsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  isActive: z.enum(['true', 'false']).optional(),
})

export const uploadUrlSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  fileName: z.string().min(1),
})

export type CreateProductInput = z.infer<typeof createProductSchema>
export type UpdateProductInput = z.infer<typeof updateProductSchema>
export type VariantInput = z.infer<typeof variantInputSchema>
export type VariantUpdateInput = z.infer<typeof variantUpdateSchema>
