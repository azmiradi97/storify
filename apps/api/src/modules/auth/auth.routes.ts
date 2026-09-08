import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { config } from '../../config/env'
import {
  loginUser,
  getRefreshTokenData,
  rotateRefreshToken,
  invalidateRefreshToken,
  requestPasswordReset,
  resetPassword,
  checkForgotPasswordRateLimit,
} from './auth.service'
import { authenticate, requirePermission } from '../../shared/middleware/auth.middleware'
import type { JWTPayload } from '../../shared/middleware/auth.middleware'
import { requireUnderLimit } from '../../shared/middleware/limit.middleware'
import { permissionsWithinActor } from '../../shared/utils/permissions'

const REFRESH_COOKIE = 'refreshToken'
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 // 7 days

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const forgotSchema = z.object({ email: z.string().email() })

const resetSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
})

function cookieOpts(maxAge: number) {
  return {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
    // Share the refresh cookie across all subdomains (*.hesbaapp.com)
    ...(config.APP_BASE_DOMAIN ? { domain: `.${config.APP_BASE_DOMAIN}` } : {}),
  }
}

export async function authRoutes(app: FastifyInstance) {
  // ─── POST /api/auth/login ─────────────────────────────────────────────────
  app.post('/login', {
    config: { rateLimit: { max: 10, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'validation_error', message: parsed.error.errors[0].message },
      })
    }

    try {
      const { email, password } = parsed.data
      const result = await loginUser(
        request.tenantDb,
        request.tenant.id,
        request.tenant.schemaName,
        email,
        password,
      )

      const accessToken = await reply.jwtSign(result.payload)

      reply.setCookie(REFRESH_COOKIE, result.refreshToken, cookieOpts(COOKIE_MAX_AGE))

      return reply.status(200).send({
        success: true,
        data: { accessToken, user: result.user },
      })
    } catch (err: unknown) {
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
  })

  // ─── POST /api/auth/refresh ───────────────────────────────────────────────
  // Rate-limited so an attacker who scrapes a refresh cookie can't churn it.
  app.post('/refresh', {
    config: { rateLimit: { max: 30, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE]
    if (!token) {
      return reply.status(401).send({
        success: false,
        error: { code: 'no_refresh_token', message: 'الجلسة منتهية، يرجى تسجيل الدخول مجدداً' },
      })
    }

    const data = await getRefreshTokenData(token)
    if (!data) {
      reply.clearCookie(REFRESH_COOKIE, { path: '/' })
      return reply.status(401).send({
        success: false,
        error: { code: 'invalid_refresh_token', message: 'الجلسة منتهية، يرجى تسجيل الدخول مجدداً' },
      })
    }

    // Refuse to refresh sessions when the subscription is past the grace
    // period. The tenant middleware exempts /api/auth/* from this check (so
    // users can still log in to pay), but for refresh we want a stricter
    // gate — otherwise a SUSPENDED/CANCELLED tenant can extend its session
    // indefinitely off a still-valid refresh token.
    const { masterDb } = await import('../../config/database')
    const subscription = await masterDb.subscription.findFirst({
      where: { tenantId: request.tenant.id },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    })
    if (subscription && (subscription.status === 'SUSPENDED' || subscription.status === 'CANCELLED')) {
      await invalidateRefreshToken(token)
      reply.clearCookie(REFRESH_COOKIE, { path: '/' })
      return reply.status(402).send({
        success: false,
        error: { code: 'subscription_inactive', message: 'الاشتراك غير نشط' },
      })
    }

    // Look up fresh user data to build the payload
    const user = await request.tenantDb.user.findUnique({
      where: { id: data.userId },
      include: { role: true },
    })

    if (!user || !user.isActive) {
      await invalidateRefreshToken(token)
      reply.clearCookie(REFRESH_COOKIE, { path: '/' })
      return reply.status(401).send({
        success: false,
        error: { code: 'user_inactive', message: 'الحساب غير مفعّل' },
      })
    }

    const payload: JWTPayload = {
      scope: 'tenant',
      userId: user.id,
      tenantId: data.tenantId,
      schemaName: data.schemaName,
      roleSlug: user.role.slug,
      branchId: user.branchId ?? '',
      permissions: (user.role.permissions as Record<string, string[]>) ?? {},
    }

    const accessToken = await reply.jwtSign(payload)
    const newRefreshToken = await rotateRefreshToken(token, data)

    reply.setCookie(REFRESH_COOKIE, newRefreshToken, cookieOpts(COOKIE_MAX_AGE))

    return reply.status(200).send({ success: true, data: { accessToken } })
  })

  // ─── POST /api/auth/logout ────────────────────────────────────────────────
  app.post('/logout', async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE]
    if (token) await invalidateRefreshToken(token)
    reply.clearCookie(REFRESH_COOKIE, { path: '/' })
    return reply.status(200).send({ success: true })
  })

  // ─── POST /api/auth/forgot-password ──────────────────────────────────────
  // Per-IP cap on top of the per-email rate limit so an attacker can't pivot
  // through many emails. The per-email Redis-backed limit lives inside
  // checkForgotPasswordRateLimit.
  app.post('/forgot-password', {
    config: { rateLimit: { max: 20, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const parsed = forgotSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(200).send({ success: true }) // never reveal anything
    }

    const { email } = parsed.data
    const allowed = await checkForgotPasswordRateLimit(email)
    if (!allowed) {
      return reply.status(429).send({
        success: false,
        error: { code: 'rate_limited', message: 'تم تجاوز الحد المسموح. حاول بعد ساعة.' },
      })
    }

    const ip = request.ip
    const subdomain = request.tenant.subdomain

    // Fire and forget — always return 200
    requestPasswordReset(request.tenantDb, subdomain, email, ip).catch((err) =>
      app.log.error({ err }, 'forgot-password: requestPasswordReset failed'),
    )

    return reply.status(200).send({ success: true })
  })

  // ─── POST /api/auth/reset-password ───────────────────────────────────────
  // Tight rate limit — without this, leaked reset URLs become token-guessing
  // surfaces and brute force is cheap.
  app.post('/reset-password', {
    config: { rateLimit: { max: 5, timeWindow: 5 * 60_000 } },
  }, async (request, reply) => {
    const parsed = resetSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'validation_error', message: parsed.error.errors[0].message },
      })
    }

    try {
      await resetPassword(request.tenantDb, parsed.data.token, parsed.data.newPassword)
      return reply.status(200).send({ success: true })
    } catch (err: unknown) {
      const error = err as Error & { statusCode?: number }
      if (error.message === 'invalid_or_expired_token') {
        return reply.status(400).send({
          success: false,
          error: { code: 'invalid_or_expired_token', message: 'رابط إعادة التعيين غير صالح أو منتهي الصلاحية' },
        })
      }
      app.log.error(err)
      return reply.status(500).send({ success: false, error: { code: 'internal_error', message: 'خطأ داخلي' } })
    }
  })

  // ─── GET /api/auth/me — current user + tenant + plan features ────────────
  // Frontend uses `plan.features` and limits to gate UI before backend rejects.
  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const auth = request.user as JWTPayload
    const user = await request.tenantDb.user.findUnique({
      where: { id: auth.userId },
      include: { role: { select: { id: true, name: true, slug: true, permissions: true } } },
    })
    if (!user) return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'المستخدم غير موجود' } })

    const tenant = request.tenant
    return reply.send({
      success: true,
      data: {
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          roleSlug: user.role.slug,
          branchId: user.branchId ?? '',
          permissions: (user.role.permissions as Record<string, string[]>) ?? {},
        },
        tenant: {
          id: tenant.id,
          name: tenant.name,
          subdomain: tenant.subdomain,
          plan: {
            id: tenant.plan.id,
            name: tenant.plan.name,
            slug: tenant.plan.slug,
            features: tenant.plan.features ?? {},
            limits: {
              maxProducts: tenant.plan.maxProducts,
              maxOrders: tenant.plan.maxOrders,
              maxUsers: tenant.plan.maxUsers,
              maxStorage: tenant.plan.maxStorage,
              maxInstallmentPlansMonthly: tenant.plan.maxInstallmentPlansMonthly,
            },
          },
        },
      },
    })
  })

  // ─── GET /api/auth/me/usage — current usage vs. plan limits ─────────────
  app.get('/me/usage', { preHandler: [authenticate] }, async (request, reply) => {
    const tenant = request.tenant
    const plan = tenant.plan

    // Invoice + installment caps are per calendar month — match the
    // requireUnderLimit('invoices') middleware and the installment quota check.
    // Users + products are all-time totals.
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const [users, products, invoicesThisMonth, installmentPlansThisMonth] = await Promise.all([
      request.tenantDb.user.count(),
      request.tenantDb.product.count(),
      request.tenantDb.invoice.count({ where: { createdAt: { gte: monthStart } } }),
      request.tenantDb.installmentContract.count({ where: { createdAt: { gte: monthStart } } }).catch(() => 0),
    ])

    return reply.send({
      success: true,
      data: {
        users: { used: users, limit: plan.maxUsers },
        products: { used: products, limit: plan.maxProducts },
        invoicesThisMonth: { used: invoicesThisMonth, limit: plan.maxOrders },
        installmentPlansThisMonth: { used: installmentPlansThisMonth, limit: plan.maxInstallmentPlansMonthly },
      },
    })
  })

  // ─── GET /api/auth/users — list all tenant users ─────────────────────────
  app.get('/users', { preHandler: [authenticate, requirePermission('users', 'read')] }, async (request, reply) => {
    const users = await request.tenantDb.user.findMany({
      include: { role: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return reply.send({
      success: true,
      data: users.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        lastLogin: u.lastLogin,
        branchId: u.branchId,
      })),
    })
  })

  // ─── POST /api/auth/users — create a new tenant user ─────────────────────
  const createUserSchema = z.object({
    fullName: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
    roleId: z.string().uuid(),
    branchId: z.string().uuid().optional(),
  })

  app.post('/users', { preHandler: [authenticate, requirePermission('users', 'create'), requireUnderLimit('users')] }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: 'validation_error', message: parsed.error.errors[0].message } })
    }
    const { fullName, password, roleId, branchId } = parsed.data
    // Normalize on write so logins (also normalized) always match — the email
    // column is case-sensitive VARCHAR, not CITEXT.
    const email = parsed.data.email.trim().toLowerCase()
    const existing = await request.tenantDb.user.findUnique({ where: { email } })
    if (existing) {
      return reply.status(409).send({ success: false, error: { code: 'conflict', message: 'البريد الإلكتروني مستخدم بالفعل' } })
    }

    // HESBA-SEC-02: a user can't assign a role above their own privilege.
    const creator = request.user as JWTPayload
    const targetRole = await request.tenantDb.role.findUnique({
      where: { id: roleId },
      select: { slug: true, permissions: true },
    })
    if (!targetRole) {
      return reply.status(400).send({ success: false, error: { code: 'invalid_role', message: 'الدور غير موجود' } })
    }
    if (creator.roleSlug !== 'super_admin') {
      const targetPerms = (targetRole.permissions as Record<string, string[]>) ?? {}
      if (targetRole.slug === 'super_admin' || !permissionsWithinActor(targetPerms, creator.permissions)) {
        return reply.status(403).send({
          success: false,
          error: { code: 'permission_escalation', message: 'لا يمكنك تعيين دور بصلاحيات أعلى من صلاحياتك' },
        })
      }
    }

    const { hashPassword } = await import('../../shared/utils/password')
    const passwordHash = await hashPassword(password)
    const user = await request.tenantDb.user.create({
      data: { fullName, email, passwordHash, roleId, branchId: branchId ?? null },
      include: { role: { select: { id: true, name: true, slug: true } } },
    })
    return reply.status(201).send({
      success: true,
      data: { id: user.id, fullName: user.fullName, email: user.email, role: user.role, isActive: user.isActive },
    })
  })

  // ─── GET /api/auth/roles — list available roles ───────────────────────────
  app.get('/roles', { preHandler: [authenticate] }, async (request, reply) => {
    const roles = await request.tenantDb.role.findMany({
      select: { id: true, name: true, slug: true, permissions: true, isSystem: true },
      orderBy: { name: 'asc' },
    })
    return reply.send({ success: true, data: roles })
  })

  // ─── POST /api/auth/roles — create a custom (non-system) role ────────────
  const createRoleSchema = z.object({
    name: z.string().trim().min(1, 'الاسم مطلوب').max(100),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]+$/, 'المعرّف يجب أن يحتوي حروفاً لاتينية صغيرة وأرقام و- أو _ فقط').min(1).max(50),
    permissions: z.record(z.string(), z.array(z.string())).default({}),
  })

  app.post(
    '/roles',
    { preHandler: [authenticate, requirePermission('users', 'update')] },
    async (request, reply) => {
      const parsed = createRoleSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'validation_error', message: parsed.error.errors[0].message },
        })
      }

      // HESBA-SEC-02: can't create a role granting permissions you don't hold.
      const creator = request.user as JWTPayload
      if (creator.roleSlug !== 'super_admin' && !permissionsWithinActor(parsed.data.permissions, creator.permissions)) {
        return reply.status(403).send({
          success: false,
          error: { code: 'permission_escalation', message: 'لا يمكنك منح صلاحيات لا تملكها' },
        })
      }

      const existing = await request.tenantDb.role.findUnique({
        where: { slug: parsed.data.slug },
        select: { id: true },
      })
      if (existing) {
        return reply.status(409).send({
          success: false,
          error: { code: 'slug_taken', message: 'هذا المعرّف مستخدم بالفعل' },
        })
      }

      const actor = request.user as JWTPayload
      const role = await request.tenantDb.role.create({
        data: {
          name: parsed.data.name,
          slug: parsed.data.slug,
          permissions: parsed.data.permissions,
          isSystem: false,
        },
        select: { id: true, name: true, slug: true, permissions: true, isSystem: true },
      })

      const { auditLog } = await import('../../shared/utils/audit')
      await auditLog({
        db: request.tenantDb,
        actorId: actor.userId,
        entity: 'role',
        entityId: role.id,
        action: 'create',
        after: { name: role.name, slug: role.slug },
        ip: request.ip,
      })

      return reply.status(201).send({ success: true, data: role })
    },
  )

  // ─── PATCH /api/auth/roles/:id — update a role's permissions and/or name ──
  // System roles (e.g., super_admin) are read-only on purpose — losing their
  // permissions would lock the tenant out of recovery. Slugs are immutable
  // even for custom roles because JWTs and a few hardcoded checks reference
  // them by value.
  const updateRoleSchema = z.object({
    permissions: z.record(z.string(), z.array(z.string())).optional(),
    name: z.string().trim().min(1).max(100).optional(),
  }).refine(
    (v) => v.permissions !== undefined || v.name !== undefined,
    { message: 'لا توجد تغييرات' },
  )

  app.patch<{ Params: { id: string } }>(
    '/roles/:id',
    { preHandler: [authenticate, requirePermission('users', 'update')] },
    async (request, reply) => {
      const parsed = updateRoleSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'validation_error', message: parsed.error.errors[0].message },
        })
      }

      // HESBA-SEC-02: can't escalate a role's permissions beyond your own.
      const editor = request.user as JWTPayload
      if (
        editor.roleSlug !== 'super_admin' &&
        parsed.data.permissions !== undefined &&
        !permissionsWithinActor(parsed.data.permissions, editor.permissions)
      ) {
        return reply.status(403).send({
          success: false,
          error: { code: 'permission_escalation', message: 'لا يمكنك منح صلاحيات لا تملكها' },
        })
      }

      const existing = await request.tenantDb.role.findUnique({
        where: { id: request.params.id },
        select: { id: true, name: true, slug: true, permissions: true, isSystem: true },
      })
      if (!existing) {
        return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'الدور غير موجود' } })
      }
      if (existing.isSystem) {
        return reply.status(403).send({ success: false, error: { code: 'system_role_readonly', message: 'لا يمكن تعديل دور نظامي' } })
      }

      const actor = request.user as JWTPayload
      const updated = await request.tenantDb.role.update({
        where: { id: request.params.id },
        data: {
          ...(parsed.data.permissions !== undefined ? { permissions: parsed.data.permissions } : {}),
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        },
        select: { id: true, name: true, slug: true, permissions: true, isSystem: true },
      })

      const { auditLog } = await import('../../shared/utils/audit')
      await auditLog({
        db: request.tenantDb,
        actorId: actor.userId,
        entity: 'role',
        entityId: updated.id,
        action: parsed.data.permissions !== undefined ? 'permissions_update' : 'rename',
        before: { name: existing.name, permissions: existing.permissions },
        after: { name: updated.name, permissions: updated.permissions },
        ip: request.ip,
      })

      return reply.send({ success: true, data: updated })
    },
  )

  // ─── DELETE /api/auth/roles/:id — delete a custom role ────────────────────
  app.delete<{ Params: { id: string } }>(
    '/roles/:id',
    { preHandler: [authenticate, requirePermission('users', 'update')] },
    async (request, reply) => {
      const existing = await request.tenantDb.role.findUnique({
        where: { id: request.params.id },
        select: { id: true, name: true, slug: true, isSystem: true, _count: { select: { users: true } } },
      })
      if (!existing) {
        return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'الدور غير موجود' } })
      }
      if (existing.isSystem) {
        return reply.status(403).send({ success: false, error: { code: 'system_role_readonly', message: 'لا يمكن حذف دور نظامي' } })
      }
      if (existing._count.users > 0) {
        return reply.status(409).send({
          success: false,
          error: { code: 'role_in_use', message: `لا يمكن حذف الدور وله ${existing._count.users} مستخدم — أعد تعيين هؤلاء المستخدمين أولاً.` },
        })
      }

      const actor = request.user as JWTPayload
      await request.tenantDb.role.delete({ where: { id: request.params.id } })

      const { auditLog } = await import('../../shared/utils/audit')
      await auditLog({
        db: request.tenantDb,
        actorId: actor.userId,
        entity: 'role',
        entityId: existing.id,
        action: 'delete',
        before: { name: existing.name, slug: existing.slug },
        ip: request.ip,
      })

      return reply.status(204).send()
    },
  )

  // ─── PATCH /api/auth/me/password — change own password ───────────────────
  const changePasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  })

  app.patch('/me/password', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as import('../../shared/middleware/auth.middleware').JWTPayload
    const parsed = changePasswordSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: 'validation_error', message: parsed.error.errors[0].message } })
    }

    const { verifyPassword, hashPassword } = await import('../../shared/utils/password')
    const dbUser = await request.tenantDb.user.findUnique({ where: { id: user.userId } })
    if (!dbUser) {
      return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'المستخدم غير موجود' } })
    }

    const valid = await verifyPassword(parsed.data.currentPassword, dbUser.passwordHash)
    if (!valid) {
      return reply.status(401).send({ success: false, error: { code: 'wrong_password', message: 'كلمة المرور الحالية غير صحيحة' } })
    }

    const passwordHash = await hashPassword(parsed.data.newPassword)
    await request.tenantDb.user.update({ where: { id: user.userId }, data: { passwordHash } })

    return reply.send({ success: true })
  })

  // ─── GET /api/auth/audit-logs — paginated audit log viewer ───────────────
  const auditQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    entity: z.string().optional(),
    action: z.string().optional(),
    actorId: z.string().uuid().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  })

  app.get('/audit-logs', { preHandler: [authenticate, requirePermission('users', 'read')] }, async (request, reply) => {
    const parsed = auditQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: 'validation_error', message: parsed.error.errors[0].message } })
    }
    const { page, limit, entity, action, actorId, from, to } = parsed.data

    const where = {
      ...(entity ? { entity } : {}),
      ...(action ? { action } : {}),
      ...(actorId ? { actorId } : {}),
      ...(from || to ? {
        createdAt: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
        },
      } : {}),
    }

    const [logs, total] = await Promise.all([
      request.tenantDb.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      request.tenantDb.auditLog.count({ where }),
    ])

    return reply.send({
      success: true,
      data: logs,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    })
  })
}
