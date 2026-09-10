import type { FastifyInstance } from 'fastify'
import { authenticate, requirePermission } from '../../shared/middleware/auth.middleware'
import type { JWTPayload } from '../../shared/middleware/auth.middleware'
import { requireFeature } from '../../shared/middleware/feature.middleware'
import { auditLog } from '../../shared/utils/audit'
import { contentDispositionAttachment } from '../../shared/utils/content-disposition'
import {
  createSupplierSchema,
  updateSupplierSchema,
  listSuppliersSchema,
  createTransactionSchema,
} from './supplier.schema'

// balance delta per transaction type
const BALANCE_DELTA: Record<string, 1 | -1> = {
  purchase: 1,   // we owe them more
  payment: -1,   // we owe them less
  return: -1,    // credit reduces liability
}

export async function supplierRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  // Plan-gate the entire module. Mirrors the frontend FeatureGate on /suppliers/*
  // so API calls can't bypass the gate by hitting endpoints directly.
  app.addHook('preHandler', requireFeature('suppliers'))

  // ─── GET /api/suppliers ──────────────────────────────────────────────────────
  app.get('/', { preHandler: requirePermission('suppliers', 'read') }, async (request, reply) => {
    const parsed = listSuppliersSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: 'validation_error', message: parsed.error.errors[0].message } })
    }

    const { page, limit, search, isActive } = parsed.data
    const where = {
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
      ...(isActive !== undefined ? { isActive: isActive === 'true' } : {}),
    }

    const [total, items] = await Promise.all([
      request.tenantDb.supplier.count({ where }),
      request.tenantDb.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])

    return reply.send({ success: true, data: items, meta: { total, page, limit, pages: Math.ceil(total / limit) } })
  })

  // ─── POST /api/suppliers ─────────────────────────────────────────────────────
  app.post('/', { preHandler: requirePermission('suppliers', 'create') }, async (request, reply) => {
    const parsed = createSupplierSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: 'validation_error', message: parsed.error.errors[0].message } })
    }
    const actor = request.user as JWTPayload
    const supplier = await request.tenantDb.supplier.create({ data: parsed.data })
    await auditLog({ db: request.tenantDb, actorId: actor.userId, entity: 'supplier', entityId: supplier.id, action: 'create', after: { name: supplier.name }, ip: request.ip })
    return reply.status(201).send({ success: true, data: supplier })
  })

  // ─── GET /api/suppliers/:id ──────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requirePermission('suppliers', 'read') },
    async (request, reply) => {
      const supplier = await request.tenantDb.supplier.findUnique({
        where: { id: request.params.id },
        include: { _count: { select: { purchaseOrders: true, transactions: true } } },
      })
      if (!supplier) return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'المورد غير موجود' } })
      return reply.send({ success: true, data: supplier })
    },
  )

  // ─── PATCH /api/suppliers/:id ────────────────────────────────────────────────
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requirePermission('suppliers', 'update') },
    async (request, reply) => {
      const parsed = updateSupplierSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: { code: 'validation_error', message: parsed.error.errors[0].message } })
      }
      try {
        const actor = request.user as JWTPayload
        const supplier = await request.tenantDb.supplier.update({ where: { id: request.params.id }, data: parsed.data })
        await auditLog({ db: request.tenantDb, actorId: actor.userId, entity: 'supplier', entityId: supplier.id, action: 'update', ip: request.ip })
        return reply.send({ success: true, data: supplier })
      } catch {
        return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'المورد غير موجود' } })
      }
    },
  )

  // ─── DELETE /api/suppliers/:id (soft) ────────────────────────────────────────
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requirePermission('suppliers', 'delete') },
    async (request, reply) => {
      try {
        await request.tenantDb.supplier.update({ where: { id: request.params.id }, data: { isActive: false } })
        return reply.send({ success: true })
      } catch {
        return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'المورد غير موجود' } })
      }
    },
  )

  // ─── GET /api/suppliers/:id/transactions ─────────────────────────────────────
  // Supports optional `type` (purchase|payment|return), `from`, `to` filters.
  // Response includes a `summary` aggregated over the FILTERED set (not just
  // the current page) so the drawer can render running totals without a
  // second round trip.
  app.get<{ Params: { id: string } }>(
    '/:id/transactions',
    { preHandler: requirePermission('suppliers', 'read') },
    async (request, reply) => {
      const q = request.query as Record<string, string>
      const page = Number(q.page) || 1
      const limit = Number(q.limit) || 20
      const type = q.type
      const from = q.from
      const to = q.to

      const where = {
        supplierId: request.params.id,
        ...(type && ['purchase', 'payment', 'return'].includes(type) ? { type } : {}),
        ...(from || to ? {
          createdAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
          },
        } : {}),
      }

      const [total, items, byType] = await Promise.all([
        request.tenantDb.supplierTransaction.count({ where }),
        request.tenantDb.supplierTransaction.findMany({
          where,
          include: { user: { select: { id: true, fullName: true } }, branch: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        request.tenantDb.supplierTransaction.groupBy({
          by: ['type'],
          where,
          _sum: { amount: true },
          _count: { _all: true },
        }),
      ])

      // Normalize into a stable summary shape so the frontend doesn't have
      // to hunt for missing buckets.
      const pick = (t: string) => byType.find((b) => b.type === t)
      const summary = {
        totalPurchases: Number(pick('purchase')?._sum.amount ?? 0),
        totalPayments: Number(pick('payment')?._sum.amount ?? 0),
        totalReturns: Number(pick('return')?._sum.amount ?? 0),
        countPurchases: pick('purchase')?._count._all ?? 0,
        countPayments: pick('payment')?._count._all ?? 0,
        countReturns: pick('return')?._count._all ?? 0,
      }

      return reply.send({
        success: true,
        data: items,
        meta: { total, page, limit, pages: Math.ceil(total / limit) },
        summary,
      })
    },
  )

  // ─── POST /api/suppliers/:id/transactions ────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/:id/transactions',
    { preHandler: requirePermission('suppliers', 'update') },
    async (request, reply) => {
      const parsed = createTransactionSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: { code: 'validation_error', message: parsed.error.errors[0].message } })
      }

      const actor = request.user as JWTPayload
      const delta = BALANCE_DELTA[parsed.data.type]

      const supplier = await request.tenantDb.supplier.findUnique({ where: { id: request.params.id } })
      if (!supplier) return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'المورد غير موجود' } })

      await request.tenantDb.$transaction([
        request.tenantDb.supplierTransaction.create({
          data: {
            supplierId: request.params.id,
            branchId: parsed.data.branchId,
            userId: actor.userId,
            type: parsed.data.type,
            amount: parsed.data.amount,
            reference: parsed.data.reference ?? null,
            note: parsed.data.note ?? null,
          },
        }),
        request.tenantDb.supplier.update({
          where: { id: request.params.id },
          data: { balance: { [delta > 0 ? 'increment' : 'decrement']: parsed.data.amount } },
        }),
      ])

      return reply.status(201).send({ success: true })
    },
  )

  // ─── GET /api/suppliers/:id/statement (Excel export) ─────────────────────────
  app.get<{ Params: { id: string } }>(
    '/:id/statement',
    { preHandler: requirePermission('suppliers', 'read') },
    async (request, reply) => {
      const supplier = await request.tenantDb.supplier.findUnique({ where: { id: request.params.id } })
      if (!supplier) return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'المورد غير موجود' } })

      const transactions = await request.tenantDb.supplierTransaction.findMany({
        where: { supplierId: request.params.id },
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { fullName: true } }, branch: { select: { name: true } } },
      })

      const purchaseOrders = await request.tenantDb.purchaseOrder.findMany({
        where: { supplierId: request.params.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, createdAt: true, status: true, totalAmount: true },
      })

      const ExcelJS = await import('exceljs')
      const wb = new ExcelJS.default.Workbook()
      wb.creator = 'Hesba'

      const styleHeader = (row: import('exceljs').Row) => {
        row.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }
          cell.alignment = { horizontal: 'right' }
          cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } }
        })
      }

      // Sheet 1: Summary
      const summary = wb.addWorksheet('ملخص المورد')
      summary.addRow(['المورد', supplier.name])
      summary.addRow(['الهاتف', supplier.phone ?? '—'])
      summary.addRow(['البريد', supplier.email ?? '—'])
      summary.addRow(['الرصيد المستحق', Number(supplier.balance).toFixed(2) + ' ج'])
      summary.addRow(['عدد الأوامر', purchaseOrders.length])

      // Sheet 2: Transactions
      const txSheet = wb.addWorksheet('المعاملات')
      const txHeader = txSheet.addRow(['التاريخ', 'النوع', 'المبلغ', 'المرجع', 'ملاحظة', 'المستخدم', 'الفرع'])
      styleHeader(txHeader)
      const typeLabels: Record<string, string> = { purchase: 'مشتريات', payment: 'دفعة', return: 'مرتجع' }
      for (const t of transactions) {
        txSheet.addRow([
          new Date(t.createdAt).toLocaleDateString('ar-EG-u-nu-latn'),
          typeLabels[t.type] ?? t.type,
          Number(t.amount).toFixed(2),
          t.reference ?? '',
          t.note ?? '',
          t.user?.fullName ?? '',
          t.branch?.name ?? '',
        ])
      }
      txSheet.columns.forEach((col) => { col.width = 18 })

      // Sheet 3: Purchase Orders
      const poSheet = wb.addWorksheet('أوامر الشراء')
      const poHeader = poSheet.addRow(['التاريخ', 'الحالة', 'الإجمالي'])
      styleHeader(poHeader)
      const statusLabels: Record<string, string> = { draft: 'مسودة', pending_approval: 'انتظار', approved: 'موافق', received: 'مستلم', cancelled: 'ملغي' }
      for (const po of purchaseOrders) {
        poSheet.addRow([
          new Date(po.createdAt).toLocaleDateString('ar-EG-u-nu-latn'),
          statusLabels[po.status] ?? po.status,
          Number(po.totalAmount).toFixed(2) + ' ج',
        ])
      }
      poSheet.columns.forEach((col) => { col.width = 20 })

      const buf = await wb.xlsx.writeBuffer()
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', contentDispositionAttachment(`supplier-${supplier.name}.xlsx`))
        .send(buf)
    },
  )
}
