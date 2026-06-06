-- Atomically edit a dispatch order (draft or active).
-- For active orders: inserts SALE_CANCEL reversals for old items, then inserts new items
-- so the trigger fn_dispatch_item_to_ledger fires SALE_OUT for each new item.
CREATE OR REPLACE FUNCTION edit_dispatch_order(
  p_order_id        UUID,
  p_invoice_number  TEXT,
  p_dispatch_date   DATE,
  p_vehicle_number  TEXT,
  p_driver_name     TEXT,
  p_notes           TEXT,
  p_company_id      UUID,
  p_warehouse_id    UUID,
  p_customer_id     UUID,
  p_sale_ref_id     TEXT,
  p_status          TEXT,
  p_total_quantity  NUMERIC,
  p_total_amount    NUMERIC,
  p_items           JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order dispatch_orders%ROWTYPE;
  v_item  JSONB;
BEGIN
  SELECT * INTO v_order FROM dispatch_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Dispatch order not found');
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot edit a cancelled order');
  END IF;

  -- Reverse stock for currently-active order items
  IF v_order.status = 'active' THEN
    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id,
      material_type_id, material_size_id, size_label,
      quantity,
      reference_type, reference_id, reference_number,
      notes, entry_date,
      purchase_line_id, sub_purchase_line_id
    )
    SELECT
      'SALE_CANCEL',
      v_order.company_id, v_order.warehouse_id,
      di.material_type_id, di.material_size_id, di.size_label,
      di.quantity,
      'dispatch', v_order.id, v_order.invoice_number,
      'Sale edit — stock reversal',
      CURRENT_DATE,
      di.purchase_line_id, di.sub_purchase_line_id
    FROM dispatch_items di
    WHERE di.dispatch_order_id = p_order_id;
  END IF;

  -- Delete existing items
  DELETE FROM dispatch_items WHERE dispatch_order_id = p_order_id;

  -- Update order header (status updated BEFORE inserting items so trigger sees correct status)
  UPDATE dispatch_orders SET
    invoice_number = p_invoice_number,
    dispatch_date  = p_dispatch_date,
    vehicle_number = p_vehicle_number,
    driver_name    = p_driver_name,
    notes          = p_notes,
    company_id     = p_company_id,
    warehouse_id   = p_warehouse_id,
    customer_id    = p_customer_id,
    sale_ref_id    = p_sale_ref_id,
    status         = p_status,
    total_quantity = p_total_quantity,
    total_amount   = p_total_amount,
    updated_at     = NOW()
  WHERE id = p_order_id;

  -- Insert new items — trigger fn_dispatch_item_to_ledger fires SALE_OUT for each (if status='active')
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO dispatch_items (
      dispatch_order_id,
      item_master_id, sale_line_id, purchase_line_id,
      item_name, material_type_id, material_size_id, size_label,
      quantity, unit, rate, amount, notes,
      tax_rate_id, taxable_value,
      cgst_rate, cgst_amount, sgst_rate, sgst_amount,
      tcs_rate, tcs_amount, total_with_tax
    ) VALUES (
      p_order_id,
      NULLIF(v_item->>'item_master_id', '')::UUID,
      NULLIF(v_item->>'sale_line_id', ''),
      NULLIF(v_item->>'purchase_line_id', ''),
      NULLIF(v_item->>'item_name', ''),
      (v_item->>'material_type_id')::UUID,
      NULLIF(v_item->>'material_size_id', '')::UUID,
      NULLIF(v_item->>'size_label', ''),
      (v_item->>'quantity')::NUMERIC,
      COALESCE(NULLIF(v_item->>'unit', ''), 'tons'),
      NULLIF(v_item->>'rate', '')::NUMERIC,
      NULLIF(v_item->>'amount', '')::NUMERIC,
      NULLIF(v_item->>'notes', ''),
      NULLIF(v_item->>'tax_rate_id', '')::UUID,
      NULLIF(v_item->>'taxable_value', '')::NUMERIC,
      NULLIF(v_item->>'cgst_rate', '')::NUMERIC,
      NULLIF(v_item->>'cgst_amount', '')::NUMERIC,
      NULLIF(v_item->>'sgst_rate', '')::NUMERIC,
      NULLIF(v_item->>'sgst_amount', '')::NUMERIC,
      NULLIF(v_item->>'tcs_rate', '')::NUMERIC,
      NULLIF(v_item->>'tcs_amount', '')::NUMERIC,
      NULLIF(v_item->>'total_with_tax', '')::NUMERIC
    );
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$$;
