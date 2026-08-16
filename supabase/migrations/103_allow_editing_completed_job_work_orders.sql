-- Allow editing a completed Job Work order (e.g. to correct a wrong Vendor
-- entered at dispatch time, discovered only after the order was fully
-- returned). Previously edit_job_work_order() rejected any edit once
-- status = 'completed'; only 'cancelled' orders should stay locked. No
-- other change: the existing delete-and-reinsert-ledger-rows body already
-- recalculates stock correctly for any input/output quantity change,
-- regardless of the order's status at edit time.
CREATE OR REPLACE FUNCTION public.edit_job_work_order(p_order_id uuid, p_company_id uuid, p_warehouse_id uuid, p_vendor_id uuid, p_dispatch_date date, p_expected_return_date date, p_work_description text, p_notes text, p_input_items jsonb, p_output_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
  v_old_transferred_out NUMERIC;
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Job work order not found');
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot edit a cancelled order');
  END IF;

  -- Capture each existing line's transfer-destination flag/link and
  -- transfer-source progress before it's deleted, keyed by purchase_line_id,
  -- so the rebuilt row can carry all of it forward instead of silently
  -- defaulting to false/NULL/0.
  SELECT COALESCE(jsonb_object_agg(
    purchase_line_id,
    jsonb_build_object(
      'is_transfer_line', is_transfer_line,
      'source_job_work_item_id', source_job_work_item_id,
      'quantity_transferred_out', quantity_transferred_out
    )
  ), '{}'::jsonb)
  INTO v_old_transfer_info
  FROM job_work_items
  WHERE job_work_order_id = p_order_id AND purchase_line_id IS NOT NULL;

  -- Remove all stock ledger entries previously created for this order
  -- EXCEPT:
  --  - vendor-direct-sale virtual-return rows, which belong to a separate
  --    flow (Sell from Vendor) and must survive an Edit Order save untouched
  --    — deleting/recreating them here would lose the note tag the Item
  --    Ledger report depends on to merge the sale+return display row.
  --  - JOB_WORK_TRANSFER_OUT rows, which record material this order already
  --    sent on to a different vendor via a completed Job Work Transfer.
  --    That transfer's destination order/item is untouched by this edit, so
  --    deleting the source-side row here would orphan it and double-count
  --    this order's remaining vendor stock.
  DELETE FROM stock_ledger
  WHERE reference_type = 'job_work' AND reference_id = p_order_id
    AND NOT (entry_type = 'JOB_WORK_RETURN_IN' AND notes = 'Vendor direct sale — virtual return')
    AND entry_type <> 'JOB_WORK_TRANSFER_OUT';

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
    v_old_transferred_out := COALESCE((v_old_transfer_info -> v_line_key ->> 'quantity_transferred_out')::numeric, 0);

    INSERT INTO job_work_items (
      job_work_order_id, purchase_line_id, sub_purchase_line_id, job_line_id,
      item_master_id, item_name, material_type_id, material_size_id, size_label,
      quantity_sent, quantity_received, unit, notes,
      is_transfer_line, source_job_work_item_id, quantity_transferred_out
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
      v_source_item_id,
      v_old_transferred_out
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
$function$;
