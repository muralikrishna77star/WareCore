-- ============================================================
-- Migration 136: stop Edit Order from re-posting an unchanged
-- Job Work Output line's ledger entry on every save
-- ============================================================
-- Root cause: edit_job_work_order()'s output-items loop (114) always runs
-- `UPDATE job_work_output_items SET ... WHERE id = v_existing_id` for every
-- existing output row present in the save payload, whether or not any of
-- that row's values actually changed — same as every other row in that
-- loop, this is a plain reassignment, not a conditional one.
--
-- fn_job_work_item_to_ledger() (input side) already guards its own
-- Qty Sent correction with `IF NEW.quantity_sent <> OLD.quantity_sent`
-- before posting anything. fn_job_work_output_item_to_ledger()'s UPDATE
-- branch — added in the same migration 114 — never got the equivalent
-- guard: it unconditionally reverses the OLD row (JOB_WORK_CANCEL) and
-- reposts NEW (JOB_WORK_OUTPUT_IN) on every UPDATE statement, even when
-- OLD and NEW are identical.
--
-- Net effect on stock is always zero (a cancel exactly offsets what it
-- reverses), but every unrelated Edit Order save — fixing a note, the
-- vendor, an input line, anything — appended two new rows to
-- stock_ledger for every existing output line on the order. Repeated
-- edits accumulate CANCEL/OUTPUT_IN pairs that read as duplicate entries
-- in Item Ledger and every other report keyed off stock_ledger, exactly
-- as reported for JW-MTBHDLZV-H92K (an output row edited twice 40 minutes
-- apart produced extra rows that had to be deleted by hand).
--
-- Fix: skip the reversal-and-repost entirely when nothing that actually
-- feeds a stock_ledger column changed (material, size, quantity, unit,
-- received_date/entry_date). Mirrors the input-side guard's intent.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_job_work_output_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_order job_work_orders%ROWTYPE;
  v_purchase_line_id TEXT;
  v_sub_purchase_line_id TEXT;
  v_line_count INT;
  v_target_unit TEXT;
  v_old_unit TEXT;
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = NEW.job_work_order_id;

  -- NEW: nothing ledger-relevant changed — same row, resaved. Without this,
  -- every Edit Order save re-posts a no-op JOB_WORK_CANCEL + JOB_WORK_OUTPUT_IN
  -- pair for every existing output line, whether or not that line was
  -- touched. See migration header.
  IF TG_OP = 'UPDATE'
     AND NEW.material_type_id IS NOT DISTINCT FROM OLD.material_type_id
     AND NEW.material_size_id IS NOT DISTINCT FROM OLD.material_size_id
     AND NEW.size_label       IS NOT DISTINCT FROM OLD.size_label
     AND NEW.quantity         IS NOT DISTINCT FROM OLD.quantity
     AND NEW.unit             IS NOT DISTINCT FROM OLD.unit
     AND NEW.received_date    IS NOT DISTINCT FROM OLD.received_date
  THEN
    RETURN NEW;
  END IF;

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

  -- On UPDATE, reverse whatever the OLD row posted before reposting for NEW.
  IF TG_OP = 'UPDATE' AND OLD.material_type_id IS NOT NULL THEN
    SELECT unit INTO v_old_unit FROM material_types WHERE id = OLD.material_type_id;
    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id, material_type_id, material_size_id, size_label,
      quantity, reference_type, reference_id, reference_number,
      notes, entry_date, created_by, purchase_line_id, sub_purchase_line_id
    ) VALUES (
      'JOB_WORK_CANCEL', v_order.company_id, v_order.warehouse_id,
      OLD.material_type_id, OLD.material_size_id, OLD.size_label,
      -fn_convert_quantity(OLD.quantity, OLD.unit, v_old_unit),
      'job_work', v_order.id, v_order.reference_number,
      'Output line corrected via Edit Order',
      COALESCE(OLD.received_date, v_order.dispatch_date), v_order.created_by,
      v_purchase_line_id, v_sub_purchase_line_id
    );
  END IF;

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
