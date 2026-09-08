import { PrismaClient, TenantPrismaClient } from '@hesba/database'
import { LRUCache } from 'lru-cache'
import { config } from './env'

// Master DB — single instance for the API server lifetime
export const masterDb = new PrismaClient({
  datasources: { db: { url: config.DATABASE_MASTER_URL } },
  log: config.NODE_ENV === 'development' ? ['error'] : ['error'],
})

// Per-tenant client pool bound. Worst-case Postgres connections held across all
// tenant clients is roughly TENANT_DB_MAX × TENANT_DB_CONNECTION_LIMIT (+ the
// master client). Keep that product comfortably under Postgres `max_connections`
// (default 100). Beyond ~15 concurrently-active tenants on a default instance,
// front Postgres with PgBouncer (transaction pooling) and raise these.
const TENANT_DB_MAX = 50
const TENANT_DB_CONNECTION_LIMIT = 5

// Tenant clients — LRU-evicted pool.
const tenantClients = new LRUCache<string, TenantPrismaClient>({
  max: TENANT_DB_MAX,
  ttl: 1000 * 60 * 30, // 30 min idle TTL
  updateAgeOnGet: true,
  dispose: (client) => {
    client.$disconnect().catch(() => {})
  },
})

export function getTenantDb(schemaName: string): TenantPrismaClient {
  const cached = tenantClients.get(schemaName)
  if (cached) return cached

  const base = new URL(config.DATABASE_MASTER_URL)
  base.searchParams.set('schema', schemaName)
  // Bound this client's pool explicitly — Prisma's default (num_cpus*2+1 PER
  // client) is unbounded in aggregate across the LRU and can exhaust Postgres.
  base.searchParams.set('connection_limit', String(TENANT_DB_CONNECTION_LIMIT))
  base.searchParams.set('pool_timeout', '20')
  const client = new TenantPrismaClient({ datasources: { db: { url: base.toString() } } })
  tenantClients.set(schemaName, client)
  return client
}
