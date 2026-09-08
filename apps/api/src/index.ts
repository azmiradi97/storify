import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import helmet from '@fastify/helmet'
import fastifyStatic from '@fastify/static'
import { join } from 'path'
import { config } from './config/env'
import { masterDb } from './config/database'
import { redis } from './config/redis'
import jwtPlugin from './shared/plugins/jwt.plugin'
import cookiePlugin from './shared/plugins/cookie.plugin'
import sentryPlugin from './shared/plugins/sentry.plugin'
import { tenantMiddleware } from './shared/middleware/tenant.middleware'
import { tenantRoutes } from './modules/tenants/tenant.routes'
import { authRoutes } from './modules/auth/auth.routes'
import { productRoutes } from './modules/products/product.routes'
import { stockRoutes } from './modules/stock/stock.routes'
import { paymentMethodRoutes } from './modules/payment-methods/pm.routes'
import { customerRoutes } from './modules/customers/customer.routes'
import { invoiceRoutes } from './modules/invoices/invoice.routes'
import { installmentRoutes } from './modules/installments/installment.routes'
import { supplierRoutes } from './modules/suppliers/supplier.routes'
import { purchaseOrderRoutes } from './modules/purchase-orders/po.routes'
import { expenseRoutes } from './modules/expenses/expense.routes'
import { serviceRoutes } from './modules/services/service.routes'
import { workOrderRoutes } from './modules/services/workOrder.routes'
import { reportRoutes } from './modules/reports/report.routes'
import { couponRoutes } from './modules/coupons/coupon.routes'
import { etaRoutes } from './modules/eta/eta.routes'
import { billingRoutes, billingWebhookRoutes } from './modules/billing/billing.routes'
import { adminRoutes } from './modules/admin/admin.routes'
import { seedOwnerFromEnv } from './modules/admin/admin.auth.service'
import { migrateAllTenants } from '@hesba/database'
import { authenticate } from './shared/middleware/auth.middleware'
import { requireUnderLimit } from './shared/middleware/limit.middleware'
import { startEtaWorker } from './jobs/eta-submission.job'
import { startDunningWorker, scheduleDunning } from './jobs/dunning.job'
import { startReminderWorker, scheduleReminders } from './jobs/installment-reminders.job'
import { startTrialExpiryWorker, scheduleTrialExpiry } from './jobs/trial-expiry.job'
import { startRenewalWorker, scheduleRenewal } from './jobs/renewal.job'

const app = Fastify({
  logger: {
    level: config.NODE_ENV === 'development' ? 'info' : 'warn',
    // Strip credentials before anything reaches the logs (or Sentry, which
    // ingests breadcrumbs from them). `remove` drops the field entirely.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
      ],
      remove: true,
    },
    transport:
      config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
})

// ─── Global plugins (CORS is NOT global — see apiContext below) ──────────────
// CORS is registered inside the apiContext encapsulation so it only gates the
// API routes. Static assets served by fastifyStatic must bypass CORS, otherwise
// browsers get 500s on /assets/*.js when accessing the app from a domain that
// isn't in FRONTEND_URL / APP_BASE_DOMAIN (e.g. Railway's *.up.railway.app).
app.register(sentryPlugin)
app.register(jwtPlugin)
app.register(cookiePlugin)
// Security headers. CSP is disabled because we serve the Vite-built SPA from
// the same origin and inline styles/scripts are unavoidable without rework.
app.register(helmet, { contentSecurityPolicy: false })
app.register(rateLimit, {
  global: false, // opt-in per-route via config.rateLimit
  redis,
})

// Global error handler — never leak stack traces or internal messages in
// production. Fastify validation errors keep their message; other errors are
// normalized to `{ success: false, error: { code, message } }`.
app.setErrorHandler((error, request, reply) => {
  const status =
    typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500

  if (status >= 500) {
    request.log.error({ err: error, url: request.url }, 'unhandled_error')
  }

  // Fastify schema validation errors come back with a `validation` array.
  if ((error as { validation?: unknown[] }).validation) {
    return reply.status(400).send({
      success: false,
      error: { code: 'validation_error', message: error.message },
    })
  }

  // Rate-limit plugin reports 429 with its own message.
  if (status === 429) {
    return reply.status(429).send({
      success: false,
      error: { code: 'rate_limited', message: error.message || 'Too many requests' },
    })
  }

  if (status >= 500) {
    return reply.status(status).send({
      success: false,
      error: {
        code: 'internal_error',
        message: config.NODE_ENV === 'production' ? 'Internal server error' : error.message,
      },
    })
  }

  return reply.status(status).send({
    success: false,
    error: { code: (error as { code?: string }).code ?? 'error', message: error.message },
  })
})

