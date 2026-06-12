-- ============================================================
-- WareCore WMS - Job Work Cancellations Archive
-- Job work orders have no intermediate "cancelled" status — deleting
-- an order reverses stock immediately and hard-deletes the order
-- (see delete_job_work_order, migrations 035/036). This migration adds
-- archive tables that snapshot the order + input/output line items
-- before that hard delete, and updates delete_job_work_order to write
-- to them, so cancelled job work orders remain visible for audit.
-- ============================================================

CREATE TABLE job_work_cancellations (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  original_order_id     UUID,
  reference_number      TEXT,
  vendor_id             UUID,
  vendor_name           TEXT,
  company_id            UUID,
  company_name          TEXT,
  warehouse_id          UUID,
  warehouse_name        TEXT,
  dispatch_date         DATE,
  expected_return_date  DATE,
  actual_return_date    DATE,
  work_description      TEXT,
  notes                 TEXT,
  status                TEXT,
  cancelled_at          TIMESTAMPTZ DEFAULT NOW(),
  cancelled_notes       TEXT,
  cancelled_by_id       UUID
);

CREATE TABLE job_work_cancellation_items (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cancellation_id       UUID NOT NULL REFERENCES job_work_cancellations(id) ON DELETE CASCADE,
  original_item_id      UUID,
  item_master_id        UUID,
  item_name             TEXT,
  material_type_id      UUID,
  material_type_name    TEXT,
  material_size_id      UUID,
  size_label            TEXT,
  quantity_sent         DECIMAL(15,3),
  quantity_received     DECIMAL(15,3),
  unit                  TEXT,
  purchase_line_id      TEXT,
  sub_purchase_line_id  TEXT,
  job_line_id           TEXT
);

CREATE TABLE job_work_cancellation_output_items (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cancellation_id         UUID NOT NULL REFERENCES job_work_cancellations(id) ON DELETE CASCADE,
  original_item_id        UUID,
  item_master_id          UUID,
  item_name               TEXT,
  material_type_id        UUID,
  material_type_name      TEXT,
  material_size_id        UUID,
  size_label              TEXT,
  quantity                DECIMAL(15,3),
  unit                    TEXT,
  source_job_line_id      TEXT,
  source_purchase_line_ids JSONB,
  notes                   TEXT
);

CREATE INDEX idx_job_work_cancellations_cancelled_at ON job_work_cancellations(cancelled_at DESC);
CREATE INDEX idx_job_work_cancellation_items_cancellation ON job_work_cancellation_items(cancellation_id);
CREATE INDEX idx_job_work_cancellation_output_items_cancellation ON job_work_cancellation_output_items(cancellation_id);

-- ============================================================
-- UPDATE delete_job_work_order to archive before hard delete
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

  -- Restore stock for input items still out at vendor
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
