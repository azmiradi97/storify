import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// DATA-01 — the tenant tables are created by raw SQL (packages/database/
// migrations/tenant/*.sql), while schema.tenant.prisma is a hand-maintained
// mirror used only for type generation. Nothing keeps them in sync, so they can
// drift (a column/table added to one but not the other → silent TS blindness or
// a runtime "relation/column does not exist"). This is a cheap, DB-free guard
// for the highest-value case: table-level parity. Run via `pnpm --filter
// @hesba/api test`, so it gates every PR through CI.
//
// (Column-level parity would be stronger but needs a real introspection against
// a scratch Postgres — see the follow-up note in the security-audit memory.)

const DB_DIR = path.resolve(process.cwd(), '../../packages/database')
const TENANT_SQL_DIR = path.join(DB_DIR, 'migrations/tenant')
const TENANT_PRISMA = path.join(DB_DIR, 'prisma/schema.tenant.prisma')

function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--')
      return idx === -1 ? line : line.slice(0, idx)
    })
    .join('\n')
}

function sqlTableNames(): Set<string> {
  const names = new Set<string>()
  for (const f of fs.readdirSync(TENANT_SQL_DIR)) {
    if (!f.endsWith('.sql')) continue
    const sql = stripSqlComments(fs.readFileSync(path.join(TENANT_SQL_DIR, f), 'utf8'))
    const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(sql)) !== null) names.add(m[1].toLowerCase())
  }
  return names
}

function prismaModelTables(): Set<string> {
  const schema = fs.readFileSync(TENANT_PRISMA, 'utf8')
  const names = new Set<string>()
  const re = /@@map\("([a-z_][a-z0-9_]*)"\)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(schema)) !== null) names.add(m[1].toLowerCase())
  return names
}

describe('tenant schema parity: SQL migrations <-> Prisma models (DATA-01)', () => {
  const sql = sqlTableNames()
  const prisma = prismaModelTables()

  it('discovers a non-trivial set of tables (sanity)', () => {
    expect(sql.size).toBeGreaterThan(20)
    expect(prisma.size).toBeGreaterThan(20)
  })

  it('every CREATE TABLE in the migrations has a matching Prisma @@map model', () => {
    const missingInPrisma = [...sql].filter((t) => !prisma.has(t)).sort()
    expect(
      missingInPrisma,
      `tables created in SQL but missing a Prisma model: ${missingInPrisma.join(', ')}`,
    ).toEqual([])
  })

  it('every Prisma model maps to a table created by a migration', () => {
    const missingInSql = [...prisma].filter((t) => !sql.has(t)).sort()
    expect(
      missingInSql,
      `Prisma models with no CREATE TABLE in the migrations: ${missingInSql.join(', ')}`,
    ).toEqual([])
  })
})
