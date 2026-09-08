import type { TenantPrismaClient } from '@hesba/database'
import { Decimal, toDecimal, roundMoney, ZERO } from '../../shared/utils/decimal'
import { calculateFee } from '../../shared/utils/fee'
import type { CreateInvoiceInput, ReturnInvoiceInput } from './invoice.schema'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function badRequest(msg: string) {
  const err = new Error(msg) as Error & { statusCode: number }
  err.statusCode = 400
  return err
}

function notFound() {
  const err = new Error('not_found') as Error & { statusCode: number }
  err.statusCode = 404
  return err
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listInvoices(
  db: TenantPrismaClient,
  opts: {
    page: number
    limit: number
    customerId?: string
    branchId?: string
    status?: string
    etaStatus?: string
    search?: string
    from?: string
    to?: string
  },
) {
  // Resolve invoice IDs matching invoice_number search (raw column, not in Prisma schema)
  let searchIds: string[] | undefined
  if (opts.search) {
    const term = `%${opts.search}%`
    const rows = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM invoices WHERE invoice_number ILIKE $1 LIMIT 200`,
      term,
    )
    const customerRows = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT i.id FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE c.full_name ILIKE $1 LIMIT 200`,
      term,
    )
    const idSet = new Set([...rows.map((r) => r.id), ...customerRows.map((r) => r.id)])
    searchIds = [...idSet]
    if (searchIds.length === 0) {
      return { items: [], meta: { total: 0, page: opts.page, limit: opts.limit, pages: 0 } }
    }
  }

  const where = {
    ...(searchIds ? { id: { in: searchIds } } : {}),
    ...(opts.customerId ? { customerId: opts.customerId } : {}),
    ...(opts.branchId ? { branchId: opts.branchId } : {}),
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.etaStatus ? { etaStatus: opts.etaStatus } : {}),
    ...(opts.from || opts.to
      ? {
          createdAt: {
            ...(opts.from ? { gte: new Date(opts.from) } : {}),
            ...(opts.to ? { lte: new Date(opts.to) } : {}),
          },
        }
      : {}),
  }

  const [total, items] = await Promise.all([
    db.invoice.count({ where }),
    db.invoice.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
        customer: { select: { id: true, fullName: true, phone: true } },
        cashier: { select: { id: true, fullName: true } },
        paymentMethod: { select: { id: true, name: true, type: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
  ])

  return {
    items,
    meta: { total, page: opts.page, limit: opts.limit, pages: Math.ceil(total / opts.limit) },
  }
}

// ─── Get one ──────────────────────────────────────────────────────────────────

export async function getInvoice(db: TenantPrismaClient, invoiceId: string) {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      branch: { select: { id: true, name: true } },
      customer: { select: { id: true, fullName: true, phone: true, email: true, creditBalance: true } },
      cashier: { select: { id: true, fullName: true } },
      paymentMethod: true,
      currency: true,
      coupon: { select: { id: true, code: true, discountType: true, discountValue: true } },
      items: {
        include: {
          variant: {
            include: { product: { select: { id: true, name: true, unit: true } } },
          },
          // service is set when the item was generated from a work order line
          service: { select: { id: true, name: true } },
          taxRate: { select: { id: true, name: true, rate: true } },
        },
      },
      returns: { include: { items: true, processedBy: { select: { id: true, fullName: true } } } },
      paymentFeeExpenses: true,
    },
  })
  if (!invoice) throw notFound()
  return invoice
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createInvoice(
  db: TenantPrismaClient,
  input: CreateInvoiceInput & { branchId: string; currencyId: string },
  cashierId: string,
) {
  // 1. Validate payment method
  const paymentMethod = await db.paymentMethod.findUnique({
    where: { id: input.paymentMethodId },
  })
  if (!paymentMethod || !paymentMethod.isActive) throw badRequest('payment_method_not_found')

  // 2. Validate currency
  const currency = await db.currency.findUnique({ where: { id: input.currencyId } })
  if (!currency) throw badRequest('currency_not_found')

  // 3. Validate and resolve coupon
  let couponId: string | null = null
  let couponDiscount = ZERO
  let couponDiscountType = ''
  let couponDiscountValue = ZERO

  if (input.couponCode) {
    const coupon = await db.coupon.findUnique({ where: { code: input.couponCode } })
    if (!coupon || !coupon.isActive) throw badRequest('coupon_invalid')
    if (coupon.expiresAt && coupon.expiresAt < new Date()) throw badRequest('coupon_expired')
    if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) throw badRequest('coupon_exhausted')
    couponId = coupon.id
    couponDiscountType = coupon.discountType
    couponDiscountValue = toDecimal(coupon.discountValue)
  }

  // 4. Resolve variants + tax rates for all items (pre-transaction lookup)
  const variantIds = input.items.map((i) => i.variantId)
  const variants = await db.productVariant.findMany({
    where: { id: { in: variantIds }, isActive: true },
    include: {
      product: { include: { taxRate: true } },
    },
  })

  const variantMap = new Map(variants.map((v) => [v.id, v]))
  for (const item of input.items) {
    if (!variantMap.has(item.variantId)) throw badRequest(`variant_not_found:${item.variantId}`)
  }

  // 5. Calculate totals
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Batch-load active product discounts for every product in the cart in ONE
  // query (previously a findFirst ran per line item — an N+1 on the POS hot
  // path). Keep the first active discount per product to mirror findFirst.
  const productIds = [...new Set(variants.map((v) => v.productId))]
  const activeDiscounts = await db.productDiscount.findMany({
    where: {
      productId: { in: productIds },
      isActive: true,
      startDate: { lte: today },
      endDate: { gte: today },
    },
  })
  const discountByProduct = new Map<string, (typeof activeDiscounts)[number]>()
  for (const d of activeDiscounts) {
    if (!discountByProduct.has(d.productId)) discountByProduct.set(d.productId, d)
  }

  let subtotal = ZERO
  let taxTotal = ZERO

  const computedItems: Array<{
    variantId: string
    taxRateId: string | null
    quantity: number
    unitPrice: Decimal
    discountAmount: Decimal
    taxAmount: Decimal
    subtotal: Decimal
    costAtSale: Decimal
  }> = []

  for (const item of input.items) {
    const variant = variantMap.get(item.variantId)!
    const unitPrice = toDecimal(item.unitPrice)

    // Active product discount (pre-loaded above — no per-item query).
    const productDiscount = discountByProduct.get(variant.productId) ?? null

    let itemDiscount = ZERO
    if (productDiscount) {
      if (productDiscount.discountType === 'percentage') {
        itemDiscount = roundMoney(
          unitPrice.times(item.quantity).times(toDecimal(productDiscount.discountValue)).dividedBy(100),
        )
      } else {
        itemDiscount = roundMoney(toDecimal(productDiscount.discountValue).times(item.quantity))
      }
    }

    const itemSubtotal = roundMoney(unitPrice.times(item.quantity).minus(itemDiscount))
    const taxRate = variant.product.taxRate
    const itemTax = taxRate
      ? roundMoney(itemSubtotal.times(toDecimal(taxRate.rate)).dividedBy(100))
      : ZERO

    subtotal = subtotal.plus(itemSubtotal)
    taxTotal = taxTotal.plus(itemTax)

    computedItems.push({
      variantId: item.variantId,
      taxRateId: variant.product.taxRateId ?? null,
      quantity: item.quantity,
      unitPrice,
      discountAmount: itemDiscount,
      taxAmount: itemTax,
      subtotal: itemSubtotal,
      costAtSale: toDecimal(variant.costPrice),
    })
  }

  // Coupon discount (applied to subtotal after product discounts)
  if (couponId) {
    if (couponDiscountType === 'percentage') {
      couponDiscount = roundMoney(subtotal.times(couponDiscountValue).dividedBy(100))
    } else {
      couponDiscount = roundMoney(couponDiscountValue)
    }
    // Cap coupon at subtotal
    if (couponDiscount.greaterThan(subtotal)) couponDiscount = subtotal
  }

  // Validate and cap credit amount
  let creditUsed = ZERO
  if (input.creditAmount && input.creditAmount > 0 && input.customerId) {
    const customer = await db.customer.findUnique({ where: { id: input.customerId }, select: { creditBalance: true } })
    if (customer) {
      const availableCredit = toDecimal(customer.creditBalance)
      creditUsed = roundMoney(toDecimal(Math.min(input.creditAmount, availableCredit.toNumber())))
    }
  }

  const preFeeTotal = subtotal.minus(couponDiscount).plus(taxTotal)
  const { feeAmount, feeAddedToTotal } = calculateFee(
    preFeeTotal,
    paymentMethod,
    input.feeBearer,
  )

  const totalBeforeCredit = roundMoney(
    feeAddedToTotal ? preFeeTotal.plus(feeAmount) : preFeeTotal,
  )
  // Credit reduces the amount actually charged via payment method (capped at total)
  if (creditUsed.greaterThan(totalBeforeCredit)) creditUsed = totalBeforeCredit
  const totalAmount = roundMoney(totalBeforeCredit.minus(creditUsed))

  const effectiveFeeBearer = input.feeBearer ?? paymentMethod.feeBearer

  // 6. Atomic transaction
  return db.$transaction(async (tx) => {
    // Track post-deduction balance so we can write a ledger entry once the
    // invoice row exists (entityId = customerId, invoiceId in `after`).
    let creditBalanceAfter: string | null = null
    if (creditUsed.greaterThan(0) && input.customerId) {
      const updated = await tx.customer.update({
        where: { id: input.customerId },
        data: { creditBalance: { decrement: creditUsed } },
        select: { creditBalance: true },
      })
      creditBalanceAfter = updated.creditBalance.toString()
    }

    const invoice = await tx.invoice.create({
      data: {
        branchId: input.branchId,
        customerId: input.customerId ?? null,
        cashierId,
        paymentMethodId: input.paymentMethodId,
        currencyId: input.currencyId,
        couponId,
        exchangeRate: toDecimal(currency.rateToBase),
        subtotal,
        discountAmount: couponDiscount.plus(creditUsed),
        taxTotal,
        feePercentage: toDecimal(paymentMethod.feePercentage),
        feeFixed: toDecimal(paymentMethod.feeFixed),
        feeAmount,
        feeBearer: effectiveFeeBearer,
        feeAddedToTotal,
        totalAmount,
        paidAmount: totalAmount, // full payment for regular invoices
        status: 'completed',
        notes: input.notes ?? null,
        splitPaymentMethodId: input.splitPaymentMethodId ?? null,
        splitPaymentAmount: input.splitPaymentAmount ? toDecimal(input.splitPaymentAmount) : null,
      },
    })

    for (const item of computedItems) {
      // Atomic stock gate — race-safe
      const result = await tx.stock.updateMany({
        where: {
          variantId: item.variantId,
          branchId: input.branchId,
          quantity: { gte: item.quantity },
        },
        data: { quantity: { decrement: item.quantity }, updatedAt: new Date() },
      })

      if (result.count === 0) {
        throw badRequest(`insufficient_stock:${item.variantId}`)
      }

      await tx.invoiceItem.create({
        data: {
          invoiceId: invoice.id,
          variantId: item.variantId,
          taxRateId: item.taxRateId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount,
          taxAmount: item.taxAmount,
          subtotal: item.subtotal,
          costAtSale: item.costAtSale,
        },
      })

      await tx.stockMovement.create({
        data: {
          variantId: item.variantId,
          branchId: input.branchId,
          userId: cashierId,
          type: 'out',
          quantity: -item.quantity,
          reference: invoice.id,
        },
      })
    }

    // Increment coupon usage atomically. Two concurrent invoices could both
    // pass the up-front check at line 149 (used_count < max_uses) and then
    // both increment, overshooting the limit. A single conditional UPDATE
    // closes the window — Prisma's query builder can't express the
    // column-to-column comparison, so we go to raw SQL. updated count = 0
    // means the row was already at the limit by the time we tried.
    if (couponId) {
      const incremented = await tx.$executeRaw`
        UPDATE coupons
        SET used_count = used_count + 1
        WHERE id = ${couponId}::uuid
          AND (max_uses IS NULL OR used_count < max_uses)
      `
      if (incremented === 0) throw badRequest('coupon_exhausted')
    }

    // Auto fee expense when merchant bears it
    if (effectiveFeeBearer === 'merchant' && feeAmount.greaterThan(0)) {
      await tx.paymentFeeExpense.create({
        data: {
          invoiceId: invoice.id,
          paymentMethodId: input.paymentMethodId,
          feeAmount,
          branchId: input.branchId,
        },
      })
    }

    // External financing record (stock IS updated immediately — handled above)
    if (input.externalFinancing) {
      await tx.externalFinancing.create({
        data: {
          invoiceId: invoice.id,
          companyName: input.externalFinancing.companyName,
          referenceNo: input.externalFinancing.referenceNo ?? null,
          commissionPct: input.externalFinancing.commissionPct,
        },
      })
    }

    // Generate invoice number from a per-tenant sequence (migration 015).
    // Format: INV-YYYYMMDD-{6+ digit zero-padded sequence}. The sequence is
    // monotonic and scoped to the tenant schema, so two concurrent invoices
    // can never claim the same number — replacing the older UUID-suffix
    // approach that had a ~1-in-16.7M birthday collision per invoice.
    const now = new Date()
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, '')
    const seqRows = await tx.$queryRawUnsafe<Array<{ nextval: bigint }>>(
      `SELECT nextval('invoice_number_seq') AS nextval`,
    )
    const seq = seqRows[0].nextval.toString().padStart(6, '0')
    const invoiceNumber = `INV-${datePart}-${seq}`
    await tx.invoice.update({ where: { id: invoice.id }, data: { invoiceNumber } })

    // Award loyalty points to customer if enabled
    let loyaltyEarned = 0
    let loyaltyBalanceAfter: number | null = null
    if (input.customerId) {
      const settings = await tx.tenantSetting.findFirst()
      if (settings?.loyaltyEnabled && settings.loyaltyPointsPerUnit > 0) {
        // ACC-04: points earned = spend × points-per-currency-unit. The old code
        // divided by pointsPerUnit, which inverted the setting (a higher rate
        // yielded FEWER points, contradicting the field name).
        const pointsEarned = Math.floor(totalAmount.toNumber() * settings.loyaltyPointsPerUnit)
        if (pointsEarned > 0) {
          const updated = await tx.customer.update({
            where: { id: input.customerId },
            data: { loyaltyPoints: { increment: pointsEarned } },
            select: { loyaltyPoints: true },
          })
          loyaltyEarned = pointsEarned
          loyaltyBalanceAfter = updated.loyaltyPoints
        }
      }
    }

    // Mandatory audit log inside transaction
    await tx.auditLog.create({
      data: {
        actorId: cashierId,
        entity: 'invoice',
        entityId: invoice.id,
        action: 'create',
        after: {
          invoiceNumber,
          totalAmount: totalAmount.toString(),
          itemCount: computedItems.length,
          feeAmount: feeAmount.toString(),
          feeBearer: effectiveFeeBearer,
        },
      },
    })

    // Customer-scoped ledger entries — written after invoice creation so we
    // can reference invoiceId, but inside the same transaction so they roll
    // back together with the invoice on failure.
    if (creditBalanceAfter !== null && input.customerId) {
      await tx.auditLog.create({
        data: {
          actorId: cashierId,
          entity: 'customer',
          entityId: input.customerId,
          action: 'credit_used',
          after: {
            invoiceId: invoice.id,
            invoiceNumber,
            amount: creditUsed.toString(),
            newBalance: creditBalanceAfter,
          },
        },
      })
    }
    if (loyaltyEarned > 0 && input.customerId) {
      await tx.auditLog.create({
        data: {
          actorId: cashierId,
          entity: 'customer',
          entityId: input.customerId,
          action: 'loyalty_earned',
          after: {
            invoiceId: invoice.id,
            invoiceNumber,
            points: loyaltyEarned,
            newBalance: loyaltyBalanceAfter,
          },
        },
      })
    }

    return { ...invoice, invoiceNumber }
  })
}

