-- ============================================================
-- Migration 129: backfill missing SALE_OUT for dispatch 0824-0235
-- ============================================================
-- REC-002 flagged dispatch 0824-0235 (active, vendor-direct-sale, 2.650 qty,
-- customer ea6197db..., dispatch_date 2024-08-16) as having zero stock_ledger
-- rows at all — same "orphan, no discoverable creation mechanism" defect
-- class as 125/127 (order/item created_at is 2026-08-19, unrelated to any
-- migration in this repo), this time on the dispatch side rather than
-- job_work_items.
--
-- This dispatch is sourced from job work order JW-MSU45A12-1WVF
-- (11600fc0-f089-420a-b2ad-725d06f662d1), the exact order 127 backfilled.
-- 127 already posted that order's JOB_WORK_RETURN_IN leg (2.650, generic
-- backfill notes) — the raw-material-returned side of this transaction is
-- already covered. Only this dispatch's own SALE_OUT leg (the actual sale
-- to the customer) is still missing; a normal vendor-direct-sale trigger
-- fire would also post a second "Vendor direct sale — virtual return"
-- JOB_WORK_RETURN_IN, but doing that here would double-count the return
-- 127 already posted, so this migration posts SALE_OUT only.
--
-- Note for a future report-accuracy pass (not required for ledger
-- correctness): 127's RETURN_IN row isn't tagged notes = 'Vendor direct
-- sale — virtual return', so the Item Ledger report's sale+return merge
-- display (see 062_fix_vendor_direct_sale_duplicate_return.sql) won't pick
-- it up as this dispatch's counterpart row. Left as-is here since it
-- doesn't affect any stock balance or reconciliation rule.
--
-- Confirmed independently correct regardless of the negative-stock
-- consequence below: checked against same-day/customer/amount dispatch
-- 0824-0393 to rule out a duplicate-order explanation — that one traces to
-- a *different* source job work order (922b7bd3-...), so this is a
-- distinct, real sale, not a double-entry.
--
-- Posting this deepens this material's (cd18bd17.../e662ffd6...) current
-- company-wide balance from -0.055 to -2.705 (REC-005 EXC-000580) — total
-- customer sales for this exact material/size (2.650 + 2.650) will now
-- exceed the only external inflow ever recorded (one 2.705 purchase) by
-- 2.595. That gap is real and pre-existing, not created by this migration;
-- it's the next thing to investigate (likely a second missing purchase or
-- inflow for this material spec), tracked as a separate, still-open
-- REC-005 exception — deliberately not addressed here.
--
-- Idempotent — guarded by NOT EXISTS scoped to (reference_type,
-- reference_id, entry_type), safe to re-run.
-- ============================================================

BEGIN;

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id, created_by
)
SELECT
  'SALE_OUT', do2.company_id, do2.warehouse_id, di.material_type_id, di.material_size_id,
  di.size_label, -di.quantity, 'dispatch', do2.id, do2.invoice_number,
  'Backfilled missing Sale Out — see migration 129', do2.dispatch_date,
  di.purchase_line_id, di.sub_purchase_line_id, do2.created_by
FROM dispatch_items di
JOIN dispatch_orders do2 ON do2.id = di.dispatch_order_id
WHERE do2.invoice_number = '0824-0235'
AND NOT EXISTS (
  SELECT 1 FROM stock_ledger sl
  WHERE sl.reference_type = 'dispatch' AND sl.entry_type = 'SALE_OUT' AND sl.reference_id = do2.id
    AND sl.material_type_id = di.material_type_id
    AND sl.material_size_id IS NOT DISTINCT FROM di.material_size_id
);

COMMIT;
