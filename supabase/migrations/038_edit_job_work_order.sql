-- ============================================================
-- WareCore WMS - Edit Job Work Order with Stock Reversal
-- Atomically edits a job work order's header, input items, and
-- output items. Reverses the net stock impact of the existing
-- items (JOB_WORK_CANCEL entries) before deleting and re-inserting
-- items, so the existing INSERT triggers re-create JOB_WORK_OUT /
-- JOB_WORK_OUTPUT_IN entries for the new line items.
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
  v_order     job_work_orders%ROWTYPE;
  v_item      job_work_items%ROWTYPE;
  v_out_item  job_work_output_items%ROWTYPE;
  v_net_qty   DECIMAL(15,3);
  v_in_json   JSONB;
  v_out_json  JSONB;
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

  -- Reverse stock for current input items (net of any returns already received)
  FOR v_item IN
    SELECT * FROM job_work_items WHERE job_work_order_id = p_order_id
  LOOP
    v_net_qty := v_item.quantity_sent - COALESCE(v_item.quantity_received, 0);

    IF v_net_qty <> 0 THEN
      INSERT INTO stock_ledger (
        entry_type,
        company_id, warehouse_id,
        material_type_id, material_size_id, size_label,
        quantity,
        reference_type, reference_id, reference_number,
        notes, entry_date,
        purchase_line_id, sub_purchase_line_id,
        created_by
      ) VALUES (
        'JOB_WORK_CANCEL',
        v_order.company_id, v_order.warehouse_id,
        v_item.material_type_id, v_item.material_size_id, v_item.size_label,
        v_net_qty,
        'job_work', v_order.id, v_order.reference_number,
        'Job work edit — stock reversal', CURRENT_DATE,
        v_item.purchase_line_id, v_item.sub_purchase_line_id,
        v_order.created_by
      );
    END IF;
  END LOOP;

  -- Reverse stock for current output items
  FOR v_out_item IN
    SELECT * FROM job_work_output_items WHERE job_work_order_id = p_order_id
  LOOP
    IF v_out_item.material_type_id IS NOT NULL THEN
      INSERT INTO stock_ledger (
        entry_type,
        company_id, warehouse_id,
        material_type_id, material_size_id, size_label,
        quantity,
        reference_type, reference_id, reference_number,
        notes, entry_date,
        created_by
      ) VALUES (
        'JOB_WORK_CANCEL',
        v_order.company_id, v_order.warehouse_id,
        v_out_item.material_type_id, v_out_item.material_size_id, v_out_item.size_label,
        -v_out_item.quantity,
        'job_work', v_order.id, v_order.reference_number,
        'Job work edit — stock reversal', CURRENT_DATE,
        v_order.created_by
      );
    END IF;
  END LOOP;

  -- Drop existing line items
  DELETE FROM job_work_items WHERE job_work_order_id = p_order_id;
  DELETE FROM job_work_output_items WHERE job_work_order_id = p_order_id;

  -- Update order header. Editing resets returns: any partial returns recorded
  -- against the old line items no longer apply to the new ones.
  UPDATE job_work_orders SET
    company_id            = p_company_id,
    warehouse_id          = p_warehouse_id,
    vendor_id             = p_vendor_id,
    dispatch_date         = p_dispatch_date,
    expected_return_date  = p_expected_return_date,
    work_description      = p_work_description,
    notes                 = p_notes,
    status                = 'dispatched',
    actual_return_date    = NULL,
    updated_at            = NOW()
  WHERE id = p_order_id;

  -- Insert new input items — trigger fn_job_work_item_to_ledger fires JOB_WORK_OUT for each
  FOR v_in_json IN SELECT * FROM jsonb_array_elements(p_input_items)
  LOOP
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
      0,
      COALESCE(NULLIF(v_in_json->>'unit', ''), 'MT'),
      NULLIF(v_in_json->>'notes', '')
    );
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

  RETURN jsonb_build_object('success', true);
END;
$$;
