import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticate, requirePermission } from '../../shared/middleware/auth.middleware'
import { amountPositive, amountNonNeg } from '../../shared/validation'

const couponBody = z.object({
  code: z.string().min(1).max(100).toUpperCase(),
  discountType: z.enum(['percentage', 'fixed']),
  discountValue: amountPositive,
  minAmount: amountNonNeg.optional(),
  maxUses: z.coerce.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
  isActive: z.boolean().default(true),
})

export async function couponRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET /api/coupons/validate?code=:code — public coupon check (auth only)
  app.get('/validate', async (request, reply) => {
    const q = z.object({ code: z.string().min(1) }).safeParse(request.query)
    if (!q.success) return reply.status(400).send({ success: false, error: { code: 'validation_error', message: 'كود مطلوب' } })

    const coupon = await request.tenantDb.coupon.findUnique({ where: { code: q.data.code.toUpperCase() } })
    if (!coupon || !coupon.isActive) return reply.status(404).send({ success: false, error: { code: 'invalid', message: 'الكوبون غير صالح' } })
    if (coupon.expiresAt && coupon.expiresAt < new Date()) return reply.status(400).send({ success: false, error: { code: 'expired', message: 'الكوبون منتهي الصلاحية' } })
    if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) return reply.status(400).send({ success: false, error: { code: 'exhausted', message: 'تم استنفاد حد استخدام الكوبون' } })

    return reply.send({ success: true, data: { code: coupon.code, discountType: coupon.discountType, discountValue: coupon.discountValue, minAmount: coupon.minAmount } })
  })

  // GET /api/coupons
  app.get('/', { preHandler: requirePermission('invoices', 'read') }, async (request, reply) => {
    const { z: zod } = await import('zod')
    const q = zod.object({ page: zod.coerce.number().int().min(1).default(1), limit: zod.coerce.number().int().min(1).max(100).default(20) })
    const { page, limit } = q.parse(request.query)

    const [coupons, total] = await Promise.all([
      request.tenantDb.coupon.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      request.tenantDb.coupon.count(),
    ])
    return reply.send({ success: true, data: coupons, meta: { total, page, limit, pages: Math.ceil(total / limit) } })
  })

  // POST /api/coupons
  app.post('/', { preHandler: requirePermission('invoices', 'create') }, async (request, reply) => {
    const parsed = couponBody.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'validation_error', message: parsed.error.errors[0].message } })

    const { code, discountType, discountValue, minAmount, maxUses, expiresAt, isActive } = parsed.data
    const existing = await request.tenantDb.coupon.findUnique({ where: { code } })
    if (existing) return reply.status(409).send({ success: false, error: { code: 'conflict', message: 'الكود مستخدم بالفعل' } })

    const coupon = await request.tenantDb.coupon.create({
      data: {
        code,
        discountType,
        discountValue,
        minAmount: minAmount ?? null,
        maxUses: maxUses ?? null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        isActive,
      },
    })
    return reply.status(201).send({ success: true, data: coupon })
  })

  // PATCH /api/coupons/:id
  app.patch<{ Params: { id: string } }>('/:id', { preHandler: requirePermission('invoices', 'update') }, async (request, reply) => {
    const body = couponBody.partial().safeParse(request.body)
    if (!body.success) return reply.status(400).send({ success: false, error: { code: 'validation_error', message: body.error.errors[0].message } })

    const coupon = await request.tenantDb.coupon.update({
      where: { id: request.params.id },
      data: {
        ...body.data,
        minAmount: body.data.minAmount ?? undefined,
        maxUses: body.data.maxUses ?? undefined,
        expiresAt: body.data.expiresAt ? new Date(body.data.expiresAt) : undefined,
      },
    })
    return reply.send({ success: true, data: coupon })
  })

  // DELETE /api/coupons/:id
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: requirePermission('invoices', 'delete') }, async (request, reply) => {
    await request.tenantDb.coupon.delete({ where: { id: request.params.id } })
    return reply.send({ success: true })
  })
}
