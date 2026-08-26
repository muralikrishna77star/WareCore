-- ============================================================
-- Migration 124: Undo the JWT-0826-0012 Qty Sent corruption on
-- JW-MSWZLTVJ-OQDQ (OTH00038 — Paint 0.70X121, purchase line OT0324-0006)
-- ============================================================
-- On 2026-08-26, an Edit Order save on JW-MSWZLTVJ-OQDQ (the destination
-- order of vendor transfer JWT-0826-0012, Arun Engineering -> M&M,
-- 2.300 MT, transfer date 2024-07-09) was allowed to edit Qty Sent on a
-- transfer-received (is_transfer_line = true) line — a case Edit Order's
-- UI blocks removing but not editing (src/app/(app)/jobwork/[id]/edit/
-- page.tsx's blockedReason only disables the row-remove button, not the
-- Qty Consumed input; the server guard in edit_job_work_order() only
-- checks against quantity_transferred_out/quantity_received, both 0 on a
-- transfer-in line). Two saves dropped quantity_sent 2.300 -> 0.100 ->
-- 0.001, each firing fn_job_work_item_to_ledger()'s quantity_sent delta
-- branch and posting a NEGATIVE JOB_WORK_TRANSFER_IN (-2.200, then
-- -0.099) instead of a real transfer receipt.
--
-- Compounding this: JWT-0826-0012's correct ledger legs were never posted
-- to begin with (migration 119 diagnosed and wrote the fix for exactly
-- this, but was never applied to this database) — so there was nothing
-- correct for the bogus corrections to even be undoing.
--
-- This migration:
--   1. Removes the two bogus JOB_WORK_TRANSFER_IN rows.
--   2. Restores quantity_sent on the destination line to 2.300 (matching
--      job_work_transfer_items.quantity_transferred and the source line's
--      quantity_transferred_out — both untouched by the bug and still
--      correct). Done via UPDATE ... RETURNING inside the same statement
--      as the ledger cleanup so fn_job_work_item_to_ledger's own delta
--      insert (which would fire off the corrupted 0.001 baseline and
--      produce an imprecise +2.299) is deleted immediately after, before
--      the correct pair below is posted.
--   3. Posts the correct TRANSFER_OUT (source)/TRANSFER_IN (destination)
--      pair — same values/company/warehouse migration 119 already
--      researched and would have posted.
-- ============================================================

BEGIN;

-- 1. Remove the two bogus "Qty Sent corrected" rows.
DELETE FROM stock_ledger
WHERE id IN ('9ab85d06-fca6-4f61-b2ad-7f4321db47e7', 'c087125a-a3e4-4555-a562-f2fb53a0eaab')
  AND entry_type = 'JOB_WORK_TRANSFER_IN'
  AND notes = 'Edit Order — Qty Sent corrected';

-- 2. Restore quantity_sent. This fires fn_job_work_item_to_ledger's
-- UPDATE branch (delta = 2.300 - 0.001 = 2.299) — immediately deleted
-- below so it can't leave an imprecise, confusingly-noted row behind.
UPDATE job_work_items
SET quantity_sent = 2.300, updated_at = NOW()
WHERE id = 'c3e1b90d-e587-4d78-adc7-7e17aa8f7609'
  AND job_work_order_id = '0b099597-0fb4-431f-82ee-de7d483a899a'
  AND is_transfer_line = TRUE
  AND quantity_sent = 0.001;

DELETE FROM stock_ledger
WHERE reference_type = 'job_work'
  AND reference_id = '0b099597-0fb4-431f-82ee-de7d483a899a'
  AND entry_type = 'JOB_WORK_TRANSFER_IN'
  AND purchase_line_id = 'OT0324-0006'
  AND notes = 'Edit Order — Qty Sent corrected';

-- 3. Post the correct pair for JWT-0826-0012 (same values as 119).
INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id
) VALUES (
  'JOB_WORK_TRANSFER_OUT',
  '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2',
  '40215bef-0196-4451-891a-ba9cc6cab35e', '5b7ee72f-88ae-4b18-8144-bd8c000747ba', '0.70X121',
  -2.300, 'job_work', '7c96e421-f771-4a6a-82e9-eab691493212', 'JW-MSA6L8EL-UC8A',
  'Vendor transfer — sent to new vendor (repaired, migration 124, JWT-0826-0012)', '2024-07-09',
  'OT0324-0006', NULL
);

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id
) VALUES (
  'JOB_WORK_TRANSFER_IN',
  '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2',
  '40215bef-0196-4451-891a-ba9cc6cab35e', '5b7ee72f-88ae-4b18-8144-bd8c000747ba', '0.70X121',
  2.300, 'job_work', '0b099597-0fb4-431f-82ee-de7d483a899a', 'JW-MSWZLTVJ-OQDQ',
  'Vendor transfer — received (repaired, migration 124, JWT-0826-0012)', '2024-07-09',
  'OT0324-0006', NULL
);

COMMIT;
