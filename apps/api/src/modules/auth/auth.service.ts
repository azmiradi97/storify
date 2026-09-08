import { createHash, randomBytes } from 'crypto'
import type { TenantPrismaClient } from '@hesba/database'
import { redis } from '../../config/redis'
import { verifyPassword } from '../../shared/utils/password'
import { sendPasswordResetEmail } from '../../shared/utils/email'
import type { JWTPayload } from '../../shared/middleware/auth.middleware'

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60 // 7 days in seconds

// ─── Login ───────────────────────────────────────────────────────────────────

export interface LoginResult {
  payload: JWTPayload
  refreshToken: string
  user: {
    id: string
    email: string
    fullName: string
    roleSlug: string
    branchId: string
    /** Flat permissions map mirrored from role.permissions so the frontend can
     * gate menu items without an extra request. */
    permissions: Record<string, string[]>
  }
}

export async function loginUser(
  db: TenantPrismaClient,
  tenantId: string,
  schemaName: string,
  email: string,
  password: string,
): Promise<LoginResult> {
  // Email lookups are normalized (the column is case-sensitive VARCHAR, not
  // CITEXT) so "Owner@x.com" and "owner@x.com" resolve to the same account.
  const user = await db.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: { role: true },
  })

  const invalid = () => {
    const err = new Error('invalid_credentials') as Error & { statusCode: number }
    err.statusCode = 401
    return err
  }

  if (!user || !user.isActive) throw invalid()

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) throw invalid()

  await db.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  })

  const payload: JWTPayload = {
    scope: 'tenant',
    userId: user.id,
    tenantId,
    schemaName,
    roleSlug: user.role.slug,
    branchId: user.branchId ?? '',
    permissions: (user.role.permissions as Record<string, string[]>) ?? {},
  }

  // Opaque refresh token stored in Redis (true invalidation on logout)
  const refreshToken = randomBytes(32).toString('hex')
  await redis.set(
    `refresh:${refreshToken}`,
    JSON.stringify({ userId: user.id, tenantId, schemaName }),
    'EX',
    REFRESH_TOKEN_TTL,
  )

  return {
    payload,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roleSlug: user.role.slug,
      branchId: user.branchId ?? '',
      // Send permissions to the client so the frontend can hide menu items
      // and gate routes the user can't reach. Backend still enforces per-route.
      permissions: (user.role.permissions as Record<string, string[]>) ?? {},
    },
  }
}

// ─── Refresh ─────────────────────────────────────────────────────────────────

export interface RefreshTokenData {
  userId: string
  tenantId: string
  schemaName: string
}

export async function getRefreshTokenData(refreshToken: string): Promise<RefreshTokenData | null> {
  const raw = await redis.get(`refresh:${refreshToken}`)
  if (!raw) return null
  return JSON.parse(raw) as RefreshTokenData
}

export async function rotateRefreshToken(
  oldToken: string,
  data: RefreshTokenData,
): Promise<string> {
  await redis.del(`refresh:${oldToken}`)
  const newToken = randomBytes(32).toString('hex')
  await redis.set(
    `refresh:${newToken}`,
    JSON.stringify(data),
    'EX',
    REFRESH_TOKEN_TTL,
  )
  return newToken
}

export async function invalidateRefreshToken(refreshToken: string): Promise<void> {
  await redis.del(`refresh:${refreshToken}`)
}

// ─── Forgot / Reset password ─────────────────────────────────────────────────

export async function requestPasswordReset(
  db: TenantPrismaClient,
  subdomain: string,
  email: string,
  ip: string,
): Promise<void> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } })
  // Always return without error — never reveal whether the email exists
  if (!user || !user.isActive) return

  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')

  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      ip,
    },
  })

  await sendPasswordResetEmail({ to: user.email, rawToken, subdomain })
}

export async function resetPassword(
  db: TenantPrismaClient,
  rawToken: string,
  newPassword: string,
): Promise<void> {
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  })

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    const err = new Error('invalid_or_expired_token') as Error & { statusCode: number }
    err.statusCode = 400
    throw err
  }

  const { hashPassword } = await import('../../shared/utils/password')
  const passwordHash = await hashPassword(newPassword)

  // Atomic single-use: updateMany with `usedAt: null` filter only succeeds the
  // first time. Two concurrent reset requests with the same token race on
  // this update — the loser sees count=0 and aborts. Without this, the up-
  // front `record.usedAt` check is a TOCTOU window.
  await db.$transaction(async (tx) => {
    const claim = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    })
    if (claim.count === 0) {
      const err = new Error('invalid_or_expired_token') as Error & { statusCode: number }
      err.statusCode = 400
      throw err
    }
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } })
  })

  // Best-effort: drop any active sessions for this user so a leaked
  // refresh token can't outlive the reset. Uses SCAN (non-blocking cursor)
  // instead of KEYS (which blocks Redis O(N) across the whole keyspace —
  // unsafe in production once the session count grows).
  let cursor = '0'
  do {
    const [next, batch] = await redis
      .scan(cursor, 'MATCH', 'refresh:*', 'COUNT', 200)
      .catch(() => ['0', [] as string[]] as const)
    cursor = next
    for (const k of batch) {
      const raw = await redis.get(k).catch(() => null)
      if (!raw) continue
      try {
        const parsed = JSON.parse(raw) as RefreshTokenData
        if (parsed.userId === record.userId) await redis.del(k)
      } catch {
        // ignore corrupt entries
      }
    }
  } while (cursor !== '0')
}

// ─── Rate limit: forgot-password (5/hour/email, Redis-backed) ────────────────

export async function checkForgotPasswordRateLimit(email: string): Promise<boolean> {
  const key = `rate:forgot:${email.toLowerCase()}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 3600)
  return count <= 5
}
