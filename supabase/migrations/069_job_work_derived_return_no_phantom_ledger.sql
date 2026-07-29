-- ============================================================
-- WareCore WMS - Qty Returned (input) is now purely derived from output;
-- stop it from posting a phantom JOB_WORK_RETURN_IN
--
-- The Edit Order screen no longer lets a user manually type a Job Work
-- input line's "Qty Returned" — it's now a read-only display, computed
-- client-side as the total of output-material rows sharing that input's
-- Job Line ID (a coil sent as input can be slit into several different
-- output sizes/categories, each with its own Received Date). That derived
-- total is still submitted as job_work_items.quantity_received, so order
-- status/"Balance at Vendor" reporting keep working — but two things in
-- edit_job_work_order() (migrations 066-068) assumed a *manually typed*
-- value and are now wrong:
--
-- 1. It used GREATEST(vendor_direct_baseline, submitted_value) — correct
--    when a human typed the true grand total (vendor-direct sale rows are
--    a floor a manual entry can't undercut), but the frontend now submits
--    only the output-derived portion, not a grand total. Needs to be
--    additive: baseline + output-derived portion.
-- 2. Whenever quantity_received increased, it let the normal (unguarded)
--    trigger branch post a fresh JOB_WORK_RETURN_IN — adding the *input's
--    own raw material* back to warehouse stock. That was correct for a
--    genuine physical return, but the "return" is now always backed by
--    real JOB_WORK_OUTPUT_IN rows (a different, processed item) that
--    already correctly added stock. Posting both would double-count.
--    Fix: guard this UPDATE with warecore.skip_job_work_return_trigger,
--    same mechanism already used for vendor-direct-sale (062), since
--    every path that can raise quantity_received now has its own correct
--    ledger entry elsewhere (JOB_WORK_OUTPUT_IN, or the preserved
--    vendor-direct-sale row) — this UPDATE is bookkeeping-only from here.
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
  v_order              job_work_orders%ROWTYPE;
  v_in_json            JSONB;
  v_out_json           JSONB;
  v_new_item_id        UUID;
  v_vendor_baseline    NUMERIC;
  v_form_qty           NUMERIC;
  v_all_returned       BOOLEAN;
  v_none_returned      BOOLEAN;
  v_old_transfer_info  JSONB;
  v_line_key           TEXT;
  v_is_transfer_line   BOOLEAN;
  v_source_item_id     UUID;
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

  -- Capture each existing line's transfer-destination flag/link before it's
  -- deleted, keyed by purchase_line_id, so the rebuilt row can carry it
  -- forward instead of silently defaulting to false/NULL.
  SELECT COALESCE(jsonb_object_agg(
    purchase_line_id,
    jsonb_build_object('is_transfer_line', is_transfer_line, 'source_job_work_item_id', source_job_work_item_id)
  ), '{}'::jsonb)
  INTO v_old_transfer_info
  FROM job_work_items
  WHERE job_work_order_id = p_order_id AND purchase_line_id IS NOT NULL;

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

  -- Insert new input items — trigger fn_job_work_item_to_ledger fires
  -- JOB_WORK_OUT (plain line) or JOB_WORK_TRANSFER_IN (transfer-destination
  -- line) depending on is_transfer_line, exactly as it did on the order's
  -- original creation.
  FOR v_in_json IN SELECT * FROM jsonb_array_elements(p_input_items)
  LOOP
    v_line_key := NULLIF(v_in_json->>'purchase_line_id', '');

    -- Whatever this line's purchase_line_id already has posted via vendor-direct
    -- sale is a real, separately-ledgered contribution to how much of this
    -- input has been closed out — additive with the output-derived portion
    -- submitted below, not a floor to clamp a "grand total" against (the
    -- frontend no longer sends a grand total, only the output-derived part).
    SELECT COALESCE(SUM(quantity), 0) INTO v_vendor_baseline
    FROM stock_ledger
    WHERE reference_type = 'job_work' AND reference_id = p_order_id
      AND entry_type = 'JOB_WORK_RETURN_IN' AND notes = 'Vendor direct sale — virtual return'
      AND purchase_line_id = v_line_key;

    v_is_transfer_line := COALESCE((v_old_transfer_info -> v_line_key ->> 'is_transfer_line')::boolean, false);
    v_source_item_id := (v_old_transfer_info -> v_line_key ->> 'source_job_work_item_id')::uuid;

    INSERT INTO job_work_items (
      job_work_order_id, purchase_line_id, sub_purchase_line_id, job_line_id,
      item_master_id, item_name, material_type_id, material_size_id, size_label,
      quantity_sent, quantity_received, unit, notes,
      is_transfer_line, source_job_work_item_id
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
      NULLIF(v_in_json->>'notes', ''),
      v_is_transfer_line,
      v_source_item_id
    )
    RETURNING id INTO v_new_item_id;

    -- quantity_received submitted here is purely the output-derived portion
    -- (sum of output rows sharing this line's Job Line ID) — add it on top
    -- of the vendor-direct baseline. Guarded: every unit this can add is
    -- already backed by its own correct ledger entry elsewhere (a
    -- JOB_WORK_OUTPUT_IN row for the produced item, or the preserved
    -- vendor-direct-sale row above) — letting the generic trigger post its
    -- own JOB_WORK_RETURN_IN here would double-count the same stock.
    v_form_qty := v_vendor_baseline + COALESCE((v_in_json->>'quantity_received')::NUMERIC, 0);
    IF v_form_qty > v_vendor_baseline THEN
      PERFORM set_config('warecore.skip_job_work_return_trigger', 'true', true);
      UPDATE job_work_items
      SET quantity_received = v_form_qty,
          received_date = NULLIF(v_in_json->>'received_date', '')::DATE
      WHERE id = v_new_item_id;
      PERFORM set_config('warecore.skip_job_work_return_trigger', 'false', true);
    END IF;
  END LOOP;

  -- Insert new output items — trigger fn_job_work_output_item_to_ledger fires JOB_WORK_OUTPUT_IN for each
  FOR v_out_json IN SELECT * FROM jsonb_array_elements(p_output_items)
  LOOP
    INSERT INTO job_work_output_items (
      job_work_order_id, item_master_id, item_name,
      material_type_id, material_size_id, size_label,
      quantity, unit, source_job_line_id, notes, received_date
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
      NULLIF(v_out_json->>'notes', ''),
      NULLIF(v_out_json->>'received_date', '')::DATE
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
