-- Repair a half-completed vendor-to-vendor Job Work Transfer for GI00069
-- (GI 0.75X1666). job_work_transfers/job_work_transfer_items already record
-- that 0.610 MT was transferred on 2024-07-23 from JW-MSN4Q1KK-SGL9 (source
-- item 704c49cc-4891-4999-8d99-738bd34becbb, line GI0724-0020, vendor Modern
-- Age Metal Processors) to JW-MSWZ4GL8-HKJI (vendor Arun Engineering) — the
-- source's own quantity_transferred_out was correctly bumped to 0.610, but
-- the destination job_work_items row was never created
-- (job_work_transfer_items.to_job_work_item_id is still NULL for this line),
-- so neither JOB_WORK_TRANSFER_OUT nor JOB_WORK_TRANSFER_IN was ever posted
-- to stock_ledger. Found via the item reconciliation check: GI00069's
-- ledger-derived vendor balance (15.655) didn't match job-work records
-- (15.045) by exactly this 0.610 shortfall.
--
-- Fix mirrors the app's own transfer flow instead of hand-crafting ledger
-- rows: insert the missing destination line (is_transfer_line = true), which
-- lets fn_job_work_item_to_ledger()'s INSERT branch auto-post a correctly
-- dated JOB_WORK_TRANSFER_IN; then toggle the source's
-- quantity_transferred_out down and back up to 0.610 so the UPDATE branch
-- auto-posts the paired JOB_WORK_TRANSFER_OUT (see migration 065 for why
-- both legs share the destination order's dispatch_date). Finally, complete
-- the transfer audit row's to_job_work_item_id link, per the convention set
-- by migrations 070/071/078. Every step is guarded to be a no-op if already
-- applied.

BEGIN;

-- 1. Missing destination line — triggers an automatic JOB_WORK_TRANSFER_IN.
INSERT INTO job_work_items (
  id, job_work_order_id, purchase_line_id, item_master_id, item_name,
  material_type_id, material_size_id, size_label, quantity_sent, quantity_received,
  unit, job_line_id, is_transfer_line, source_job_work_item_id
)
SELECT
  '4214853a-827d-4958-bc38-c21fa5fe054f', '4148bce4-39a8-4f51-9b0e-d69b7c85dabc',
  'GI0724-0020', '8530cdb0-735a-46da-876b-d6923354f314', 'GI 0.75X1666',
  'cd18bd17-6f05-44ab-a59d-486d0562131b', '2b114584-da77-47d2-b366-355dab9855d6', '0.75X1666',
  0.610, 0, 'MT', 'JW-2307-0003', TRUE, '704c49cc-4891-4999-8d99-738bd34becbb'
WHERE NOT EXISTS (
  SELECT 1 FROM job_work_items WHERE source_job_work_item_id = '704c49cc-4891-4999-8d99-738bd34becbb'
)
AND EXISTS (SELECT 1 FROM job_work_orders WHERE id = '4148bce4-39a8-4f51-9b0e-d69b7c85dabc')
AND EXISTS (SELECT 1 FROM job_work_items WHERE id = '704c49cc-4891-4999-8d99-738bd34becbb' AND quantity_transferred_out = 0.610);

-- 2. Toggle source's quantity_transferred_out to fire the trigger's paired
--    JOB_WORK_TRANSFER_OUT post. Guarded on the TRANSFER_OUT row not already
--    existing, so re-running this migration after success is a no-op.
UPDATE job_work_items SET quantity_transferred_out = 0
WHERE id = '704c49cc-4891-4999-8d99-738bd34becbb'
  AND quantity_transferred_out = 0.610
  AND EXISTS (SELECT 1 FROM job_work_items WHERE id = '4214853a-827d-4958-bc38-c21fa5fe054f')
  AND NOT EXISTS (
    SELECT 1 FROM stock_ledger
    WHERE entry_type = 'JOB_WORK_TRANSFER_OUT'
      AND reference_id = 'f90b2efe-34a3-4287-b51e-c1fc890aea68'
      AND purchase_line_id = 'GI0724-0020'
  );

UPDATE job_work_items SET quantity_transferred_out = 0.610
WHERE id = '704c49cc-4891-4999-8d99-738bd34becbb'
  AND quantity_transferred_out = 0
  AND EXISTS (SELECT 1 FROM job_work_items WHERE id = '4214853a-827d-4958-bc38-c21fa5fe054f')
  AND NOT EXISTS (
    SELECT 1 FROM stock_ledger
    WHERE entry_type = 'JOB_WORK_TRANSFER_OUT'
      AND reference_id = 'f90b2efe-34a3-4287-b51e-c1fc890aea68'
      AND purchase_line_id = 'GI0724-0020'
  );

-- 3. Complete the transfer audit row's destination link.
UPDATE job_work_transfer_items
SET to_job_work_item_id = '4214853a-827d-4958-bc38-c21fa5fe054f'
WHERE id = '64cde794-3d74-4868-a4ab-3c2cdd7899e4'
  AND to_job_work_item_id IS NULL;

COMMIT;
