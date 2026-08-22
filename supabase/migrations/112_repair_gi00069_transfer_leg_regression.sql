-- Re-repair GI00069 (GI 0.75X1666): migration 104's fix (2026-08-21) was
-- silently undone the next day. Order JW-MSWZ4GL8-HKJI
-- (4148bce4-39a8-4f51-9b0e-d69b7c85dabc) was edited on 2026-08-22 — almost
-- certainly from a browser tab that had loaded the order before migration
-- 104's transfer-destination line (id 4214853a-827d-4958-bc38-c21fa5fe054f)
-- existed on it. edit_job_work_order() unconditionally deletes every
-- existing job_work_items/stock_ledger row for an order and rebuilds only
-- from what the save submits, so a line not present in that stale payload
-- is lost outright — confirmed: the row and its JOB_WORK_TRANSFER_IN ledger
-- entry are both gone entirely (not archived anywhere), while the source
-- side (order JW-MSN4Q1KK-SGL9, quantity_transferred_out = 0.610) is
-- untouched, exactly reproducing 2026-08-21's original mismatch (ledger
-- 15.655 vs job-work 15.045). See migration 111's header for the sibling
-- GA00128 regression found in the same order at the same time.
--
-- Fix: identical to migration 104, with a fresh row id and re-linking the
-- transfer audit row (its to_job_work_item_id still pointed at the deleted
-- row).

BEGIN;

INSERT INTO job_work_items (
  id, job_work_order_id, purchase_line_id, item_master_id, item_name,
  material_type_id, material_size_id, size_label, quantity_sent, quantity_received,
  unit, job_line_id, is_transfer_line, source_job_work_item_id
)
SELECT
  'd8e2fafc-210e-4191-9099-a82ec3879d89', '4148bce4-39a8-4f51-9b0e-d69b7c85dabc',
  'GI0724-0020', '8530cdb0-735a-46da-876b-d6923354f314', 'GI 0.75X1666',
  'cd18bd17-6f05-44ab-a59d-486d0562131b', '2b114584-da77-47d2-b366-355dab9855d6', '0.75X1666',
  0.610, 0, 'MT', 'JW-2307-0003', TRUE, '704c49cc-4891-4999-8d99-738bd34becbb'
WHERE NOT EXISTS (
  SELECT 1 FROM job_work_items WHERE source_job_work_item_id = '704c49cc-4891-4999-8d99-738bd34becbb'
)
AND EXISTS (SELECT 1 FROM job_work_orders WHERE id = '4148bce4-39a8-4f51-9b0e-d69b7c85dabc')
AND EXISTS (SELECT 1 FROM job_work_items WHERE id = '704c49cc-4891-4999-8d99-738bd34becbb' AND quantity_transferred_out = 0.610);

-- Toggle source's quantity_transferred_out to fire the trigger's paired
-- JOB_WORK_TRANSFER_OUT post. Guarded on the TRANSFER_OUT row not already
-- existing, so re-running this migration after success is a no-op.
UPDATE job_work_items SET quantity_transferred_out = 0
WHERE id = '704c49cc-4891-4999-8d99-738bd34becbb'
  AND quantity_transferred_out = 0.610
  AND EXISTS (SELECT 1 FROM job_work_items WHERE id = 'd8e2fafc-210e-4191-9099-a82ec3879d89')
  AND NOT EXISTS (
    SELECT 1 FROM stock_ledger
    WHERE entry_type = 'JOB_WORK_TRANSFER_OUT'
      AND reference_id = 'f90b2efe-34a3-4287-b51e-c1fc890aea68'
      AND purchase_line_id = 'GI0724-0020'
  );

UPDATE job_work_items SET quantity_transferred_out = 0.610
WHERE id = '704c49cc-4891-4999-8d99-738bd34becbb'
  AND quantity_transferred_out = 0
  AND EXISTS (SELECT 1 FROM job_work_items WHERE id = 'd8e2fafc-210e-4191-9099-a82ec3879d89')
  AND NOT EXISTS (
    SELECT 1 FROM stock_ledger
    WHERE entry_type = 'JOB_WORK_TRANSFER_OUT'
      AND reference_id = 'f90b2efe-34a3-4287-b51e-c1fc890aea68'
      AND purchase_line_id = 'GI0724-0020'
  );

-- Re-link the transfer audit row (was still pointing at the deleted row).
UPDATE job_work_transfer_items
SET to_job_work_item_id = 'd8e2fafc-210e-4191-9099-a82ec3879d89'
WHERE id = '64cde794-3d74-4868-a4ab-3c2cdd7899e4';

COMMIT;
