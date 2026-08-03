-- ============================================================
-- WareCore WMS - purge_cancelled_dispatch(): delete the order's ledger
-- footprint on purge, mirroring purge_cancelled_bill (migration 054).
--
-- purge_cancelled_dispatch() archives a cancelled order into
-- dispatch_cancellations/dispatch_cancellation_items and deletes the
-- dispatch_orders row, but never removed the order's stock_ledger rows
-- (SALE_OUT and any SALE_CANCEL) — purchase bills got this fix in
-- migration 054; dispatch purge never did. Net stock stays correct
-- (rows sum to zero), but every purged order leaves a permanently
-- orphaned SALE_OUT sitting in stock_ledger, referencing an order that
-- no longer exists — inflating the "sales" category's ledger total in
-- Stock Reconciliation against the (correctly order-excluding) source
-- total forever, and cluttering the Item Ledger.
-- ============================================================

CREATE OR REPLACE FUNCTION purge_cancelled_dispatch(p_order_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS jsonb AS $$
DECLARE
  v_order            dispatch_orders%ROWTYPE;
  v_cancellation_id  uuid;
BEGIN
  SELECT * INTO v_order FROM dispatch_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Dispatch order not found');
  END IF;
  IF v_order.status != 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only cancelled orders can be purged');
  END IF;

  INSERT INTO dispatch_cancellations (
    original_order_id, invoice_number, dispatch_date,
    company_id, company_name,
    warehouse_id, warehouse_name,
    customer_id, customer_name,
    vehicle_number, driver_name, sale_ref_id,
    total_quantity, total_amount, notes,
    cancelled_at, cancelled_notes,
    purged_by_id
  )
  SELECT
    v_order.id, v_order.invoice_number, v_order.dispatch_date,
    v_order.company_id, c.name,
    v_order.warehouse_id, w.name,
    v_order.customer_id, cu.name,
    v_order.vehicle_number, v_order.driver_name, v_order.sale_ref_id,
    v_order.total_quantity, v_order.total_amount, v_order.notes,
    v_order.cancelled_at, v_order.cancelled_notes,
    p_user_id
  FROM (SELECT 1) AS _dummy
  LEFT JOIN companies  c ON c.id = v_order.company_id
  LEFT JOIN warehouses w ON w.id = v_order.warehouse_id
  LEFT JOIN customers  cu ON cu.id = v_order.customer_id
  RETURNING id INTO v_cancellation_id;

  INSERT INTO dispatch_cancellation_items (
    cancellation_id, original_item_id, sale_line_id, purchase_line_id,
    item_master_id, item_name,
    material_type_id, material_type_name,
    material_size_id, size_label,
    quantity, rate, amount, notes,
    tax_rate_id, taxable_value,
    cgst_rate, cgst_amount,
    sgst_rate, sgst_amount,
    tcs_rate, tcs_amount, total_with_tax
  )
  SELECT
    v_cancellation_id, di.id, di.sale_line_id, di.purchase_line_id,
    di.item_master_id, di.item_name,
    di.material_type_id, mt.description,
    di.material_size_id, di.size_label,
    di.quantity, di.rate, di.amount, di.notes,
    di.tax_rate_id, di.taxable_value,
    di.cgst_rate, di.cgst_amount,
    di.sgst_rate, di.sgst_amount,
    di.tcs_rate, di.tcs_amount, di.total_with_tax
  FROM dispatch_items di
  LEFT JOIN material_types mt ON mt.id = di.material_type_id
  WHERE di.dispatch_order_id = p_order_id;

  -- Remove this order's stock ledger entries (SALE_OUT and any
  -- SALE_CANCEL reversals). The order is archived above, so there is
  -- nothing left to reconcile the ledger rows against.
  DELETE FROM stock_ledger
  WHERE reference_type = 'dispatch' AND reference_id = p_order_id;

  DELETE FROM dispatch_orders WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'cancellation_id', v_cancellation_id);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- One-time cleanup: dispatch orders already purged under the old
-- function left their stock_ledger rows behind, orphaned (reference_id
-- no longer resolves to a dispatch_orders row). Nets to zero — pure
-- clutter — safe to remove, mirroring migration 054's equivalent cleanup
-- for purchase bills.
-- ============================================================

DELETE FROM stock_ledger sl
WHERE sl.reference_type = 'dispatch'
  AND NOT EXISTS (SELECT 1 FROM dispatch_orders d WHERE d.id = sl.reference_id);
