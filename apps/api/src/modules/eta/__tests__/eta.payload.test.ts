import { describe, it, expect } from 'vitest'
import { buildEtaPayload, type EtaPayloadParams } from '../eta.payload'

// ETA-01 — the submitted document must reflect real discounts and its totals
// must reconcile internally (and to the invoice the customer paid). These tests
// pin the arithmetic invariants; the exact ETA field semantics still need a
// preprod-sandbox validation before production.

const issuer = {
  name: 'Test Store',
  taxpayerId: '123456789',
  activityCode: '4711',
  address: { country: 'EG', governate: 'Cairo', regionCity: 'Nasr City', street: 'St 1', buildingNumber: '10' },
}

function build(items: EtaPayloadParams['items'], invoiceExtraDiscount = 0) {
  return buildEtaPayload({
    invoice: { invoiceNumber: 'INV-1', issuedAt: new Date('2026-01-01T00:00:00Z') },
    issuer,
    items,
    invoiceExtraDiscount,
  })
}

// One line: 2 × 100 @ 14% VAT.
const baseItem = { description: 'Widget', internalCode: 'SKU1', quantity: 2, unitPrice: '100', vatRate: '14' }

describe('buildEtaPayload — ETA-01 discount reconciliation', () => {
  it('no discounts: net = gross, total = net + tax', () => {
    const doc = build([{ ...baseItem }])
    expect(doc.totalSalesAmount).toBe(200)
    expect(doc.totalDiscountAmount).toBe(0)
    expect(doc.netAmount).toBe(200)
    expect(doc.taxTotals.reduce((s, t) => s + t.amount, 0)).toBe(28)
    expect(doc.totalAmount).toBe(228)
  })

  it('line discount lowers net, tax base, and total', () => {
    const doc = build([{ ...baseItem, discountAmount: '20' }])
    expect(doc.totalSalesAmount).toBe(200)
    expect(doc.totalDiscountAmount).toBe(20)
    expect(doc.netAmount).toBe(180)
    // tax on 180 @ 14% = 25.2
    expect(doc.taxTotals.reduce((s, t) => s + t.amount, 0)).toBe(25.2)
    expect(doc.totalAmount).toBe(205.2)
  })

  it('invoice-level (coupon/credit) discount maps to extraDiscountAmount', () => {
    const doc = build([{ ...baseItem }], 30)
    expect(doc.extraDiscountAmount).toBe(30)
    expect(doc.netAmount).toBe(200)
    // total = net(200) + tax(28) − extra(30) = 198
    expect(doc.totalAmount).toBe(198)
  })

  it('combined line + invoice discount, and total reconciles to the invoice', () => {
    const doc = build([{ ...baseItem, discountAmount: '20' }], 30)
    // invoice.subtotal would be 180, taxTotal 25.2, coupon 30 →
    // invoice.totalAmount = 180 + 25.2 − 30 = 175.2
    expect(doc.netAmount).toBe(180)
    expect(doc.totalAmount).toBe(175.2)
  })

  it('holds the document invariants for a mixed multi-line cart', () => {
    const doc = build(
      [
        { description: 'A', internalCode: 'A', quantity: 3, unitPrice: '33.3333', vatRate: '14', discountAmount: '5' },
        { description: 'B', internalCode: 'B', quantity: 1, unitPrice: '50', vatRate: '0' },
      ],
      12,
    )
    const taxSum = doc.taxTotals.reduce((s, t) => s + t.amount, 0)
    const lineNetSum = doc.invoiceLines.reduce((s, l) => s + l.netTotal, 0)
    const lineDiscountSum = doc.invoiceLines.reduce((s, l) => s + l.discount.amount, 0)

    // netAmount = gross − line discounts = Σ line netTotals
    expect(doc.netAmount).toBeCloseTo(doc.totalSalesAmount - doc.totalDiscountAmount, 5)
    expect(doc.netAmount).toBeCloseTo(lineNetSum, 5)
    expect(doc.totalDiscountAmount).toBeCloseTo(lineDiscountSum, 5)
    // totalAmount = net + tax − extra
    expect(doc.totalAmount).toBeCloseTo(doc.netAmount + taxSum - doc.extraDiscountAmount, 5)
  })
})
