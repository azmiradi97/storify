import type { TenantPrismaClient } from '@hesba/database'
import { redis } from '../../config/redis'
import { toDecimal } from '../../shared/utils/decimal'

// ─── Date helpers ─────────────────────────────────────────────────────────────

function todayRange() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

function buildDateFilter(from?: string, to?: string) {
  if (!from && !to) return undefined
  return {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export async function getDashboard(db: TenantPrismaClient, tenantId: string, branchId?: string) {
  const cacheKey = `dashboard:${tenantId}:${branchId ?? 'all'}`
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached) as object

  const { start, end } = todayRange()
  const branchFilter = branchId ? { branchId } : {}

  const [
    todaySalesAgg,
    todayInvoiceCount,
    pendingInstallments,
    overduePayments,
    lowStockCount,
    pendingExpenses,
    todayFeeExpenses,
    todayServicesAgg,
  ] = await Promise.all([
    // Today's revenue
    db.invoice.aggregate({
      where: { ...branchFilter, status: 'completed', createdAt: { gte: start, lte: end } },
      _sum: { totalAmount: true },
      _count: true,
    }),
    // Invoice count today
    db.invoice.count({
      where: { ...branchFilter, status: 'completed', createdAt: { gte: start, lte: end } },
    }),
    // Pending installment approvals
    db.installmentContract.count({ where: { status: 'pending_approval' } }),
    // Overdue installment payments
    db.installmentPayment.count({
      where: { status: 'pending', dueDate: { lt: new Date() } },
    }),
    // Low-stock variants
    db.stock.count({
      where: {
        ...branchFilter,
        quantity: { lte: db.stock.fields.minQuantity },
      },
    }),
    // Pending expense approvals
    db.expense.count({ where: { ...branchFilter, status: 'pending' } }),
    // Today's merchant fee costs
    db.paymentFeeExpense.aggregate({
      where: { ...branchFilter, createdAt: { gte: start, lte: end } },
      _sum: { feeAmount: true },
    }),
    // Today's work-order revenue (services). Filtered by paidAt so payments
    // *received* today land here, regardless of when the ticket was opened.
    // Tenants without the services feature simply get 0 rows back — the query
    // is harmless on empty tables.
    db.workOrder.aggregate({
      where: { ...branchFilter, paidAt: { gte: start, lte: end } },
      _sum: { paidAmount: true },
      _count: true,
    }).catch(() => ({ _sum: { paidAmount: null }, _count: 0 } as const)),
  ])

  const result = {
    today: {
      revenue: toDecimal(todaySalesAgg._sum.totalAmount ?? 0).toNumber(),
      invoiceCount: todayInvoiceCount,
      feeExpenses: toDecimal(todayFeeExpenses._sum.feeAmount ?? 0).toNumber(),
      servicesRevenue: toDecimal(todayServicesAgg._sum.paidAmount ?? 0).toNumber(),
      servicesCount: todayServicesAgg._count as number,
    },
    pending: {
      installmentApprovals: pendingInstallments,
      overdueInstallmentPayments: overduePayments,
      expenseApprovals: pendingExpenses,
    },
    lowStockAlerts: lowStockCount,
  }

  await redis.set(cacheKey, JSON.stringify(result), 'EX', 120) // 2 min TTL
  return result
}

// ─── Sales report ─────────────────────────────────────────────────────────────

export async function getSalesReport(
  db: TenantPrismaClient,
  opts: {
    from?: string
    to?: string
    branchId?: string
    cashierId?: string
    paymentMethodId?: string
    groupBy: 'day' | 'week' | 'month'
  },
) {
  const dateFilter = buildDateFilter(opts.from, opts.to)
  const where = {
    status: 'completed',
    ...(opts.branchId ? { branchId: opts.branchId } : {}),
    ...(opts.cashierId ? { cashierId: opts.cashierId } : {}),
    ...(opts.paymentMethodId ? { paymentMethodId: opts.paymentMethodId } : {}),
    ...(dateFilter ? { createdAt: dateFilter } : {}),
  }

  const [totals, byPaymentMethod, periodRows, invoices] = await Promise.all([
    db.invoice.aggregate({
      where,
      _sum: { totalAmount: true, subtotal: true, taxTotal: true, discountAmount: true, feeAmount: true },
      _count: true,
    }),
    db.invoice.groupBy({
      by: ['paymentMethodId'],
      where,
      _sum: { totalAmount: true, feeAmount: true },
      _count: true,
    }),
    // DATA-01: the time-series must cover EVERY matching invoice, not just the
    // most recent 500 used for the drill-down table below — otherwise the chart
    // silently under-reports and won't sum to the headline total. Select only
    // the two columns the buckets need so this stays cheap.
    db.invoice.findMany({ where, select: { createdAt: true, totalAmount: true } }),
    db.invoice.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        totalAmount: true,
        subtotal: true,
        taxTotal: true,
        discountAmount: true,
        feeAmount: true,
        feeBearer: true,
        paymentMethod: { select: { id: true, name: true } },
        cashier: { select: { id: true, fullName: true } },
        branch: { select: { id: true, name: true } },
        customer: { select: { id: true, fullName: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
  ])

  // Resolve payment method names for groupBy result
  const pmIds = byPaymentMethod.map((r) => r.paymentMethodId)
  const paymentMethods = await db.paymentMethod.findMany({
    where: { id: { in: pmIds } },
    select: { id: true, name: true, type: true },
  })
  const pmMap = new Map(paymentMethods.map((p) => [p.id, p]))

  // Group invoices by period (over the FULL matching set — see DATA-01 note)
  const grouped: Record<string, { period: string; revenue: number; count: number }> = {}
  for (const inv of periodRows) {
    const d = inv.createdAt
    let period: string
    if (opts.groupBy === 'month') {
      period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    } else if (opts.groupBy === 'week') {
      // ISO week
      const jan4 = new Date(d.getFullYear(), 0, 4)
      const weekNum = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7)
      period = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
    } else {
      period = d.toISOString().slice(0, 10)
    }
    if (!grouped[period]) grouped[period] = { period, revenue: 0, count: 0 }
    grouped[period].revenue += toDecimal(inv.totalAmount).toNumber()
    grouped[period].count += 1
  }

  return {
    summary: {
      totalRevenue: toDecimal(totals._sum.totalAmount ?? 0).toNumber(),
      subtotal: toDecimal(totals._sum.subtotal ?? 0).toNumber(),
      taxTotal: toDecimal(totals._sum.taxTotal ?? 0).toNumber(),
      discountTotal: toDecimal(totals._sum.discountAmount ?? 0).toNumber(),
      feeTotal: toDecimal(totals._sum.feeAmount ?? 0).toNumber(),
      invoiceCount: totals._count,
    },
    byPaymentMethod: byPaymentMethod.map((r) => ({
      paymentMethod: pmMap.get(r.paymentMethodId) ?? { id: r.paymentMethodId },
      totalRevenue: toDecimal(r._sum.totalAmount ?? 0).toNumber(),
      feeTotal: toDecimal(r._sum.feeAmount ?? 0).toNumber(),
      count: r._count,
    })),
    byPeriod: Object.values(grouped).sort((a, b) => a.period.localeCompare(b.period)),
    invoices,
  }
}

// ─── Stock report ─────────────────────────────────────────────────────────────

export async function getStockReport(
  db: TenantPrismaClient,
  opts: { branchId?: string; lowStockOnly: boolean },
) {
  const branchFilter = opts.branchId ? { branchId: opts.branchId } : {}

  const stock = await db.stock.findMany({
    where: {
      ...branchFilter,
      // LOG-02: push the low-stock predicate into SQL (column-vs-column via a
      // Prisma field reference) instead of fetching the whole table and
      // filtering in memory.
      ...(opts.lowStockOnly ? { quantity: { lte: db.stock.fields.minQuantity } } : {}),
    },
    include: {
      variant: {
        include: {
          product: { select: { id: true, name: true, category: { select: { id: true, name: true } } } },
        },
      },
      branch: { select: { id: true, name: true } },
    },
    orderBy: [{ branchId: 'asc' }, { variant: { product: { name: 'asc' } } }],
  })

  const filtered = stock

  const totalVariants = filtered.length
  const lowStockCount = filtered.filter((s) => s.quantity <= s.minQuantity).length
  const totalValue = filtered.reduce(
    (sum, s) => sum + toDecimal(s.variant.costPrice).times(s.quantity).toNumber(),
    0,
  )

  return {
    summary: { totalVariants, lowStockCount, totalStockValue: totalValue },
    items: filtered.map((s) => ({
      variantId: s.variantId,
      branchId: s.branchId,
      branch: s.branch,
      product: s.variant.product,
      sku: s.variant.sku,
      quantity: s.quantity,
      minQuantity: s.minQuantity,
      isLowStock: s.quantity <= s.minQuantity,
      costPrice: toDecimal(s.variant.costPrice).toNumber(),
      stockValue: toDecimal(s.variant.costPrice).times(s.quantity).toNumber(),
    })),
  }
}

// ─── Installments report ──────────────────────────────────────────────────────

export async function getInstallmentsReport(
  db: TenantPrismaClient,
  opts: { branchId?: string; status?: string },
) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const branchFilter = opts.branchId ? { invoice: { branchId: opts.branchId } } : {}
  const statusFilter = opts.status ? { status: opts.status } : {}

  const [active, overdue, completed, pendingApproval, totalReceivables] = await Promise.all([
    db.installmentContract.count({ where: { ...branchFilter, status: 'active' } }),
    db.installmentPayment.count({ where: { status: 'pending', dueDate: { lt: today } } }),
    db.installmentContract.count({ where: { ...branchFilter, status: 'completed' } }),
    db.installmentContract.count({ where: { ...branchFilter, status: 'pending_approval' } }),
    db.installmentPayment.aggregate({
      where: { status: 'pending', contract: branchFilter },
      _sum: { amountPaid: true },
    }),
  ])

  const contracts = await db.installmentContract.findMany({
    where: { ...branchFilter, ...statusFilter },
    include: {
      customer: { select: { id: true, fullName: true, phone: true } },
      invoice: { select: { id: true, totalAmount: true, branchId: true, branch: { select: { name: true } } } },
      payments: { where: { status: 'pending' }, select: { amountPaid: true, dueDate: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  return {
    summary: {
      active,
      overdue,
      completed,
      pendingApproval,
      totalReceivables: toDecimal(totalReceivables._sum.amountPaid ?? 0).toNumber(),
    },
    contracts: contracts.map((c) => ({
      ...c,
      overduePaymentsCount: c.payments.filter((p) => p.dueDate < today).length,
      nextDue: c.payments.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0]?.dueDate ?? null,
    })),
  }
}

// ─── Fees report ──────────────────────────────────────────────────────────────

export async function getFeesReport(
  db: TenantPrismaClient,
  opts: { from?: string; to?: string; branchId?: string },
) {
  const dateFilter = buildDateFilter(opts.from, opts.to)
  const branchFilter = opts.branchId ? { branchId: opts.branchId } : {}
  const where = {
    ...branchFilter,
    ...(dateFilter ? { createdAt: dateFilter } : {}),
  }

  const [merchantFees, invoiceFees] = await Promise.all([
    // Merchant-bearing fees (recorded as expenses)
    db.paymentFeeExpense.groupBy({
      by: ['paymentMethodId'],
      where,
      _sum: { feeAmount: true },
      _count: true,
    }),
    // All fees on invoices (customer + merchant bearing)
    db.invoice.groupBy({
      by: ['paymentMethodId', 'feeBearer'],
      where: { ...branchFilter, ...(dateFilter ? { createdAt: dateFilter } : {}), status: 'completed' },
      _sum: { feeAmount: true, totalAmount: true },
      _count: true,
    }),
  ])

  const pmIds = [...new Set([...merchantFees.map((r) => r.paymentMethodId), ...invoiceFees.map((r) => r.paymentMethodId)])]
  const paymentMethods = await db.paymentMethod.findMany({
    where: { id: { in: pmIds } },
    select: { id: true, name: true, type: true },
  })
  const pmMap = new Map(paymentMethods.map((p) => [p.id, p]))

  const totalMerchantFees = merchantFees.reduce((s, r) => s + toDecimal(r._sum.feeAmount ?? 0).toNumber(), 0)
  const totalCustomerFees = invoiceFees
    .filter((r) => r.feeBearer === 'customer')
    .reduce((s, r) => s + toDecimal(r._sum.feeAmount ?? 0).toNumber(), 0)

  return {
    summary: {
      totalMerchantFees,
      totalCustomerFees,
      totalFees: totalMerchantFees + totalCustomerFees,
    },
    byPaymentMethod: invoiceFees.map((r) => ({
      paymentMethod: pmMap.get(r.paymentMethodId) ?? { id: r.paymentMethodId },
      feeBearer: r.feeBearer,
      totalFees: toDecimal(r._sum.feeAmount ?? 0).toNumber(),
      invoiceCount: r._count,
    })),
    merchantFeeDetails: merchantFees.map((r) => ({
      paymentMethod: pmMap.get(r.paymentMethodId) ?? { id: r.paymentMethodId },
      totalFeeExpense: toDecimal(r._sum.feeAmount ?? 0).toNumber(),
      transactionCount: r._count,
    })),
  }
}

// ─── Profit & Loss ────────────────────────────────────────────────────────────

export async function getProfitLoss(
  db: TenantPrismaClient,
  opts: { from?: string; to?: string; branchId?: string },
) {
  const dateFilter = buildDateFilter(opts.from, opts.to)
  const branchFilter = opts.branchId ? { branchId: opts.branchId } : {}
  const invoiceWhere = {
    ...branchFilter,
    status: 'completed',
    ...(dateFilter ? { createdAt: dateFilter } : {}),
  }

  // Revenue
  const revenueAgg = await db.invoice.aggregate({
    where: invoiceWhere,
    _sum: { totalAmount: true, taxTotal: true, discountAmount: true },
    _count: true,
  })

  // Work-order revenue collected in the same window (by paidAt). Counted as
  // top-line revenue alongside invoices because work orders don't go through
  // the Invoice table in v1. NOTE: paidAmount on a work order is the cumulative
  // amount paid; for tickets with multiple payments spread across days, the
  // full cumulative paid amount is attributed to the day of the LAST payment.
  // Acceptable approximation for now — proper per-payment ledger is Phase 2.
  const woRevenueAgg = await db.workOrder.aggregate({
    where: {
      ...branchFilter,
      ...(dateFilter ? { paidAt: dateFilter } : { paidAt: { not: null } }),
    },
    _sum: { paidAmount: true },
    _count: true,
  }).catch(() => ({ _sum: { paidAmount: null }, _count: 0 } as const))

  // COGS — cost × quantity for all sold items in the period. ACC-03: prefer the
  // cost snapshotted at sale time; fall back to the live variant cost only for
  // rows created before migration 017 (which have no snapshot).
  const soldItems = await db.invoiceItem.findMany({
    where: { invoice: invoiceWhere },
    select: { quantity: true, costAtSale: true, variant: { select: { costPrice: true } } },
  })
  // Service items (variantId === null) have no product cost — skip them.
  const cogs = soldItems.reduce((sum, item) => {
    const unitCost = item.costAtSale ?? item.variant?.costPrice ?? null
    return unitCost != null ? sum + toDecimal(unitCost).times(item.quantity).toNumber() : sum
  }, 0)

  // Approved expenses
  const expenseAgg = await db.expense.aggregate({
    where: { ...branchFilter, status: 'approved', ...(dateFilter ? { expenseDate: dateFilter } : {}) },
    _sum: { amount: true },
  })

  // Payment fee expenses (merchant-bearing fees)
  const feeExpenseAgg = await db.paymentFeeExpense.aggregate({
    where: { ...branchFilter, ...(dateFilter ? { createdAt: dateFilter } : {}) },
    _sum: { feeAmount: true },
  })

  // Returns (refunds reduce revenue)
  const returnAgg = await db.return.aggregate({
    where: { invoice: invoiceWhere, returnType: 'refund' },
    _sum: { amount: true },
  })

  const invoiceRevenue = toDecimal(revenueAgg._sum.totalAmount ?? 0).toNumber()
  const servicesRevenue = toDecimal(woRevenueAgg._sum.paidAmount ?? 0).toNumber()
  const revenue = invoiceRevenue + servicesRevenue
  const refunds = toDecimal(returnAgg._sum.amount ?? 0).toNumber()
  const netRevenue = revenue - refunds
  const grossProfit = netRevenue - cogs
  const operatingExpenses = toDecimal(expenseAgg._sum.amount ?? 0).toNumber()
  const feeExpenses = toDecimal(feeExpenseAgg._sum.feeAmount ?? 0).toNumber()
  const netProfit = grossProfit - operatingExpenses - feeExpenses

  return {
    revenue,
    invoiceRevenue,
    servicesRevenue,
    refunds,
    netRevenue,
    cogs,
    grossProfit,
    grossMarginPct: netRevenue > 0 ? Number(((grossProfit / netRevenue) * 100).toFixed(2)) : 0,
    operatingExpenses,
    feeExpenses,
    totalExpenses: operatingExpenses + feeExpenses,
    netProfit,
    netMarginPct: netRevenue > 0 ? Number(((netProfit / netRevenue) * 100).toFixed(2)) : 0,
    invoiceCount: revenueAgg._count,
    workOrderCount: woRevenueAgg._count as number,
  }
}

// ─── Returns analytics ───────────────────────────────────────────────────────
// Aggregates the returns table to help admins spot trends:
//  • totals + refund/credit split
//  • bucketed time series for the chart
//  • most-cited reasons (raw text — light grouping; future work: normalize)
//  • most-returned products (joins through return_items + variants)

export async function getReturnsReport(
  db: TenantPrismaClient,
  opts: { from?: string; to?: string; groupBy?: 'day' | 'week' | 'month' },
) {
  const dateFilter = buildDateFilter(opts.from, opts.to)
  const where = dateFilter ? { createdAt: dateFilter } : {}
  const groupBy = opts.groupBy ?? 'day'

  const [totals, byType, returns, topItemsRaw] = await Promise.all([
    db.return.aggregate({ where, _sum: { amount: true }, _count: true }),
    db.return.groupBy({
      by: ['returnType'],
      where,
      _sum: { amount: true },
      _count: true,
    }),
    db.return.findMany({
      where,
      select: { id: true, amount: true, reason: true, returnType: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 2000, // safety cap; charts/aggregations work fine within this
    }),
    db.returnItem.groupBy({
      by: ['variantId'],
      where: { return: where },
      _sum: { quantity: true },
      _count: true,
      orderBy: { _sum: { quantity: 'desc' } },
      take: 10,
    }),
  ])

  // Bucket by period for the time-series chart.
  const periodKey = (d: Date) => {
    if (groupBy === 'month') return d.toISOString().slice(0, 7) // YYYY-MM
    if (groupBy === 'week') {
      // ISO-week start (Mon). Cheap floor; not locale-aware but matches sales chart.
      const monday = new Date(d)
      const day = monday.getUTCDay() || 7
      if (day !== 1) monday.setUTCDate(monday.getUTCDate() - (day - 1))
      return monday.toISOString().slice(0, 10)
    }
    return d.toISOString().slice(0, 10) // YYYY-MM-DD
  }
  const periodMap = new Map<string, { period: string; amount: number; count: number }>()
  for (const r of returns) {
    const k = periodKey(r.createdAt)
    const entry = periodMap.get(k) ?? { period: k, amount: 0, count: 0 }
    entry.amount += Number(r.amount)
    entry.count++
    periodMap.set(k, entry)
  }
  const byPeriod = Array.from(periodMap.values()).sort((a, b) => a.period.localeCompare(b.period))

  // Top reasons — group by raw text, drop empty / null.
  const reasonMap = new Map<string, { reason: string; count: number; amount: number }>()
  for (const r of returns) {
    const reason = (r.reason ?? '').trim()
    if (!reason) continue
    const entry = reasonMap.get(reason) ?? { reason, count: 0, amount: 0 }
    entry.count++
    entry.amount += Number(r.amount)
    reasonMap.set(reason, entry)
  }
  const topReasons = Array.from(reasonMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Resolve variant names for the top-items output.
  const variantIds = topItemsRaw.map((r) => r.variantId)
  const variants = await db.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, sku: true, product: { select: { name: true } } },
  })
  const variantMap = new Map(variants.map((v) => [v.id, v]))
  const topItems = topItemsRaw.map((r) => {
    const v = variantMap.get(r.variantId)
    return {
      variantId: r.variantId,
      sku: v?.sku ?? r.variantId.slice(0, 8),
      productName: v?.product.name ?? '—',
      totalReturnedQty: Number(r._sum?.quantity ?? 0),
      occurrences: r._count,
    }
  })

  const pickType = (t: string) => byType.find((b) => b.returnType === t)
  return {
    summary: {
      totalAmount: Number(totals._sum.amount ?? 0),
      totalCount: totals._count,
      refundAmount: Number(pickType('refund')?._sum.amount ?? 0),
      refundCount: pickType('refund')?._count ?? 0,
      creditAmount: Number(pickType('credit')?._sum.amount ?? 0),
      creditCount: pickType('credit')?._count ?? 0,
    },
    byPeriod,
    topReasons,
    topItems,
  }
}

// ─── Day close ────────────────────────────────────────────────────────────────

export async function getDayClose(db: TenantPrismaClient, date: string, branchId?: string) {
  const start = new Date(`${date}T00:00:00.000`)
  const end = new Date(`${date}T23:59:59.999`)
  const branchFilter = branchId ? { branchId } : {}

  const [posTotals, posByPM, instPayments, woTotals, woByPM] = await Promise.all([
    db.invoice.aggregate({
      where: { status: 'completed', createdAt: { gte: start, lte: end }, ...branchFilter },
      _sum: { totalAmount: true },
      _count: true,
    }),
    db.invoice.groupBy({
      by: ['paymentMethodId'],
      where: { status: 'completed', createdAt: { gte: start, lte: end }, ...branchFilter },
      _sum: { totalAmount: true },
      _count: true,
    }),
    db.installmentPayment.aggregate({
      where: { paidDate: { gte: start, lte: end }, status: 'paid' },
      _sum: { amountPaid: true },
      _count: { id: true },
    }),
    // Work-order revenue collected today (by paidAt).
    db.workOrder.aggregate({
      where: { paidAt: { gte: start, lte: end }, ...branchFilter },
      _sum: { paidAmount: true },
      _count: true,
    }).catch(() => ({ _sum: { paidAmount: null }, _count: 0 } as const)),
    db.workOrder.groupBy({
      by: ['paymentMethodId'],
      where: { paidAt: { gte: start, lte: end }, ...branchFilter, paymentMethodId: { not: null } },
      _sum: { paidAmount: true },
      _count: true,
    }).catch(() => [] as Array<{ paymentMethodId: string | null; _sum: { paidAmount: unknown }; _count: number }>),
  ])

  // Build a combined PM id list so we look up names in a single query.
  const pmIds = [
    ...posByPM.map((r) => r.paymentMethodId),
    ...woByPM.map((r) => r.paymentMethodId).filter((id): id is string => id != null),
  ]
  const paymentMethods = await db.paymentMethod.findMany({
    where: { id: { in: pmIds } },
    select: { id: true, name: true },
  })
  const pmMap = Object.fromEntries(paymentMethods.map((pm) => [pm.id, pm.name]))

  const posBreakdown = posByPM.map((r) => ({
    methodId: r.paymentMethodId,
    methodName: pmMap[r.paymentMethodId] ?? 'غير محدد',
    total: Number(r._sum.totalAmount ?? 0),
    count: r._count as number,
  }))

  const instCount = instPayments._count?.id ?? 0
  const instTotal = Number(instPayments._sum?.amountPaid ?? 0)
  const instBreakdown = instCount > 0
    ? [{ methodId: null, methodName: 'أقساط', total: instTotal, count: instCount }]
    : []

  const woBreakdown = woByPM.map((r) => ({
    methodId: r.paymentMethodId,
    methodName: pmMap[r.paymentMethodId as string] ?? 'غير محدد',
    total: Number(r._sum.paidAmount ?? 0),
    count: r._count as number,
  }))

  return {
    date,
    pos: {
      byMethod: posBreakdown,
      total: Number(posTotals._sum.totalAmount ?? 0),
      count: posTotals._count as number,
    },
    installments: {
      byMethod: instBreakdown,
      total: instBreakdown.reduce((s, m) => s + m.total, 0),
      count: instBreakdown.reduce((s, m) => s + m.count, 0),
    },
    services: {
      byMethod: woBreakdown,
      total: Number(woTotals._sum.paidAmount ?? 0),
      count: woTotals._count as number,
    },
  }
}
