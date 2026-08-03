-- ============================================================
-- WareCore WMS - fn_job_work_output_item_to_ledger(): fall back to the
-- order's own dispatch_date instead of CURRENT_DATE when a Job Work output
-- line has no Received Date entered.
--
-- Editing a job work order re-posts every output line's JOB_WORK_OUTPUT_IN
-- row on every save (edit_job_work_order deletes and reinserts). Received
-- Date is an optional field on the edit form — any output line left blank
-- was silently re-stamped to *today* every time the order was edited,
-- same class of bug already fixed for cancellations (migration 072) and
-- job-work-transfer dating (migration 065). No historical rows exist to
-- backfill: job_work_output_items and JOB_WORK_OUTPUT_IN are both
-- currently empty in this database (verified before writing this fix), so
-- this migration is a pure forward fix.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_job_work_output_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_order job_work_orders%ROWTYPE;
  v_purchase_line_id TEXT;
  v_sub_purchase_line_id TEXT;
  v_line_count INT;
  v_target_unit TEXT;
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = NEW.job_work_order_id;

  SELECT count(DISTINCT purchase_line_id),
         (array_agg(DISTINCT purchase_line_id))[1],
         (array_agg(DISTINCT sub_purchase_line_id))[1]
  INTO v_line_count, v_purchase_line_id, v_sub_purchase_line_id
  FROM job_work_items
  WHERE job_work_order_id = NEW.job_work_order_id AND purchase_line_id IS NOT NULL;

  IF v_line_count <> 1 THEN
    v_purchase_line_id := NULL;
    v_sub_purchase_line_id := NULL;
  END IF;

  -- Only create ledger entry if material_type_id is set
  IF NEW.material_type_id IS NOT NULL THEN
    SELECT unit INTO v_target_unit FROM material_types WHERE id = NEW.material_type_id;
    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id,
      material_type_id, material_size_id, size_label,
      quantity,
      reference_type, reference_id, reference_number,
      entry_date, created_by,
      purchase_line_id, sub_purchase_line_id
    ) VALUES (
      'JOB_WORK_OUTPUT_IN', v_order.company_id, v_order.warehouse_id,
      NEW.material_type_id, NEW.material_size_id, NEW.size_label,
      fn_convert_quantity(NEW.quantity, NEW.unit, v_target_unit),
      'job_work', v_order.id, v_order.reference_number,
      COALESCE(NEW.received_date, v_order.dispatch_date), v_order.created_by,
      v_purchase_line_id, v_sub_purchase_line_id
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
