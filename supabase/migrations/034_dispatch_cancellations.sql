-- Archive tables for purged cancelled dispatch orders

CREATE TABLE dispatch_cancellations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  original_order_id UUID,
  invoice_number    TEXT,
  dispatch_date     DATE,
  company_id        UUID,
  company_name      TEXT,
  warehouse_id      UUID,
  warehouse_name    TEXT,
  customer_id       UUID,
  customer_name     TEXT,
  vehicle_number    TEXT,
  driver_name       TEXT,
  sale_ref_id       TEXT,
  total_quantity    DECIMAL(15,3),
  total_amount      DECIMAL(15,2),
  notes             TEXT,
  cancelled_at      TIMESTAMPTZ,
  cancelled_notes   TEXT,
  purged_at         TIMESTAMPTZ DEFAULT NOW(),
  purged_by_id      UUID
);

CREATE TABLE dispatch_cancellation_items (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cancellation_id       UUID NOT NULL REFERENCES dispatch_cancellations(id) ON DELETE CASCADE,
  original_item_id      UUID,
  sale_line_id          TEXT,
  purchase_line_id      TEXT,
  item_master_id        UUID,
  item_name             TEXT,
  material_type_id      UUID,
  material_type_name    TEXT,
  material_size_id      UUID,
  size_label            TEXT,
  quantity              DECIMAL(15,3),
  rate                  DECIMAL(15,2),
  amount                DECIMAL(15,2),
  notes                 TEXT,
  tax_rate_id           UUID,
  taxable_value         DECIMAL(15,2),
  cgst_rate             DECIMAL(5,2),
  cgst_amount           DECIMAL(15,2),
  sgst_rate             DECIMAL(5,2),
  sgst_amount           DECIMAL(15,2),
  tcs_rate              DECIMAL(5,2),
  tcs_amount            DECIMAL(15,2),
  total_with_tax        DECIMAL(15,2)
);

CREATE INDEX idx_dispatch_cancellations_purged_at ON dispatch_cancellations(purged_at DESC);
CREATE INDEX idx_dispatch_cancellation_items_cancellation ON dispatch_cancellation_items(cancellation_id);

-- Atomic purge function
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

  DELETE FROM dispatch_orders WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'cancellation_id', v_cancellation_id);
END;
$$ LANGUAGE plpgsql;
