-- ============================================================
-- WareCore WMS - Backfill missing JOB_WORK_TRANSFER_OUT ledger rows
--
-- Found while investigating why the Vendorwise Stock Movement report's
-- closing balance (348.663 T as of 2024-05-31) didn't match the Stock
-- Statement report's "Stock at Vendor" column (331.365 T) for the same
-- date. Part of the gap traced to 4 job_work_items rows with
-- quantity_transferred_out > 0 (i.e. their pending quantity was handed to
-- a new vendor via a Job Work Transfer) whose paired JOB_WORK_TRANSFER_IN
-- row exists on the destination order, but whose own JOB_WORK_TRANSFER_OUT
-- row was never posted to stock_ledger at all — so the ledger only ever
-- saw the material arrive at the new vendor, never leave the old one.
--
-- Every other JOB_WORK_TRANSFER_OUT/IN pair in the system was audited
-- (each source item's quantity_transferred_out matched by exactly one
-- TRANSFER_OUT row of that same quantity) — these 4 are the only gaps.
-- Two of them (JW-MRET3ZIS-T1QX, JW-MR0J2NYQ-HEKS) fall before 2024-05-31
-- and account for 8.860 T of the reported discrepancy; the other two
-- (JW-MRKJHEXQ-RP3D, JW-MR5XV0TQ-YODF) are dated after the cutoff but are
-- the same defect and are backfilled here too so future reports stay
-- correct.
--
-- Each row is dated to match its paired JOB_WORK_TRANSFER_IN's entry_date
-- (the destination order's dispatch_date), following the convention
-- established by migration 065.
-- ============================================================

-- Each INSERT is guarded by `WHERE EXISTS (... job_work_orders ...
-- id = <reference_id>)` — the hardcoded company_id/warehouse_id/material/
-- reference ids below only exist in the hosted production database this
-- repair targeted. On a fresh database (e.g. the standalone desktop build's
-- own empty embedded Postgres), the source order doesn't exist, so each
-- guard makes its INSERT a no-op instead of an FK violation on stock_ledger.

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id
)
SELECT
  'JOB_WORK_TRANSFER_OUT',
  '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2',
  'cd18bd17-6f05-44ab-a59d-486d0562131b', 'fed3365a-654e-4191-9289-2af4dd85c919', '1MM X 1220',
  -7.702,
  'job_work', '54a56517-d19b-49ae-b10c-d205c69c6e86', 'JW-MRET3ZIS-T1QX',
  'Backfilled missing JOB_WORK_TRANSFER_OUT — vendor transfer had no source-side ledger row (migration 077)',
  '2024-05-15',
  'GI0524-0018', NULL
WHERE EXISTS (SELECT 1 FROM job_work_orders WHERE id = '54a56517-d19b-49ae-b10c-d205c69c6e86');

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id
)
SELECT
  'JOB_WORK_TRANSFER_OUT',
  '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2',
  'cd18bd17-6f05-44ab-a59d-486d0562131b', 'b6af96b4-3de3-4a8e-99d6-53d7a316de87', '0.70X1305',
  -1.158,
  'job_work', '5f6d88a8-6870-4a43-9e4d-8d99505343a9', 'JW-MR0J2NYQ-HEKS',
  'Backfilled missing JOB_WORK_TRANSFER_OUT — vendor transfer had no source-side ledger row (migration 077)',
  '2024-05-25',
  'GI0524-0002', NULL
WHERE EXISTS (SELECT 1 FROM job_work_orders WHERE id = '5f6d88a8-6870-4a43-9e4d-8d99505343a9');

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id
)
SELECT
  'JOB_WORK_TRANSFER_OUT',
  '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2',
  'd2e3f40f-8076-46fa-a3cc-f52a661972d7', '3441d0e1-c60b-45b9-ae6e-af8e5cf3d223', '0.75X1690',
  -5.760,
  'job_work', '08160f1f-8902-45b9-a560-b5addcf9c145', 'JW-MRKJHEXQ-RP3D',
  'Backfilled missing JOB_WORK_TRANSFER_OUT — vendor transfer had no source-side ledger row (migration 077)',
  '2024-06-28',
  'CR0624-0003', NULL
WHERE EXISTS (SELECT 1 FROM job_work_orders WHERE id = '08160f1f-8902-45b9-a560-b5addcf9c145');

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id
)
SELECT
  'JOB_WORK_TRANSFER_OUT',
  '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2',
  'd2e3f40f-8076-46fa-a3cc-f52a661972d7', '8dc41cb8-748a-40ca-88b5-c5d210dbc4b5', '0.75X914',
  -3.250,
  'job_work', '6105e339-d5d4-4c5a-bb34-bb7b873dc7bb', 'JW-MR5XV0TQ-YODF',
  'Backfilled missing JOB_WORK_TRANSFER_OUT — vendor transfer had no source-side ledger row (migration 077)',
  '2024-06-22',
  'CR0524-0027', NULL
WHERE EXISTS (SELECT 1 FROM job_work_orders WHERE id = '6105e339-d5d4-4c5a-bb34-bb7b873dc7bb');
