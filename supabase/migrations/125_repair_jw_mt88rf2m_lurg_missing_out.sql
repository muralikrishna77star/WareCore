-- ============================================================
-- Migration 125: repair job_work_order JW-MT88RF2M-LURG's missing
-- JOB_WORK_OUT ledger row
-- ============================================================
-- Found while investigating an unexplained 2.310 gap on the Vendorwise
-- Stock Movement report: for 01-Mar-2024 -> today, the visible summary
-- formula (Job Work Out - Returns - Direct Sales = 1,593.604 - 12.969 -
-- 1,350.681 = 229.954) didn't match the displayed "Balance at Vendors"
-- of 232.264.
--
-- Root cause: order JW-MT88RF2M-LURG (id 35242507-00ea-4b37-b58f-
-- 4ae7eb43cd85, vendor MODERN AGE METAL PROCESSORS, company Sri Sai
-- Steels, dispatch_date 2024-09-14, purchase line CR0724-0044,
-- material 2 X 1620, qty 2.310) has a job_work_items row with
-- quantity_sent = quantity_received = 2.310, and a JOB_WORK_RETURN_IN
-- ledger row for the same 2.310 (posted 2026-08-25), but NO matching
-- JOB_WORK_OUT ledger row was ever posted for it — fn_job_work_item_to_
-- ledger() always posts one on INSERT, so this row is an orphan; the
-- mechanism that produced it could not be determined (order and item
-- created_at both 2026-08-25, same day as the return; not attributable
-- to any migration in this repo). A system-wide scan (every non-
-- cancelled, non-transfer-line job_work_items row with quantity_sent
-- <> 0) found this is the ONLY such orphan — an isolated data gap, not
-- a pattern.
--
-- Effect: the Vendorwise Stock Movement report's "Balance at Vendors"
-- is computed from job_work_items.quantity_sent (cumulative, ground
-- truth for physical stock at the vendor) minus ledger returns/transfer-
-- outs, so it correctly included this order's 2.310 as outstanding-then-
-- returned (net zero contribution to the balance). But the "Job Work
-- Out" summary card sums ledger JOB_WORK_OUT rows only, so it never saw
-- this order's outbound leg at all — while the "Returns" card DID see
-- its return. The visible cards therefore looked 2.310 short even
-- though the closing balance itself (232.264) was correct.
--
-- Fix: back-fill the missing JOB_WORK_OUT row so stock_ledger agrees
-- with job_work_items, matching the trigger's own posting convention
-- (negative quantity, dated on the order's dispatch_date). Idempotent —
-- guarded by NOT EXISTS, safe to re-run. No existing rows are modified
-- or deleted; the order's balance (232.264) does not change, only the
-- previously-invisible movement becomes visible on the report.
-- ============================================================

BEGIN;

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id, created_by
)
SELECT
  'JOB_WORK_OUT',
  o.company_id,
  o.warehouse_id,
  ji.material_type_id,
  ji.material_size_id,
  ji.size_label,
  -ji.quantity_sent,
  'job_work',
  o.id,
  o.reference_number,
  'Backfilled missing Job Work Out — see migration 125',
  o.dispatch_date,
  ji.purchase_line_id,
  ji.sub_purchase_line_id,
  o.created_by
FROM job_work_items ji
JOIN job_work_orders o ON o.id = ji.job_work_order_id
WHERE ji.id = '3a4bae85-543c-4536-ae83-fd4ac66447ea'
  AND NOT EXISTS (
    SELECT 1 FROM stock_ledger sl
    WHERE sl.reference_type = 'job_work' AND sl.entry_type = 'JOB_WORK_OUT' AND sl.reference_id = o.id
  );

COMMIT;
