-- ── Archive tables for purged cancelled purchase bills ───────────────────────

CREATE TABLE purchase_cancellations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  original_bill_id  UUID,                        -- reference only; original is deleted
  bill_number       TEXT NOT NULL,
  bill_date         DATE,
  company_id        UUID,
  company_name      TEXT,
  warehouse_id      UUID,
  warehouse_name    TEXT,
  supplier_id       UUID,
  supplier_name     TEXT,
  total_quantity    DECIMAL(15,3),
  total_amount      DECIMAL(15,2),
  notes             TEXT,
  cancelled_at      TIMESTAMPTZ,
  cancelled_notes   TEXT,
  purged_at         TIMESTAMPTZ DEFAULT NOW(),
  purged_by_id      UUID
);

CREATE TABLE purchase_cancellation_items (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cancellation_id       UUID NOT NULL REFERENCES purchase_cancellations(id) ON DELETE CASCADE,
  original_item_id      UUID,
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
  tds_rate              DECIMAL(5,2),
  tds_amount            DECIMAL(15,2),
  total_with_tax        DECIMAL(15,2)
);

CREATE INDEX idx_purchase_cancellations_purged_at ON purchase_cancellations(purged_at DESC);
CREATE INDEX idx_purchase_cancellation_items_cancellation ON purchase_cancellation_items(cancellation_id);

-- ── Atomic purge function ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION purge_cancelled_bill(p_bill_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS jsonb AS $$
DECLARE
  v_bill             purchase_bills%ROWTYPE;
  v_cancellation_id  uuid;
BEGIN
  SELECT * INTO v_bill FROM purchase_bills WHERE id = p_bill_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bill not found');
  END IF;
  IF v_bill.status != 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only cancelled bills can be purged');
  END IF;

  -- Archive the bill (denormalise names so the record is self-contained)
  INSERT INTO purchase_cancellations (
    original_bill_id, bill_number, bill_date,
    company_id,   company_name,
    warehouse_id, warehouse_name,
    supplier_id,  supplier_name,
    total_quantity, total_amount, notes,
    cancelled_at, cancelled_notes,
    purged_by_id
  )
  SELECT
    v_bill.id, v_bill.bill_number, v_bill.bill_date,
    v_bill.company_id,   c.name,
    v_bill.warehouse_id, w.name,
    v_bill.supplier_id,  s.name,
    v_bill.total_quantity, v_bill.total_amount, v_bill.notes,
    v_bill.cancelled_at, v_bill.cancelled_notes,
    p_user_id
  FROM (SELECT 1) AS _dummy
  LEFT JOIN companies  c ON c.id = v_bill.company_id
  LEFT JOIN warehouses w ON w.id = v_bill.warehouse_id
  LEFT JOIN suppliers  s ON s.id = v_bill.supplier_id
  RETURNING id INTO v_cancellation_id;

  -- Archive the line items
  INSERT INTO purchase_cancellation_items (
    cancellation_id, original_item_id, purchase_line_id,
    item_master_id, item_name,
    material_type_id, material_type_name,
    material_size_id, size_label,
    quantity, rate, amount, notes,
    tax_rate_id, taxable_value,
    cgst_rate, cgst_amount,
    sgst_rate, sgst_amount,
    tds_rate,  tds_amount,  total_with_tax
  )
  SELECT
    v_cancellation_id, pbi.id, pbi.purchase_line_id,
    pbi.item_master_id, pbi.item_name,
    pbi.material_type_id, mt.description,
    pbi.material_size_id, pbi.size_label,
    pbi.quantity, pbi.rate, pbi.amount, pbi.notes,
    pbi.tax_rate_id, pbi.taxable_value,
    pbi.cgst_rate, pbi.cgst_amount,
    pbi.sgst_rate, pbi.sgst_amount,
    pbi.tds_rate,  pbi.tds_amount,  pbi.total_with_tax
  FROM purchase_bill_items pbi
  LEFT JOIN material_types mt ON mt.id = pbi.material_type_id
  WHERE pbi.bill_id = p_bill_id;

  -- Remove the original (cascade deletes purchase_bill_items)
  DELETE FROM purchase_bills WHERE id = p_bill_id;

  RETURN jsonb_build_object('success', true, 'cancellation_id', v_cancellation_id);
END;
$$ LANGUAGE plpgsql;
