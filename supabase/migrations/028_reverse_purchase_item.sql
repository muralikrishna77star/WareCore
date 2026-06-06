-- Helper used when editing an active purchase bill: inserts a PURCHASE_CANCEL
-- stock_ledger entry to reverse the original PURCHASE_IN for a specific item,
-- then the caller deletes the item row.  New items trigger a fresh PURCHASE_IN
-- via the existing fn_bill_item_to_ledger trigger.

CREATE OR REPLACE FUNCTION reverse_purchase_item(p_bill_id uuid, p_item_id uuid)
RETURNS void AS $$
DECLARE
  v_bill purchase_bills%ROWTYPE;
  v_item purchase_bill_items%ROWTYPE;
BEGIN
  SELECT * INTO v_bill FROM purchase_bills WHERE id = p_bill_id;
  SELECT * INTO v_item FROM purchase_bill_items WHERE id = p_item_id AND bill_id = p_bill_id;
  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO stock_ledger (
    entry_type, company_id, warehouse_id,
    material_type_id, material_size_id, size_label,
    quantity, reference_type, reference_id, reference_number,
    notes, entry_date, purchase_line_id
  ) VALUES (
    'PURCHASE_CANCEL',
    v_bill.company_id, v_bill.warehouse_id,
    v_item.material_type_id, v_item.material_size_id, v_item.size_label,
    -v_item.quantity,
    'purchase_bill', v_bill.id, v_bill.bill_number,
    'Edit correction', CURRENT_DATE,
    v_item.purchase_line_id
  );
END;
$$ LANGUAGE plpgsql;