// ─── Public routes (no tenant required) ──────────────────────────────────────
// Migration state is published here for liveness probes / on-call dashboards.
// `migrateAllTenants` is fire-and-forget at startup (so health checks don't
// block on slow migrations), but if some tenants fail to migrate we still
// want that to be visible — not buried in logs.
interface MigrationState {
  status: 'pending' | 'ok' | 'partial' | 'failed'
  ok: number
  failed: number
  errors: Array<{ tenantId: string; err: string }>
  finishedAt: string | null
}
const migrationState: MigrationState = {
  status: 'pending',
  ok: 0,
  failed: 0,
  errors: [],
  finishedAt: null,
}

app.get('/health', async (_req, reply) => {
  // If any tenant migration failed, surface it as a 503 so orchestrators
  // (Railway / k8s) can see the degraded state. Pending and ok stay 200.
  const status = migrationState.status === 'failed' ? 503 : 200
  return reply.status(status).send({
    status: status === 200 ? 'ok' : 'degraded',
    env: config.NODE_ENV,
    timestamp: new Date().toISOString(),
    migrations: {
      status: migrationState.status,
      ok: migrationState.ok,
      failed: migrationState.failed,
      // Don't dump full error details to anonymous callers — surfaces tenant
      // ids and stack info. Just a count.
      finishedAt: migrationState.finishedAt,
    },
  })
})

// Caddy on-demand TLS ask endpoint — returns 200 only for *.APP_BASE_DOMAIN
app.get('/internal/check-tenant', async (req, reply) => {
  const domain = (req.query as Record<string, string>).domain ?? ''
  const base = config.APP_BASE_DOMAIN
  if (base && domain.endsWith(`.${base}`)) return reply.status(200).send()
  return reply.status(400).send()
})

