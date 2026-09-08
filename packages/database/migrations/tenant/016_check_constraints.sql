-- 016: defense-in-depth CHECK constraints.
--
-- The application already enforces these invariants (race-safe conditional
-- updates for stock, Decimal math for money), but the database itself should
-- never accept an impossible value. Added NOT VALID so EXISTING rows are not
-- re-validated on apply — these guard new INSERT/UPDATE only, which keeps the
-- migration safe to roll out to live tenant schemas.
--
-- NOTE: only columns that are genuinely non-negative in this domain are
-- constrained. Signed/overloaded columns are intentionally left alone:
--   • stock_movements.quantity      — a signed delta (negative on sale)
--   • customers.credit_balance      — can be negative (customer owes)
--   • suppliers.balance             — can be negative
--   • *.discount_value              — holds either a percentage OR a fixed
--                                     amount depending on discount_type

ALTER TABLE product_variants
  ADD CONSTRAINT chk_variant_cost_nonneg CHECK (cost_price >= 0) NOT VALID;

ALTER TABLE product_variants
  ADD CONSTRAINT chk_variant_sell_nonneg CHECK (sell_price >= 0) NOT VALID;

ALTER TABLE stock
  ADD CONSTRAINT chk_stock_quantity_nonneg CHECK (quantity >= 0) NOT VALID;

ALTER TABLE stock
  ADD CONSTRAINT chk_stock_minquantity_nonneg CHECK (min_quantity >= 0) NOT VALID;

ALTER TABLE coupons
  ADD CONSTRAINT chk_coupon_usedcount_nonneg CHECK (used_count >= 0) NOT VALID;

ALTER TABLE installment_contracts
  ADD CONSTRAINT chk_installment_count_positive CHECK (installments_count > 0) NOT VALID;

ALTER TABLE installment_contracts
  ADD CONSTRAINT chk_installment_amounts_nonneg
  CHECK (down_payment >= 0 AND monthly_amount >= 0 AND total_amount >= 0) NOT VALID;

ALTER TABLE invoices
  ADD CONSTRAINT chk_invoice_amounts_nonneg
  CHECK (subtotal >= 0 AND total_amount >= 0 AND paid_amount >= 0) NOT VALID;
