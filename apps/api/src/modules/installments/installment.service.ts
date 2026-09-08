import dayjs from 'dayjs'
import type { TenantPrismaClient } from '@hesba/database'
import { Decimal, toDecimal, roundMoney, ZERO } from '../../shared/utils/decimal'
import { calculateFee } from '../../shared/utils/fee'
import type { CreateInstallmentInput, RecordPaymentInput } from './installment.schema'

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

// ─── Monthly amount formula (doc §8) ─────────────────────────────────────────

function calcMonthlyAmount(
  total: Decimal,
  downPayment: Decimal,
  count: number,
  interestRate: Decimal,
): Decimal {
  const principal = total.minus(downPayment)
  const interest = principal
    .times(interestRate.dividedBy(100))
    .times(new Decimal(count).dividedBy(12))
  return roundMoney(principal.plus(interest).dividedBy(count))
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listContracts(
  db: TenantPrismaClient,
  opts: { page: number; limit: number; status?: string; customerId?: string; branchId?: string },
) {
  const where = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.customerId ? { customerId: opts.customerId } : {}),
    ...(opts.branchId ? { invoice: { branchId: opts.branchId } } : {}),
  }

  const [total, items] = await Promise.all([
    db.installmentContract.count({ where }),
    db.installmentContract.findMany({
      where,
      include: {
        customer: { select: { id: true, fullName: true, phone: true } },
        approvedBy: { select: { id: true, fullName: true } },
        currency: { select: { id: true, code: true, name: true } },
        invoice: { select: { id: true, totalAmount: true, branchId: true, status: true } },
        _count: { select: { payments: true } },
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

export async function getContract(db: TenantPrismaClient, contractId: string) {
  const contract = await db.installmentContract.findUnique({
    where: { id: contractId },
    include: {
      customer: true,
      approvedBy: { select: { id: true, fullName: true } },
      currency: true,
      invoice: {
        include: {
          items: {
            include: {
              variant: { include: { product: { select: { id: true, name: true } } } },
            },
          },
          branch: { select: { id: true, name: true } },
          paymentMethod: { select: { id: true, name: true } },
        },
      },
      payments: { orderBy: { installmentNumber: 'asc' } },
    },
  })
  if (!contract) throw notFound()
  return contract
}

// ─── Create contract ──────────────────────────────────────────────────────────

export async function createContract(
  db: TenantPrismaClient,
  input: CreateInstallmentInput,
  cashierId: string,
) {
  // Validate payment method
  const paymentMethod = await db.paymentMethod.findUnique({
    where: { id: input.paymentMethodId },
  })
  if (!paymentMethod || !paymentMethod.isActive) throw badRequest('payment_method_not_found')

  // Validate currency and lock exchange rate
  const currency = await db.currency.findUnique({ where: { id: input.currencyId } })
  if (!currency) throw badRequest('currency_not_found')

  // Validate customer
  const customer = await db.customer.findUnique({ where: { id: input.customerId } })
  if (!customer) throw badRequest('customer_not_found')

  // Validate variants
  const variantIds = input.items.map((i) => i.variantId)
  const variants = await db.productVariant.findMany({
    where: { id: { in: variantIds }, isActive: true },
    include: { product: { include: { taxRate: true } } },
  })
  const variantMap = new Map(variants.map((v) => [v.id, v]))
  for (const item of input.items) {
    if (!variantMap.has(item.variantId)) throw badRequest(`variant_not_found:${item.variantId}`)
  }

  // Calculate invoice totals (same as regular invoice, no stock check yet)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // LOG-01: batch active product-discount lookups in one query (mirrors the POS
  // path) instead of a findFirst per line item.
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

    const productDiscount = discountByProduct.get(variant.productId) ?? null

    let itemDiscount = ZERO
    if (productDiscount) {
      itemDiscount =
        productDiscount.discountType === 'percentage'
          ? roundMoney(unitPrice.times(item.quantity).times(toDecimal(productDiscount.discountValue)).dividedBy(100))
          : roundMoney(toDecimal(productDiscount.discountValue).times(item.quantity))
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

  const { feeAmount, feeAddedToTotal } = calculateFee(
    subtotal.plus(taxTotal),
    paymentMethod,
  )
  const totalAmount = roundMoney(
    feeAddedToTotal
      ? subtotal.plus(taxTotal).plus(feeAmount)
      : subtotal.plus(taxTotal),
  )

  const downPayment = toDecimal(input.downPayment)
  if (downPayment.greaterThan(totalAmount)) throw badRequest('down_payment_exceeds_total')

  const interestRate = toDecimal(input.interestRate)
  const monthlyAmount = calcMonthlyAmount(totalAmount, downPayment, input.installmentsCount, interestRate)

  // Compute the exact contract total from principal + interest *before*
  // monthly rounding, so the contract amount the customer signs equals the
  // sum of payments they actually owe. Without this, `monthly × count` drifts
  // by ±cents from the real total. The last installment will absorb the
  // rounding remainder at schedule generation time (see approveContract).
  const principal = totalAmount.minus(downPayment)
  const interest = principal
    .times(interestRate.dividedBy(100))
    .times(new Decimal(input.installmentsCount).dividedBy(12))
  const contractTotal = roundMoney(downPayment.plus(principal).plus(interest))

  const exchangeRate = toDecimal(currency.rateToBase)

  return db.$transaction(async (tx) => {
    // Create pending invoice (stock NOT touched)
    const invoice = await tx.invoice.create({
      data: {
        branchId: input.branchId,
        customerId: input.customerId,
        cashierId,
        paymentMethodId: input.paymentMethodId,
        currencyId: input.currencyId,
        exchangeRate,
        subtotal,
        discountAmount: ZERO,
        taxTotal,
        feePercentage: toDecimal(paymentMethod.feePercentage),
        feeFixed: toDecimal(paymentMethod.feeFixed),
        feeAmount,
        feeBearer: paymentMethod.feeBearer,
        feeAddedToTotal,
        totalAmount,
        paidAmount: ZERO,
        status: 'pending',
        notes: input.notes ?? null,
      },
    })

    // Create invoice items
    for (const item of computedItems) {
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
    }

    // Create installment contract
    const contract = await tx.installmentContract.create({
      data: {
        invoiceId: invoice.id,
        customerId: input.customerId,
        currencyId: input.currencyId,
        exchangeRateAtContract: exchangeRate,
        downPayment,
        installmentsCount: input.installmentsCount,
        monthlyAmount,
        interestRate,
        totalAmount: contractTotal,
        firstDueDate: new Date(input.firstDueDate),
        status: 'pending_approval',
        guarantorName: input.guarantorName ?? null,
        guarantorPhone: input.guarantorPhone ?? null,
        signatureUrl: input.signatureUrl ?? null,
        notes: input.notes ?? null,
      },
    })

    await tx.auditLog.create({
      data: {
        actorId: cashierId,
        entity: 'installment_contract',
        entityId: contract.id,
        action: 'create',
        after: { totalAmount: totalAmount.toString(), installmentsCount: input.installmentsCount },
      },
    })

    return { contract, invoice }
  })
}

// ─── Approve ──────────────────────────────────────────────────────────────────

export async function approveContract(
  db: TenantPrismaClient,
  contractId: string,
  actorId: string,
) {
  const contract = await db.installmentContract.findUnique({
    where: { id: contractId },
    include: {
      invoice: { include: { items: true } },
    },
  })
  if (!contract) throw notFound()
  if (contract.status !== 'pending_approval') throw badRequest('contract_not_pending')

  return db.$transaction(async (tx) => {
    // Update contract
    await tx.installmentContract.update({
      where: { id: contractId },
      data: { status: 'active', approvedById: actorId },
    })

    // Complete invoice with down payment as paidAmount
    await tx.invoice.update({
      where: { id: contract.invoiceId },
      data: { status: 'completed', paidAmount: contract.downPayment },
    })

    // Atomic stock decrement for product items only (service items have no stock)
    for (const item of contract.invoice.items) {
      if (!item.variantId) continue // skip service line items
      const result = await tx.stock.updateMany({
        where: {
          variantId: item.variantId,
          branchId: contract.invoice.branchId,
          quantity: { gte: item.quantity },
        },
        data: { quantity: { decrement: item.quantity }, updatedAt: new Date() },
      })

      if (result.count === 0) {
        throw badRequest(`insufficient_stock:${item.variantId}`)
      }

      await tx.stockMovement.create({
        data: {
          variantId: item.variantId,
          branchId: contract.invoice.branchId,
          userId: actorId,
          type: 'out',
          quantity: -item.quantity,
          reference: contract.invoiceId,
        },
      })
    }

    // Generate payment schedule. The first N-1 installments use the rounded
    // `monthlyAmount`; the final installment absorbs the rounding remainder
    // so `sum(schedule) + downPayment == contractTotal` to the cent. Without
    // this, the customer's signed contract and the schedule sum drift by a
    // small amount and the contract never closes cleanly.
    const firstDue = dayjs(contract.firstDueDate)
    const monthly = toDecimal(contract.monthlyAmount)
    const totalScheduled = toDecimal(contract.totalAmount).minus(toDecimal(contract.downPayment))
    const lastInstallment = roundMoney(
      totalScheduled.minus(monthly.times(contract.installmentsCount - 1)),
    )
    for (let i = 0; i < contract.installmentsCount; i++) {
      const amount = i === contract.installmentsCount - 1 ? lastInstallment : monthly
      await tx.installmentPayment.create({
        data: {
          contractId,
          installmentNumber: i + 1,
          amountPaid: amount,
          dueDate: firstDue.add(i, 'month').toDate(),
          status: 'pending',
        },
      })
    }

    await tx.auditLog.create({
      data: {
        actorId,
        entity: 'installment_contract',
        entityId: contractId,
        action: 'approve',
        after: { status: 'active', installmentsCount: contract.installmentsCount },
      },
    })

    return db.installmentContract.findUnique({
      where: { id: contractId },
      include: { payments: { orderBy: { installmentNumber: 'asc' } } },
    })
  })
}

// ─── Reject ───────────────────────────────────────────────────────────────────

export async function rejectContract(
  db: TenantPrismaClient,
  contractId: string,
  actorId: string,
) {
  const contract = await db.installmentContract.findUnique({ where: { id: contractId } })
  if (!contract) throw notFound()
  if (contract.status !== 'pending_approval') throw badRequest('contract_not_pending')

  return db.$transaction(async (tx) => {
    await tx.installmentContract.update({
      where: { id: contractId },
      data: { status: 'cancelled' },
    })
    await tx.invoice.update({
      where: { id: contract.invoiceId },
      data: { status: 'cancelled' },
    })
    await tx.auditLog.create({
      data: {
        actorId,
        entity: 'installment_contract',
        entityId: contractId,
        action: 'reject',
        after: { status: 'cancelled' },
      },
    })
  })
}

// ─── Record payment ───────────────────────────────────────────────────────────

export async function recordPayment(
  db: TenantPrismaClient,
  contractId: string,
  paymentId: string,
  input: RecordPaymentInput,
  actorId: string,
) {
  const payment = await db.installmentPayment.findFirst({
    where: { id: paymentId, contractId },
  })
  if (!payment) throw notFound()
  if (payment.status === 'paid') throw badRequest('already_paid')

  const unpaidPrevious = await db.installmentPayment.count({
    where: { contractId, installmentNumber: { lt: payment.installmentNumber }, status: { not: 'paid' } },
  })
  if (unpaidPrevious > 0) throw badRequest('previous_installments_not_paid')

  await db.$transaction(async (tx) => {
    const paidDate = input.paidDate ? new Date(input.paidDate) : new Date()

    await tx.installmentPayment.update({
      where: { id: paymentId },
      data: {
        status: 'paid',
        paidDate,
        receivedById: actorId,
        receiptUrl: input.receiptUrl ?? null,
      },
    })

    // Check if all payments done → complete contract
    const pendingCount = await tx.installmentPayment.count({
      where: { contractId, status: { not: 'paid' }, id: { not: paymentId } },
    })

    if (pendingCount === 0) {
      await tx.installmentContract.update({
        where: { id: contractId },
        data: { status: 'completed' },
      })
    }

    await tx.auditLog.create({
      data: {
        actorId,
        entity: 'installment_payment',
        entityId: paymentId,
        action: 'record_payment',
        after: { paidDate: paidDate.toISOString(), status: 'paid' },
      },
    })
  })

  return db.installmentPayment.findUnique({ where: { id: paymentId } })
}
