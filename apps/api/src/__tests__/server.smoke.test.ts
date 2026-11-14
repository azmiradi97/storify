import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import bcrypt from 'bcryptjs'
import type { FastifyInstance } from 'fastify'

// Boot smoke test for the real server wiring in src/index.ts (Fastify 5 and
// its plugin majors): login → refresh cookie rotation → tenant-scoped GET with
// tenant binding, rate-limit 429 shape, CORS preflight methods, trustProxy hop
// handling, and the production static SPA fallback.
//
// Only the I/O edges are faked: Postgres (masterDb / tenant client), Redis
// (an in-memory stand-in that also implements the rate-limit Lua commands),
// and the BullMQ workers. Everything else — plugins, hooks, middleware, error
// handler, routes — is the code that ships.

const h = vi.hoisted(() => {
  // index.ts reads config at import time; production mode turns on the static
  // SPA serving and the 404 fallback.
  process.env.NODE_ENV = 'production'
  process.env.API_PORT = '0'
  process.env.API_HOST = '127.0.0.1'
  process.env.TRUST_PROXY_HOPS = '1'
  process.env.APP_BASE_DOMAIN = 'hesba.test'
  process.env.FRONTEND_URL = 'https://hesba.test'
  return {
    captured: { app: undefined as FastifyInstance | undefined },
    webDist: '',
  }
})

// ─── Capture the instance index.ts builds ────────────────────────────────────
vi.mock('fastify', async (importOriginal) => {
  const mod = await importOriginal<typeof import('fastify')>()
  const real = mod.default as unknown as (opts: unknown) => FastifyInstance
  const factory = (opts: unknown) => {
    const app = real(opts)
    h.captured.app = app
    return app
  }
  return { ...mod, default: factory }
})

// Point the production web root at a temp fixture instead of apps/web/dist.
vi.mock('path', async (importOriginal) => {
  const mod = await importOriginal<typeof import('path')>()
  const join = (...parts: string[]) => {
    const out = mod.join(...parts)
    return out.endsWith(mod.join('apps', 'web', 'dist')) && h.webDist ? h.webDist : out
  }
  return { ...mod, join, default: { ...mod, join } }
})

// ─── In-memory Redis ─────────────────────────────────────────────────────────
vi.mock('../config/redis', () => {
  const store = new Map<string, string>()
  const counters = new Map<string, { n: number; exp: number }>()
  const redis: Record<string, unknown> = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => { store.set(k, v); return 'OK' },
    setex: async (k: string, _ttl: number, v: string) => { store.set(k, v); return 'OK' },
    del: async (k: string) => (store.delete(k) ? 1 : 0),
    defineCommand(name: string) {
      if (name === 'rateLimit') {
        redis.rateLimit = (key: string, win: number, _max: number, _c: boolean, _e: boolean, cb: (e: Error | null, r: number[]) => void) => {
          const now = Date.now()
          const c = counters.get(key)
          if (!c || c.exp < now) {
            counters.set(key, { n: 1, exp: now + win })
            return cb(null, [1, win])
          }
          c.n += 1
          return cb(null, [c.n, c.exp - now])
        }
      }
      if (name === 'rateLimitRead') {
        redis.rateLimitRead = (key: string, cb: (e: Error | null, r: number[]) => void) => {
          const c = counters.get(key)
          cb(null, c ? [c.n, Math.max(0, c.exp - Date.now())] : [0, 0])
        }
      }
    },
  }
  return { redis }
})

// ─── Fake Postgres ───────────────────────────────────────────────────────────
const TENANT = {
  id: 'tenant-a',
  subdomain: 'shop-a',
  schemaName: 'tenant_shop_a',
  status: 'ACTIVE',
  plan: { id: 'p1', name: 'Pro' },
}
const OTHER_TENANT = { ...TENANT, id: 'tenant-b', subdomain: 'shop-b', schemaName: 'tenant_shop_b' }
const PASSWORD = 'Correct-Horse-9'
const USER = {
  id: 'u1',
  email: 'owner@shop-a.test',
  fullName: 'Owner',
  isActive: true,
  branchId: 'b1',
  passwordHash: bcrypt.hashSync(PASSWORD, 4),
  role: { slug: 'owner', permissions: { products: ['read'] } },
}
const BRANCHES = [{ id: 'b1', name: 'Main', isMain: true, isActive: true, address: null, phone: null }]

