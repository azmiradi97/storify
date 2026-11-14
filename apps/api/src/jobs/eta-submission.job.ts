import { Queue, Worker, type Job } from 'bullmq'
import { redis } from '@/config/redis'
import { getTenantDb } from '@/config/database'
import { submitInvoiceToEta } from '@/modules/eta/eta.submit'
import { buildEtaQrData } from '@/modules/eta/eta.qr'

export const ETA_QUEUE = 'eta-submissions'

interface EtaJobData {
  invoiceId: string
  tenantId: string
  schemaName: string
}

const BACKOFF_DELAYS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000]

export function getEtaQueue() {
  return new Queue<EtaJobData>(ETA_QUEUE, {
    connection: redis,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'custom' },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: false,
    },
  })
}

export function enqueueEtaSubmission(data: EtaJobData) {
  return getEtaQueue().add('submit', data, { delay: 0 })
}

interface InvoiceRow {
  id: string
  invoice_number: string
  created_at: Date
  total_amount: string
  // ETA-01: invoice-level discount (coupon + credit) → extraDiscountAmount.
  discount_amount: string
  eta_enabled: boolean
  eta_taxpayer_id: string | null
  eta_activity_code: string | null
  eta_branch_code: string | null
  eta_client_id: string | null
  eta_client_secret: string | null
  eta_signing_cert_pem: string | null
  is_production: boolean
  // Issuer registration — must match the taxpayer profile registered with ETA.
  // ETA rejects submissions where these don't match its own records.
  eta_issuer_name: string | null
  eta_address_governate: string | null
  eta_address_region_city: string | null
  eta_address_street: string | null
  eta_address_building: string | null
}

interface ItemRow {
  product_name: string
  sku: string
  quantity: number
  unit_price: string
  vat_rate: string
  // ETA-01: per-line product/line discount → line discount.amount.
  discount_amount: string
}

