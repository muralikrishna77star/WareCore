-- Corrects an error in 094_repair_vendor_direct_sale_duplicates_batch2.sql.
--
-- That migration deleted stock_ledger row 45bae91d-fa04-4543-a7b0-cf880dd47094
-- (JOB_WORK_OUT -2.350, JW-MSMUJ9FA-V7R4, 22-Jul-2024) on the assumption that
-- it was a same-millisecond double-submit duplicate of the surviving row
-- beda240d-7200-4e48-baab-f8cbc23fc72c — both rows were byte-identical in
-- every stock_ledger column, which is exactly what a double-submit looks
-- like. It wasn't one.
--
-- Discovered while building the item-by-item Stock Reconciliation feature:
-- its cross-check against v_stock_at_vendors (job_work_items-derived,
-- independent of stock_ledger) flagged CR00524's vendor balance as 2.350
-- short of job_work_items' own bookkeeping (4.700). Checking job_work_items
-- directly for job JW-MSMUJ9FA-V7R4 shows TWO separate line rows for CR00524
-- (5308840d-6fab-4de3-884a-3a8b413ddc9e and ed6e99af-e6f3-4e52-823e-
-- 20353340aaf0), both against purchase_line_id CR0724-0028, both
-- quantity_sent = 2.350, both quantity_received = 0 — i.e. two genuinely
-- separate dispatches of the same purchase line, not one duplicated. The
-- stock_ledger JOB_WORK_OUT rows for this order never carried a
-- purchase_line_id (both NULL), so nothing in stock_ledger itself could
-- distinguish the two legitimate postings from a true duplicate — which is
-- exactly why 094's fingerprint-based approach (entry_type + reference +
-- purchase_line_id + quantity, all matching) got this one wrong.
--
-- Restores the deleted row so stock_ledger again has two JOB_WORK_OUT rows
-- totaling -4.700 for this item/order, matching job_work_items. Same
-- values as the surviving row (they were byte-identical in every ledger
-- column and are legitimately meant to be), new id and created_at.
BEGIN;

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id
)
SELECT
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id
FROM stock_ledger
WHERE id = 'beda240d-7200-4e48-baab-f8cbc23fc72c';

COMMIT;
