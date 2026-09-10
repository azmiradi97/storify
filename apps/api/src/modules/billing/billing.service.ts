import { masterDb } from '@/config/database'
import { redis } from '@/config/redis'
import { config } from '@/config/env'
import { PaymobClient, type PaymobBillingData } from './paymob.client'
import { sendEmail } from '@/shared/utils/email'
import Decimal from 'decimal.js'
import { Prisma } from '@hesba/database'
import dayjs from 'dayjs'

/**
 * Webhook handlers and admin cancellation flip subscription state, which the
 * tenant middleware caches in two keys:
 *   • `tenant:{subdomain}`   — full tenant row incl. plan (5 min TTL)
 *   • `sub:status:{tenantId}` — latest sub.status (30s TTL)
 *
 * Without explicit invalidation, a user whose card just cleared could still
 * be served a stale 402 for up to 30s; one whose card just bounced could
 * keep using the system for the same window. Short, but irritating — and
 * easy to fix at the write site.
 */
async function invalidateSubscriptionCaches(tenantId: string) {
  const tenant = await masterDb.tenant.findUnique({
    where: { id: tenantId },
    select: { subdomain: true },
  })
  await Promise.all([
    redis.del(`sub:status:${tenantId}`),
    tenant ? redis.del(`tenant:${tenant.subdomain}`) : Promise.resolve(0),
  ])
}

/**
 * Adds one billing cycle to `start` using calendar math, not raw setMonth /
 * setFullYear. dayjs handles the Jan-31 → Feb-28 edge case correctly so a
 * subscription that started on a month-end doesn't drift back a day on every
 * rollover.
 */
function addPeriod(start: Date, cycle: 'MONTHLY' | 'YEARLY' | string): Date {
  if (cycle === 'YEARLY') return dayjs(start).add(1, 'year').toDate()
  return dayjs(start).add(1, 'month').toDate()
}

const paymob = new PaymobClient()

export async function startTrial(tenantId: string, planId: string) {
  const plan = await masterDb.plan.findUniqueOrThrow({ where: { id: planId } })
  const trialEndAt = new Date(Date.now() + 14 * 24 * 3600 * 1000)

  await masterDb.subscription.create({
    data: {
      tenantId,
      planId,
      billingCycle: 'MONTHLY',
      status: 'TRIALING',
      trialEndsAt: trialEndAt,
      currentPeriodStart: new Date(),
      currentPeriodEnd: trialEndAt,
      priceAtSubscription: plan.priceMonthly,
      provider: 'paymob',
    },
  })
}

/**
 * Build the URLs Paymob needs for a checkout. Both intentionally use
 * FRONTEND_URL (the platform domain) and NOT a per-tenant subdomain:
 *
 *   • redirectUrl: even when APP_BASE_DOMAIN is set, per-tenant subdomains
 *     aren't actually resolvable in DNS — tenants are identified by an
 *     `x-tenant-subdomain` header from the SPA served on the main domain.
 *     Redirecting to a phantom subdomain produces DNS_PROBE_FINISHED_NXDOMAIN
 *     in the browser; even if it resolved, the user would lose their session
 *     because localStorage tokens are scoped per-origin.
 *
 *   • notificationUrl: webhook is platform-wide, routes by merchant_order_id,
 *     and Paymob's servers need a publicly resolvable host — only the
 *     platform domain qualifies.
 *
 * Setting both per-transaction means merchants don't have to remember to
 * fill in the same URLs in every Paymob integration's dashboard config.
 */
function buildPaymobCallbacks(): {
  redirectUrl: string
  notificationUrl: string
} {
  return {
    redirectUrl: `${config.FRONTEND_URL}/settings?tab=billing`,
    notificationUrl: `${config.FRONTEND_URL}/api/billing/paymob/webhook`,
  }
}

