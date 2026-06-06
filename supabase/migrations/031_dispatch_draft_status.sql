-- ============================================================
-- WareCore WMS - Dispatch Orders Draft Status
-- ============================================================
-- 1. Add 'draft' to dispatch_orders status constraint
-- 2. Modify fn_dispatch_item_to_ledger to skip for draft orders
--    (stock is only committed when order status = 'active')

ALTER TABLE dispatch_orders DROP CONSTRAINT IF EXISTS dispatch_orders_status_check;
ALTER TABLE dispatch_orders ADD CONSTRAINT dispatch_orders_status_check
  CHECK (status IN ('draft', 'active', 'cancelled'));

-- Modify trigger: skip SALE_OUT ledger entry for draft orders.
-- When a draft is submitted (status changed to active), stock entries
-- are written by a separate call via the submit_dispatch_order function.
CREATE OR REPLACE FUNCTION fn_dispatch_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_dispatch dispatch_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_dispatch FROM dispatch_orders WHERE id = NEW.dispatch_order_id;
  -- Skip ledger entry for draft orders
  IF v_dispatch.status = 'draft' THEN
    RETURN NEW;
  END IF;
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
