-- Repair seven duplicate virtual returns created when vendor-direct dispatches
-- were edited before their item rows were replaced.  Each duplicate cleared
-- vendor stock a second time, producing negative vendor balances.
BEGIN;

DELETE FROM stock_ledger
WHERE id IN (
  '05a30064-5e52-4970-8bb1-b09bd2d1dd2a',
  '5be1c5c9-1c62-44ef-9e4b-6b8a64e141d5',
  '7acfb2f7-3a3c-4d61-b22e-d389d2815999',
  'd200bbaa-bcdc-4298-849d-a1c9d026d53c',
  '3569b9cd-7b27-47ac-acca-b865a891c0b1',
  'aaed3d16-d975-46b8-ba42-521203d0f8eb',
  'f69c830e-7029-48c9-8130-cbe3c3cc946e'
)
AND entry_type = 'JOB_WORK_RETURN_IN'
AND notes ILIKE '%virtual return%';

-- Restore the pending quantity on the corresponding source job-work lines.
WITH corrections AS (
  SELECT
    di.source_job_work_item_id AS job_work_item_id,
    SUM(fn_convert_quantity(di.quantity, di.unit, mt.unit)) AS quantity
  FROM dispatch_items di
  JOIN dispatch_orders d ON d.id = di.dispatch_order_id
  JOIN material_types mt ON mt.id = di.material_type_id
  WHERE d.is_vendor_direct = TRUE
    AND d.invoice_number IN ('0624-0092', '0624-0120', '0624-0104', '0524-0043')
    AND di.source_job_work_item_id IS NOT NULL
  GROUP BY di.source_job_work_item_id
)
UPDATE job_work_items jwi
SET quantity_received = GREATEST(0, COALESCE(jwi.quantity_received, 0) - corrections.quantity),
    updated_at = NOW()
FROM corrections
WHERE jwi.id = corrections.job_work_item_id;

COMMIT;