export function startEtaWorker() {
  const worker = new Worker<EtaJobData>(
    ETA_QUEUE,
    async (job: Job<EtaJobData>) => {
      const { invoiceId, schemaName } = job.data
      const db = getTenantDb(schemaName)

      const invoiceRows = await db.$queryRawUnsafe<InvoiceRow[]>(`
        SELECT i.id, i.invoice_number, i.created_at, i.total_amount, i.discount_amount,
               ts.eta_enabled, ts.eta_taxpayer_id, ts.eta_activity_code,
               ts.eta_branch_code, ts.eta_client_id, ts.eta_client_secret,
               ts.eta_signing_cert_pem, COALESCE(ts.eta_is_production, false) AS is_production,
               ts.eta_issuer_name, ts.eta_address_governate, ts.eta_address_region_city,
               ts.eta_address_street, ts.eta_address_building
        FROM invoices i
        CROSS JOIN tenant_settings ts
        WHERE i.id = $1
        LIMIT 1
      `, invoiceId)

      if (!invoiceRows.length) throw new Error(`Invoice ${invoiceId} not found`)
      const inv = invoiceRows[0]

      // Three distinct outcomes when ETA can't submit:
      //   - eta_enabled=false  → store opted out (VAT-exempt) → 'not_required'
      //   - eta_enabled=true but credentials missing → 'pending_setup'
      //     (the store must finish ETA enrollment; the cashier should see this)
      //   - everything set → submit normally below
      if (!inv.eta_enabled) {
        await db.$executeRawUnsafe(
          `UPDATE invoices SET eta_status = 'not_required' WHERE id = $1`,
          invoiceId,
        )
        return
      }
      // Four prerequisites for a valid ETA submission:
      //   1. Taxpayer credentials  (id / client_id / client_secret) — for auth
      //   2. Issuer name — the legal business name on the ETA registry
      //   3. Issuer address — governate / region+city / street / building
      // Missing any of these means ETA will reject the document, so park the
      // invoice in 'pending_setup' and let the owner finish enrollment first.
      const missingCredentials =
        !inv.eta_taxpayer_id || !inv.eta_client_id || !inv.eta_client_secret
      const missingIssuer =
        !inv.eta_issuer_name ||
        !inv.eta_address_governate ||
        !inv.eta_address_region_city ||
        !inv.eta_address_street ||
        !inv.eta_address_building
      if (missingCredentials || missingIssuer) {
        await db.$executeRawUnsafe(
          `UPDATE invoices SET eta_status = 'pending_setup' WHERE id = $1`,
          invoiceId,
        )
        return
      }

      const itemRows = await db.$queryRawUnsafe<ItemRow[]>(`
        SELECT p.name AS product_name, pv.sku, ii.quantity, ii.unit_price,
               COALESCE(ii.discount_amount, 0) AS discount_amount,
               COALESCE(tr.rate, 0) AS vat_rate
        FROM invoice_items ii
        JOIN product_variants pv ON pv.id = ii.variant_id
        JOIN products p ON p.id = pv.product_id
        LEFT JOIN tax_rates tr ON tr.id = ii.tax_rate_id
        WHERE ii.invoice_id = $1
      `, invoiceId)

      // All fields below are non-null at this point because of the
      // missingCredentials || missingIssuer guard above. TypeScript can't
      // narrow through aggregate booleans, so we assert with `!`. If anyone
      // removes that guard the assertions will start crashing in tests —
      // which is the desired blast radius.
      const tenantSettings = {
        eta_taxpayer_id: inv.eta_taxpayer_id!,
        eta_activity_code: inv.eta_activity_code ?? '',
        eta_branch_code: inv.eta_branch_code ?? '0',
        eta_client_id: inv.eta_client_id!,
        eta_client_secret: inv.eta_client_secret!,
        eta_signing_cert_pem: inv.eta_signing_cert_pem ?? undefined,
        eta_enabled: inv.eta_enabled,
        is_production: inv.is_production,
      }

      const payloadParams = {
        invoice: { invoiceNumber: inv.invoice_number, issuedAt: new Date(inv.created_at) },
        invoiceExtraDiscount: inv.discount_amount,
        items: itemRows.map((item: ItemRow) => ({
          description: item.product_name,
          internalCode: item.sku,
          quantity: Number(item.quantity),
          unitPrice: item.unit_price,
          vatRate: item.vat_rate,
          discountAmount: item.discount_amount,
        })),
        issuer: {
          name: inv.eta_issuer_name!,
          taxpayerId: inv.eta_taxpayer_id!,
          activityCode: inv.eta_activity_code ?? '',
          address: {
            country: 'EG',
            governate: inv.eta_address_governate!,
            regionCity: inv.eta_address_region_city!,
            street: inv.eta_address_street!,
            buildingNumber: inv.eta_address_building!,
          },
        },
      }

      await db.$executeRawUnsafe(
        `UPDATE invoices SET eta_status = 'submitted' WHERE id = $1`,
        invoiceId,
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await submitInvoiceToEta({ invoiceId, payloadParams, tenantSettings, db: db as any })

      if (result.success && result.etaUuid) {
        const qrData = buildEtaQrData({
          etaLongId: result.etaLongId!,
          taxpayerId: inv.eta_taxpayer_id!,
          invoiceNumber: inv.invoice_number,
          issuedAt: new Date(inv.created_at),
          totalAmount: Number(inv.total_amount),
          isProd: inv.is_production,
        })
        await db.$executeRawUnsafe(`
          UPDATE invoices
          SET eta_status = 'accepted', eta_uuid = $1, eta_long_id = $2, eta_qr_data = $3
          WHERE id = $4
        `, result.etaUuid, result.etaLongId, qrData, invoiceId)
      } else {
        const isRejected = result.etaStatus === 'rejected'
        await db.$executeRawUnsafe(`
          UPDATE invoices SET eta_status = $1, eta_error = $2::jsonb WHERE id = $3
        `, isRejected ? 'rejected' : 'failed', JSON.stringify(result.etaError), invoiceId)

        if (!isRejected) {
          throw new Error(`ETA submission failed: ${JSON.stringify(result.etaError)}`)
        }
      }
    },
    {
      connection: redis,
      concurrency: 3,
      settings: {
        backoffStrategy: (attemptsMade: number) =>
          BACKOFF_DELAYS[Math.min(attemptsMade - 1, BACKOFF_DELAYS.length - 1)],
      },
    },
  )

  worker.on('failed', async (job, err) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 5)) {
      const { invoiceId, schemaName } = job.data
      const db = getTenantDb(schemaName)
      await db.$executeRawUnsafe(
        `UPDATE invoices SET eta_status = 'failed' WHERE id = $1`,
        invoiceId,
      ).catch(() => {})
      console.error(`[ETA] Invoice ${invoiceId} permanently failed:`, err.message)
    }
  })

  worker.on('error', (err) => console.error('[ETA Worker]', err.message))
  return worker
}
