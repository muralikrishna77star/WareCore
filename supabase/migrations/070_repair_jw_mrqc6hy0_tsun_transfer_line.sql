-- Repair the vendor-transfer destination line on JW-MRQC6HY0-TSUN.
--
-- A historical edit reset the destination item's transfer metadata.  The
-- associated ledger row is correctly JOB_WORK_TRANSFER_IN, so this line must
-- not be included in the Job Work Out source total used by stock verification.

UPDATE job_work_items AS destination_item
SET
  is_transfer_line = TRUE,
  source_job_work_item_id = transfer_item.from_job_work_item_id,
  updated_at = NOW()
FROM job_work_orders AS destination_order
JOIN job_work_transfers AS transfer
  ON transfer.to_job_work_order_id = destination_order.id
JOIN job_work_transfer_items AS transfer_item
  ON transfer_item.job_work_transfer_id = transfer.id
WHERE destination_item.job_work_order_id = destination_order.id
  AND transfer_item.to_job_work_item_id = destination_item.id
  AND destination_order.reference_number = 'JW-MRQC6HY0-TSUN'
  AND destination_item.is_transfer_line = FALSE;
