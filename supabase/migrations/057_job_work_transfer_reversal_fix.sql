-- ============================================================
-- WareCore WMS - Account for quantity_transferred_out in
-- delete_job_work_order stock reversal
--
-- (edit_job_work_order doesn't need this fix — since migration 041 it
-- reverses by deleting this order's stock_ledger rows outright and lets
-- the insert triggers recreate them from the new line items, rather than
-- computing a net-quantity reversal. Editing an order that has an active
-- transfer against it is flagged to the user in the edit page UI instead —
-- see jobwork/[id]/edit/page.tsx's hasTransfers warning.)
--
-- delete_job_work_order restores "stock still out at vendor" as
-- quantity_sent - quantity_received. That portion already handed to
-- another vendor via a transfer (quantity_transferred_out, migration 056)
-- was already reversed out of this order via its own JOB_WORK_TRANSFER_OUT
-- entry, so it must be excluded here too or it gets double-reversed.
-- ============================================================

CREATE OR REPLACE FUNCTION delete_job_work_order(
  p_order_id UUID,
  p_notes    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order           job_work_orders%ROWTYPE;
  v_item            job_work_items%ROWTYPE;
  v_out_item        job_work_output_items%ROWTYPE;
  v_net_qty         DECIMAL(15,3);
  v_cancellation_id UUID;
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Job work order not found');
  END IF;

  -- Archive the order snapshot
  INSERT INTO job_work_cancellations (
    original_order_id, reference_number,
    vendor_id, vendor_name,
    company_id, company_name,
    warehouse_id, warehouse_name,
    dispatch_date, expected_return_date, actual_return_date,
    work_description, notes, status,
    cancelled_notes
  )
  SELECT
    v_order.id, v_order.reference_number,
    v_order.vendor_id, s.name,
    v_order.company_id, c.name,
    v_order.warehouse_id, w.name,
    v_order.dispatch_date, v_order.expected_return_date, v_order.actual_return_date,
    v_order.work_description, v_order.notes, v_order.status,
    p_notes
  FROM (SELECT 1) AS _dummy
  LEFT JOIN suppliers  s ON s.id = v_order.vendor_id
  LEFT JOIN companies  c ON c.id = v_order.company_id
  LEFT JOIN warehouses w ON w.id = v_order.warehouse_id
  RETURNING id INTO v_cancellation_id;

  -- Archive input line items
  INSERT INTO job_work_cancellation_items (
    cancellation_id, original_item_id,
    item_master_id, item_name,
    material_type_id, material_type_name,
    material_size_id, size_label,
    quantity_sent, quantity_received, unit,
    purchase_line_id, sub_purchase_line_id, job_line_id
  )
  SELECT
    v_cancellation_id, ji.id,
    ji.item_master_id, ji.item_name,
    ji.material_type_id, mt.description,
    ji.material_size_id, ji.size_label,
    ji.quantity_sent, ji.quantity_received, ji.unit,
    ji.purchase_line_id, ji.sub_purchase_line_id, ji.job_line_id
  FROM job_work_items ji
  LEFT JOIN material_types mt ON mt.id = ji.material_type_id
  WHERE ji.job_work_order_id = p_order_id;

  -- Archive output line items
  INSERT INTO job_work_cancellation_output_items (
    cancellation_id, original_item_id,
    item_master_id, item_name,
    material_type_id, material_type_name,
    material_size_id, size_label,
    quantity, unit,
    source_job_line_id, source_purchase_line_ids, notes
  )
  SELECT
    v_cancellation_id, oi.id,
    oi.item_master_id, oi.item_name,
    oi.material_type_id, mt.description,
    oi.material_size_id, oi.size_label,
    oi.quantity, oi.unit,
    oi.source_job_line_id, oi.source_purchase_line_ids, oi.notes
  FROM job_work_output_items oi
  LEFT JOIN material_types mt ON mt.id = oi.material_type_id
  WHERE oi.job_work_order_id = p_order_id;

  -- Restore stock for input items still out at vendor (excluding quantity
  -- already handed to another vendor via a transfer — that portion was
  -- already reversed out of this order via its own JOB_WORK_TRANSFER_OUT entry)
  FOR v_item IN
    SELECT * FROM job_work_items WHERE job_work_order_id = p_order_id
  LOOP
    v_net_qty := v_item.quantity_sent - COALESCE(v_item.quantity_received, 0) - COALESCE(v_item.quantity_transferred_out, 0);

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
        p_notes, CURRENT_DATE,
        v_item.purchase_line_id, v_item.sub_purchase_line_id,
        v_order.created_by
      );
    END IF;
  END LOOP;

  -- Reverse output item stock (undo JOB_WORK_OUTPUT_IN entries)
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
        p_notes, CURRENT_DATE,
        v_order.created_by
      );
    END IF;
  END LOOP;

  -- Hard delete — cascades to job_work_items and job_work_output_items
  DELETE FROM job_work_orders WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'cancellation_id', v_cancellation_id);
END;
$$;
