-- 017: snapshot unit cost at the moment of sale (ACC-03).
--
-- COGS in the P&L report multiplied the CURRENT product_variants.cost_price by
-- quantity sold. Because cost_price is a single mutable field (and, before this
-- release, was never even updated by purchase-order receipts), historical gross
-- margins silently changed whenever cost was edited. Snapshotting the cost onto
-- the line item at sale time freezes each sale's COGS to what it actually was.
--
-- Nullable on purpose: rows created before this migration have no snapshot, so
-- the report falls back to the live variant cost for those (see report.service
-- getProfitLoss). New POS + installment invoices always populate it.

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS cost_at_sale numeric(15, 4);
