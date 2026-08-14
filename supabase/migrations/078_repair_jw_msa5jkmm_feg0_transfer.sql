-- Repair a missing vendor-to-vendor transfer for CR00640 (1.40X1080) on
-- JW-MSA5JKMM-FEG0 -> JW-MSA5LD07-6ZNP.
--
-- job_work_transfers/JWT-0826-0001 records that 1.950 MT was transferred
-- from JW-MSA5JKMM-FEG0 (vendor at the time: Arun Engineering) to a new
-- order, JW-MSA5LD07-6ZNP (MAC MANS INDUSTRIES). The destination line
-- (is_transfer_line = true) was created correctly, but the source order's
-- own item was later replaced by a historical edit — resetting
-- quantity_transferred_out to 0 and orphaning the transfer audit trail's
-- from_job_work_item_id (it still points at the deleted original item,
-- 9e44b933-03e7-4f70-a910-5890f59d0ce8). JW-MSA5JKMM-FEG0's vendor field
-- was also later corrected to MAC MANS INDUSTRIES directly (not via another
-- transfer), so both orders now independently show 1.950 MT outstanding at
-- MAC MANS INDUSTRIES — v_stock_at_vendors sums them to 3.900 MT, while the
-- Item Stock Ledger's own running "Balance at Vendor" (built from
-- stock_ledger, which only ever saw the original 1.950 MT JOB_WORK_OUT)
-- correctly shows 1.950 MT. Neither TRANSFER_OUT nor TRANSFER_IN was ever
-- posted to stock_ledger for this transfer.
--
-- Confirmed with the user: this was one real transfer of 1.950 MT, so only
-- 1.950 MT should count as outstanding at the vendor.
BEGIN;

-- 1. Mark the source item's quantity as transferred out, so
--    v_stock_at_vendors stops counting it a second time.
UPDATE job_work_items
SET quantity_transferred_out = 1.950,
    updated_at = NOW()
WHERE id = '6b7bdab5-d837-4e76-979d-dda1ee2ce919'
  AND job_work_order_id = '12963adc-900a-4088-b4ad-fa35b747a3b2'
  AND quantity_transferred_out = 0;

-- 2. Complete the destination item's link back to its (replaced) source
--    item, matching the convention set by migration 070/071.
UPDATE job_work_items
SET source_job_work_item_id = '6b7bdab5-d837-4e76-979d-dda1ee2ce919',
    updated_at = NOW()
WHERE id = '74eb2cf5-86f0-4e6f-a168-f624a6c5d176'
  AND job_work_order_id = '4023acca-2a8c-45dd-a272-aafaadd65b32'
  AND source_job_work_item_id IS NULL;

-- 3. Post the missing TRANSFER_OUT (source order) / TRANSFER_IN
--    (destination order) pair, dated to match the transfer, so the Item
--    Ledger's transaction list reflects the transfer explicitly rather
--    than showing a single unexplained Job Work Out.
INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id
)
SELECT
  'JOB_WORK_TRANSFER_OUT', '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2',
  'd2e3f40f-8076-46fa-a3cc-f52a661972d7', '1805bd91-21e8-4cc8-9a1a-7de2ceb9a0bb', '1.40X1080',
  -1.950, 'job_work', '12963adc-900a-4088-b4ad-fa35b747a3b2', 'JW-MSA5JKMM-FEG0',
  'Backfilled missing JOB_WORK_TRANSFER_OUT for JWT-0826-0001 (migration 078)',
  '2024-04-24', 'CR0324-0001', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM stock_ledger
  WHERE entry_type = 'JOB_WORK_TRANSFER_OUT' AND reference_id = '12963adc-900a-4088-b4ad-fa35b747a3b2'
);

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id
)
SELECT
  'JOB_WORK_TRANSFER_IN', '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2',
  'd2e3f40f-8076-46fa-a3cc-f52a661972d7', '1805bd91-21e8-4cc8-9a1a-7de2ceb9a0bb', '1.40X1080',
  1.950, 'job_work', '4023acca-2a8c-45dd-a272-aafaadd65b32', 'JW-MSA5LD07-6ZNP',
  'Backfilled missing JOB_WORK_TRANSFER_IN for JWT-0826-0001 (migration 078)',
  '2024-04-24', 'CR0324-0001', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM stock_ledger
  WHERE entry_type = 'JOB_WORK_TRANSFER_IN' AND reference_id = '4023acca-2a8c-45dd-a272-aafaadd65b32'
);

-- 4. Point the transfer audit row's item links at the current (post-edit)
--    items instead of the deleted original.
UPDATE job_work_transfer_items
SET from_job_work_item_id = '6b7bdab5-d837-4e76-979d-dda1ee2ce919',
    to_job_work_item_id = '74eb2cf5-86f0-4e6f-a168-f624a6c5d176'
WHERE job_work_transfer_id = '3c3cb6a6-682d-41ec-9e6b-556847a6b2e9';

COMMIT;
