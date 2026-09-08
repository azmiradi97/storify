import { describe, it, expect } from 'vitest'
import { weightedAverageCost } from '../cost'

// ACC-03 — weighted moving-average cost on purchase-order receipt.
describe('weightedAverageCost', () => {
  it('adopts the received cost when there is no stock on hand', () => {
    expect(weightedAverageCost(0, 100, 10, 130).toString()).toBe('130')
  })

  it('adopts the received cost when the prior cost is zero/unset', () => {
    expect(weightedAverageCost(5, 0, 5, 80).toString()).toBe('80')
    expect(weightedAverageCost(5, null, 5, 80).toString()).toBe('80')
  })

  it('blends existing and received units by quantity', () => {
    // (10*100 + 10*130) / 20 = 115
    expect(weightedAverageCost(10, 100, 10, 130).toString()).toBe('115')
  })

  it('weights by the larger side correctly', () => {
    // (90*10 + 10*20) / 100 = 11
    expect(weightedAverageCost(90, 10, 10, 20).toString()).toBe('11')
  })

  it('rounds to 4 dp HALF_UP and never uses native float', () => {
    // (3*3.3333 + 1*4) / 4 = (9.9999 + 4)/4 = 13.9999/4 = 3.499975 -> 3.5000
    expect(weightedAverageCost(3, '3.3333', 1, '4').toString()).toBe('3.5')
  })
})
