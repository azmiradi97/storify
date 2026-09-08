import { describe, it, expect } from 'vitest'
import { computeLoyaltyRedemption } from '../loyalty'
import { toDecimal } from '../decimal'

// ACC-04 — points redemption cap math.
const D = toDecimal

describe('computeLoyaltyRedemption', () => {
  it('applies the full requested value when nothing caps it', () => {
    // 500 points × 0.01 = 5.00 off a 100 sale (5% ≤ 50%, ≤ remaining)
    const r = computeLoyaltyRedemption({ requestedPoints: 500, pointValue: '0.01', saleTotal: D(100), amountRemaining: D(100) })
    expect(r.pointsUsed).toBe(500)
    expect(r.discount.toString()).toBe('5')
  })

  it('caps at 50% of the sale and consumes only the points applied', () => {
    // 20000 points × 0.01 = 200 requested, but 50% of a 100 sale = 50 max.
    // pointsUsed = floor(50 / 0.01) = 5000.
    const r = computeLoyaltyRedemption({ requestedPoints: 20000, pointValue: '0.01', saleTotal: D(100), amountRemaining: D(100) })
    expect(r.discount.toString()).toBe('50')
    expect(r.pointsUsed).toBe(5000)
  })

  it('never discounts more than the amount still owed', () => {
    // remaining after credit is only 8; 50% cap would allow 50, request worth 200.
    const r = computeLoyaltyRedemption({ requestedPoints: 20000, pointValue: '0.01', saleTotal: D(100), amountRemaining: D(8) })
    expect(r.discount.toString()).toBe('8')
    expect(r.pointsUsed).toBe(800)
  })

  it('is a no-op for zero points, zero point-value, or nothing owed', () => {
    expect(computeLoyaltyRedemption({ requestedPoints: 0, pointValue: '0.01', saleTotal: D(100), amountRemaining: D(100) }).pointsUsed).toBe(0)
    expect(computeLoyaltyRedemption({ requestedPoints: 500, pointValue: '0', saleTotal: D(100), amountRemaining: D(100) }).discount.toString()).toBe('0')
    expect(computeLoyaltyRedemption({ requestedPoints: 500, pointValue: '0.01', saleTotal: D(100), amountRemaining: D(0) }).pointsUsed).toBe(0)
  })
})
