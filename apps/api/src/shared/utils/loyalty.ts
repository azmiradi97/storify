import { Decimal, toDecimal, roundMoney, ZERO } from './decimal'

export const LOYALTY_MIN_REDEEM_POINTS = 100
export const LOYALTY_MAX_REDEEM_FRACTION = 0.5 // at most 50% of a sale can be paid with points

export interface LoyaltyRedemption {
  pointsUsed: number
  discount: Decimal
}

/**
 * ACC-04 — compute how much of a sale a points redemption actually covers.
 *
 * Pure so it can be unit-tested without a DB. The caller is responsible for the
 * hard validations that should reject the request (loyalty disabled, below the
 * minimum, more points than the customer holds); this function only clamps a
 * valid request to the money caps and reports the points genuinely consumed.
 *
 * The discount is the smallest of: the requested points' cash value, the
 * max-fraction cap of the sale, and the amount still owed after other discounts.
 * When the cap bites, only the points whose value was actually applied are
 * consumed (floored, so we never spend more point-value than we discounted).
 */
export function computeLoyaltyRedemption(params: {
  requestedPoints: number
  pointValue: Decimal | number | string
  saleTotal: Decimal
  amountRemaining: Decimal
  maxFraction?: number
}): LoyaltyRedemption {
  const { requestedPoints, saleTotal, amountRemaining } = params
  const pv = toDecimal(params.pointValue)
  if (requestedPoints <= 0 || pv.lessThanOrEqualTo(0) || amountRemaining.lessThanOrEqualTo(0)) {
    return { pointsUsed: 0, discount: ZERO }
  }

  const requestedValue = roundMoney(pv.times(requestedPoints))
  const maxByFraction = roundMoney(saleTotal.times(params.maxFraction ?? LOYALTY_MAX_REDEEM_FRACTION))
  const discount = Decimal.min(requestedValue, maxByFraction, amountRemaining)

  if (discount.lessThanOrEqualTo(0)) return { pointsUsed: 0, discount: ZERO }

  // Full request applied → consume exactly what was asked; otherwise consume
  // only the points whose value fit under the cap (floor — never over-spend).
  const pointsUsed = discount.equals(requestedValue)
    ? requestedPoints
    : Math.floor(discount.dividedBy(pv).toNumber())

  return { pointsUsed, discount: roundMoney(discount) }
}
