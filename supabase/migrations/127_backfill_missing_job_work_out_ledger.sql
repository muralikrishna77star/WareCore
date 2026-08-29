-- ============================================================
-- Migration 127: backfill 3 job_work_items rows with NO stock_ledger
-- footprint at all (not even JOB_WORK_OUT)
-- ============================================================
-- Found comparing Stock Statement's "Stock at Vendor" against Vendorwise
-- Stock Movement's closing balance for 01-Mar-2024 -> 30-Sep-2024, right
-- after 126 shipped: 3 NEW gaps appeared (Arun Engineering / GI 0.90X1235,
-- Arun Engineering / CR 1.40X1080, MAC MANS INDUSTRIES / CR 1.40X1165) —
-- not the same bug as 126. Root cause this time: three job_work_items
-- rows have real quantity_sent (and, for one, quantity_received) but ZERO
-- rows in stock_ledger for their own (job_work_order_id, material_type_id,
-- material_size_id) at all — not even the JOB_WORK_OUT that
-- fn_job_work_item_to_ledger() always posts on INSERT. Same class of
-- defect as 125 (an orphan with no discoverable creation mechanism — order/
-- item created_at is recent, 2026, unrelated to any migration in this
-- repo), just three instances instead of one. A system-wide scan (every
-- non-cancelled, non-transfer-line job_work_items row with quantity_sent
-- <> 0 and zero matching stock_ledger rows) confirms these are the only 3.
--
-- Stock Statement (pure ledger) has zero visibility into these orders, so
-- it silently omits them from the vendor balance entirely. Vendor
-- Movements' balance formula includes them via its job_work_items.
-- quantity_sent floor (the orphan-safety mechanism from 125/126), but has
-- no equivalent floor for quantity_received when the RETURN_IN ledger row
-- is also missing — so it shows the full quantity_sent as outstanding
-- even for the one row that was partially received back. Backfilling both
-- legs (OUT, and RETURN_IN where quantity_received > 0) makes stock_ledger
-- agree with job_work_items, so both reports compute from the same
-- ground truth and reconcile.
--
-- 1. JW-MSU45A12-1WVF / GI0524-0021 (GI00103, Arun Engineering):
--    quantity_sent 2.705, quantity_received 2.650. This order's other
--    line (GI0824-0027) has its own JOB_WORK_TRANSFER_IN + RETURN_IN
--    pair, the RETURN_IN dated 2024-08-16 — used as the best available
--    date estimate for this line's RETURN_IN too, since no ledger
--    evidence records the actual date.
-- 2. JW-MSA6FLFY-5OWM / CR0324-0008 (MAC MANS INDUSTRIES): quantity_sent
--    2.450, quantity_received 0 — OUT only.
-- 3. JW-MSA5JKMM-FEG0 / CR0324-0001 (Arun Engineering): quantity_sent
--    1.950, quantity_received 0 — OUT only.
--
-- Idempotent — guarded by NOT EXISTS scoped to (reference_id,
-- material_type_id, material_size_id), safe to re-run.
-- ============================================================

BEGIN;

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id, created_by
)
SELECT
  'JOB_WORK_OUT', o.company_id, o.warehouse_id, ji.material_type_id, ji.material_size_id,
  ji.size_label, -ji.quantity_sent, 'job_work', o.id, o.reference_number,
  'Backfilled missing Job Work Out — see migration 127', o.dispatch_date,
  ji.purchase_line_id, ji.sub_purchase_line_id, o.created_by
FROM job_work_items ji
JOIN job_work_orders o ON o.id = ji.job_work_order_id
WHERE ji.id IN (
  '497cc83b-e726-4e60-9a4f-d14b59a3a607', -- JW-MSU45A12-1WVF / GI0524-0021
  '900cee36-dd07-4035-8ee5-b30ffea4e0e8', -- JW-MSA6FLFY-5OWM / CR0324-0008
  '59ab612b-fc3c-4e79-a075-1e62893f8fdb'  -- JW-MSA5JKMM-FEG0 / CR0324-0001
)
AND NOT EXISTS (
  SELECT 1 FROM stock_ledger sl
  WHERE sl.reference_type = 'job_work' AND sl.entry_type = 'JOB_WORK_OUT' AND sl.reference_id = o.id
    AND sl.material_type_id = ji.material_type_id
    AND sl.material_size_id IS NOT DISTINCT FROM ji.material_size_id
);

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id, created_by
)
SELECT
  'JOB_WORK_RETURN_IN', o.company_id, o.warehouse_id, ji.material_type_id, ji.material_size_id,
  ji.size_label, ji.quantity_received, 'job_work', o.id, o.reference_number,
  'Backfilled missing return, date estimated from sibling line — see migration 127', '2024-08-16',
  ji.purchase_line_id, ji.sub_purchase_line_id, o.created_by
FROM job_work_items ji
JOIN job_work_orders o ON o.id = ji.job_work_order_id
WHERE ji.id = '497cc83b-e726-4e60-9a4f-d14b59a3a607' -- JW-MSU45A12-1WVF / GI0524-0021
AND NOT EXISTS (
  SELECT 1 FROM stock_ledger sl
  WHERE sl.reference_type = 'job_work' AND sl.entry_type = 'JOB_WORK_RETURN_IN' AND sl.reference_id = o.id
    AND sl.material_type_id = ji.material_type_id
    AND sl.material_size_id IS NOT DISTINCT FROM ji.material_size_id
);

COMMIT;
