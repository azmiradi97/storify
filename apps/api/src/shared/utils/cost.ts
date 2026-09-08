import { Decimal, toDecimal, roundMoney } from './decimal'

/**
 * ACC-03 — weighted moving-average cost.
 *
 * Blends the existing on-hand inventory (at its current unit cost) with a newly
 * received batch (at its purchase unit cost) to produce the variant's new unit
 * cost. When there is no meaningful prior position (no stock on hand, or no
 * recorded cost yet), the received cost is adopted directly.
 *
 * Pure + Decimal-only so it can be unit-tested without a database and never
 * touches native floating point.
 */
export function weightedAverageCost(
  existingQty: number,
  existingCost: Decimal | number | string | null | undefined,
  receivedQty: number,
  receivedCost: Decimal | number | string,
): Decimal {
  const existing = toDecimal(existingCost)
  const received = toDecimal(receivedCost)
  const totalQty = existingQty + receivedQty
  if (existingQty > 0 && existing.greaterThan(0) && totalQty > 0) {
    return roundMoney(
      existing.times(existingQty).plus(received.times(receivedQty)).dividedBy(totalQty),
    )
  }
  return roundMoney(received)
}
