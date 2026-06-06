-- ============================================================
-- WareCore WMS - Stock Reconciliation
-- ============================================================
-- Fixes the root cause of phantom stock entries:
-- When purchase_bill_items are DELETED (draft edit, active-bill edit),
-- the original PURCHASE_IN entries in stock_ledger are not reversed,
-- causing the stock statement to show inflated figures.
--
-- Part 1: DELETE trigger — prevents future phantom entries
-- Part 2: reconcile_purchase_stock() — fixes existing phantoms
-- ============================================================

-- Part 1: Reverse PURCHASE_IN when an item is removed from a bill

CREATE OR REPLACE FUNCTION fn_bill_item_deleted()
RETURNS TRIGGER AS $$
DECLARE
  v_bill purchase_bills%ROWTYPE;
BEGIN
  IF OLD.purchase_line_id IS NULL THEN
    RETURN OLD;
  END IF;
  SELECT * INTO v_bill FROM purchase_bills WHERE id = OLD.bill_id;
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

CREATE OR REPLACE TRIGGER tr_bill_item_deleted
AFTER DELETE ON purchase_bill_items
FOR EACH ROW
EXECUTE FUNCTION fn_bill_item_deleted();

-- Part 2: Fix existing phantom entries from past draft edits
-- For each purchase_line_id that has net positive stock in the ledger
-- but no corresponding row in purchase_bill_items, insert a
-- PURCHASE_CANCEL to zero it out.

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
      MAX(sl.company_id)       AS company_id,
      MAX(sl.warehouse_id)     AS warehouse_id,
      MAX(sl.material_type_id) AS material_type_id,
      MAX(sl.material_size_id) AS material_size_id,
      MAX(sl.size_label)       AS size_label,
      MAX(sl.reference_id)     AS reference_id,
      MAX(sl.reference_number) AS reference_number
    FROM stock_ledger sl
    WHERE sl.purchase_line_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM purchase_bill_items pbi
        WHERE pbi.purchase_line_id = sl.purchase_line_id
      )
    GROUP BY sl.purchase_line_id
  ) phantoms
  WHERE net_qty > 0;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
