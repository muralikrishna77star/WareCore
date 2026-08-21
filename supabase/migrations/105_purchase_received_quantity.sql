-- Add a "Received Quantity" to purchase bill lines, independent from the
-- invoiced Quantity.
--
-- Why: in scrap/coil trading, the weighbridge-verified quantity actually
-- received often differs slightly from what the supplier invoices (weighing
-- tolerance, or supplier underbilling) — see CR00431's item reconciliation
-- mismatch (closing balance -0.090, chased down to purchase line
-- CR0624-0011: 4 real dispatch invoices sold 15.020 MT against only 14.930
-- MT invoiced). Previously the only number on a purchase line was the
-- invoiced quantity, which also drove stock — so a supplier who invoices
-- light for material we actually received (or weighed heavier at our own
-- weighbridge) made the system think we oversold, when nothing was wrong.
--
-- Fix: received_quantity is the new stock-driving figure (PURCHASE_IN /
-- PURCHASE_CANCEL amounts, and therefore everything computed from
-- stock_ledger — dispatch/job-work "available to sell", the reconciliation
-- checks). quantity/rate/amount/tax stay exactly as they are today, driving
-- billing/payment — this migration does not touch that side at all.
-- received_quantity defaults to (and stays in lockstep with) quantity unless
-- explicitly overridden, via COALESCE at the trigger level, so any existing
-- or new bill line that never sets it behaves identically to before.

ALTER TABLE purchase_bill_items ADD COLUMN IF NOT EXISTS received_quantity NUMERIC(15,3);

-- Backfill: every existing line's received quantity is assumed equal to its
-- invoiced quantity (no historical weighbridge data to do otherwise) — a
-- no-op for every PURCHASE_IN row already in stock_ledger.
UPDATE purchase_bill_items SET received_quantity = quantity WHERE received_quantity IS NULL;

CREATE OR REPLACE FUNCTION fn_bill_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_bill purchase_bills%ROWTYPE;
  v_target_unit TEXT;
BEGIN
  SELECT * INTO v_bill FROM purchase_bills WHERE id = NEW.bill_id;
  SELECT unit INTO v_target_unit FROM material_types WHERE id = NEW.material_type_id;
  INSERT INTO stock_ledger (
    entry_type, company_id, warehouse_id, material_type_id, material_size_id,
    size_label, quantity, reference_type, reference_id, reference_number,
    notes, entry_date, created_by, purchase_line_id, sub_purchase_line_id
  ) VALUES (
    'PURCHASE_IN', v_bill.company_id, v_bill.warehouse_id,
    NEW.material_type_id, NEW.material_size_id, NEW.size_label,
    fn_convert_quantity(COALESCE(NEW.received_quantity, NEW.quantity), NEW.unit, v_target_unit),
    'purchase_bill', v_bill.id, v_bill.bill_number,
    NEW.notes, v_bill.bill_date, v_bill.created_by,
    NEW.purchase_line_id, NULL
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
    -COALESCE(OLD.received_quantity, OLD.quantity),
    'purchase_bill', v_bill.id, COALESCE(v_bill.bill_number, 'DRAFT'),
    'Item removed from bill', COALESCE(v_bill.bill_date, CURRENT_DATE), OLD.purchase_line_id
  );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
