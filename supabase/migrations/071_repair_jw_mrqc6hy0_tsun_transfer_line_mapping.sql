-- Complete the repair for JW-MRQC6HY0-TSUN.  Its historical transfer-audit
-- record predates to_job_work_item_id being populated, so match the
-- destination line by its immutable transferred-line attributes.

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
  AND destination_order.reference_number = 'JW-MRQC6HY0-TSUN'
  AND destination_item.is_transfer_line = FALSE
  AND destination_item.purchase_line_id IS NOT DISTINCT FROM transfer_item.purchase_line_id
  AND destination_item.sub_purchase_line_id IS NOT DISTINCT FROM transfer_item.sub_purchase_line_id
  AND destination_item.item_master_id IS NOT DISTINCT FROM transfer_item.item_master_id
  AND destination_item.material_type_id = transfer_item.material_type_id
  AND destination_item.material_size_id IS NOT DISTINCT FROM transfer_item.material_size_id
  AND destination_item.size_label IS NOT DISTINCT FROM transfer_item.size_label
  AND destination_item.quantity_sent = transfer_item.quantity_transferred;