export async function startCheckout(
  tenantId: string,
  billing: PaymobBillingData,
): Promise<{ iframeUrl: string }> {
  const sub = await masterDb.subscription.findFirstOrThrow({
    where: { tenantId },
    include: { plan: true },
  })
  const amountCents = new Decimal(sub.priceAtSubscription.toString())
    .times(100)
    .toDecimalPlaces(0)
    .toNumber()

  const callbacks = buildPaymobCallbacks()

  const result = await paymob.startCheckoutSession({
    amountCents,
    tenantId,
    billingData: billing,
    redirectUrl: callbacks.redirectUrl,
    notificationUrl: callbacks.notificationUrl,
  })
  return { iframeUrl: result.iframeUrl }
}

export async function handleWebhookSuccess(params: {
  orderId: number
  transactionId: number
  amountCents: number
  cardToken?: string
  providerCustomerId?: string
  merchantOrderId: string
}) {
  const { orderId, transactionId, amountCents, cardToken, merchantOrderId } = params

  // Extract tenantId from merchant_order_id format: sub_<tenantId>_<timestamp>
  const tenantId = merchantOrderId.split('_')[1]
  if (!tenantId) return

  const sub = await masterDb.subscription.findFirst({ where: { tenantId } })
  if (!sub) return

  const periodStart = new Date()
  // Period length must match billing cycle — yearly subs renew yearly, not
  // in 30 days. Use date-arithmetic that handles month-end edge cases
  // (Jan 31 → Feb 28) rather than naive setMonth.
  const periodEnd = addPeriod(periodStart, sub.billingCycle)

  // Idempotency: the up-front findFirst can race with another concurrent
  // webhook. Rely on the @unique on providerTransactionId to make the
  // create the source of truth — catch the P2002 violation and exit
  // cleanly so we don't double-update the subscription.
  try {
    await masterDb.$transaction([
      masterDb.paymentAttempt.create({
        data: {
          subscriptionId: sub.id,
          providerTransactionId: String(transactionId),
          amount: new Decimal(amountCents).dividedBy(100),
          currency: 'EGP',
          status: 'SUCCESS',
          attemptType: 'initial',
          provider: 'paymob',
          providerResponse: { orderId, transactionId },
        },
      }),
      masterDb.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'ACTIVE',
          failedAttempts: 0,
          lastFailureReason: null,
          // Clear the dunning anchor so a future failure starts a fresh 3/7/14
          // cycle instead of inheriting the prior failure window.
          lastFailedAt: null,
          lastPaymentAt: periodStart,
          nextBillingAt: periodEnd,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          providerCardToken: cardToken,
        },
      }),
    ])
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Already recorded by a concurrent webhook delivery — safe no-op.
      return
    }
    throw err
  }

  await invalidateSubscriptionCaches(tenantId)

  const tenant = await masterDb.tenant.findUnique({ where: { id: tenantId } })
  if (tenant) {
    await sendEmail({
      to: tenant.ownerEmail,
      template: 'payment_succeeded',
      data: { tenantName: tenant.name, amount: `${amountCents / 100} EGP`, period: periodEnd.toLocaleDateString('ar-EG-u-nu-latn') },
    }).catch((err) => {
      // Never throw from a webhook flow over an email failure — payment
      // state is already persisted. Log so the merchant-success template
      // doesn't go silent without anyone noticing.
      console.error('[Billing] email send failed', { template: 'payment_succeeded', tenantId, err: String(err) })
    })
  }
}