// ─── API surface — CORS registered here so static assets bypass it ──────────
app.register(async function apiContext(api) {
  await api.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true) // server-to-server / curl
      const baseDomain = config.APP_BASE_DOMAIN
      const allowed =
        origin === config.FRONTEND_URL ||
        (baseDomain && (origin === `https://${baseDomain}` || origin.endsWith(`.${baseDomain}`))) ||
        (config.NODE_ENV === 'development' && /^https?:\/\/localhost(:\d+)?$/.test(origin))
      cb(allowed ? null : new Error('CORS: origin not allowed'), allowed ?? false)
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Subdomain'],
  })

  // also expose under /api/plans so the Vite proxy (/api → :3000) works
  api.get('/plans', async (_req, reply) => {
    const plans = await masterDb.plan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    })
    return reply.send({ data: plans })
  })
  api.get('/api/plans', async (_req, reply) => {
    const plans = await masterDb.plan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    })
    return reply.send({ data: plans })
  })

  api.register(tenantRoutes, { prefix: '/api/tenants' })

  // ─── Platform-owner admin panel (cross-tenant, no tenant scoping) ────────
  api.register(adminRoutes, { prefix: '/api/admin' })

  // ─── Paymob webhook (public) ─────────────────────────────────────────────
  // Registered OUTSIDE the tenant-scoped instance below: Paymob's servers send
  // no tenant subdomain, so tenantMiddleware would 400 the callback before it
  // runs. The handler resolves the tenant from merchant_order_id and verifies
  // the HMAC itself.
  api.register(billingWebhookRoutes, { prefix: '/api' })

  // ─── Tenant-scoped routes (tenant middleware required) ──────────────────────
  api.register(async function tenantScoped(sub) {
  sub.addHook('onRequest', tenantMiddleware)
  sub.register(authRoutes, { prefix: '/api/auth' })
  sub.register(productRoutes, { prefix: '/api/products' })
  sub.register(stockRoutes, { prefix: '/api/stock' })
  sub.register(paymentMethodRoutes, { prefix: '/api/payment-methods' })
  sub.register(customerRoutes, { prefix: '/api/customers' })
  sub.register(invoiceRoutes, { prefix: '/api/invoices' })
  sub.register(installmentRoutes, { prefix: '/api/installments' })
  sub.register(supplierRoutes, { prefix: '/api/suppliers' })
  sub.register(purchaseOrderRoutes, { prefix: '/api/purchase-orders' })
  sub.register(expenseRoutes, { prefix: '/api/expenses' })
  sub.register(serviceRoutes, { prefix: '/api/services' })
  sub.register(workOrderRoutes, { prefix: '/api/work-orders' })
  sub.register(reportRoutes, { prefix: '/api/reports' })
  sub.register(couponRoutes, { prefix: '/api/coupons' })
  sub.register(etaRoutes, { prefix: '/api' })
  sub.register(billingRoutes, { prefix: '/api' })

  // ─── Tenant Settings ──────────────────────────────────────────────────────
  sub.get('/api/settings', { preHandler: [authenticate] }, async (request, reply) => {
    const s = await request.tenantDb.tenantSetting.findFirst()
    if (!s) return reply.send({ success: true, data: s })
    // Never leak the encrypted ETA secrets to the client. Replace them with
    // booleans so the UI can show "configured ✓" without exposing values.
    const { etaClientId, etaClientSecret, etaSigningCert, ...safe } = s
    return reply.send({
      success: true,
      data: {
        ...safe,
        etaClientIdSet: !!etaClientId,
        etaClientSecretSet: !!etaClientSecret,
        etaSigningCertSet: !!etaSigningCert,
      },
    })
  })

  sub.patch('/api/settings', { preHandler: [authenticate] }, async (request, reply) => {
    const { z } = await import('zod')
    const schema = z.object({
      vatEnabled: z.boolean().optional(),
      vatRate: z.coerce.number().min(0).max(100).optional(),
      timezone: z.string().optional(),
      language: z.string().optional(),
      currencyDefault: z.string().optional(),
      loyaltyEnabled: z.boolean().optional(),
      loyaltyPointsPerUnit: z.coerce.number().int().min(1).optional(),
      loyaltyPointValue: z.coerce.number().min(0).optional(),
      printTemplate: z.string().optional(),
      dailySalesTarget: z.coerce.number().min(0).optional(),
      // ETA toggle — owners can opt out if VAT-exempt. The encrypted
      // credentials (client_id, client_secret, signing cert) are handled
      // by the dedicated ETA enrollment flow because they need encryption
      // at rest via APP_ENCRYPTION_KEY.
      etaEnabled: z.boolean().optional(),
      // ETA issuer registration — public business data, no encryption needed.
      // Must match what the merchant registered on invoicing.eta.gov.eg;
      // mismatches cause ETA to reject submissions.
      // Setting any value to '' clears it (sent as null to the DB).
      etaTaxpayerId: z.string().trim().max(50).optional(),
      etaActivityCode: z.string().trim().max(20).optional(),
      etaBranchCode: z.string().trim().max(20).optional(),
      etaIssuerName: z.string().trim().max(500).optional(),
      etaAddressGovernate: z.string().trim().max(50).optional(),
      etaAddressRegionCity: z.string().trim().max(100).optional(),
      etaAddressStreet: z.string().trim().max(200).optional(),
      etaAddressBuilding: z.string().trim().max(50).optional(),
    })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'validation_error', message: parsed.error.errors[0].message } })
    const existing = await request.tenantDb.tenantSetting.findFirst()
    if (!existing) return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'الإعدادات غير موجودة' } })

    // Treat empty strings on the ETA text fields as "clear it" so the owner
    // can roll back a setting from the UI without an extra DELETE endpoint.
    // The job's missingIssuer guard relies on NULL to mean "not configured",
    // so '' must be normalized to null here.
    const ETA_NULLABLE = [
      'etaTaxpayerId', 'etaActivityCode', 'etaIssuerName',
      'etaAddressGovernate', 'etaAddressRegionCity',
      'etaAddressStreet', 'etaAddressBuilding',
    ] as const
    const data: Record<string, unknown> = { ...parsed.data }
    for (const key of ETA_NULLABLE) {
      if (data[key] === '') data[key] = null
    }

    const updated = await request.tenantDb.tenantSetting.update({ where: { id: existing.id }, data })
    // Re-mask before returning (the update result includes the encrypted secrets).
    const { etaClientId, etaClientSecret, etaSigningCert, ...safe } = updated
    return reply.send({
      success: true,
      data: {
        ...safe,
        etaClientIdSet: !!etaClientId,
        etaClientSecretSet: !!etaClientSecret,
        etaSigningCertSet: !!etaSigningCert,
      },
    })
  })

  // ─── ETA encrypted credentials ──────────────────────────────────────────────
  // Separate from PATCH /settings because these are secrets: encrypted at rest
  // with APP_ENCRYPTION_KEY, write-only (never returned), and each field is
  // only touched when a non-empty value is supplied (so saving the wizard
  // without re-typing a secret keeps the existing one).
  sub.put('/api/settings/eta/credentials', { preHandler: [authenticate] }, async (request, reply) => {
    const { z } = await import('zod')
    const { encrypt } = await import('@/shared/utils/encryption')
    const schema = z.object({
      etaClientId: z.string().trim().optional(),
      etaClientSecret: z.string().trim().optional(),
      etaSigningCert: z.string().trim().optional(),
    })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: 'validation_error', message: parsed.error.errors[0].message } })
    }
    if (!config.APP_ENCRYPTION_KEY) {
      return reply.status(503).send({ success: false, error: { code: 'encryption_unavailable', message: 'تشفير الخادم غير مهيأ — تواصل مع الدعم' } })
    }

    const existing = await request.tenantDb.tenantSetting.findFirst()
    if (!existing) return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'الإعدادات غير موجودة' } })

    // Encrypt only the fields that arrived with a value. Omitted/empty → untouched.
    const data: Record<string, string> = {}
    if (parsed.data.etaClientId) data.etaClientId = encrypt(parsed.data.etaClientId)
    if (parsed.data.etaClientSecret) data.etaClientSecret = encrypt(parsed.data.etaClientSecret)
    if (parsed.data.etaSigningCert) data.etaSigningCert = encrypt(parsed.data.etaSigningCert)

    if (Object.keys(data).length === 0) {
      return reply.status(400).send({ success: false, error: { code: 'no_fields', message: 'لم يتم إرسال أي بيانات للحفظ' } })
    }

    await request.tenantDb.tenantSetting.update({ where: { id: existing.id }, data })
    return reply.send({ success: true, data: { saved: Object.keys(data) } })
  })

  // ─── ETA connection test ──────────────────────────────────────────────────
  // Decrypts the stored credentials and performs a real OAuth handshake with
  // ETA's /connect/token. Lets the merchant confirm enrollment before the
  // first invoice is issued, instead of discovering a bad secret at submit time.
  sub.post('/api/settings/eta/test', { preHandler: [authenticate] }, async (request, reply) => {
    const { decrypt } = await import('@/shared/utils/encryption')
    const { EtaClient } = await import('@/modules/eta/eta.client')

    const s = await request.tenantDb.tenantSetting.findFirst()
    if (!s) return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'الإعدادات غير موجودة' } })
    if (!s.etaClientId || !s.etaClientSecret) {
      return reply.send({ success: false, message: 'بيانات الاعتماد (Client ID و Client Secret) غير مكتملة' })
    }

    let clientId: string
    let clientSecret: string
    try {
      clientId = decrypt(s.etaClientId)
      clientSecret = decrypt(s.etaClientSecret)
    } catch {
      return reply.send({ success: false, message: 'تعذّر فك تشفير بيانات الاعتماد — أعد إدخالها' })
    }

    const isProd = s.etaEnvironment === 'production'
    const client = new EtaClient(clientId, clientSecret, isProd)
    try {
      await client.testConnection()
      return reply.send({ success: true, message: isProd ? 'الاتصال ناجح ✓ (بيئة الإنتاج)' : 'الاتصال ناجح ✓ (بيئة الاختبار preprod)' })
    } catch (err) {
      request.log.warn({ err }, 'eta_test_connection_failed')
      return reply.send({ success: false, message: 'فشل الاتصال بمنظومة ETA — تأكد من Client ID و Client Secret والبيئة' })
    }
  })

  // ─── Currencies ───────────────────────────────────────────────────────────
  sub.get('/api/currencies', { preHandler: [authenticate] }, async (request, reply) => {
    const currencies = await request.tenantDb.currency.findMany({
      orderBy: [{ isBase: 'desc' }, { code: 'asc' }],
    })
    return reply.send({ success: true, data: currencies })
  })

  // ─── Branches CRUD ────────────────────────────────────────────────────────
  sub.get('/api/branches', { preHandler: [authenticate] }, async (request, reply) => {
    const branches = await request.tenantDb.branch.findMany({
      select: { id: true, name: true, isMain: true, isActive: true, address: true, phone: true },
      orderBy: { isMain: 'desc' },
    })
    return reply.send({ success: true, data: branches })
  })

  sub.post('/api/branches', { preHandler: [authenticate, requireUnderLimit('branches')] }, async (request, reply) => {
    const { z } = await import('zod')
    const schema = z.object({ name: z.string().min(1), address: z.string().optional(), phone: z.string().optional() })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'validation_error', message: parsed.error.errors[0].message } })
    const branch = await request.tenantDb.branch.create({
      data: { name: parsed.data.name, address: parsed.data.address, phone: parsed.data.phone },
    })
    return reply.status(201).send({ success: true, data: branch })
  })

  sub.patch<{ Params: { id: string } }>('/api/branches/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { z } = await import('zod')
    const schema = z.object({ name: z.string().min(1).optional(), address: z.string().optional(), phone: z.string().optional(), isActive: z.boolean().optional() })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'validation_error', message: parsed.error.errors[0].message } })
    const branch = await request.tenantDb.branch.update({
      where: { id: request.params.id },
      data: parsed.data,
    })
    return reply.send({ success: true, data: branch })
  })
})
}) // close apiContext

