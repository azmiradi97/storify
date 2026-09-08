import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { Prisma } from '@hesba/database'
import { config } from '../../config/env'
import { masterDb, getTenantDb } from '../../config/database'
import { redis } from '../../config/redis'
import { hashPassword } from '../../shared/utils/password'
import { passwordSchema } from '../../shared/validation'
import { migrateAllTenants } from '@hesba/database'
import {
  authenticatePlatformAdmin,
  requireOwner,
  type PlatformJWTPayload,
} from '../../shared/middleware/platform-admin.middleware'
import {
  loginPlatformAdmin,
  getPlatformRefreshTokenData,
  rotatePlatformRefreshToken,
  invalidatePlatformRefreshToken,
} from './admin.auth.service'
import { platformAudit } from './admin.audit'

const REFRESH_COOKIE = 'platformRefreshToken'
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60

function cookieOpts(maxAge: number) {
  return {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    // Strict (not Lax) for the platform-admin cookie: tenant SPAs and admin
    // SPA share an eTLD+1, so a Lax cookie travels on top-level navigations
    // initiated from any tenant subdomain. Combined with an XSS on a tenant,
    // that's privilege escalation. Strict blocks the cookie on cross-site
    // requests entirely; the admin UI is only entered directly, so usability
    // doesn't suffer.
    sameSite: 'strict' as const,
    // Path-scope so the cookie is only sent to /api/admin/* endpoints; it
    // shouldn't be attached to tenant API calls either.
    path: '/api/admin',
    maxAge,
  }
}

// Bust caches that may have stale tenant data after a write.
async function invalidateTenantCache(subdomain: string, tenantId: string) {
  await Promise.all([
    redis.del(`tenant:${subdomain}`),
    redis.del(`sub:status:${tenantId}`),
  ])
}

// Bust the tenant cache for every tenant on a given plan. Used after a plan
// edit because tenantMiddleware caches the tenant *with its plan embedded*,
// so feature/limit changes wouldn't take effect until the 5-min TTL expires.
async function invalidateCacheForPlan(planId: string) {
  const tenants = await masterDb.tenant.findMany({
    where: { planId },
    select: { id: true, subdomain: true },
  })
  if (tenants.length === 0) return
  await Promise.all(tenants.map((t) => invalidateTenantCache(t.subdomain, t.id)))
}

