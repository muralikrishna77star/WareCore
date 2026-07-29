-- ============================================================
-- WareCore WMS - Edit Job Work Order now edits return quantities too
--
-- Return-quantity entry is moving from the separate "Save Return
-- Quantities" screen (JobWorkReturnClient) into Edit Order, with a
-- per-item "Received Date" instead of one shared date for the whole
-- save. Edit Order's save path (edit_job_work_order()) deletes every
-- stock_ledger row and job_work_items row for the order and rebuilds
-- from scratch on every save — that's why it used to warn returns get
-- reset to 0.
--
-- Risk: "Sell from Vendor" (vendor-direct sale, fn_dispatch_item_to_ledger())
-- posts its own JOB_WORK_RETURN_IN row against this same order, tagged
-- with notes = 'Vendor direct sale — virtual return'. The Item Ledger
-- report's sale/return merge display depends on that exact tag. A naive
-- wipe-and-rebuild that also touches quantity_received would blow that
-- tag away and double-post the return. Audited every job_work_items row
-- that has a vendor-direct-sale contribution (110 lines across ~90
-- orders) — quantity_received exactly equals the vendor-direct sum for
-- all of them (no line currently has a manual return on top), so the
-- baseline-preserving approach below is a safe, idempotent no-op for
-- every existing order that doesn't change its return quantity.
--
-- Fix, mirroring edit_dispatch_order()'s (062) reversal pattern for the
-- mirror-image case:
--   1. Exclude vendor-direct-sale-tagged rows from the ledger wipe.
--   2. Seed each new job_work_items row's quantity_received at whatever
--      vendor-direct sale already contributed for that purchase_line_id
--      (not 0).
--   3. If the form's quantity_received is higher, apply the extra via a
--      follow-up UPDATE (not the INSERT) so the normal delta-based
--      ledger trigger fires and posts a plain JOB_WORK_RETURN_IN for
--      just the manual portion, dated by the new received_date column.
--   4. Recompute order status/actual_return_date from final per-line
--      totals (previously computed client-side in JobWorkReturnClient).
-- ============================================================

