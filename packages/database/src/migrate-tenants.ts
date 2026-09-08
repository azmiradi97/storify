import fs from 'fs/promises'
import path from 'path'
import { PrismaClient } from './generated/client'
import { masterDb } from './prisma'

const MIGRATIONS_DIR = path.join(__dirname, '../migrations/tenant')

interface Migration {
  version: number
  name: string
  sql: string
}

async function loadMigrations(): Promise<Migration[]> {
  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort()

  return Promise.all(
    files.map(async (f) => ({
      version: parseInt(f.split('_')[0], 10),
      name: f,
      sql: await fs.readFile(path.join(MIGRATIONS_DIR, f), 'utf8'),
    })),
  )
}

function createTenantClient(schemaName: string, opts?: { connectionLimit?: number }): PrismaClient {
  const base = new URL(process.env.DATABASE_MASTER_URL!)
  base.searchParams.set('schema', schemaName)
  if (opts?.connectionLimit != null) {
    base.searchParams.set('connection_limit', String(opts.connectionLimit))
  }
  return new PrismaClient({ datasources: { db: { url: base.toString() } } })
}

// Strip `--` line comments (so a stray `;` inside a comment doesn't break the
// split) then split a migration file into individual statements.
// NOTE: naive splitter — it does NOT understand dollar-quoted bodies
// ($$ ... $$), so tenant migrations must not define PL/pgSQL functions / DO
// blocks. (Verified none do as of migration 015.)
function splitStatements(sql: string): string[] {
  const stripped = sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--')
      return idx === -1 ? line : line.slice(0, idx)
    })
    .join('\n')
  return stripped
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export async function runTenantMigrations(schemaName: string, tenantId: string): Promise<void> {
  const tenant = await masterDb.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) throw new Error(`tenant_not_found:${tenantId}`)

  const migrations = await loadMigrations()
  const pending = migrations.filter((m) => m.version > tenant.schemaVersion)
  if (pending.length === 0) return

  // One dedicated, single-connection client for the whole run. connection_limit=1
  // pins every query to the same physical connection, which is what keeps a
  // session-level advisory lock held across statements — Prisma's default pool
  // would otherwise spread queries across connections and silently drop it.
  const db = createTenantClient(schemaName, { connectionLimit: 1 })
  const lockKey = `hesba_migrate:${schemaName}`
  try {
    // Serialize concurrent migrators of THIS schema — the admin "Run Migrations"
    // button and the startup/cron sweep can otherwise run DDL on the same schema
    // simultaneously. Non-blocking: a loser defers to the winner and exits; the
    // next run catches up if anything is still pending.
    const [{ locked }] = await db.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${lockKey})) AS locked
    `
    if (!locked) {
      console.log(`⏳ tenant=${schemaName} migration skipped — another runner holds the lock`)
      return
    }

    try {
      for (const m of pending) {
        const sql = m.sql.trim()
        if (!sql) {
          // Empty placeholder — skip execution but don't bump schema_version.
          console.log(`⏭  tenant=${schemaName} migration=${m.name} skipped (empty)`)
          continue
        }

        const statements = splitStatements(sql)

        // Apply the whole migration file atomically: a mid-file failure rolls
        // back the partial DDL instead of leaving a half-migrated schema with
        // schema_version un-bumped (which a retry could then double-apply).
        await db.$transaction(
          async (tx) => {
            for (const stmt of statements) {
              await tx.$executeRawUnsafe(stmt)
            }
          },
          { timeout: 120_000, maxWait: 120_000 },
        )

        await masterDb.tenant.update({
          where: { id: tenantId },
          data: { schemaVersion: m.version },
        })
        console.log(`✅ tenant=${schemaName} migration=${m.name} applied`)
      }
    } finally {
      await db.$queryRaw`SELECT pg_advisory_unlock(hashtext(${lockKey}))`
    }
  } finally {
    await db.$disconnect()
  }
}

export async function migrateAllTenants(): Promise<{
  ok: number
  failed: number
  errors: Array<{ tenantId: string; err: string }>
}> {
  const tenants = await masterDb.tenant.findMany({
    where: { status: { in: ['ACTIVE', 'SUSPENDED'] } },
  })

  const results = { ok: 0, failed: 0, errors: [] as Array<{ tenantId: string; err: string }> }

  for (const t of tenants) {
    try {
      await runTenantMigrations(t.schemaName, t.id)
      results.ok++
    } catch (err) {
      results.failed++
      results.errors.push({ tenantId: t.id, err: String(err) })
      console.error(`❌ tenant=${t.schemaName} migration failed:`, err)
    }
  }

  return results
}