vi.mock('../config/database', () => {
  const tenantDb = {
    user: {
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) =>
        where.email === USER.email || where.id === USER.id ? USER : null,
      update: async () => USER,
    },
    branch: { findMany: async () => BRANCHES },
  }
  return {
    masterDb: {
      tenant: {
        findUnique: async ({ where }: { where: { subdomain: string } }) =>
          [TENANT, OTHER_TENANT].find((t) => t.subdomain === where.subdomain) ?? null,
      },
      subscription: { findFirst: async () => ({ status: 'ACTIVE' }) },
      plan: { findMany: async () => [] },
    },
    getTenantDb: () => tenantDb,
  }
})

vi.mock('@hesba/database', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  migrateAllTenants: async () => ({ ok: 1, failed: 0, errors: [] }),
}))

vi.mock('../modules/admin/admin.auth.service', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  seedOwnerFromEnv: async () => {},
}))

// ─── BullMQ workers off ──────────────────────────────────────────────────────
const worker = { close: async () => {} }
vi.mock('../jobs/eta-submission.job', async (o) => ({ ...(await o<object>()), startEtaWorker: () => worker }))
vi.mock('../jobs/dunning.job', async (o) => ({ ...(await o<object>()), startDunningWorker: () => worker, scheduleDunning: async () => {} }))
vi.mock('../jobs/installment-reminders.job', async (o) => ({ ...(await o<object>()), startReminderWorker: () => worker, scheduleReminders: async () => {} }))
vi.mock('../jobs/trial-expiry.job', async (o) => ({ ...(await o<object>()), startTrialExpiryWorker: () => worker, scheduleTrialExpiry: async () => {} }))
vi.mock('../jobs/renewal.job', async (o) => ({ ...(await o<object>()), startRenewalWorker: () => worker, scheduleRenewal: async () => {} }))

let app: FastifyInstance
const HOST_A = 'shop-a.hesba.test'

beforeAll(async () => {
  h.webDist = mkdtempSync(join(tmpdir(), 'hesba-web-'))
  writeFileSync(join(h.webDist, 'index.html'), '<!doctype html><title>Hesba SPA</title>')
  mkdirSync(join(h.webDist, 'assets'))
  writeFileSync(join(h.webDist, 'assets', 'app.js'), 'console.log("hesba")')

  await import('../index')
  app = h.captured.app!
  await app.ready()
})

afterAll(async () => {
  await app?.close()
  rmSync(h.webDist, { recursive: true, force: true })
})

function refreshCookie(res: { cookies: Array<{ name: string; value: string }> }) {
  return res.cookies.find((c) => c.name === 'refreshToken')
}