CREATE OR REPLACE FUNCTION edit_job_work_order(
  p_order_id             UUID,
  p_company_id           UUID,
  p_warehouse_id         UUID,
  p_vendor_id            UUID,
  p_dispatch_date        DATE,
  p_expected_return_date DATE,
  p_work_description     TEXT,
  p_notes                TEXT,
  p_input_items          JSONB,
  p_output_items         JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order            job_work_orders%ROWTYPE;
  v_in_json          JSONB;
  v_out_json         JSONB;
  v_new_item_id      UUID;
  v_vendor_baseline  NUMERIC;
  v_form_qty         NUMERIC;
  v_all_returned     BOOLEAN;
  v_none_returned    BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Job work order not found');
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot edit a cancelled order');
  END IF;

  IF v_order.status = 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot edit a completed order');
  END IF;

  -- Remove all stock ledger entries previously created for this order
  -- EXCEPT vendor-direct-sale virtual-return rows, which belong to a
  -- separate flow (Sell from Vendor) and must survive an Edit Order save
  -- untouched — deleting/recreating them here would lose the note tag the
  -- Item Ledger report depends on to merge the sale+return display row.
  DELETE FROM stock_ledger
  WHERE reference_type = 'job_work' AND reference_id = p_order_id
    AND NOT (entry_type = 'JOB_WORK_RETURN_IN' AND notes = 'Vendor direct sale — virtual return');

  -- Drop existing line items
  DELETE FROM job_work_items WHERE job_work_order_id = p_order_id;
  DELETE FROM job_work_output_items WHERE job_work_order_id = p_order_id;

  -- Update order header. status/actual_return_date are recomputed below,
  -- once every line's final quantity_received is known.
  UPDATE job_work_orders SET
    company_id            = p_company_id,
    warehouse_id          = p_warehouse_id,
    vendor_id             = p_vendor_id,
    dispatch_date         = p_dispatch_date,
    expected_return_date  = p_expected_return_date,
    work_description      = p_work_description,
    notes                 = p_notes,
    updated_at            = NOW()
  WHERE id = p_order_id;

  -- Insert new input items — trigger fn_job_work_item_to_ledger fires JOB_WORK_OUT for each
  FOR v_in_json IN SELECT * FROM jsonb_array_elements(p_input_items)
  LOOP
    -- Whatever this line's purchase_line_id already has posted via vendor-direct
    -- sale is the floor for quantity_received — those preserved ledger rows
    -- still represent real, already-sold stock; the new row must start there.
    SELECT COALESCE(SUM(quantity), 0) INTO v_vendor_baseline
    FROM stock_ledger
    WHERE reference_type = 'job_work' AND reference_id = p_order_id
      AND entry_type = 'JOB_WORK_RETURN_IN' AND notes = 'Vendor direct sale — virtual return'
      AND purchase_line_id = NULLIF(v_in_json->>'purchase_line_id', '');

    INSERT INTO job_work_items (
      job_work_order_id, purchase_line_id, sub_purchase_line_id, job_line_id,
      item_master_id, item_name, material_type_id, material_size_id, size_label,
      quantity_sent, quantity_received, unit, notes
    ) VALUES (
      p_order_id,
      NULLIF(v_in_json->>'purchase_line_id', ''),
      NULLIF(v_in_json->>'sub_purchase_line_id', ''),
      NULLIF(v_in_json->>'job_line_id', ''),
      NULLIF(v_in_json->>'item_master_id', '')::UUID,
      NULLIF(v_in_json->>'item_name', ''),
      NULLIF(v_in_json->>'material_type_id', '')::UUID,
      NULLIF(v_in_json->>'material_size_id', '')::UUID,
      NULLIF(v_in_json->>'size_label', ''),
      (v_in_json->>'quantity_sent')::NUMERIC,
      v_vendor_baseline,
      COALESCE(NULLIF(v_in_json->>'unit', ''), 'MT'),
      NULLIF(v_in_json->>'notes', '')
    )
    RETURNING id INTO v_new_item_id;

    -- Manual return quantity/date entered on the Edit Order screen — only
    -- apply the portion above the vendor-direct baseline, via an UPDATE (not
    -- the initial INSERT) so the normal delta-based ledger trigger fires and
    -- posts a plain JOB_WORK_RETURN_IN for just that manual portion.
    v_form_qty := GREATEST(COALESCE((v_in_json->>'quantity_received')::NUMERIC, 0), v_vendor_baseline);
    IF v_form_qty > v_vendor_baseline THEN
      UPDATE job_work_items
      SET quantity_received = v_form_qty,
          received_date = NULLIF(v_in_json->>'received_date', '')::DATE
      WHERE id = v_new_item_id;
    END IF;
  END LOOP;

  -- Insert new output items — trigger fn_job_work_output_item_to_ledger fires JOB_WORK_OUTPUT_IN for each
  FOR v_out_json IN SELECT * FROM jsonb_array_elements(p_output_items)
  LOOP
    INSERT INTO job_work_output_items (
      job_work_order_id, item_master_id, item_name,
      material_type_id, material_size_id, size_label,
      quantity, unit, source_job_line_id, notes
    ) VALUES (
      p_order_id,
      NULLIF(v_out_json->>'item_master_id', '')::UUID,
      NULLIF(v_out_json->>'item_name', ''),
      NULLIF(v_out_json->>'material_type_id', '')::UUID,
      NULLIF(v_out_json->>'material_size_id', '')::UUID,
      NULLIF(v_out_json->>'size_label', ''),
      (v_out_json->>'quantity')::NUMERIC,
      COALESCE(NULLIF(v_out_json->>'unit', ''), 'MT'),
      NULLIF(v_out_json->>'source_job_line_id', ''),
      NULLIF(v_out_json->>'notes', '')
    );
  END LOOP;

  -- Recompute order status from final per-line quantities — same rule
  -- JobWorkReturnClient used to apply client-side before it was stripped
  -- down to a read-only summary.
  SELECT
    bool_and(quantity_received >= quantity_sent - COALESCE(quantity_transferred_out, 0)),
    bool_and(quantity_received <= 0)
  INTO v_all_returned, v_none_returned
  FROM job_work_items WHERE job_work_order_id = p_order_id;

  UPDATE job_work_orders SET
    status = CASE WHEN v_all_returned THEN 'completed' WHEN v_none_returned THEN 'dispatched' ELSE 'partial_return' END,
    actual_return_date = CASE WHEN v_all_returned THEN CURRENT_DATE ELSE NULL END,
    updated_at = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
