-- Migration 119: JWT-0826-0012 (Arun Engineering -> M&M, OT0324-0006,
-- 0.70X121, 2.300, transfer date 2024-07-09) went through the real Transfer
-- feature on 2026-08-17 08:44 UTC — job_work_transfers audit row exists,
-- source job_work_items.quantity_transferred_out is correctly 2.300,
-- destination job_work_items row exists with is_transfer_line=true and
-- quantity_sent=2.300 — but NEITHER the JOB_WORK_TRANSFER_OUT (source) nor
-- JOB_WORK_TRANSFER_IN (destination) stock_ledger row was ever posted.
--
-- Found via a system-wide scan of every job_work_transfers row against its
-- stock_ledger legs (all 33 other transfers, before and after this one,
-- posted both legs correctly) — this is an isolated single-transfer miss,
-- not a pattern, so no trigger/code change is needed; fn_job_work_item_to_ledger()
-- as it stands today correctly posts both legs for INSERT (is_transfer_line)
-- and UPDATE (quantity_transferred_out increase). This surfaced as a 2.300 MT
-- gap between "Balance at Vendors" (built from job_work_items.quantity_sent,
-- unaffected) and the Job Work Out/Direct Sales/Returns summary cards (built
-- from stock_ledger, missing this leg) on the Vendorwise Stock Movement report.
--
-- Repaired the same way migration 101 backfilled its 4 missed-transfer pairs:
-- insert the two missing legs directly: source quantity_transferred_out is
-- already 2.300 (unchanged old->new), so the trigger's UPDATE branch can't be
-- re-triggered by touching that column — both rows are inserted explicitly.

BEGIN;

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id
) VALUES (
  'JOB_WORK_TRANSFER_OUT',
  '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2',
  '40215bef-0196-4451-891a-ba9cc6cab35e', '5b7ee72f-88ae-4b18-8144-bd8c000747ba', '0.70X121',
  -2.300, 'job_work', '7c96e421-f771-4a6a-82e9-eab691493212', 'JW-MSA6L8EL-UC8A',
  'Vendor transfer — sent to new vendor (backfilled, JWT-0826-0012)', '2024-07-09',
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
  'Vendor transfer — received (backfilled, JWT-0826-0012)', '2024-07-09',
  'OT0324-0006', NULL
);

COMMIT;