describe('server smoke (Fastify 5)', () => {
  let accessToken = ''
  let refresh = ''

  it('logs in and sets the httpOnly refresh cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { host: HOST_A },
      payload: { email: USER.email, password: PASSWORD },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data.user.id).toBe(USER.id)
    accessToken = body.data.accessToken
    expect(accessToken.split('.')).toHaveLength(3)

    const cookie = refreshCookie(res)
    expect(cookie?.value).toMatch(/^[a-f0-9]{64}$/)
    expect(res.headers['set-cookie']).toMatch(/HttpOnly/i)
    expect(res.headers['set-cookie']).toMatch(/Domain=\.hesba\.test/i)
    refresh = cookie!.value
  })

  it('rejects a wrong password with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { host: HOST_A, 'x-forwarded-for': '198.51.100.7' },
      payload: { email: USER.email, password: 'nope' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('invalid_credentials')
  })

  it('rotates the refresh cookie and issues a new access token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { host: HOST_A },
      cookies: { refreshToken: refresh },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.accessToken.split('.')).toHaveLength(3)
    const rotated = refreshCookie(res)
    expect(rotated?.value).toBeTruthy()
    expect(rotated?.value).not.toBe(refresh)

    // The old token is single-use.
    const replay = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { host: HOST_A },
      cookies: { refreshToken: refresh },
    })
    expect(replay.statusCode).toBe(401)
    expect(replay.json().error.code).toBe('invalid_refresh_token')
  })

  it('serves a tenant-scoped GET with a valid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/branches',
      headers: { host: HOST_A, authorization: `Bearer ${accessToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, data: BRANCHES })
  })

  it('rejects missing and tampered tokens with 401', async () => {
    const none = await app.inject({ method: 'GET', url: '/api/branches', headers: { host: HOST_A } })
    expect(none.statusCode).toBe(401)

    const [hd, pl, sig] = accessToken.split('.')
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)
    const bad = await app.inject({
      method: 'GET',
      url: '/api/branches',
      headers: { host: HOST_A, authorization: `Bearer ${hd}.${pl}.${flipped}` },
    })
    expect(bad.statusCode).toBe(401)
  })

  it('keeps tenant binding: tenant A token is refused on tenant B', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/branches',
      headers: { host: 'shop-b.hesba.test', authorization: `Bearer ${accessToken}` },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('tenant_mismatch')
  })

  it('rate-limits login per client IP behind one proxy hop, with the 429 envelope', async () => {
    const hit = (ip: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '10.0.0.1', // the proxy
        headers: { host: HOST_A, 'x-forwarded-for': ip },
        payload: { email: USER.email, password: 'nope' },
      })
    // max: 10 per minute per IP
    for (let i = 0; i < 10; i++) expect((await hit('203.0.113.9')).statusCode).toBe(401)
    const limited = await hit('203.0.113.9')
    expect(limited.statusCode).toBe(429)
    expect(limited.json()).toMatchObject({ success: false, error: { code: 'rate_limited' } })
    // A different client behind the same proxy has its own bucket.
    expect((await hit('203.0.113.10')).statusCode).toBe(401)
  })

  it('allows cross-origin PUT/PATCH/DELETE preflights from a tenant subdomain', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/branches/b1',
      headers: {
        host: HOST_A,
        origin: 'https://shop-a.hesba.test',
        'access-control-request-method': 'PATCH',
      },
    })
    expect(res.statusCode).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('https://shop-a.hesba.test')
    expect(res.headers['access-control-allow-credentials']).toBe('true')
    expect(String(res.headers['access-control-allow-methods'])).toMatch(/PATCH/)
    expect(String(res.headers['access-control-allow-methods'])).toMatch(/DELETE/)
  })

  it('sends the CSP from helmet', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    const csp = String(res.headers['content-security-policy'])
    expect(csp).toContain("script-src 'self' https://www.googletagmanager.com")
    expect(csp).toContain("img-src 'self' data: https:")
  })

  it('serves static assets and falls back to index.html for SPA routes', async () => {
    const asset = await app.inject({ method: 'GET', url: '/assets/app.js' })
    expect(asset.statusCode).toBe(200)
    expect(asset.body).toContain('hesba')

    const root = await app.inject({ method: 'GET', url: '/' })
    expect(root.statusCode).toBe(200)
    expect(root.body).toContain('Hesba SPA')

    const deep = await app.inject({ method: 'GET', url: '/pos/checkout' })
    expect(deep.statusCode).toBe(200)
    expect(deep.headers['content-type']).toMatch(/text\/html/)
    expect(deep.body).toContain('Hesba SPA')
  })

  it('returns JSON 404 for unknown /api routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ success: false, error: { code: 'not_found' } })
  })
})
