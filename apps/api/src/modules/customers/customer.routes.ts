import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { authenticate, requirePermission } from '../../shared/middleware/auth.middleware'
import type { JWTPayload } from '../../shared/middleware/auth.middleware'
import { getUploadUrl, getDownloadUrl, keyFromPublicUrl } from '../../config/r2'
import { contentDispositionAttachment } from '../../shared/utils/content-disposition'
import {
  createCustomerSchema,
  updateCustomerSchema,
  listCustomersSchema,
  documentUploadSchema,
} from './customer.schema'

export async function customerRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET /api/customers
  app.get('/', { preHandler: requirePermission('customers', 'read') }, async (request, reply) => {
    const parsed = listCustomersSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'validation_error', message: parsed.error.errors[0].message },
      })
    }

    const { page, limit, search } = parsed.data
    const where = search
      ? {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' as const } },
            { phone: { contains: search } },
            { nationalId: { contains: search } },
          ],
        }
      : {}

    const [total, items] = await Promise.all([
      request.tenantDb.customer.count({ where }),
      request.tenantDb.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])

    return reply.send({
      success: true,
      data: items,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    })
  })

  // POST /api/customers
  app.post('/', { preHandler: requirePermission('customers', 'create') }, async (request, reply) => {
    const parsed = createCustomerSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'validation_error', message: parsed.error.errors[0].message },
      })
    }
    const customer = await request.tenantDb.customer.create({ data: parsed.data })
    return reply.status(201).send({ success: true, data: customer })
  })

  // GET /api/customers/:id
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requirePermission('customers', 'read') },
    async (request, reply) => {
      const customer = await request.tenantDb.customer.findUnique({
        where: { id: request.params.id },
        include: {
          documents: true,
          _count: { select: { invoices: true } },
        },
      })
      if (!customer) {
        return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'العميل غير موجود' } })
      }
      return reply.send({ success: true, data: customer })
    },
  )

  // PATCH /api/customers/:id
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requirePermission('customers', 'update') },
    async (request, reply) => {
      const parsed = updateCustomerSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'validation_error', message: parsed.error.errors[0].message },
        })
      }
      try {
        const customer = await request.tenantDb.customer.update({
          where: { id: request.params.id },
          data: parsed.data,
        })
        return reply.send({ success: true, data: customer })
      } catch {
        return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'العميل غير موجود' } })
      }
    },
  )

  // POST /api/customers/:id/credit
  app.post<{ Params: { id: string } }>(
    '/:id/credit',
    { preHandler: requirePermission('customers', 'update') },
    async (request, reply) => {
      const { z } = await import('zod')
      const schema = z.object({
        amount: z.number().positive(),
        type: z.enum(['add', 'deduct']),
        note: z.string().optional(),
      })
      const parsed = schema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: { code: 'validation_error', message: parsed.error.errors[0].message } })
      }

      const customer = await request.tenantDb.customer.findUnique({ where: { id: request.params.id } })
      if (!customer) {
        return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'العميل غير موجود' } })
      }

      const delta = parsed.data.type === 'add' ? parsed.data.amount : -parsed.data.amount
      const newBalance = Number(customer.creditBalance) + delta
      if (newBalance < 0) {
        return reply.status(400).send({ success: false, error: { code: 'insufficient_credit', message: 'الرصيد غير كافٍ' } })
      }

      const actor = request.user as JWTPayload
      const updated = await request.tenantDb.customer.update({
        where: { id: request.params.id },
        data: { creditBalance: newBalance },
      })

      const { auditLog } = await import('../../shared/utils/audit')
      await auditLog({
        db: request.tenantDb,
        actorId: actor.userId,
        entity: 'customer',
        entityId: customer.id,
        action: parsed.data.type === 'add' ? 'credit_add' : 'credit_deduct',
        before: { creditBalance: customer.creditBalance.toString() },
        after: { creditBalance: newBalance.toString(), note: parsed.data.note },
        ip: request.ip,
      })

      return reply.send({ success: true, data: updated })
    },
  )

  // POST /api/customers/:id/documents — get presigned URL, then caller stores the returned publicUrl
  app.post<{ Params: { id: string } }>(
    '/:id/documents',
    { preHandler: requirePermission('customers', 'update') },
    async (request, reply) => {
      const parsed = documentUploadSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'validation_error', message: parsed.error.errors[0].message },
        })
      }

      const customer = await request.tenantDb.customer.findUnique({
        where: { id: request.params.id },
      })
      if (!customer) {
        return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'العميل غير موجود' } })
      }

      const actor = request.user as JWTPayload
      const ext = parsed.data.contentType.split('/')[1]
      const key = `customers/${request.params.id}/${randomUUID()}.${ext}`

      try {
        const { uploadUrl, publicUrl } = await getUploadUrl(key, parsed.data.contentType)

        // Record the document row immediately so the DB is the source of truth.
        // Client must PUT to uploadUrl; if they don't, the row has a broken link.
        const doc = await request.tenantDb.customerDocument.create({
          data: {
            customerId: request.params.id,
            docType: parsed.data.docType,
            fileUrl: publicUrl,
            uploadedById: actor.userId,
          },
        })

        return reply.status(201).send({ success: true, data: { document: doc, uploadUrl } })
      } catch {
        return reply.status(503).send({
          success: false,
          error: { code: 'storage_unavailable', message: 'R2 storage not configured' },
        })
      }
    },
  )

  // ─── GET /api/customers/:id/documents/:docId/download ─────────────────────────
  // API-02: returns a short-lived presigned GET URL so customer documents (often
  // national-ID scans) can live in a PRIVATE bucket instead of being served from
  // a permanent public URL. Pairs with flipping the R2 bucket to private (ops).
  app.get<{ Params: { id: string; docId: string } }>(
    '/:id/documents/:docId/download',
    { preHandler: requirePermission('customers', 'read') },
    async (request, reply) => {
      const doc = await request.tenantDb.customerDocument.findFirst({
        where: { id: request.params.docId, customerId: request.params.id },
        select: { fileUrl: true },
      })
      if (!doc) {
        return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'المستند غير موجود' } })
      }

      const key = keyFromPublicUrl(doc.fileUrl)
      // Legacy/external URL we can't re-sign — hand back what we stored.
      if (!key) return reply.send({ success: true, data: { downloadUrl: doc.fileUrl } })

      try {
        const downloadUrl = await getDownloadUrl(key, 300)
        return reply.send({ success: true, data: { downloadUrl } })
      } catch {
        return reply.status(503).send({
          success: false,
          error: { code: 'storage_unavailable', message: 'R2 storage not configured' },
        })
      }
    },
  )

  // ─── GET /api/customers/:id/statement ─────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/:id/statement',
    { preHandler: requirePermission('customers', 'read') },
    async (request, reply) => {
      const customer = await request.tenantDb.customer.findUnique({ where: { id: request.params.id } })
      if (!customer) return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'العميل غير موجود' } })

      type InvRow = { invoice_number: string; created_at: Date; pm_name: string | null; total_amount: string; status: string }
      type InstRow = { created_at: Date; total_amount: string; remaining_amount: string; status: string }
      type RetRow = { invoice_number: string; created_at: Date; amount: string; return_type: string }

      const cid = request.params.id
      const [invoices, installments, returns] = await Promise.all([
        request.tenantDb.$queryRawUnsafe<InvRow[]>(
          `SELECT i.invoice_number, i.created_at, pm.name AS pm_name, i.total_amount, i.status
           FROM invoices i LEFT JOIN payment_methods pm ON pm.id = i.payment_method_id
           WHERE i.customer_id = $1 ORDER BY i.created_at DESC LIMIT 500`, cid),
        request.tenantDb.$queryRawUnsafe<InstRow[]>(
          `SELECT created_at, total_amount, remaining_amount, status FROM installment_contracts WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 200`, cid),
        request.tenantDb.$queryRawUnsafe<RetRow[]>(
          `SELECT inv.invoice_number, r.created_at, r.amount, r.return_type
           FROM returns r JOIN invoices inv ON inv.id = r.invoice_id WHERE inv.customer_id = $1 ORDER BY r.created_at DESC LIMIT 200`, cid),
      ])

      const ExcelJS = await import('exceljs')
      const wb = new ExcelJS.default.Workbook()
      wb.creator = 'Hesba'

      const headerStyle = (row: import('exceljs').Row) => {
        row.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }
          cell.alignment = { vertical: 'middle', horizontal: 'center' }
        })
      }

      // Sheet 1: Invoices
      const invSheet = wb.addWorksheet('الفواتير')
      invSheet.addRow(['رقم الفاتورة', 'التاريخ', 'طريقة الدفع', 'الإجمالي', 'الحالة'])
      headerStyle(invSheet.lastRow!)
      for (const i of invoices) {
        invSheet.addRow([
          i.invoice_number ?? '—',
          new Date(i.created_at).toLocaleDateString('ar-EG'),
          i.pm_name ?? '—',
          Number(i.total_amount),
          i.status,
        ])
      }
      invSheet.columns.forEach((c) => { c.width = 18 })

      // Sheet 2: Installments
      const instSheet = wb.addWorksheet('الأقساط')
      instSheet.addRow(['التاريخ', 'إجمالي العقد', 'المتبقي', 'الحالة'])
      headerStyle(instSheet.lastRow!)
      for (const c of installments) {
        instSheet.addRow([new Date(c.created_at).toLocaleDateString('ar-EG'), Number(c.total_amount), Number(c.remaining_amount), c.status])
      }
      instSheet.columns.forEach((c) => { c.width = 18 })

      // Sheet 3: Returns
      const retSheet = wb.addWorksheet('المرتجعات')
      retSheet.addRow(['رقم الفاتورة', 'التاريخ', 'المبلغ', 'النوع'])
      headerStyle(retSheet.lastRow!)
      for (const r of returns) {
        retSheet.addRow([r.invoice_number ?? '—', new Date(r.created_at).toLocaleDateString('ar-EG'), Number(r.amount), r.return_type === 'refund' ? 'استرداد نقدي' : 'رصيد'])
      }
      retSheet.columns.forEach((c) => { c.width = 18 })

      const buf = await wb.xlsx.writeBuffer()
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', contentDispositionAttachment(`statement_${customer.fullName}.xlsx`))
        .send(Buffer.from(buf))
    },
  )

  // ─── GET /api/customers/:id/credit-ledger ─────────────────────────────────
  // Synthesizes the customer's credit + loyalty history from audit_logs. No
  // dedicated ledger table — `createInvoice` and `PATCH /:id/credit` both
  // write `entity: 'customer'` audit entries with action codes we know.
  app.get<{ Params: { id: string } }>(
    '/:id/credit-ledger',
    { preHandler: requirePermission('customers', 'read') },
    async (request, reply) => {
      const customer = await request.tenantDb.customer.findUnique({
        where: { id: request.params.id },
        select: { id: true, creditBalance: true, loyaltyPoints: true },
      })
      if (!customer) {
        return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'العميل غير موجود' } })
      }

      const entries = await request.tenantDb.auditLog.findMany({
        where: {
          entity: 'customer',
          entityId: request.params.id,
          action: { in: ['credit_add', 'credit_deduct', 'credit_used', 'loyalty_earned', 'loyalty_reversed'] },
        },
        include: { actor: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })

      return reply.send({
        success: true,
        data: {
          balance: {
            credit: customer.creditBalance.toString(),
            loyaltyPoints: customer.loyaltyPoints,
          },
          entries,
        },
      })
    },
  )

  // ─── POST /api/customers/import — bulk CSV import ──────────────────────────
  // CSV columns (header required): full_name, phone, email, national_id, address, notes
  // Mirrors the products/import shape so admins use the same workflow.
  app.post('/import', { preHandler: requirePermission('customers', 'create') }, async (request, reply) => {
    const file = await (request as unknown as { file: () => Promise<{ filename: string; toBuffer: () => Promise<Buffer> }> }).file()
    if (!file) {
      return reply.status(400).send({ success: false, error: { code: 'no_file', message: 'لم يتم إرسال ملف' } })
    }

    const buf = await file.toBuffer()
    // Strip UTF-8 BOM (U+FEFF) that Excel prepends to CSV exports. Using the
    // Unicode escape form keeps the source file ASCII-clean and avoids
    // lint's no-irregular-whitespace flag on the literal char.
    const text = buf.toString('utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\uFEFF/, '')
    const lines = text.split('\n').filter((l) => l.trim())
    if (lines.length < 2) {
      return reply.status(400).send({ success: false, error: { code: 'empty_file', message: 'الملف فارغ أو لا يحتوي على بيانات' } })
    }

    const parseCsv = (line: string) => line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    const headers = parseCsv(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'))
    const col = (row: string[], name: string) => row[headers.indexOf(name)] ?? ''

    const actor = request.user as JWTPayload
    const results = { created: 0, skipped: 0, errors: [] as { row: number; reason: string }[] }

    // Loose email shape — strict validation happens via zod when we save.
    const emailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    for (let i = 1; i < lines.length; i++) {
      const row = parseCsv(lines[i])
      const fullName = col(row, 'full_name') || col(row, 'name')
      const phone = col(row, 'phone') || undefined
      const email = col(row, 'email') || undefined
      const nationalId = col(row, 'national_id') || undefined
      const address = col(row, 'address') || undefined
      const notes = col(row, 'notes') || undefined

      if (!fullName) {
        results.errors.push({ row: i + 1, reason: 'الاسم مفقود' })
        results.skipped++
        continue
      }
      if (email && !emailLike.test(email)) {
        results.errors.push({ row: i + 1, reason: `بريد غير صالح: ${email}` })
        results.skipped++
        continue
      }

      try {
        await request.tenantDb.customer.create({
          data: { fullName, phone, email, nationalId, address, notes },
        })
        results.created++
      } catch {
        results.errors.push({ row: i + 1, reason: 'خطأ أثناء الحفظ' })
        results.skipped++
      }
    }

    const { auditLog } = await import('../../shared/utils/audit')
    await auditLog({
      db: request.tenantDb,
      actorId: actor.userId,
      entity: 'customer',
      entityId: 'bulk',
      action: 'bulk_import',
      after: { created: results.created, skipped: results.skipped },
      ip: request.ip,
    })

    return reply.send({ success: true, data: results })
  })
}