export async function handleWebhookFailure(params: {
  transactionId: number
  amountCents: number
  errorMessage?: string
  merchantOrderId: string
}) {
  const { transactionId, amountCents, errorMessage, merchantOrderId } = params
  const tenantId = merchantOrderId.split('_')[1]
  if (!tenantId) return

  const sub = await masterDb.subscription.findFirst({ where: { tenantId } })
  if (!sub) return

  const newFailedAttempts = (sub.failedAttempts ?? 0) + 1
  let newStatus = sub.status

  if (newFailedAttempts >= 14) {
    newStatus = 'CANCELLED'
  } else if (newFailedAttempts >= 7) {
    newStatus = 'SUSPENDED'
  } else if (newFailedAttempts >= 3) {
    newStatus = 'PAST_DUE'
  }

  try {
    await masterDb.$transaction([
      masterDb.paymentAttempt.create({
        data: {
          subscriptionId: sub.id,
          providerTransactionId: String(transactionId),
          amount: new Decimal(amountCents).dividedBy(100),
          currency: 'EGP',
          status: 'FAILED',
          attemptType: 'initial',
          provider: 'paymob',
          providerResponse: { errorMessage },
        },
      }),
      masterDb.subscription.update({
        where: { id: sub.id },
        data: {
          failedAttempts: newFailedAttempts,
          lastFailureReason: errorMessage ?? 'payment_failed',
          // Anchor for dunning's 3/7/14-day retry schedule. Updated on every
          // failure so the cadence resets if a manual retry succeeds and then
          // a later renewal fails.
          lastFailedAt: new Date(),
          status: newStatus,
          ...(newStatus === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
        },
      }),
    ])
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return
    }
    throw err
  }

  // Status may have changed (PAST_DUE / SUSPENDED / CANCELLED) — bust caches
  // so the next request reflects the new state without waiting on the 30s
  // sub-status TTL.
  if (newStatus !== sub.status) {
    await invalidateSubscriptionCaches(tenantId)
  }

  const emailTemplate =
    newStatus === 'CANCELLED'
      ? 'subscription_cancelled'
      : newStatus === 'SUSPENDED'
        ? 'subscription_suspended'
        : 'payment_failed'

  const tenant = await masterDb.tenant.findUnique({ where: { id: tenantId } })
  if (tenant) {
    await sendEmail({ to: tenant.ownerEmail, template: emailTemplate, data: { tenantName: tenant.name } }).catch((err) => {
      // See note in handleWebhookSuccess — payment state already persisted,
      // we just need visibility on the failure case (suspension / cancel
      // notices are time-sensitive for the merchant).
      console.error('[Billing] email send failed', { template: emailTemplate, tenantId, err: String(err) })
    })
  }
}

/**
 * Cancel a tenant's active subscription.
 *
 * @param tenantId      tenant whose subscription to cancel
 * @param atPeriodEnd   when true (default), the subscription keeps serving
 *                      until currentPeriodEnd, then the trial-expiry job (or
 *                      a manual sweep) flips it to CANCELLED. When false,
 *                      cancel is immediate — used for admin-driven punitive
 *                      cancellation or tenant deletion.
 *
 * Returns the updated subscription so the caller can show a confirmation
 * with the effective end date (period end for scheduled, now for immediate).
 */
export async function cancelSubscription(tenantId: string, atPeriodEnd = true) {
  const sub = await masterDb.subscription.findFirst({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  })
  if (!sub) return null

  // No grace period for cancellation of a still-trialing sub — there's no
  // paid time to preserve. Also no point keeping a CANCELLED sub on file
  // marked "will cancel at period end".
  const effectiveAtPeriodEnd =
    atPeriodEnd && sub.status !== 'TRIALING' && sub.status !== 'CANCELLED'

  const updated = await masterDb.subscription.update({
    where: { id: sub.id },
    data: effectiveAtPeriodEnd
      ? { cancelAtPeriodEnd: true }
      : { status: 'CANCELLED', cancelledAt: new Date(), cancelAtPeriodEnd: false },
  })

  await invalidateSubscriptionCaches(tenantId)
  return updated
}

/**
 * Sweep subscriptions that opted in to cancel-at-period-end and whose period
 * has now ended. Called from the trial-expiry job's daily run — no separate
 * cron needed since both checks run on the same daily schedule.
 */
export async function sweepScheduledCancellations() {
  const now = new Date()
  const due = await masterDb.subscription.findMany({
    where: {
      cancelAtPeriodEnd: true,
      status: { notIn: ['CANCELLED'] },
      currentPeriodEnd: { lte: now },
    },
    select: { id: true, tenantId: true },
  })

  for (const sub of due) {
    await masterDb.subscription.update({
      where: { id: sub.id },
      data: { status: 'CANCELLED', cancelledAt: now, cancelAtPeriodEnd: false },
    })
    await invalidateSubscriptionCaches(sub.tenantId)
    console.info(`[CancelSweep] Cancelled subscription ${sub.id} at scheduled period end`)
  }

  return due.length
}
