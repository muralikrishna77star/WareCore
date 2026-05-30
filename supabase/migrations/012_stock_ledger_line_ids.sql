-- ============================================================
-- WareCore WMS - Stock Ledger Line IDs
-- ============================================================

ALTER TABLE stock_ledger
  ADD COLUMN IF NOT EXISTS purchase_line_id TEXT,
  ADD COLUMN IF NOT EXISTS sub_purchase_line_id TEXT;

CREATE INDEX IF NOT EXISTS idx_stock_ledger_purchase_line_id ON stock_ledger(purchase_line_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_sub_purchase_line_id ON stock_ledger(sub_purchase_line_id);

-- Update stock ledger trigger functions to carry purchase/sub-purchase line IDs

CREATE OR REPLACE FUNCTION fn_bill_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_bill purchase_bills%ROWTYPE;
BEGIN
  SELECT * INTO v_bill FROM purchase_bills WHERE id = NEW.bill_id;
  INSERT INTO stock_ledger (
    entry_type, company_id, warehouse_id, material_type_id, material_size_id,
    size_label, quantity, reference_type, reference_id, reference_number,
    notes, entry_date, created_by, purchase_line_id, sub_purchase_line_id
  ) VALUES (
    'PURCHASE_IN',
    v_bill.company_id,
    v_bill.warehouse_id,
    NEW.material_type_id,
    NEW.material_size_id,
    NEW.size_label,
    NEW.quantity,
    'purchase_bill',
    v_bill.id,
    v_bill.bill_number,
    NEW.notes,
    v_bill.bill_date,
    v_bill.created_by,
    NEW.purchase_line_id,
    NULL
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_dispatch_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_dispatch dispatch_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_dispatch FROM dispatch_orders WHERE id = NEW.dispatch_order_id;
  INSERT INTO stock_ledger (
    entry_type, company_id, warehouse_id, material_type_id, material_size_id,
    size_label, quantity, reference_type, reference_id, reference_number,
    notes, entry_date, created_by, purchase_line_id, sub_purchase_line_id
  ) VALUES (
    'SALE_OUT',
    v_dispatch.company_id,
    v_dispatch.warehouse_id,
    NEW.material_type_id,
    NEW.material_size_id,
    NEW.size_label,
    -NEW.quantity,
    'dispatch',
    v_dispatch.id,
    v_dispatch.invoice_number,
    NEW.notes,
    v_dispatch.dispatch_date,
    v_dispatch.created_by,
    NEW.purchase_line_id,
    NEW.sub_purchase_line_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_job_work_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_order job_work_orders%ROWTYPE;
  v_returned_delta DECIMAL(15,3);
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = NEW.job_work_order_id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id, material_type_id, material_size_id,
      size_label, quantity, reference_type, reference_id, reference_number,
      entry_date, created_by, purchase_line_id, sub_purchase_line_id
    ) VALUES (
      'JOB_WORK_OUT',
      v_order.company_id,
      v_order.warehouse_id,
      NEW.material_type_id,
      NEW.material_size_id,
      NEW.size_label,
      -NEW.quantity_sent,
      'job_work',
      v_order.id,
      v_order.reference_number,
      v_order.dispatch_date,
      v_order.created_by,
      NEW.purchase_line_id,
      NEW.sub_purchase_line_id
    );

  ELSIF TG_OP = 'UPDATE' AND NEW.quantity_received > OLD.quantity_received THEN
    v_returned_delta := NEW.quantity_received - OLD.quantity_received;
    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id, material_type_id, material_size_id,
      size_label, quantity, reference_type, reference_id, reference_number,
      entry_date, created_by, purchase_line_id, sub_purchase_line_id
    ) VALUES (
      'JOB_WORK_RETURN_IN',
      v_order.company_id,
      v_order.warehouse_id,
      NEW.material_type_id,
      NEW.material_size_id,
      NEW.size_label,
      v_returned_delta,
      'job_work',
      v_order.id,
      v_order.reference_number,
      CURRENT_DATE,
      v_order.created_by,
      NEW.purchase_line_id,
      NEW.sub_purchase_line_id
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