// ─── Return ───────────────────────────────────────────────────────────────────

export async function returnInvoice(
  db: TenantPrismaClient,
  invoiceId: string,
  input: ReturnInvoiceInput,
  actorId: string,
) {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: true,
      customer: { select: { id: true, creditBalance: true } },
    },
  })
  if (!invoice) throw notFound()
  if (invoice.status === 'cancelled') throw badRequest('invoice_cancelled')

  // Validate return quantities don't exceed sold quantities.
  // Service items (variantId === null) cannot be returned via this flow.
  const productItems = invoice.items.filter((i) => i.variantId !== null)

  // ACC-02: cap returns against the CUMULATIVE quantity already returned across
  // every prior return on this invoice — not just against a single request.
  // Without this, two sequential partial returns each pass the per-request check
  // and together restock/refund more than was ever sold.
  const priorReturnItems = await db.returnItem.findMany({
    where: { return: { invoiceId } },
    select: { variantId: true, quantity: true },
  })
  const soldByVariant = new Map<string, number>()
  for (const it of productItems) {
    if (it.variantId) soldByVariant.set(it.variantId, (soldByVariant.get(it.variantId) ?? 0) + it.quantity)
  }
  const returnedByVariant = new Map<string, number>()
  for (const r of priorReturnItems) {
    returnedByVariant.set(r.variantId, (returnedByVariant.get(r.variantId) ?? 0) + r.quantity)
  }
  // Fold this request's own lines together first, so duplicate rows in a single
  // payload are also bounded.
  const requestedByVariant = new Map<string, number>()
  for (const ri of input.items) {
    requestedByVariant.set(ri.variantId, (requestedByVariant.get(ri.variantId) ?? 0) + ri.quantity)
  }
  for (const [variantId, requested] of requestedByVariant) {
    const sold = soldByVariant.get(variantId)
    if (sold == null) throw badRequest(`item_not_in_invoice:${variantId}`)
    const already = returnedByVariant.get(variantId) ?? 0
    if (already + requested > sold) throw badRequest(`return_qty_exceeds_sold:${variantId}`)
  }

  // Calculate return amount proportionally (service items have no stock to restock)
  const returnAmount = roundMoney(
    input.items.reduce((sum, ri) => {
      const invoiceItem = productItems.find((i) => i.variantId === ri.variantId)!
      const itemTotal = toDecimal(invoiceItem.subtotal)
        .plus(toDecimal(invoiceItem.taxAmount))
        .minus(toDecimal(invoiceItem.discountAmount))
      const perUnit = itemTotal.dividedBy(invoiceItem.quantity)
      return sum.plus(perUnit.times(ri.quantity))
    }, ZERO),
  )

  return db.$transaction(async (tx) => {
    const returnRecord = await tx.return.create({
      data: {
        invoiceId,
        processedById: actorId,
        returnType: input.returnType,
        amount: returnAmount,
        reason: input.reason ?? null,
        items: {
          create: input.items.map((ri) => ({
            variantId: ri.variantId,
            quantity: ri.quantity,
            restock: ri.restock,
          })),
        },
      },
      include: { items: true },
    })

    // Restock + log movements
    for (const ri of input.items) {
      if (ri.restock) {
        await tx.stock.updateMany({
          where: { variantId: ri.variantId, branchId: invoice.branchId },
          data: { quantity: { increment: ri.quantity }, updatedAt: new Date() },
        })
        await tx.stockMovement.create({
          data: {
            variantId: ri.variantId,
            branchId: invoice.branchId,
            userId: actorId,
            type: 'return',
            quantity: ri.quantity,
            reference: returnRecord.id,
          },
        })
      }
    }

    // Credit: increment customer balance
    if (input.returnType === 'credit' && invoice.customerId) {
      await tx.customer.update({
        where: { id: invoice.customerId },
        data: { creditBalance: { increment: returnAmount } },
      })
    }

    // Mandatory audit log
    await tx.auditLog.create({
      data: {
        actorId,
        entity: 'invoice',
        entityId: invoiceId,
        action: 'return',
        after: {
          returnId: returnRecord.id,
          returnType: input.returnType,
          amount: returnAmount.toString(),
        },
      },
    })

    return returnRecord
  })
}

