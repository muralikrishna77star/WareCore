-- Re-repair GI00069 (GI 0.75X1666) a second time. Migrations 104 and 112
-- both added the transfer-destination line directly into order
-- JW-MSWZ4GL8-HKJI (4148bce4-39a8-4f51-9b0e-d69b7c85dabc) — but that order
-- also independently carries an unrelated GA00128 dispatch that the user
-- actively edits (see migrations 109/111), and each time they save an edit
-- to it via Edit Order, the manually-inserted GI00069 line gets silently
-- dropped again (edit_job_work_order() rebuilds an order's lines only from
-- what the save submits). This has now happened twice. The app's own
-- Transfer feature (jobwork/[id]/transfer/page.tsx) never reuses an
-- existing order for a transfer destination — it always creates a
-- brand-new dedicated one — so this repair follows that same pattern
-- instead of continuing to share GA00128's order, removing the recurring
-- collateral damage at the source.
--
-- Also cleans up a stray JOB_WORK_TRANSFER_OUT (id a60cab47-810f-4ac5-9923-
-- 3527ac17b67f) left over from migration 112's toggle, now orphaned since
-- its paired destination is gone again.

BEGIN;

-- 1. Dedicated new destination order (Arun Engineering), matching the
--    original transfer's date/company/warehouse.
INSERT INTO job_work_orders (
  id, reference_number, vendor_id, company_id, warehouse_id,
  dispatch_date, status, work_description
)
SELECT
  '9ab86794-b4f3-421c-a171-3f0502822f0a', 'JW-MT46U3HO-VRW8',
  'a9281561-a471-4ef5-881c-7db24c02e81c', 'b1804696-676d-465d-a5fe-e1bb214c8da3', 'c8ca6c17-e740-4525-a485-0ce962169008',
  '2024-07-23', 'dispatched',
  'Vendor transfer destination for GI00069 (0.610 MT ex JW-MSN4Q1KK-SGL9) — split into its own order (migration 113) after repeated collateral loss when sharing an order with unrelated GA00128 activity'
WHERE NOT EXISTS (SELECT 1 FROM job_work_orders WHERE id = '9ab86794-b4f3-421c-a171-3f0502822f0a');

-- 2. Remove the stray orphaned TRANSFER_OUT before reposting a fresh one.
DELETE FROM stock_ledger WHERE id = 'a60cab47-810f-4ac5-9923-3527ac17b67f' AND entry_type = 'JOB_WORK_TRANSFER_OUT';

-- 3. Destination line — triggers an automatic JOB_WORK_TRANSFER_IN.
INSERT INTO job_work_items (
  id, job_work_order_id, purchase_line_id, item_master_id, item_name,
  material_type_id, material_size_id, size_label, quantity_sent, quantity_received,
  unit, job_line_id, is_transfer_line, source_job_work_item_id
)
SELECT
  'bea38a70-8838-4ac1-abe2-c2e37acdcc5d', '9ab86794-b4f3-421c-a171-3f0502822f0a',
  'GI0724-0020', '8530cdb0-735a-46da-876b-d6923354f314', 'GI 0.75X1666',
  'cd18bd17-6f05-44ab-a59d-486d0562131b', '2b114584-da77-47d2-b366-355dab9855d6', '0.75X1666',
  0.610, 0, 'MT', 'JW-2307-0003', TRUE, '704c49cc-4891-4999-8d99-738bd34becbb'
WHERE NOT EXISTS (
  SELECT 1 FROM job_work_items WHERE source_job_work_item_id = '704c49cc-4891-4999-8d99-738bd34becbb'
)
AND EXISTS (SELECT 1 FROM job_work_items WHERE id = '704c49cc-4891-4999-8d99-738bd34becbb' AND quantity_transferred_out = 0.610);

-- 4. Toggle source's quantity_transferred_out to fire the trigger's paired
--    JOB_WORK_TRANSFER_OUT post. Guarded on no TRANSFER_OUT existing yet.
UPDATE job_work_items SET quantity_transferred_out = 0
WHERE id = '704c49cc-4891-4999-8d99-738bd34becbb'
  AND quantity_transferred_out = 0.610
  AND EXISTS (SELECT 1 FROM job_work_items WHERE id = 'bea38a70-8838-4ac1-abe2-c2e37acdcc5d')
  AND NOT EXISTS (
    SELECT 1 FROM stock_ledger
    WHERE entry_type = 'JOB_WORK_TRANSFER_OUT'
      AND reference_id = 'f90b2efe-34a3-4287-b51e-c1fc890aea68'
      AND purchase_line_id = 'GI0724-0020'
  );

UPDATE job_work_items SET quantity_transferred_out = 0.610
WHERE id = '704c49cc-4891-4999-8d99-738bd34becbb'
  AND quantity_transferred_out = 0
  AND EXISTS (SELECT 1 FROM job_work_items WHERE id = 'bea38a70-8838-4ac1-abe2-c2e37acdcc5d')
  AND NOT EXISTS (
    SELECT 1 FROM stock_ledger
    WHERE entry_type = 'JOB_WORK_TRANSFER_OUT'
      AND reference_id = 'f90b2efe-34a3-4287-b51e-c1fc890aea68'
      AND purchase_line_id = 'GI0724-0020'
  );

-- 5. Re-point the transfer audit row at the new dedicated order/line.
UPDATE job_work_transfers
SET to_job_work_order_id = '9ab86794-b4f3-421c-a171-3f0502822f0a'
WHERE id = (SELECT job_work_transfer_id FROM job_work_transfer_items WHERE id = '64cde794-3d74-4868-a4ab-3c2cdd7899e4');

UPDATE job_work_transfer_items
SET to_job_work_item_id = 'bea38a70-8838-4ac1-abe2-c2e37acdcc5d'
WHERE id = '64cde794-3d74-4868-a4ab-3c2cdd7899e4';

COMMIT;