// ─── Serve React frontend in production ──────────────────────────────────────
if (config.NODE_ENV === 'production') {
  // __dirname is /app/apps/api/src; go up 3 levels to workspace root then into web dist
  const webDist = join(__dirname, '../../../apps/web/dist')
  app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: false })
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api')) {
      return reply.status(404).send({ success: false, error: { code: 'not_found' } })
    }
    return reply.sendFile('index.html', webDist)
  })
}

const start = async () => {
  try {
    // Idempotent — seeds OWNER from env vars on first boot, rotates password
    // if OWNER_PASSWORD changed. No-op when env vars are unset (dev).
    await seedOwnerFromEnv()

    await app.listen({ port: config.API_PORT, host: config.API_HOST })
    console.log(`Server running on port ${config.API_PORT}`)

    // Run any pending tenant migrations in the background. Idempotent: the
    // runner skips versions already <= schemaVersion. Fire-and-forget so a slow
    // migration doesn't delay startup health checks; per-tenant errors are
    // logged but never thrown. New SQL files in packages/database/migrations/tenant
    // are picked up automatically on the next boot.
    //
    // The result is published to `migrationState` so /health can surface a 503
    // when migrations fail — otherwise a partially-broken deploy would look
    // healthy and the orchestrator wouldn't roll back.
    migrateAllTenants()
      .then((r) => {
        migrationState.ok = r.ok
        migrationState.failed = r.failed
        migrationState.errors = r.errors
        migrationState.finishedAt = new Date().toISOString()
        migrationState.status = r.failed === 0 ? 'ok' : r.ok === 0 ? 'failed' : 'partial'
        app.log.info({ result: r }, 'tenant_migrations_applied')
      })
      .catch((err) => {
        migrationState.status = 'failed'
        migrationState.finishedAt = new Date().toISOString()
        app.log.error({ err }, 'tenant_migrations_failed')
      })

    // Start background workers
    const etaWorker = startEtaWorker()
    const dunningWorker = startDunningWorker()
    await scheduleDunning()
    const reminderWorker = startReminderWorker()
    await scheduleReminders()
    const trialWorker = startTrialExpiryWorker()
    await scheduleTrialExpiry()
    const renewalWorker = startRenewalWorker()
    await scheduleRenewal()

    // ─── Graceful shutdown ───────────────────────────────────────────────────
    // Rolling deploys (Railway, k8s) send SIGTERM and expect the process to
    // drain in-flight requests and BullMQ jobs before exiting. Without this
    // handler the process is killed mid-request and BullMQ workers leave
    // jobs in `active` state until lock expiry. tini (entrypoint in the
    // Dockerfile) forwards SIGTERM cleanly to PID 1 = node.
    const workers = [etaWorker, dunningWorker, reminderWorker, trialWorker, renewalWorker]
    let shuttingDown = false
    const shutdown = async (signal: string) => {
      if (shuttingDown) return
      shuttingDown = true
      app.log.info({ signal }, 'shutdown_initiated')
      // 25s budget; orchestrators typically give 30s before SIGKILL.
      const timeout = setTimeout(() => {
        app.log.error('shutdown_timed_out — forcing exit')
        process.exit(1)
      }, 25_000).unref()
      try {
        await app.close()
        await Promise.all(workers.map((w) => w.close().catch(() => {})))
      } finally {
        clearTimeout(timeout)
        process.exit(0)
      }
    }
    process.on('SIGTERM', () => void shutdown('SIGTERM'))
    process.on('SIGINT', () => void shutdown('SIGINT'))
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
