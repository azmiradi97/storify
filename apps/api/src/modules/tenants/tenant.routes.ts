import { FastifyInstance } from 'fastify'
import { registerTenantSchema } from './tenant.schema'
import { provisionTenant } from './tenant.service'
import { config } from '../../config/env'

export async function tenantRoutes(app: FastifyInstance) {
  // Each signup provisions a full Postgres schema, so throttle per IP to stop
  // scripted signups from exhausting the database.
  app.post('/register', {
    config: { rateLimit: { max: 5, timeWindow: 60 * 60_000 } },
  }, async (request, reply) => {
    const parseResult = registerTenantSchema.safeParse(request.body)

    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]
      return reply.status(400).send({
        success: false,
        error: { code: 'validation_error', message: firstError.message },
      })
    }

    try {
      const result = await provisionTenant(parseResult.data)

      const base = config.APP_BASE_DOMAIN
        ? `https://${result.subdomain}.${config.APP_BASE_DOMAIN}`
        : config.FRONTEND_URL
      const loginUrl = `${base}/login`

      return reply.status(201).send({
        success: true,
        data: {
          subdomain: result.subdomain,
          loginUrl,
        },
      })
    } catch (err: unknown) {
      const error = err as Error & { statusCode?: number }

      if (error.message === 'subdomain_taken') {
        return reply.status(409).send({
          success: false,
          error: { code: 'subdomain_taken', message: 'هذا الـ subdomain محجوز، جرّب اسماً آخر' },
        })
      }

      if (error.message === 'email_taken') {
        return reply.status(409).send({
          success: false,
          error: { code: 'email_taken', message: 'هذا البريد الإلكتروني مسجل بالفعل، جرّب تسجيل الدخول' },
        })
      }

      if (error.message === 'tenant_conflict') {
        return reply.status(409).send({
          success: false,
          error: { code: 'tenant_conflict', message: 'بيانات التسجيل مستخدمة بالفعل' },
        })
      }

      if (error.message === 'plan_not_found') {
        return reply.status(400).send({
          success: false,
          error: { code: 'plan_not_found', message: 'الباقة غير موجودة' },
        })
      }

      app.log.error(err)
      return reply.status(500).send({
        success: false,
        error: { code: 'internal_error', message: 'خطأ داخلي في الخادم' },
      })
    }
  })
}
