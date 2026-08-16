-- Migration 101: backfill 4 vendor-to-vendor job work transfers that were
-- entered as brand-new job work orders instead of using the Transfer feature
-- (/jobwork/[id]/transfer), which sets is_transfer_line + source_job_work_item_id
-- and lets fn_job_work_item_to_ledger() post a net-zero TRANSFER_OUT/TRANSFER_IN
-- pair. Each was instead posted as a plain JOB_WORK_OUT on the destination
-- order while the source order's item was left "still fully at vendor",
-- double-decrementing the item's stock_ledger closing balance for material
-- that never actually returned to the warehouse.
--
-- Found via system-wide scan: job_work_items sharing a purchase_line_id
-- across >1 vendor, none flagged is_transfer_line, where the earlier order's
-- quantity_received/quantity_transferred_out were both still 0 (i.e. the
-- material was never returned to warehouse before showing up at the next
-- vendor) and the quantities match exactly. Reported instance: CR00373
-- (CR 0.90X1280), Metalex -> Arun Engineering, 2024-08-27.
--
-- Two other matches from the same scan (GI0524-0021, GI0524-0029) were
-- EXCLUDED: their source orders show quantity_received = quantity_sent
-- (fully returned to warehouse before being re-sent to a new vendor as a
-- genuinely new job work), so those are not transfers and are left as-is.

BEGIN;

-- Pair 1: CR0724-0007 (CR00373, 0.90X1280) — Metalex -> Arun Engineering
UPDATE job_work_items
SET is_transfer_line = true, source_job_work_item_id = 'c83c536a-d5de-47e0-a374-e57fcb3e2c33'
WHERE id = '43a29bb9-83e6-409c-b2d5-00f7f3f82f80';

DELETE FROM stock_ledger WHERE id = '36c9ffc9-a744-45de-be88-05237dab2730';

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id, created_by
)
SELECT 'JOB_WORK_TRANSFER_IN', jwo.company_id, jwo.warehouse_id, jwi.material_type_id,
       jwi.material_size_id, jwi.size_label, 4.045, 'job_work', jwo.id, jwo.reference_number,
       'Vendor transfer — received', jwo.dispatch_date, jwi.purchase_line_id, jwi.sub_purchase_line_id,
       jwo.created_by
FROM job_work_items jwi JOIN job_work_orders jwo ON jwo.id = jwi.job_work_order_id
WHERE jwi.id = '43a29bb9-83e6-409c-b2d5-00f7f3f82f80';

UPDATE job_work_items SET quantity_transferred_out = 4.045
WHERE id = 'c83c536a-d5de-47e0-a374-e57fcb3e2c33';

-- Pair 2: GA0724-0002 (0.70X1248) — Metalex -> Arun Engineering
UPDATE job_work_items
SET is_transfer_line = true, source_job_work_item_id = 'f695f1c6-85d4-423c-8404-92369140d29c'
WHERE id = 'd7fa3bee-8f86-42c0-aae6-9a6898096e67';

DELETE FROM stock_ledger WHERE id = '8d268ac4-ccd6-4cd8-b33b-e2c5ea6156cd';

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id, created_by
)
SELECT 'JOB_WORK_TRANSFER_IN', jwo.company_id, jwo.warehouse_id, jwi.material_type_id,
       jwi.material_size_id, jwi.size_label, 4.875, 'job_work', jwo.id, jwo.reference_number,
       'Vendor transfer — received', jwo.dispatch_date, jwi.purchase_line_id, jwi.sub_purchase_line_id,
       jwo.created_by
FROM job_work_items jwi JOIN job_work_orders jwo ON jwo.id = jwi.job_work_order_id
WHERE jwi.id = 'd7fa3bee-8f86-42c0-aae6-9a6898096e67';

UPDATE job_work_items SET quantity_transferred_out = 4.875
WHERE id = 'f695f1c6-85d4-423c-8404-92369140d29c';

-- Pair 3: GI0724-0025 (1.70X1405) — Modern Age Metal Processors -> Mass Decoilers
UPDATE job_work_items
SET is_transfer_line = true, source_job_work_item_id = '8bc4f0cf-5153-4b7e-b760-8ca3ba781d9c'
WHERE id = '41ca5dc5-0598-42c3-8498-8d14d8fac683';

DELETE FROM stock_ledger WHERE id = '6dc03e99-f523-4853-8175-e1b84e76c2cb';

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id, created_by
)
SELECT 'JOB_WORK_TRANSFER_IN', jwo.company_id, jwo.warehouse_id, jwi.material_type_id,
       jwi.material_size_id, jwi.size_label, 2.250, 'job_work', jwo.id, jwo.reference_number,
       'Vendor transfer — received', jwo.dispatch_date, jwi.purchase_line_id, jwi.sub_purchase_line_id,
       jwo.created_by
FROM job_work_items jwi JOIN job_work_orders jwo ON jwo.id = jwi.job_work_order_id
WHERE jwi.id = '41ca5dc5-0598-42c3-8498-8d14d8fac683';

UPDATE job_work_items SET quantity_transferred_out = 2.250
WHERE id = '8bc4f0cf-5153-4b7e-b760-8ca3ba781d9c';

-- Pair 4: GI0824-0027 (0.70X1465) — Mass Decoilers -> Arun Engineering
UPDATE job_work_items
SET is_transfer_line = true, source_job_work_item_id = '3993f9dd-6eb9-48dc-afa6-1bf8d5b53658'
WHERE id = 'e0ac18f4-f852-457d-a73f-2359bb8039a7';

DELETE FROM stock_ledger WHERE id = '9ce1c8a5-746f-456b-a4a2-217c6c085584';

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id, created_by
)
SELECT 'JOB_WORK_TRANSFER_IN', jwo.company_id, jwo.warehouse_id, jwi.material_type_id,
       jwi.material_size_id, jwi.size_label, 4.876, 'job_work', jwo.id, jwo.reference_number,
       'Vendor transfer — received', jwo.dispatch_date, jwi.purchase_line_id, jwi.sub_purchase_line_id,
       jwo.created_by
FROM job_work_items jwi JOIN job_work_orders jwo ON jwo.id = jwi.job_work_order_id
WHERE jwi.id = 'e0ac18f4-f852-457d-a73f-2359bb8039a7';

UPDATE job_work_items SET quantity_transferred_out = 4.876
WHERE id = '3993f9dd-6eb9-48dc-afa6-1bf8d5b53658';

COMMIT;
