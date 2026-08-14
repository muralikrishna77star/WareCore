-- Redo the JW-MSA5JKMM-FEG0 <-> JW-MSA5LD07-6ZNP transfer repair
-- (originally migrations 078/080), which was wiped out by an Edit Order
-- save on FEG0 before migration 081 closed the gap that allowed it.
--
-- The edit gave FEG0's line item a new id (59ab612b-fc3c-4e79-a075-
-- 1e62893f8fdb, replacing 6b7bdab5-...), deleted the JOB_WORK_TRANSFER_OUT
-- ledger row, reset quantity_transferred_out to 0, and (via
-- source_job_work_item_id's ON DELETE SET NULL) nulled out the link on
-- 6ZNP's item that migration 078 had set. FEG0's vendor_id also reverted to
-- MAC MANS INDUSTRIES. None of this touched JW-MSA5LD07-6ZNP itself (its
-- item id and JOB_WORK_TRANSFER_IN row are unchanged) or the
-- job_work_transfers/JWT-0826-0001 audit record.
--
-- With migration 081 now in place, this should hold going forward — editing
-- FEG0 again will preserve quantity_transferred_out and no longer delete
-- the TRANSFER_OUT row.
BEGIN;

UPDATE job_work_items
SET quantity_transferred_out = 1.950,
    updated_at = NOW()
WHERE id = '59ab612b-fc3c-4e79-a075-1e62893f8fdb'
  AND job_work_order_id = '12963adc-900a-4088-b4ad-fa35b747a3b2'
  AND quantity_transferred_out = 0;

UPDATE job_work_items
SET source_job_work_item_id = '59ab612b-fc3c-4e79-a075-1e62893f8fdb',
    updated_at = NOW()
WHERE id = '74eb2cf5-86f0-4e6f-a168-f624a6c5d176'
  AND job_work_order_id = '4023acca-2a8c-45dd-a272-aafaadd65b32';

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id
)
SELECT
  'JOB_WORK_TRANSFER_OUT', '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2',
  'd2e3f40f-8076-46fa-a3cc-f52a661972d7', '1805bd91-21e8-4cc8-9a1a-7de2ceb9a0bb', '1.40X1080',
  -1.950, 'job_work', '12963adc-900a-4088-b4ad-fa35b747a3b2', 'JW-MSA5JKMM-FEG0',
  'Backfilled missing JOB_WORK_TRANSFER_OUT for JWT-0826-0001 (migration 082, redo of 078)',
  '2024-04-24', 'CR0324-0001', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM stock_ledger
  WHERE entry_type = 'JOB_WORK_TRANSFER_OUT' AND reference_id = '12963adc-900a-4088-b4ad-fa35b747a3b2'
);

UPDATE job_work_orders
SET vendor_id = 'a9281561-a471-4ef5-881c-7db24c02e81c', -- Arun Engineering
    updated_at = NOW()
WHERE id = '12963adc-900a-4088-b4ad-fa35b747a3b2' -- JW-MSA5JKMM-FEG0
  AND vendor_id = '11d5254c-f0c1-4b23-889c-628d86436acd'; -- currently MAC MANS INDUSTRIES

UPDATE job_work_transfer_items
SET from_job_work_item_id = '59ab612b-fc3c-4e79-a075-1e62893f8fdb',
    to_job_work_item_id = '74eb2cf5-86f0-4e6f-a168-f624a6c5d176'
WHERE job_work_transfer_id = '3c3cb6a6-682d-41ec-9e6b-556847a6b2e9';

COMMIT;