export async function adminRoutes(app: FastifyInstance) {
  // ─── POST /login ─────────────────────────────────────────────────────────
  const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  })

  app.post(
    '/login',
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'validation_error', message: parsed.error.errors[0].message },
        })
      }

      try {
        const { email, password } = parsed.data
        const result = await loginPlatformAdmin(email.toLowerCase(), password)
        const accessToken = await reply.jwtSign(result.payload)
        reply.setCookie(REFRESH_COOKIE, result.refreshToken, cookieOpts(COOKIE_MAX_AGE))

        await platformAudit({
          actorId: result.admin.id,
          entity: 'admin',
          entityId: result.admin.id,
          action: 'login',
          ip: request.ip,
        })

        return reply.send({ success: true, data: { accessToken, admin: result.admin } })
      } catch (err) {
        const error = err as Error & { statusCode?: number }
        if (error.message === 'invalid_credentials') {
          return reply.status(401).send({
            success: false,
            error: { code: 'invalid_credentials', message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' },
          })
        }
        app.log.error(err)
        return reply.status(500).send({ success: false, error: { code: 'internal_error', message: 'خطأ داخلي' } })
      }
    },
  )

  // ─── POST /refresh ───────────────────────────────────────────────────────
  app.post('/refresh', async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE]
    if (!token) {
      return reply.status(401).send({
        success: false,
        error: { code: 'no_refresh_token', message: 'الجلسة منتهية' },
      })
    }
    const data = await getPlatformRefreshTokenData(token)
    if (!data) {
      reply.clearCookie(REFRESH_COOKIE, { path: '/api/admin' })
      return reply.status(401).send({
        success: false,
        error: { code: 'invalid_refresh_token', message: 'الجلسة منتهية' },
      })
    }
    const admin = await masterDb.platformAdmin.findUnique({ where: { id: data.adminId } })
    if (!admin || !admin.isActive) {
      await invalidatePlatformRefreshToken(token)
      reply.clearCookie(REFRESH_COOKIE, { path: '/api/admin' })
      return reply.status(401).send({
        success: false,
        error: { code: 'admin_inactive', message: 'الحساب غير مفعّل' },
      })
    }

    const payload: PlatformJWTPayload = {
      scope: 'platform',
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
    }
    const accessToken = await reply.jwtSign(payload)
    const newToken = await rotatePlatformRefreshToken(token, { adminId: admin.id })
    reply.setCookie(REFRESH_COOKIE, newToken, cookieOpts(COOKIE_MAX_AGE))
    return reply.send({ success: true, data: { accessToken } })
  })

  // ─── POST /logout ────────────────────────────────────────────────────────
  app.post('/logout', async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE]
    if (token) await invalidatePlatformRefreshToken(token)
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/admin' })
    return reply.send({ success: true })
  })

  // ─── GET /me ─────────────────────────────────────────────────────────────
  app.get('/me', { preHandler: [authenticatePlatformAdmin] }, async (request, reply) => {
    return reply.send({ success: true, data: request.platformAdmin })
  })

  // ════════════════════════════════════════════════════════════════════════
  //   Everything below requires platform-admin auth.
  // ════════════════════════════════════════════════════════════════════════
  app.register(async function authedAdmin(scoped) {
    scoped.addHook('preHandler', authenticatePlatformAdmin)

    // ── GET /tenants ──────────────────────────────────────────────────────
    const tenantsQuerySchema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      search: z.string().optional(),
      status: z.enum(['ACTIVE', 'SUSPENDED', 'CANCELLED', 'PROVISIONING']).optional(),
      planSlug: z.string().optional(),
    })

    scoped.get('/tenants', async (request, reply) => {
      const parsed = tenantsQuerySchema.safeParse(request.query)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'validation_error', message: parsed.error.errors[0].message },
        })
      }
      const { page, limit, search, status, planSlug } = parsed.data
      const where: Prisma.TenantWhereInput = {
        ...(status ? { status } : {}),
        ...(planSlug ? { plan: { slug: planSlug } } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { subdomain: { contains: search, mode: 'insensitive' } },
                { ownerEmail: { contains: search, mode: 'insensitive' } },
                { ownerName: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      }

      const [rows, total] = await Promise.all([
        masterDb.tenant.findMany({
          where,
          include: {
            plan: { select: { id: true, name: true, slug: true, priceMonthly: true } },
            subscriptions: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { id: true, status: true, billingCycle: true, currentPeriodEnd: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        masterDb.tenant.count({ where }),
      ])

      const data = rows.map((t) => ({
        id: t.id,
        name: t.name,
        subdomain: t.subdomain,
        email: t.email,
        ownerName: t.ownerName,
        ownerEmail: t.ownerEmail,
        status: t.status,
        plan: t.plan,
        currentSubscription: t.subscriptions[0] ?? null,
        suspendedAt: t.suspendedAt,
        cancelledAt: t.cancelledAt,
        createdAt: t.createdAt,
      }))

      return reply.send({ success: true, data, meta: { total, page, limit, pages: Math.ceil(total / limit) } })
    })

    // ── GET /tenants/:id ──────────────────────────────────────────────────
    scoped.get<{ Params: { id: string } }>('/tenants/:id', async (request, reply) => {
      const t = await masterDb.tenant.findUnique({
        where: { id: request.params.id },
        include: {
          plan: true,
          subscriptions: {
            orderBy: { createdAt: 'desc' },
            include: {
              paymentAttempts: { orderBy: { attemptedAt: 'desc' }, take: 5 },
            },
          },
        },
      })
      if (!t) {
        return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'المتجر غير موجود' } })
      }

      // Best-effort tenant DB stats (counts). Failures should not break the page.
      let usage: { users: number; products: number; invoices: number; customers: number } | null = null
      try {
        const tdb = getTenantDb(t.schemaName)
        const [users, products, invoices, customers] = await Promise.all([
          tdb.user.count(),
          tdb.product.count(),
          tdb.invoice.count(),
          tdb.customer.count(),
        ])
        usage = { users, products, invoices, customers }
      } catch (err) {
        request.log.warn({ err, tenantId: t.id }, 'failed to fetch tenant usage')
      }

      return reply.send({ success: true, data: { ...t, usage } })
    })

    // ── PATCH /tenants/:id/suspend ───────────────────────────────────────
    const suspendSchema = z.object({
      suspended: z.boolean(),
      reason: z.string().max(500).optional(),
    })

    scoped.patch<{ Params: { id: string } }>('/tenants/:id/suspend', async (request, reply) => {
      const parsed = suspendSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'validation_error', message: parsed.error.errors[0].message },
        })
      }
      const existing = await masterDb.tenant.findUnique({ where: { id: request.params.id } })
      if (!existing) {
        return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'المتجر غير موجود' } })
      }

      const next = parsed.data.suspended
        ? { status: 'SUSPENDED' as const, suspendedAt: new Date() }
        : { status: 'ACTIVE' as const, suspendedAt: null }

      const updated = await masterDb.tenant.update({ where: { id: existing.id }, data: next })
      await invalidateTenantCache(existing.subdomain, existing.id)

      await platformAudit({
        actorId: request.platformAdmin!.id,
        entity: 'tenant',
        entityId: existing.id,
        action: parsed.data.suspended ? 'suspend' : 'unsuspend',
        before: { status: existing.status },
        after: { status: updated.status, reason: parsed.data.reason },
        ip: request.ip,
      })

      return reply.send({ success: true, data: { id: updated.id, status: updated.status, suspendedAt: updated.suspendedAt } })
    })

    // ── PATCH /tenants/:id/plan ──────────────────────────────────────────
    const changePlanSchema = z.object({ planId: z.string().min(1) })

    scoped.patch<{ Params: { id: string } }>('/tenants/:id/plan', async (request, reply) => {
      const parsed = changePlanSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'validation_error', message: parsed.error.errors[0].message },
        })
      }
      const [tenant, plan] = await Promise.all([
        masterDb.tenant.findUnique({ where: { id: request.params.id }, include: { plan: true } }),
        masterDb.plan.findUnique({ where: { id: parsed.data.planId } }),
      ])
      if (!tenant) return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'المتجر غير موجود' } })
      if (!plan) return reply.status(404).send({ success: false, error: { code: 'plan_not_found', message: 'الباقة غير موجودة' } })

      const updated = await masterDb.tenant.update({
        where: { id: tenant.id },
        data: { planId: plan.id },
        include: { plan: true },
      })
      await invalidateTenantCache(tenant.subdomain, tenant.id)

      await platformAudit({
        actorId: request.platformAdmin!.id,
        entity: 'tenant',
        entityId: tenant.id,
        action: 'plan_change',
        before: { planId: tenant.planId, planName: tenant.plan.name },
        after: { planId: plan.id, planName: plan.name },
        ip: request.ip,
      })

      return reply.send({ success: true, data: { id: updated.id, plan: updated.plan } })
    })

    // ── Plans CRUD ───────────────────────────────────────────────────────
    scoped.get('/plans', async (_request, reply) => {
      const plans = await masterDb.plan.findMany({
        orderBy: { sortOrder: 'asc' },
        include: { _count: { select: { tenants: true, subscriptions: true } } },
      })
      return reply.send({ success: true, data: plans })
    })

    const planBodySchema = z.object({
      name: z.string().min(1).max(100),
      slug: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]+$/).min(1).max(50),
      description: z.string().optional(),
      maxProducts: z.coerce.number().int().min(0).default(100),
      maxOrders: z.coerce.number().int().min(0).default(500),
      maxUsers: z.coerce.number().int().min(0).default(3),
      maxStorage: z.coerce.number().int().min(0).default(1024),
      maxInstallmentPlansMonthly: z.coerce.number().int().min(0).default(0),
      priceMonthly: z.coerce.number().min(0),
      priceYearly: z.coerce.number().min(0),
      features: z.record(z.string(), z.unknown()).default({}),
      isActive: z.boolean().default(true),
      sortOrder: z.coerce.number().int().default(0),
    })

    scoped.post('/plans', async (request, reply) => {
      const parsed = planBodySchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'validation_error', message: parsed.error.errors[0].message },
        })
      }
      const slugTaken = await masterDb.plan.findUnique({ where: { slug: parsed.data.slug }, select: { id: true } })
      if (slugTaken) {
        return reply.status(409).send({ success: false, error: { code: 'slug_taken', message: 'هذا المعرّف مستخدم بالفعل' } })
      }
      const { features, ...rest } = parsed.data
      const plan = await masterDb.plan.create({
        data: { ...rest, features: features as Prisma.InputJsonValue },
      })
      await platformAudit({
        actorId: request.platformAdmin!.id,
        entity: 'plan',
        entityId: plan.id,
        action: 'create',
        after: { name: plan.name, slug: plan.slug, priceMonthly: plan.priceMonthly },
        ip: request.ip,
      })
      return reply.status(201).send({ success: true, data: plan })
    })

    const planUpdateSchema = planBodySchema.partial().omit({ slug: true })

    scoped.patch<{ Params: { id: string } }>('/plans/:id', async (request, reply) => {
      const parsed = planUpdateSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'validation_error', message: parsed.error.errors[0].message },
        })
      }
      const existing = await masterDb.plan.findUnique({ where: { id: request.params.id } })
      if (!existing) {
        return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'الباقة غير موجودة' } })
      }
      const { features, ...rest } = parsed.data
      const updated = await masterDb.plan.update({
        where: { id: existing.id },
        data: {
          ...rest,
          ...(features !== undefined ? { features: features as Prisma.InputJsonValue } : {}),
        },
      })
      await invalidateCacheForPlan(updated.id)
      await platformAudit({
        actorId: request.platformAdmin!.id,
        entity: 'plan',
        entityId: updated.id,
        action: 'update',
        before: { name: existing.name, priceMonthly: existing.priceMonthly, isActive: existing.isActive },
        after: { name: updated.name, priceMonthly: updated.priceMonthly, isActive: updated.isActive },
        ip: request.ip,
      })
      return reply.send({ success: true, data: updated })
    })

    scoped.delete<{ Params: { id: string } }>('/plans/:id', async (request, reply) => {
      const existing = await masterDb.plan.findUnique({
        where: { id: request.params.id },
        include: { _count: { select: { tenants: true, subscriptions: true } } },
      })
      if (!existing) {
        return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'الباقة غير موجودة' } })
      }
      if (existing._count.tenants > 0 || existing._count.subscriptions > 0) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'plan_in_use',
            message: `لا يمكن حذف الباقة وعليها ${existing._count.tenants} متجر و${existing._count.subscriptions} اشتراك. أوقفها بدلاً من ذلك.`,
          },
        })
      }
      await masterDb.plan.delete({ where: { id: existing.id } })
      await platformAudit({
        actorId: request.platformAdmin!.id,
        entity: 'plan',
        entityId: existing.id,
        action: 'delete',
        before: { name: existing.name, slug: existing.slug },
        ip: request.ip,
      })
      return reply.status(204).send()
    })

    // ── GET /subscriptions ────────────────────────────────────────────────
    const subsQuerySchema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      status: z.enum(['ACTIVE', 'PAST_DUE', 'CANCELLED', 'TRIALING', 'SUSPENDED']).optional(),
    })

    scoped.get('/subscriptions', async (request, reply) => {
      const parsed = subsQuerySchema.safeParse(request.query)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'validation_error', message: parsed.error.errors[0].message },
        })
      }
      const { page, limit, status } = parsed.data
      const where: Prisma.SubscriptionWhereInput = status ? { status } : {}

      const [rows, total] = await Promise.all([
        masterDb.subscription.findMany({
          where,
          include: {
            tenant: { select: { id: true, name: true, subdomain: true } },
            plan: { select: { id: true, name: true, slug: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        masterDb.subscription.count({ where }),
      ])

      return reply.send({ success: true, data: rows, meta: { total, page, limit, pages: Math.ceil(total / limit) } })
    })

    // ── PATCH /subscriptions/:id/extend-trial ─────────────────────────────
    const extendTrialSchema = z.object({
      days: z.coerce.number().int().min(1).max(180),
      reason: z.string().max(500).optional(),
    })

    scoped.patch<{ Params: { id: string } }>('/subscriptions/:id/extend-trial', async (request, reply) => {
      const parsed = extendTrialSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'validation_error', message: parsed.error.errors[0].message },
        })
      }
      const sub = await masterDb.subscription.findUnique({
        where: { id: request.params.id },
        include: { tenant: { select: { id: true, subdomain: true } } },
      })
      if (!sub) return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'الاشتراك غير موجود' } })
      if (sub.status !== 'TRIALING' && sub.status !== 'PAST_DUE') {
        return reply.status(400).send({
          success: false,
          error: { code: 'invalid_status', message: 'تمديد الفترة التجريبية متاح فقط لاشتراك TRIALING أو PAST_DUE' },
        })
      }

      const base = sub.trialEndsAt && sub.trialEndsAt > new Date() ? sub.trialEndsAt : new Date()
      const newTrialEnd = new Date(base.getTime() + parsed.data.days * 24 * 3600 * 1000)

      const updated = await masterDb.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'TRIALING',
          trialEndsAt: newTrialEnd,
          currentPeriodEnd: newTrialEnd,
          failedAttempts: 0,
          lastFailureReason: null,
        },
      })
      await invalidateTenantCache(sub.tenant.subdomain, sub.tenant.id)

      await platformAudit({
        actorId: request.platformAdmin!.id,
        entity: 'subscription',
        entityId: sub.id,
        action: 'extend_trial',
        before: { status: sub.status, trialEndsAt: sub.trialEndsAt },
        after: { status: updated.status, trialEndsAt: updated.trialEndsAt, days: parsed.data.days, reason: parsed.data.reason },
        ip: request.ip,
      })

      return reply.send({ success: true, data: { id: updated.id, status: updated.status, trialEndsAt: updated.trialEndsAt } })
    })

    // ── PATCH /subscriptions/:id/cancel ───────────────────────────────────
    const cancelSubSchema = z.object({
      reason: z.string().max(500).optional(),
    })

    scoped.patch<{ Params: { id: string } }>('/subscriptions/:id/cancel', async (request, reply) => {
      const parsed = cancelSubSchema.safeParse(request.body ?? {})
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'validation_error', message: parsed.error.errors[0].message },
        })
      }
      const sub = await masterDb.subscription.findUnique({
        where: { id: request.params.id },
        include: { tenant: { select: { id: true, subdomain: true } } },
      })
      if (!sub) return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'الاشتراك غير موجود' } })
      if (sub.status === 'CANCELLED') {
        return reply.status(400).send({ success: false, error: { code: 'already_cancelled', message: 'الاشتراك ملغى بالفعل' } })
      }

      const updated = await masterDb.subscription.update({
        where: { id: sub.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      })
      await invalidateTenantCache(sub.tenant.subdomain, sub.tenant.id)

      await platformAudit({
        actorId: request.platformAdmin!.id,
        entity: 'subscription',
        entityId: sub.id,
        action: 'cancel',
        before: { status: sub.status },
        after: { status: updated.status, cancelledAt: updated.cancelledAt, reason: parsed.data.reason },
        ip: request.ip,
      })

      return reply.send({ success: true, data: { id: updated.id, status: updated.status, cancelledAt: updated.cancelledAt } })
    })

    // ── PATCH /subscriptions/:id/reactivate ───────────────────────────────
    // Move a PAST_DUE / SUSPENDED sub back to ACTIVE — for manual recovery
    // after an out-of-band payment or goodwill credit.
    scoped.patch<{ Params: { id: string } }>('/subscriptions/:id/reactivate', async (request, reply) => {
      const sub = await masterDb.subscription.findUnique({
        where: { id: request.params.id },
        include: { tenant: { select: { id: true, subdomain: true } } },
      })
      if (!sub) return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'الاشتراك غير موجود' } })
      if (sub.status !== 'PAST_DUE' && sub.status !== 'SUSPENDED') {
        return reply.status(400).send({
          success: false,
          error: { code: 'invalid_status', message: 'إعادة التفعيل متاحة فقط لاشتراك PAST_DUE أو SUSPENDED' },
        })
      }

      const periodStart = new Date()
      const periodEnd = new Date(periodStart)
      if (sub.billingCycle === 'YEARLY') {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1)
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1)
      }

      const updated = await masterDb.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'ACTIVE',
          failedAttempts: 0,
          lastFailureReason: null,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          nextBillingAt: periodEnd,
        },
      })
      await invalidateTenantCache(sub.tenant.subdomain, sub.tenant.id)

      await platformAudit({
        actorId: request.platformAdmin!.id,
        entity: 'subscription',
        entityId: sub.id,
        action: 'reactivate',
        before: { status: sub.status, failedAttempts: sub.failedAttempts },
        after: { status: updated.status },
        ip: request.ip,
      })

      return reply.send({ success: true, data: { id: updated.id, status: updated.status } })
    })

    // ── GET /revenue — platform-wide metrics ─────────────────────────────
    scoped.get('/revenue', async (_request, reply) => {
      const now = new Date()
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

      const activeSubs = await masterDb.subscription.findMany({
        where: { status: { in: ['ACTIVE', 'TRIALING'] } },
        select: { priceAtSubscription: true, billingCycle: true, status: true },
      })

      // MRR: yearly subs counted as price/12; trialing rows excluded from money in.
      let mrrCents = 0
      let activePayingCount = 0
      let trialingCount = 0
      for (const s of activeSubs) {
        if (s.status === 'TRIALING') {
          trialingCount += 1
          continue
        }
        activePayingCount += 1
        const monthly = s.billingCycle === 'YEARLY'
          ? s.priceAtSubscription.toNumber() / 12
          : s.priceAtSubscription.toNumber()
        mrrCents += Math.round(monthly * 100)
      }

      const [
        totalTenants,
        activeTenants,
        suspendedTenants,
        cancelledThisMonth,
        revenue30dAgg,
        recentFailures,
      ] = await Promise.all([
        masterDb.tenant.count(),
        masterDb.tenant.count({ where: { status: 'ACTIVE' } }),
        masterDb.tenant.count({ where: { status: 'SUSPENDED' } }),
        masterDb.subscription.count({
          where: { status: 'CANCELLED', cancelledAt: { gte: thirtyDaysAgo } },
        }),
        masterDb.paymentAttempt.aggregate({
          where: { status: 'SUCCESS', attemptedAt: { gte: thirtyDaysAgo } },
          _sum: { amount: true },
          _count: true,
        }),
        masterDb.paymentAttempt.count({
          where: { status: 'FAILED', attemptedAt: { gte: thirtyDaysAgo } },
        }),
      ])

      const mrr = mrrCents / 100
      const arpu = activePayingCount > 0 ? mrr / activePayingCount : 0
      // Naive monthly churn proxy: cancelled-this-month / (active + cancelled-this-month).
      const churnRate = activePayingCount + cancelledThisMonth > 0
        ? cancelledThisMonth / (activePayingCount + cancelledThisMonth)
        : 0

      return reply.send({
        success: true,
        data: {
          mrr,
          arpu,
          activePayingSubs: activePayingCount,
          trialingSubs: trialingCount,
          totalTenants,
          activeTenants,
          suspendedTenants,
          cancelledLast30Days: cancelledThisMonth,
          churnRate,
          revenueLast30Days: revenue30dAgg._sum.amount?.toNumber() ?? 0,
          successfulPaymentsLast30Days: revenue30dAgg._count,
          failedPaymentsLast30Days: recentFailures,
        },
      })
    })

    // ── GET /admins — list platform admins (OWNER only) ──────────────────
    scoped.get('/admins', { preHandler: [requireOwner()] }, async (_request, reply) => {
      const admins = await masterDb.platformAdmin.findMany({
        orderBy: { createdAt: 'asc' },
        select: { id: true, email: true, fullName: true, role: true, isActive: true, lastLogin: true, createdAt: true },
      })
      return reply.send({ success: true, data: admins })
    })

    const createAdminSchema = z.object({
      email: z.string().email(),
      fullName: z.string().min(1).max(200),
      password: passwordSchema,
      role: z.enum(['OWNER', 'ADMIN']).default('ADMIN'),
    })

    scoped.post('/admins', { preHandler: [requireOwner()] }, async (request, reply) => {
      const parsed = createAdminSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'validation_error', message: parsed.error.errors[0].message },
        })
      }
      const email = parsed.data.email.toLowerCase()
      const taken = await masterDb.platformAdmin.findUnique({ where: { email }, select: { id: true } })
      if (taken) {
        return reply.status(409).send({ success: false, error: { code: 'email_taken', message: 'البريد الإلكتروني مستخدم بالفعل' } })
      }
      const passwordHash = await hashPassword(parsed.data.password)
      const admin = await masterDb.platformAdmin.create({
        data: {
          email,
          passwordHash,
          fullName: parsed.data.fullName,
          role: parsed.data.role,
        },
        select: { id: true, email: true, fullName: true, role: true, isActive: true, lastLogin: true, createdAt: true },
      })
      await platformAudit({
        actorId: request.platformAdmin!.id,
        entity: 'admin',
        entityId: admin.id,
        action: 'create',
        after: { email: admin.email, role: admin.role },
        ip: request.ip,
      })
      return reply.status(201).send({ success: true, data: admin })
    })

    const updateAdminSchema = z.object({
      fullName: z.string().min(1).max(200).optional(),
      isActive: z.boolean().optional(),
      role: z.enum(['OWNER', 'ADMIN']).optional(),
      password: passwordSchema.optional(),
    })

    scoped.patch<{ Params: { id: string } }>(
      '/admins/:id',
      { preHandler: [requireOwner()] },
      async (request, reply) => {
        const parsed = updateAdminSchema.safeParse(request.body)
        if (!parsed.success) {
          return reply.status(400).send({
            success: false,
            error: { code: 'validation_error', message: parsed.error.errors[0].message },
          })
        }
        const existing = await masterDb.platformAdmin.findUnique({ where: { id: request.params.id } })
        if (!existing) {
          return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'المستخدم غير موجود' } })
        }
        // Prevent OWNER from locking themselves out.
        if (existing.id === request.platformAdmin!.id && parsed.data.isActive === false) {
          return reply.status(400).send({ success: false, error: { code: 'cant_disable_self', message: 'لا يمكنك تعطيل حسابك' } })
        }

        const data: Prisma.PlatformAdminUpdateInput = {
          ...(parsed.data.fullName !== undefined ? { fullName: parsed.data.fullName } : {}),
          ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
          ...(parsed.data.role !== undefined ? { role: parsed.data.role } : {}),
        }
        if (parsed.data.password) data.passwordHash = await hashPassword(parsed.data.password)

        const updated = await masterDb.platformAdmin.update({
          where: { id: existing.id },
          data,
          select: { id: true, email: true, fullName: true, role: true, isActive: true, lastLogin: true, createdAt: true },
        })

        await platformAudit({
          actorId: request.platformAdmin!.id,
          entity: 'admin',
          entityId: updated.id,
          action: parsed.data.password ? 'password_reset' : 'update',
          before: { fullName: existing.fullName, isActive: existing.isActive, role: existing.role },
          after: { fullName: updated.fullName, isActive: updated.isActive, role: updated.role },
          ip: request.ip,
        })
        return reply.send({ success: true, data: updated })
      },
    )

    scoped.delete<{ Params: { id: string } }>(
      '/admins/:id',
      { preHandler: [requireOwner()] },
      async (request, reply) => {
        if (request.params.id === request.platformAdmin!.id) {
          return reply.status(400).send({ success: false, error: { code: 'cant_delete_self', message: 'لا يمكنك حذف حسابك' } })
        }
        const existing = await masterDb.platformAdmin.findUnique({ where: { id: request.params.id } })
        if (!existing) {
          return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'المستخدم غير موجود' } })
        }
        await masterDb.platformAdmin.delete({ where: { id: existing.id } })
        await platformAudit({
          actorId: request.platformAdmin!.id,
          entity: 'admin',
          entityId: existing.id,
          action: 'delete',
          before: { email: existing.email, role: existing.role },
          ip: request.ip,
        })
        return reply.status(204).send()
      },
    )

    // ── GET /audit-logs ───────────────────────────────────────────────────
    const auditQuerySchema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      entity: z.string().optional(),
      action: z.string().optional(),
      actorId: z.string().optional(),
    })

    scoped.get('/audit-logs', async (request, reply) => {
      const parsed = auditQuerySchema.safeParse(request.query)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'validation_error', message: parsed.error.errors[0].message },
        })
      }
      const { page, limit, entity, action, actorId } = parsed.data
      const where: Prisma.PlatformAuditLogWhereInput = {
        ...(entity ? { entity } : {}),
        ...(action ? { action } : {}),
        ...(actorId ? { actorId } : {}),
      }
      const [logs, total] = await Promise.all([
        masterDb.platformAuditLog.findMany({
          where,
          include: { actor: { select: { id: true, email: true, fullName: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        masterDb.platformAuditLog.count({ where }),
      ])
      return reply.send({ success: true, data: logs, meta: { total, page, limit, pages: Math.ceil(total / limit) } })
    })

    // ─── Manual migration trigger (OWNER only) ────────────────────────────────
    // Safety valve: run pending tenant SQL migrations on-demand without
    // needing a full redeploy. Idempotent — safe to call multiple times.
    scoped.post('/run-migrations', { preHandler: [requireOwner] }, async (_request, reply) => {
      const result = await migrateAllTenants()
      return reply.send({ success: true, data: result })
    })
  })
}
