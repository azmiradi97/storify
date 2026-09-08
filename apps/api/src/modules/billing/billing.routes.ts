import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate, requirePermission } from '@/shared/middleware/auth.middleware'
import { verifyPaymobWebhook, type PaymobWebhookPayload } from './paymob.webhook'
import {
  startCheckout,
  cancelSubscription,
  handleWebhookSuccess,
  handleWebhookFailure,
} from './billing.service'
import { masterDb } from '@/config/database'
import { redis } from '@/config/redis'
import { sendEmail } from '@/shared/utils/email'

const checkoutSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email(),
  phone: z.string(),
})

// Paymob webhook — PUBLIC, no tenant context. Must be registered OUTSIDE the
// tenant-scoped instance: Paymob's servers send no tenant subdomain, so
// tenantMiddleware would 400 the callback before this handler runs (the bug
// behind the missed-payment incidents in the master migration history). The
// tenant is resolved from merchant_order_id; integrity is enforced via HMAC.
export async function billingWebhookRoutes(app: FastifyInstance) {
  app.post('/billing/paymob/webhook', async (request, reply) => {
    const hmac = (request.query as Record<string, string>).hmac
    if (!hmac) return reply.code(400).send({ message: 'missing_hmac' })

    const payload = request.body as PaymobWebhookPayload
    const isValid = verifyPaymobWebhook(payload, hmac)
    if (!isValid) {
      request.log.warn('[Paymob] HMAC verification failed')
      return reply.code(401).send({ message: 'invalid_hmac' })
    }

    const obj = payload.obj
    const merchantOrderId = obj.order?.merchant_order_id ?? ''

    if (obj.success && !obj.is_refunded && !obj.is_voided) {
      await handleWebhookSuccess({
        orderId: obj.order?.id,
        transactionId: obj.id,
        amountCents: obj.amount_cents,
        cardToken: obj.token,
        merchantOrderId,
      })
    } else if (obj.error_occured || (!obj.success && !obj.pending)) {
      await handleWebhookFailure({
        transactionId: obj.id,
        amountCents: obj.amount_cents,
        errorMessage: 'Payment declined by gateway',
        merchantOrderId,
      })
    }

    return reply.code(200).send({ received: true })
  })
}

export async function billingRoutes(app: FastifyInstance) {
  app.post(
    '/billing/checkout',
    { preHandler: [authenticate, requirePermission('billing', 'create')] },
    async (request, reply) => {
      const body = checkoutSchema.parse(request.body)
      const tenantId = request.tenant!.id

      const result = await startCheckout(tenantId, {
        first_name: body.firstName,
        last_name: body.lastName,
        email: body.email,
        phone_number: body.phone,
        country: 'EG',
        city: 'Cairo',
        state: 'Cairo',
        street: 'N/A',
        building: 'N/A',
        floor: 'N/A',
        apartment: 'N/A',
      })

      return reply.send(result)
    },
  )

  // NOTE: the Paymob webhook is intentionally NOT here — it's a public route
  // (no tenant context) registered via `billingWebhookRoutes` outside the
  // tenant-scoped instance. See that export below and apps/api/src/index.ts.

  app.get(
    '/billing/portal',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const tenantId = request.tenant!.id
      const sub = await masterDb.subscription.findFirst({
        where: { tenantId },
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
      })
      if (!sub) return reply.code(404).send({ message: 'no_subscription' })

      const attempts = await masterDb.paymentAttempt.findMany({
        where: { subscriptionId: sub.id },
        orderBy: { attemptedAt: 'desc' },
        take: 10,
      })

      return reply.send({ subscription: sub, history: attempts })
    },
  )

  // Lightweight status endpoint for the in-app subscription banner. Every
  // authenticated user in the tenant can call it (banner is purely informational
  // even for users without billing permission) — heavier portal data and
  // payment history stay behind /billing/portal.
  app.get(
    '/billing/status',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const tenantId = request.tenant!.id
      const sub = await masterDb.subscription.findFirst({
        where: { tenantId },
        include: { plan: { select: { name: true, slug: true } } },
        orderBy: { createdAt: 'desc' },
      })
      if (!sub) return reply.send({ subscription: null })

      return reply.send({
        subscription: {
          status: sub.status,
          trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
          currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          planName: sub.plan.name,
          billingCycle: sub.billingCycle,
        },
      })
    },
  )

  app.post(
    '/billing/cancel',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const tenant = request.tenant!
      const updated = await cancelSubscription(tenant.id)
      if (!updated) {
        return reply.code(404).send({ success: false, error: { code: 'no_subscription', message: 'لا يوجد اشتراك للإلغاء' } })
      }

      // Notify the owner so the scheduled cancellation isn't a surprise — they
      // can use POST /billing/resume to undo it before the period ends.
      if (updated.cancelAtPeriodEnd) {
        await sendEmail({
          to: tenant.ownerEmail,
          template: 'subscription_cancellation_scheduled',
          data: {
            tenantName: tenant.name,
            periodEnd: updated.currentPeriodEnd.toLocaleDateString('ar-EG'),
          },
        }).catch(() => {})
      }

      return reply.send({
        success: true,
        data: {
          scheduled: updated.cancelAtPeriodEnd,
          effectiveAt: updated.cancelAtPeriodEnd ? updated.currentPeriodEnd : updated.cancelledAt,
          status: updated.status,
        },
      })
    },
  )

  // Undo a scheduled cancellation. Only meaningful while cancelAtPeriodEnd is
  // true and the sweep hasn't fired yet (status still ACTIVE/PAST_DUE).
  app.post(
    '/billing/resume',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const tenantId = request.tenant!.id
      const sub = await masterDb.subscription.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      })
      if (!sub) {
        return reply.code(404).send({ success: false, error: { code: 'no_subscription', message: 'لا يوجد اشتراك' } })
      }
      if (!sub.cancelAtPeriodEnd || sub.status === 'CANCELLED') {
        return reply.code(400).send({
          success: false,
          error: { code: 'not_scheduled', message: 'لا يوجد إلغاء مجدول لإيقافه' },
        })
      }

      const updated = await masterDb.subscription.update({
        where: { id: sub.id },
        data: { cancelAtPeriodEnd: false },
      })
      // Status didn't change, but the user's perception did — bust the cache
      // so any UI banner relying on cancelAtPeriodEnd refreshes promptly.
      await redis.del(`sub:status:${tenantId}`)

      return reply.send({
        success: true,
        data: { status: updated.status, cancelAtPeriodEnd: updated.cancelAtPeriodEnd },
      })
    },
  )
}
