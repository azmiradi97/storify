import type { FastifyRequest, FastifyReply } from 'fastify'

export interface JWTPayload {
  // Discriminates tenant tokens from platform-admin tokens (which carry
  // scope:'platform'). Optional so access tokens issued before this field
  // existed still deserialize; the security check below relies on the tenant
  // id/schema match, not on scope.
  scope?: 'tenant'
  userId: string
  tenantId: string
  schemaName: string
  roleSlug: string
  branchId: string
  permissions: Record<string, string[]>
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    return reply.status(401).send({
      success: false,
      error: { code: 'unauthorized', message: 'يجب تسجيل الدخول أولاً' },
    })
  }

  // ─── Tenant binding (HESBA-SEC-01) ──────────────────────────────────────────
  // tenantMiddleware resolves request.tenant / request.tenantDb from the request
  // host / X-Tenant-Subdomain header — both attacker-controlled — and a single
  // global secret signs every tenant's tokens. Without this check a valid token
  // from tenant A is accepted against tenant B's database. Bind them: the token's
  // tenant claims MUST match the resolved tenant. A platform-admin token (no
  // tenantId) also fails here, so it can't reach tenant-scoped routes.
  const user = request.user as JWTPayload
  if (
    !request.tenant ||
    user.tenantId !== request.tenant.id ||
    user.schemaName !== request.tenant.schemaName
  ) {
    return reply.status(403).send({
      success: false,
      error: { code: 'tenant_mismatch', message: 'لا يمكن الوصول إلى متجر آخر بهذه الجلسة' },
    })
  }
}

export function requirePermission(resource: string, action: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JWTPayload

    if (user.roleSlug === 'super_admin') return

    if (!user.permissions[resource]?.includes(action)) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'forbidden',
          message: 'ليس لديك صلاحية للقيام بهذا الإجراء',
          required: `${resource}:${action}`,
        },
      })
    }
  }
}
