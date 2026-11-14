import { z } from 'zod'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') })

const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().default(parseInt(process.env.PORT || '3000', 10)),
  API_HOST: z.string().default('0.0.0.0'),
  FRONTEND_URL: z.string().url(),
  APP_BASE_DOMAIN: z.string().optional(), // e.g. hesbaapp.com — enables per-tenant subdomain URLs
  // Number of reverse proxies in front of the app (Caddy / Railway edge = 1).
  // Drives request.ip, which the per-IP rate limits key on. 0 = no proxy.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),

  // Database
  DATABASE_MASTER_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string(),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Storage (Cloudflare R2)
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),

  // Email (Resend)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  // Paymob SaaS billing (v1.2)
  PAYMOB_API_KEY: z.string().optional(),
  PAYMOB_HMAC_SECRET: z.string().optional(),
  PAYMOB_INTEGRATION_ID_CARD: z.string().optional(),
  PAYMOB_INTEGRATION_ID_WALLET: z.string().optional(),
  PAYMOB_IFRAME_ID: z.string().optional(),
  PAYMOB_BASE_URL: z.string().default('https://accept.paymob.com/api'),

  // ETA — Egyptian Tax Authority (v1.2)
  ETA_PREPROD_BASE_URL: z.string().default('https://api.preprod.invoicing.eta.gov.eg'),
  ETA_PROD_BASE_URL: z.string().default('https://api.invoicing.eta.gov.eg'),
  ETA_ENCRYPTION_KEY: z.string().optional(),

  // App encryption key — AES-256-GCM for tenant secrets at rest (v1.2)
  APP_ENCRYPTION_KEY: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const config = parsed.data

// Production warnings — downstream safety still holds:
//   - encryption.ts throws at call time if APP_ENCRYPTION_KEY is missing
//   - paymob.webhook.ts fails closed (rejects with 401) on missing HMAC
// We log a one-line warning so misconfiguration is visible without leaking
// the names of other env vars (which is reconnaissance for an attacker).
if (config.NODE_ENV === 'production') {
  const missing: string[] = []
  if (!config.APP_ENCRYPTION_KEY || config.APP_ENCRYPTION_KEY.length < 32) missing.push('APP_ENCRYPTION_KEY')
  if (!config.PAYMOB_HMAC_SECRET) missing.push('PAYMOB_HMAC_SECRET')
  if (missing.length > 0) {
    console.warn(`⚠️  Missing production env vars (features depending on them will fail): ${missing.join(', ')}`)
  }
}
