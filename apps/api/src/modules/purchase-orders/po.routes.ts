import type { FastifyInstance } from 'fastify'
import { authenticate, requirePermission } from '../../shared/middleware/auth.middleware'
import type { JWTPayload } from '../../shared/middleware/auth.middleware'
import { requireFeature } from '../../shared/middleware/feature.middleware'
import { auditLog } from '../../shared/utils/audit'
import { toDecimal, roundMoney, ZERO } from '../../shared/utils/decimal'
import { weightedAverageCost } from '../../shared/utils/cost'
import { createPoSchema, updatePoSchema, receivePoSchema, poPaymentSchema, listPoSchema } from './po.schema'

export async function purchaseOrderRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  // POs live under the suppliers feature — the Sidebar gates /purchase-orders on
  // the same flag, and you can't have POs without suppliers.
  app.addHook('preHandler', requireFeature('suppliers'))

  // ─── GET /api/purchase-orders ────────────────────────────────────────────────
  app.get('/', { preHandler: requirePermission('purchase_orders', 'read') }, async (request, reply) => {
    const parsed = listPoSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: 'validation_error', message: parsed.error.errors[0].message } })
    }

    const { page, limit, status, supplierId, branchId } = parsed.data
    const where = {
      ...(status ? { status } : {}),
      ...(supplierId ? { supplierId } : {}),
      ...(branchId ? { branchId } : {}),
    }

    const [total, items] = await Promise.all([
      request.tenantDb.purchaseOrder.count({ where }),
      request.tenantDb.purchaseOrder.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
          createdBy: { select: { id: true, fullName: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])

    return reply.send({ success: true, data: items, meta: { total, page, limit, pages: Math.ceil(total / limit) } })
  })

  // ─── POST /api/purchase-orders ───────────────────────────────────────────────
  app.post('/', { preHandler: requirePermission('purchase_orders', 'create') }, async (request, reply) => {
    const parsed = createPoSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: 'validation_error', message: parsed.error.errors[0].message } })
    }

    const actor = request.user as JWTPayload
    const { supplierId, branchId, items, expectedDate, paymentType } = parsed.data

    // MONEY-01: compute liability with Decimal math, never native float * / +.
    const total = items.reduce((sum, i) => sum.plus(toDecimal(i.unitCost).times(i.quantity)), ZERO)
    const totalAmount = roundMoney(total).toString()

    const po = await request.tenantDb.purchaseOrder.create({
      data: {
        supplierId,
        branchId,
        createdById: actor.userId,
        status: 'draft',
        totalAmount,
        paidAmount: 0,
        paymentType: paymentType ?? null,
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        items: {
          create: items.map((i) => ({
            variantId: i.variantId,
            quantity: i.quantity,
            unitCost: i.unitCost,
            subtotal: roundMoney(toDecimal(i.unitCost).times(i.quantity)).toString(),
          })),
        },
      },
      include: { items: true },
    })

    await auditLog({ db: request.tenantDb, actorId: actor.userId, entity: 'purchase_order', entityId: po.id, action: 'create', after: { totalAmount }, ip: request.ip })
    return reply.status(201).send({ success: true, data: po })
  })

  // ─── GET /api/purchase-orders/:id ────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requirePermission('purchase_orders', 'read') },
    async (request, reply) => {
      const po = await request.tenantDb.purchaseOrder.findUnique({
        where: { id: request.params.id },
        include: {
          supplier: true,
          branch: { select: { id: true, name: true } },
          createdBy: { select: { id: true, fullName: true } },
          approvedBy: { select: { id: true, fullName: true } },
          items: { include: { variant: { include: { product: { select: { id: true, name: true } } } } } },
          receipts: true,
          payments: { include: { paidBy: { select: { id: true, fullName: true } } } },
        },
      })
      if (!po) return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'أمر الشراء غير موجود' } })
      return reply.send({ success: true, data: po })
    },
  )

  // ─── PATCH /api/purchase-orders/:id — amend a draft PO ───────────────────────
  // Only allowed while status === 'draft'. Once submitted, the PO is frozen so
  // approvers and receivers see a stable target. `items` replaces the entire
  // line set in a transaction; partial item edits aren't supported on purpose
  // — UX-wise the user re-sees the full list before saving anyway.
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requirePermission('purchase_orders', 'update') },
    async (request, reply) => {
      const parsed = updatePoSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'validation_error', message: parsed.error.errors[0].message },
        })
      }

      const existing = await request.tenantDb.purchaseOrder.findUnique({
        where: { id: request.params.id },
        select: { id: true, status: true, totalAmount: true },
      })
      if (!existing) {
        return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'أمر الشراء غير موجود' } })
      }
      if (existing.status !== 'draft') {
        return reply.status(409).send({
          success: false,
          error: { code: 'not_draft', message: 'يمكن تعديل أمر الشراء أثناء المسودة فقط' },
        })
      }

      const actor = request.user as JWTPayload
      const { supplierId, branchId, expectedDate, paymentType, items } = parsed.data

      const updated = await request.tenantDb.$transaction(async (tx) => {
        // Replace line items if provided. Recompute totalAmount from the new
        // set so the saved invoice reflects what the user just saw.
        let newTotal = existing.totalAmount
        if (items) {
          await tx.purchaseOrderItem.deleteMany({ where: { orderId: existing.id } })
          await tx.purchaseOrderItem.createMany({
            data: items.map((i) => ({
              orderId: existing.id,
              variantId: i.variantId,
              quantity: i.quantity,
              unitCost: i.unitCost,
              subtotal: roundMoney(toDecimal(i.unitCost).times(i.quantity)).toString(),
            })),
          })
          newTotal = roundMoney(items.reduce((s, i) => s.plus(toDecimal(i.unitCost).times(i.quantity)), ZERO))
        }

        return tx.purchaseOrder.update({
          where: { id: existing.id },
          data: {
            ...(supplierId !== undefined ? { supplierId } : {}),
            ...(branchId !== undefined ? { branchId } : {}),
            ...(expectedDate !== undefined ? { expectedDate: expectedDate ? new Date(expectedDate) : null } : {}),
            ...(paymentType !== undefined ? { paymentType } : {}),
            ...(items ? { totalAmount: newTotal } : {}),
          },
          include: { items: true },
        })
      })

      await auditLog({
        db: request.tenantDb,
        actorId: actor.userId,
        entity: 'purchase_order',
        entityId: existing.id,
        action: 'update',
        before: { totalAmount: existing.totalAmount.toString() },
        after: { totalAmount: updated.totalAmount.toString(), itemCount: updated.items.length },
        ip: request.ip,
      })

      return reply.send({ success: true, data: updated })
    },
  )

  // ─── PATCH /api/purchase-orders/:id/submit (draft → pending) ─────────────────
  app.patch<{ Params: { id: string } }>(
    '/:id/submit',
    { preHandler: requirePermission('purchase_orders', 'update') },
    async (request, reply) => {
      const actor = request.user as JWTPayload
      const po = await request.tenantDb.purchaseOrder.findUnique({ where: { id: request.params.id } })
      if (!po) return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'أمر الشراء غير موجود' } })
      if (po.status !== 'draft') return reply.status(400).send({ success: false, error: { code: 'invalid_status', message: 'أمر الشراء ليس في مرحلة المسودة' } })

      const updated = await request.tenantDb.purchaseOrder.update({ where: { id: request.params.id }, data: { status: 'pending' } })
      await auditLog({ db: request.tenantDb, actorId: actor.userId, entity: 'purchase_order', entityId: po.id, action: 'submit', after: { status: 'pending' }, ip: request.ip })
      return reply.send({ success: true, data: updated })
    },
  )

  // ─── PATCH /api/purchase-orders/:id/approve (pending → approved) ──────────────
  app.patch<{ Params: { id: string } }>(
    '/:id/approve',
    { preHandler: requirePermission('purchase_orders', 'approve') },
    async (request, reply) => {
      const actor = request.user as JWTPayload
      const po = await request.tenantDb.purchaseOrder.findUnique({ where: { id: request.params.id } })
      if (!po) return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'أمر الشراء غير موجود' } })
      if (po.status !== 'pending') return reply.status(400).send({ success: false, error: { code: 'invalid_status', message: 'أمر الشراء ليس في مرحلة الانتظار' } })

      const updated = await request.tenantDb.purchaseOrder.update({
        where: { id: request.params.id },
        data: { status: 'approved', approvedById: actor.userId },
      })
      await auditLog({ db: request.tenantDb, actorId: actor.userId, entity: 'purchase_order', entityId: po.id, action: 'approve', after: { status: 'approved' }, ip: request.ip })
      return reply.send({ success: true, data: updated })
    },
  )

  // ─── POST /api/purchase-orders/:id/receive ────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/:id/receive',
    { preHandler: requirePermission('purchase_orders', 'receive') },
    async (request, reply) => {
      const parsed = receivePoSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: { code: 'validation_error', message: parsed.error.errors[0].message } })
      }

      const actor = request.user as JWTPayload

      const po = await request.tenantDb.purchaseOrder.findUnique({
        where: { id: request.params.id },
        include: { items: true },
      })
      if (!po) return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'أمر الشراء غير موجود' } })
      if (po.status !== 'approved' && po.status !== 'partially_received') {
        return reply.status(400).send({ success: false, error: { code: 'invalid_status', message: 'أمر الشراء يجب أن يكون معتمداً أولاً' } })
      }

      const receivedDate = parsed.data.receivedDate ? new Date(parsed.data.receivedDate) : new Date()

      // Resolve which items + quantities to receive this batch.
      // Default (no `items` payload): receive all outstanding quantities.
      // With `items`: validate each row belongs to this PO and the requested
      // quantity doesn't exceed what's still outstanding.
      type ReceiveBatch = { item: typeof po.items[number]; quantity: number }
      const batch: ReceiveBatch[] = []
      if (parsed.data.items && parsed.data.items.length > 0) {
        for (const requested of parsed.data.items) {
          const item = po.items.find((i) => i.id === requested.id)
          if (!item) {
            return reply.status(400).send({
              success: false,
              error: { code: 'item_not_in_po', message: 'صنف غير موجود في أمر الشراء' },
            })
          }
          const outstanding = item.quantity - item.receivedQuantity
          if (requested.quantity > outstanding) {
            return reply.status(400).send({
              success: false,
              error: { code: 'qty_exceeds_outstanding', message: `الكمية المطلوبة تتجاوز المتبقي (${outstanding}) للصنف` },
            })
          }
          if (requested.quantity > 0) batch.push({ item, quantity: requested.quantity })
        }
      } else {
        for (const item of po.items) {
          const outstanding = item.quantity - item.receivedQuantity
          if (outstanding > 0) batch.push({ item, quantity: outstanding })
        }
      }

      if (batch.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'nothing_to_receive', message: 'لا توجد كميات متبقية للاستلام' },
        })
      }

      // Cost of just this batch (proportional supplier liability). MONEY-01:
      // Decimal math, no native float.
      const batchCost = roundMoney(
        batch.reduce((sum, b) => sum.plus(toDecimal(b.item.unitCost).times(b.quantity)), ZERO),
      )

      const result = await request.tenantDb.$transaction(async (tx) => {
        for (const { item, quantity } of batch) {
          // ACC-03: roll the variant's cost_price forward by weighted moving
          // average so COGS reflects real purchase cost. Read on-hand quantity
          // (across branches) and the current cost BEFORE this batch increments
          // stock, then blend in the received units at their unit cost.
          const onHand = await tx.stock.aggregate({
            where: { variantId: item.variantId },
            _sum: { quantity: true },
          })
          const existingQty = onHand._sum.quantity ?? 0
          const currentVariant = await tx.productVariant.findUnique({
            where: { id: item.variantId },
            select: { costPrice: true },
          })
          const newCost = weightedAverageCost(existingQty, currentVariant?.costPrice, quantity, item.unitCost)

          await tx.stock.upsert({
            where: { uq_stock_variant_branch: { variantId: item.variantId, branchId: po.branchId } },
            create: { variantId: item.variantId, branchId: po.branchId, quantity, minQuantity: 0, updatedAt: new Date() },
            update: { quantity: { increment: quantity }, updatedAt: new Date() },
          })

          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { costPrice: newCost },
          })

          await tx.stockMovement.create({
            data: {
              variantId: item.variantId,
              branchId: po.branchId,
              userId: actor.userId,
              type: 'in',
              quantity,
              reference: po.id,
            },
          })

          // Advance the PO item's received counter.
          await tx.purchaseOrderItem.update({
            where: { id: item.id },
            data: { receivedQuantity: { increment: quantity } },
          })
        }

        await tx.purchaseReceipt.create({
          data: {
            orderId: po.id,
            receivedById: actor.userId,
            receivedDate,
            notes: parsed.data.notes ?? null,
            invoiceImageUrl: parsed.data.invoiceImageUrl ?? null,
          },
        })

        // Supplier liability is per-batch — only what arrived in this receipt.
        await tx.supplierTransaction.create({
          data: {
            supplierId: po.supplierId,
            branchId: po.branchId,
            userId: actor.userId,
            type: 'purchase',
            amount: batchCost,
            reference: po.id,
          },
        })
        await tx.supplier.update({
          where: { id: po.supplierId },
          data: { balance: { increment: batchCost } },
        })

        // Determine the new PO status by re-reading item totals after this
        // batch's updates have committed inside the transaction.
        const refreshedItems = await tx.purchaseOrderItem.findMany({ where: { orderId: po.id } })
        const allFulfilled = refreshedItems.every((i) => i.receivedQuantity >= i.quantity)
        const newStatus = allFulfilled ? 'received' : 'partially_received'

        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: newStatus },
        })

        await tx.auditLog.create({
          data: {
            actorId: actor.userId,
            entity: 'purchase_order',
            entityId: po.id,
            action: allFulfilled ? 'receive' : 'partial_receive',
            before: { status: po.status },
            after: {
              status: newStatus,
              itemCount: batch.length,
              batchCost: String(batchCost),
            },
          },
        })

        return { status: newStatus, itemsReceived: batch.length }
      })

      return reply.send({ success: true, data: result })
    },
  )

  // ─── POST /api/purchase-orders/:id/payments ───────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/:id/payments',
    { preHandler: requirePermission('purchase_orders', 'update') },
    async (request, reply) => {
      const parsed = poPaymentSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: { code: 'validation_error', message: parsed.error.errors[0].message } })
      }

      const actor = request.user as JWTPayload

      const po = await request.tenantDb.purchaseOrder.findUnique({ where: { id: request.params.id } })
      if (!po) return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'أمر الشراء غير موجود' } })

      const remaining = toDecimal(po.totalAmount).minus(toDecimal(po.paidAmount)).toNumber()
      if (parsed.data.amount > remaining + 0.0001) {
        return reply.status(400).send({ success: false, error: { code: 'overpayment', message: 'المبلغ يتجاوز المبلغ المستحق' } })
      }

      await request.tenantDb.$transaction([
        request.tenantDb.purchasePayment.create({
          data: {
            orderId: po.id,
            supplierId: po.supplierId,
            paidById: actor.userId,
            amount: parsed.data.amount,
            paymentMethod: parsed.data.paymentMethod ?? null,
            receiptUrl: parsed.data.receiptUrl ?? null,
          },
        }),
        request.tenantDb.purchaseOrder.update({
          where: { id: po.id },
          data: { paidAmount: { increment: parsed.data.amount } },
        }),
        request.tenantDb.supplierTransaction.create({
          data: {
            supplierId: po.supplierId,
            branchId: po.branchId,
            userId: actor.userId,
            type: 'payment',
            amount: parsed.data.amount,
            reference: po.id,
          },
        }),
        request.tenantDb.supplier.update({
          where: { id: po.supplierId },
          data: { balance: { decrement: parsed.data.amount } },
        }),
      ])

      await auditLog({ db: request.tenantDb, actorId: actor.userId, entity: 'purchase_order', entityId: po.id, action: 'payment', after: { amount: parsed.data.amount }, ip: request.ip })
      return reply.status(201).send({ success: true })
    },
  )
}