// ─── Cancel ───────────────────────────────────────────────────────────────────
// Cancels a completed invoice as if it never happened:
//   - restores stock for every line item
//   - refunds credit if the customer paid partly with credit (from the
//     `credit_used` audit entry written at creation time)
//   - reverses loyalty points if any were earned
//   - marks the invoice cancelled
//
// Refuses if the invoice is already cancelled or has been returned (use the
// return flow for returned invoices — credit refunds already happened there).
export async function cancelInvoice(
  db: TenantPrismaClient,
  invoiceId: string,
  actorId: string,
) {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: { items: true },
  })
  if (!invoice) throw notFound()
  if (invoice.status === 'cancelled') throw badRequest('already_cancelled')
  if (invoice.status === 'returned') throw badRequest('invoice_returned')

  // ACC-01: a fully/partially returned invoice must not also be cancelled — the
  // return flow already restocked and refunded, so cancelling would double both.
  // We key off the existence of return rows rather than an overloaded status
  // (which the revenue reports depend on staying 'completed').
  const returnCount = await db.return.count({ where: { invoiceId } })
  if (returnCount > 0) throw badRequest('invoice_returned')

  return db.$transaction(async (tx) => {
    // ACC-06: release the coupon hold so a limited-use coupon isn't consumed by
    // a sale that never stood. Floor at 0 defensively.
    if (invoice.couponId) {
      await tx.$executeRaw`
        UPDATE coupons SET used_count = GREATEST(used_count - 1, 0)
        WHERE id = ${invoice.couponId}::uuid
      `
    }
    // 1. Restore stock + log movements for product items only (service items have no stock)
    for (const item of invoice.items) {
      if (!item.variantId) continue // skip service line items
      await tx.stock.updateMany({
        where: { variantId: item.variantId, branchId: invoice.branchId },
        data: { quantity: { increment: item.quantity }, updatedAt: new Date() },
      })
      await tx.stockMovement.create({
        data: {
          variantId: item.variantId,
          branchId: invoice.branchId,
          userId: actorId,
          type: 'cancellation',
          quantity: item.quantity,
          reference: invoiceId,
        },
      })
    }

    // 2. Refund credit + reverse loyalty by reading the customer audit entries
    //    we wrote on invoice creation. Older invoices created before that
    //    instrumentation simply skip these steps.
    let refundedCredit = '0'
    let reversedLoyalty = 0
    if (invoice.customerId) {
      const customerAudits = await tx.auditLog.findMany({
        where: {
          entity: 'customer',
          entityId: invoice.customerId,
          action: { in: ['credit_used', 'loyalty_earned'] },
        },
      })
      type AuditAfter = { invoiceId?: string; amount?: string; points?: number }
      const creditEntry = customerAudits.find(
        (e) => e.action === 'credit_used' && (e.after as AuditAfter | null)?.invoiceId === invoiceId,
      )
      const loyaltyEntry = customerAudits.find(
        (e) => e.action === 'loyalty_earned' && (e.after as AuditAfter | null)?.invoiceId === invoiceId,
      )

      if (creditEntry) {
        const amount = String((creditEntry.after as AuditAfter).amount ?? '0')
        const updated = await tx.customer.update({
          where: { id: invoice.customerId },
          data: { creditBalance: { increment: toDecimal(amount) } },
          select: { creditBalance: true },
        })
        refundedCredit = amount
        await tx.auditLog.create({
          data: {
            actorId,
            entity: 'customer',
            entityId: invoice.customerId,
            action: 'credit_add',
            after: {
              invoiceId,
              invoiceNumber: invoice.invoiceNumber,
              amount,
              newBalance: updated.creditBalance.toString(),
              note: 'استرداد رصيد بسبب إلغاء الفاتورة',
            },
          },
        })
      }
      if (loyaltyEntry) {
        const points = Number((loyaltyEntry.after as AuditAfter).points ?? 0)
        if (points > 0) {
          const updated = await tx.customer.update({
            where: { id: invoice.customerId },
            data: { loyaltyPoints: { decrement: points } },
            select: { loyaltyPoints: true },
          })
          reversedLoyalty = points
          await tx.auditLog.create({
            data: {
              actorId,
              entity: 'customer',
              entityId: invoice.customerId,
              action: 'loyalty_reversed',
              after: {
                invoiceId,
                invoiceNumber: invoice.invoiceNumber,
                points,
                newBalance: updated.loyaltyPoints,
                note: 'إلغاء نقاط بسبب إلغاء الفاتورة',
              },
            },
          })
        }
      }
    }

    // 3. Mark the invoice cancelled
    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: 'cancelled' },
    })

    // 4. Audit
    await tx.auditLog.create({
      data: {
        actorId,
        entity: 'invoice',
        entityId: invoiceId,
        action: 'cancel',
        before: { status: invoice.status },
        after: {
          status: 'cancelled',
          itemCount: invoice.items.length,
          refundedCredit,
          reversedLoyalty,
        },
      },
    })

    return updated
  })
}
