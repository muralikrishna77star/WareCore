-- ============================================================
-- WareCore WMS - Fix reconcile_purchase_stock function
-- ============================================================
-- Updates migration 029's function to be more robust:
--   1. fn_bill_item_deleted: skip if bill has no company/warehouse
--      (prevents trigger failure when editing bills with nullable FKs)
--   2. reconcile_purchase_stock: use FILTER(WHERE entry_type='PURCHASE_IN')
--      for metadata columns so we always get the original purchase values,
--      and guard against NULL required fields via HAVING
-- ============================================================

-- Part 1: Guard the deletion trigger against NULL company/warehouse
CREATE OR REPLACE FUNCTION fn_bill_item_deleted()
RETURNS TRIGGER AS $$
DECLARE
  v_bill purchase_bills%ROWTYPE;
BEGIN
  IF OLD.purchase_line_id IS NULL THEN
    RETURN OLD;
  END IF;
  SELECT * INTO v_bill FROM purchase_bills WHERE id = OLD.bill_id;
  IF v_bill.company_id IS NULL OR v_bill.warehouse_id IS NULL THEN
    RETURN OLD;
  END IF;
  INSERT INTO stock_ledger (
    entry_type, company_id, warehouse_id, material_type_id, material_size_id,
    size_label, quantity, reference_type, reference_id, reference_number,
    notes, entry_date, purchase_line_id
  ) VALUES (
    'PURCHASE_CANCEL',
    v_bill.company_id, v_bill.warehouse_id,
    OLD.material_type_id, OLD.material_size_id, OLD.size_label,
    -OLD.quantity,
    'purchase_bill', v_bill.id, COALESCE(v_bill.bill_number, 'DRAFT'),
    'Item removed from bill', CURRENT_DATE, OLD.purchase_line_id
  );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Part 2: Safer reconcile function
-- Uses FILTER(WHERE entry_type='PURCHASE_IN') for metadata so that
-- columns like company_id/warehouse_id always come from the original
-- purchase entry (not from SALE_OUT or PURCHASE_CANCEL entries which
-- can have different warehouse contexts).  The HAVING clause skips any
-- purchase_line_id where those required NOT NULL columns would be null.
CREATE OR REPLACE FUNCTION reconcile_purchase_stock()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  INSERT INTO stock_ledger (
    entry_type, company_id, warehouse_id, material_type_id, material_size_id,
    size_label, quantity, reference_type, reference_id, reference_number,
    notes, entry_date, purchase_line_id
  )
  SELECT
    'PURCHASE_CANCEL',
    company_id, warehouse_id, material_type_id, material_size_id, size_label,
    -net_qty,
    'purchase_bill', reference_id, COALESCE(reference_number, 'RECONCILE'),
    'Stock reconciliation - phantom entry correction',
    CURRENT_DATE,
    purchase_line_id
  FROM (
    SELECT
      sl.purchase_line_id,
      SUM(sl.quantity) AS net_qty,
      (array_agg(sl.company_id)       FILTER (WHERE sl.entry_type = 'PURCHASE_IN'))[1] AS company_id,
      (array_agg(sl.warehouse_id)     FILTER (WHERE sl.entry_type = 'PURCHASE_IN'))[1] AS warehouse_id,
      (array_agg(sl.material_type_id) FILTER (WHERE sl.entry_type = 'PURCHASE_IN'))[1] AS material_type_id,
      (array_agg(sl.material_size_id) FILTER (WHERE sl.entry_type = 'PURCHASE_IN'))[1] AS material_size_id,
      (array_agg(sl.size_label)       FILTER (WHERE sl.entry_type = 'PURCHASE_IN'))[1] AS size_label,
      (array_agg(sl.reference_id)     FILTER (WHERE sl.entry_type = 'PURCHASE_IN'))[1] AS reference_id,
      (array_agg(sl.reference_number) FILTER (WHERE sl.entry_type = 'PURCHASE_IN'))[1] AS reference_number
    FROM stock_ledger sl
    WHERE sl.purchase_line_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM purchase_bill_items pbi
        WHERE pbi.purchase_line_id = sl.purchase_line_id
      )
    GROUP BY sl.purchase_line_id
    HAVING SUM(sl.quantity) > 0
      AND (array_agg(sl.company_id)       FILTER (WHERE sl.entry_type = 'PURCHASE_IN'))[1] IS NOT NULL
      AND (array_agg(sl.warehouse_id)     FILTER (WHERE sl.entry_type = 'PURCHASE_IN'))[1] IS NOT NULL
      AND (array_agg(sl.material_type_id) FILTER (WHERE sl.entry_type = 'PURCHASE_IN'))[1] IS NOT NULL
  ) phantoms;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
