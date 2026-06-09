-- ============================================================
-- WareCore WMS - Job Work Output Items
-- Tracks produced/output materials from a job work process,
-- enabling full traceability: Purchase Line → Job Work → Output Item.
-- ============================================================

-- Add JOB_WORK_OUTPUT_IN entry type to stock ledger
ALTER TABLE stock_ledger DROP CONSTRAINT IF EXISTS stock_ledger_entry_type_check;
ALTER TABLE stock_ledger
  ADD CONSTRAINT stock_ledger_entry_type_check
  CHECK (entry_type IN (
    'PURCHASE_IN', 'VENDOR_RETURN_IN',
    'SALE_OUT',
    'JOB_WORK_OUT', 'JOB_WORK_RETURN_IN', 'JOB_WORK_CANCEL', 'JOB_WORK_OUTPUT_IN',
    'TRANSFER_OUT', 'TRANSFER_IN',
    'ADJUSTMENT_IN', 'ADJUSTMENT_OUT',
    'PURCHASE_CANCEL', 'SALE_CANCEL'
  ));

-- ============================================================
-- job_work_output_items TABLE
-- ============================================================

CREATE TABLE job_work_output_items (
  id                     UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  job_work_order_id      UUID           NOT NULL REFERENCES job_work_orders(id) ON DELETE CASCADE,
  item_master_id         UUID           REFERENCES item_master(id),
  item_name              TEXT,
  material_type_id       UUID           REFERENCES material_types(id),
  material_size_id       UUID           REFERENCES material_sizes(id),
  size_label             TEXT,
  quantity               DECIMAL(15,3)  NOT NULL CHECK (quantity > 0),
  unit                   TEXT           NOT NULL DEFAULT 'MT',
  -- JSON array of purchase_line_id strings from input items e.g. ["HR0625-0001","HR0625-0002"]
  source_purchase_line_ids JSONB        NOT NULL DEFAULT '[]',
  notes                  TEXT,
  created_at             TIMESTAMPTZ    DEFAULT NOW(),
  updated_at             TIMESTAMPTZ    DEFAULT NOW()
);

CREATE INDEX idx_job_work_output_items_order_id ON job_work_output_items(job_work_order_id);
CREATE INDEX idx_job_work_output_items_item_master ON job_work_output_items(item_master_id);

-- ============================================================
-- TRIGGER: job_work_output_items → stock_ledger (JOB_WORK_OUTPUT_IN)
-- Adds produced output items to stock immediately upon insertion.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_job_work_output_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_order job_work_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = NEW.job_work_order_id;

  -- Only create ledger entry if material_type_id is set
  IF NEW.material_type_id IS NOT NULL THEN
    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id,
      material_type_id, material_size_id, size_label,
      quantity,
      reference_type, reference_id, reference_number,
      entry_date, created_by
    ) VALUES (
      'JOB_WORK_OUTPUT_IN',
      v_order.company_id,
      v_order.warehouse_id,
      NEW.material_type_id,
      NEW.material_size_id,
      NEW.size_label,
      NEW.quantity,
      'job_work',
      v_order.id,
      v_order.reference_number,
      CURRENT_DATE,
      v_order.created_by
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_job_work_output_item_to_ledger
AFTER INSERT ON job_work_output_items
FOR EACH ROW EXECUTE FUNCTION fn_job_work_output_item_to_ledger();

-- ============================================================
-- UPDATE delete_job_work_order to also reverse output item stock
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
  v_order      job_work_orders%ROWTYPE;
  v_item       job_work_items%ROWTYPE;
  v_out_item   job_work_output_items%ROWTYPE;
  v_net_qty    DECIMAL(15,3);
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Job work order not found');
  END IF;

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

  RETURN jsonb_build_object('success', true);
END;
$$;
