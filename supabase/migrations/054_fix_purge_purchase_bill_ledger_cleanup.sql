-- ============================================================
-- WareCore WMS - Fix Purge Purchase Bill Ledger Cleanup
-- purge_cancelled_bill() archives a cancelled bill into
-- purchase_cancellations/purchase_cancellation_items and deletes the
-- purchase_bills row, but never removed the bill's stock_ledger rows
-- (the original PURCHASE_IN and its PURCHASE_CANCEL reversal). Net
-- stock stayed correct (they always sum to zero), but every purged
-- bill left a permanent orphaned pair (or more, if the bill had been
-- edited first) cluttering the Item Ledger — exactly the "multiple
-- Purchase Entries and Cancellations" seen for GI00148 (GI 1.15X1240),
-- whose bill 0526-0015 was edited once then cancelled and purged.
--
-- Fix: mirror delete_job_work_order() (migration 051) — delete the
-- bill's stock_ledger rows as part of the purge, since the archive
-- tables already preserve the audit trail.
-- ============================================================

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

  -- Remove this bill's stock ledger entries (PURCHASE_IN and any
  -- PURCHASE_CANCEL reversals). The bill is archived above, so there is
  -- nothing left to reconcile the ledger rows against — deleting them
  -- avoids leaving a permanently orphaned pair in the Item Ledger.
  DELETE FROM stock_ledger
  WHERE reference_type = 'purchase_bill' AND reference_id = p_bill_id;

  -- Remove the original (cascade deletes purchase_bill_items)
  DELETE FROM purchase_bills WHERE id = p_bill_id;

  RETURN jsonb_build_object('success', true, 'cancellation_id', v_cancellation_id);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- One-time data fix: every purchase bill already purged under the old
-- function left its stock_ledger rows behind, orphaned (reference_id no
-- longer resolves to a purchase_bills row). All net to zero, so this is
-- pure ledger clutter with no effect on stock totals — safe to remove.
-- This is what caused GI00148 (bill 0526-0015 / GI 1.15X1240) to show
-- 3 Purchase entries and 2 Cancellations instead of the 1 real, still-
-- active purchase (bill 0524-0146).
-- ============================================================

DELETE FROM stock_ledger sl
WHERE sl.reference_type = 'purchase_bill'
  AND NOT EXISTS (SELECT 1 FROM purchase_bills pb WHERE pb.id = sl.reference_id);
