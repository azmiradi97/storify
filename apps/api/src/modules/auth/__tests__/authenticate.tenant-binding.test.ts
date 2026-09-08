import { describe, it, expect, vi } from 'vitest'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { authenticate } from '../../../shared/middleware/auth.middleware'

// HESBA-SEC-01 regression: the tenant context (request.tenant / tenantDb) is
// resolved from the attacker-controlled host / X-Tenant-Subdomain header, and a
// single global secret signs every tenant's tokens. `authenticate` MUST reject
// any request whose token tenant claims don't match the resolved tenant —
// otherwise a tenant-A token works against tenant B's data.

function makeReply() {
  const reply = {
    statusCode: 200 as number,
    body: undefined as unknown,
    status: vi.fn(function (this: typeof reply, code: number) {
      this.statusCode = code
      return this
    }),
    send: vi.fn(function (this: typeof reply, body: unknown) {
      this.body = body
      return this
    }),
  }
  return reply as unknown as FastifyReply & { statusCode: number; body: { error?: { code?: string } } }
}

function makeRequest(opts: {
  verifyOk?: boolean
  user?: unknown
  tenant?: unknown
}): FastifyRequest {
  return {
    jwtVerify: vi.fn(() =>
      opts.verifyOk === false ? Promise.reject(new Error('bad-signature')) : Promise.resolve(),
    ),
    user: opts.user,
    tenant: opts.tenant,
  } as unknown as FastifyRequest
}

const tenant = { id: 't1', schemaName: 'tenant_t1' }
const tokenForTenant1 = {
  userId: 'u1',
  tenantId: 't1',
  schemaName: 'tenant_t1',
  roleSlug: 'cashier',
  branchId: 'b1',
  permissions: {},
}

describe('authenticate — tenant binding (HESBA-SEC-01)', () => {
  it('passes when the token tenant matches the resolved tenant', async () => {
    const reply = makeReply()
    await authenticate(makeRequest({ user: tokenForTenant1, tenant }), reply)
    expect(reply.status).not.toHaveBeenCalled()
  })

  it('rejects a tenant-A token used against tenant B (the core exploit)', async () => {
    const reply = makeReply()
    await authenticate(
      makeRequest({ user: tokenForTenant1, tenant: { id: 't2', schemaName: 'tenant_t2' } }),
      reply,
    )
    expect(reply.status).toHaveBeenCalledWith(403)
    expect(reply.body.error?.code).toBe('tenant_mismatch')
  })

  it('rejects when only the schemaName diverges', async () => {
    const reply = makeReply()
    await authenticate(
      makeRequest({ user: tokenForTenant1, tenant: { id: 't1', schemaName: 'tenant_evil' } }),
      reply,
    )
    expect(reply.status).toHaveBeenCalledWith(403)
    expect(reply.body.error?.code).toBe('tenant_mismatch')
  })

  it('rejects a platform-admin token (no tenantId) on a tenant route', async () => {
    const reply = makeReply()
    await authenticate(
      makeRequest({ user: { scope: 'platform', adminId: 'a1' }, tenant }),
      reply,
    )
    expect(reply.status).toHaveBeenCalledWith(403)
    expect(reply.body.error?.code).toBe('tenant_mismatch')
  })

  it('fails closed when no tenant was resolved', async () => {
    const reply = makeReply()
    await authenticate(makeRequest({ user: tokenForTenant1, tenant: undefined }), reply)
    expect(reply.status).toHaveBeenCalledWith(403)
  })

  it('returns 401 when the JWT signature is invalid', async () => {
    const reply = makeReply()
    await authenticate(makeRequest({ verifyOk: false, tenant }), reply)
    expect(reply.status).toHaveBeenCalledWith(401)
    expect(reply.body.error?.code).toBe('unauthorized')
  })
})
