-- ============================================================
-- WareCore WMS - Fix cancellation ledger entries hardcoding CURRENT_DATE
--
-- cancel_dispatch_order(), cancel_purchase_bill() and the
-- fn_bill_item_deleted() trigger (fired when a bill's line item is removed
-- during an edit) all dated their reversal ledger row with CURRENT_DATE
-- instead of the original transaction's own date — the same class of bug
-- already fixed for job work transfers in migration 065. Any as-of-date
-- report (Stock Statement, Item Ledger, Daywise Stock Statement) with a
-- cutoff between the original transaction date and the day the
-- cancellation/edit actually happened would see the reversal as not yet
-- applied, producing an incorrect (often negative) closing balance even
-- though the underlying transaction was legitimately reversed.
--
-- This migration re-dates the three functions' reversal entries to the
-- source record's own date, and backfills every existing PURCHASE_CANCEL/
-- SALE_CANCEL row whose entry_date doesn't match its source record.
-- ============================================================

-- ── cancel_dispatch_order(): date reversals from the order's own dispatch_date ──
CREATE OR REPLACE FUNCTION cancel_dispatch_order(
  p_order_id UUID,
  p_notes    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order       dispatch_orders%ROWTYPE;
  v_item        dispatch_items%ROWTYPE;
  v_target_unit TEXT;
  v_jwo_id      UUID;
  v_jwo_ref     TEXT;
BEGIN
  SELECT * INTO v_order FROM dispatch_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Dispatch order not found');
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Dispatch order is already cancelled');
  END IF;

  -- Cache JW order info if vendor_direct
  IF v_order.is_vendor_direct AND v_order.source_job_work_order_id IS NOT NULL THEN
    SELECT id, reference_number
      INTO v_jwo_id, v_jwo_ref
      FROM job_work_orders WHERE id = v_order.source_job_work_order_id;
  END IF;

  FOR v_item IN
    SELECT * FROM dispatch_items WHERE dispatch_order_id = p_order_id
  LOOP
    SELECT unit INTO v_target_unit FROM material_types WHERE id = v_item.material_type_id;

    -- Reverse SALE_OUT
    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id, material_type_id, material_size_id, size_label,
      quantity, reference_type, reference_id, reference_number,
      notes, entry_date, purchase_line_id, sub_purchase_line_id
    ) VALUES (
      'SALE_CANCEL',
      v_order.company_id, v_order.warehouse_id,
      v_item.material_type_id, v_item.material_size_id, v_item.size_label,
      fn_convert_quantity(v_item.quantity, v_item.unit, v_target_unit),
      'dispatch', v_order.id, v_order.invoice_number,
      p_notes, v_order.dispatch_date,
      v_item.purchase_line_id, v_item.sub_purchase_line_id
    );

    -- For vendor_direct: reverse the JOB_WORK_RETURN_IN and restore vendor pending qty
    IF v_order.is_vendor_direct AND v_jwo_id IS NOT NULL THEN
      INSERT INTO stock_ledger (
        entry_type, company_id, warehouse_id, material_type_id, material_size_id, size_label,
        quantity, reference_type, reference_id, reference_number,
        notes, entry_date, purchase_line_id, sub_purchase_line_id
      ) VALUES (
        'JOB_WORK_OUT',
        v_order.company_id, v_order.warehouse_id,
        v_item.material_type_id, v_item.material_size_id, v_item.size_label,
        -fn_convert_quantity(v_item.quantity, v_item.unit, v_target_unit),
        'job_work', v_jwo_id, v_jwo_ref,
        'Vendor direct sale cancelled — material back at vendor',
        v_order.dispatch_date,
        v_item.purchase_line_id, v_item.sub_purchase_line_id
      );

      -- Restore quantity_received on the job work item
      IF v_item.source_job_work_item_id IS NOT NULL THEN
        UPDATE job_work_items
        SET    quantity_received = GREATEST(0,
                 COALESCE(quantity_received, 0)
                 - fn_convert_quantity(v_item.quantity, v_item.unit, v_target_unit)),
               updated_at = NOW()
        WHERE  id = v_item.source_job_work_item_id;
      ELSIF v_item.purchase_line_id IS NOT NULL THEN
        UPDATE job_work_items
        SET    quantity_received = GREATEST(0,
                 COALESCE(quantity_received, 0)
                 - fn_convert_quantity(v_item.quantity, v_item.unit, v_target_unit)),
               updated_at = NOW()
        WHERE  job_work_order_id = v_order.source_job_work_order_id
          AND  purchase_line_id  = v_item.purchase_line_id;
      END IF;
    END IF;
  END LOOP;

  UPDATE dispatch_orders
  SET status         = 'cancelled',
      cancelled_at   = NOW(),
      cancelled_notes = p_notes,
      updated_at     = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── cancel_purchase_bill(): date the reversal from the bill's own bill_date ──
CREATE OR REPLACE FUNCTION cancel_purchase_bill(
  p_bill_id UUID,
  p_notes   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bill  purchase_bills%ROWTYPE;
  v_item  purchase_bill_items%ROWTYPE;
  v_target_unit TEXT;
BEGIN
  SELECT * INTO v_bill FROM purchase_bills WHERE id = p_bill_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bill not found');
  END IF;

  IF v_bill.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bill is already cancelled');
  END IF;

  FOR v_item IN
    SELECT * FROM purchase_bill_items WHERE bill_id = p_bill_id
  LOOP
    SELECT unit INTO v_target_unit FROM material_types WHERE id = v_item.material_type_id;
    INSERT INTO stock_ledger (
      entry_type,
      company_id, warehouse_id,
      material_type_id, material_size_id, size_label,
      quantity,
      reference_type, reference_id, reference_number,
      notes, entry_date,
      purchase_line_id
    ) VALUES (
      'PURCHASE_CANCEL',
      v_bill.company_id, v_bill.warehouse_id,
      v_item.material_type_id, v_item.material_size_id, v_item.size_label,
      -fn_convert_quantity(v_item.quantity, v_item.unit, v_target_unit),
      'purchase_bill', v_bill.id, v_bill.bill_number,
      p_notes,
      v_bill.bill_date,
      v_item.purchase_line_id
    );
  END LOOP;

  UPDATE purchase_bills
  SET status = 'cancelled', cancelled_at = NOW(), cancelled_notes = p_notes, updated_at = NOW()
  WHERE id = p_bill_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── fn_bill_item_deleted(): date the PURCHASE_CANCEL from the bill's own bill_date ──
-- Fires on DELETE from purchase_bill_items (a line removed while editing a bill).
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
    'Item removed from bill', COALESCE(v_bill.bill_date, CURRENT_DATE), OLD.purchase_line_id
  );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Backfill: existing SALE_CANCEL / PURCHASE_CANCEL rows mis-dated with
-- CURRENT_DATE (from the time they were inserted) instead of the source
-- record's own date — corrected to match what the fixed functions above
-- would have produced.
-- ============================================================

UPDATE stock_ledger sl
SET entry_date = do_.dispatch_date
FROM dispatch_orders do_
WHERE sl.entry_type = 'SALE_CANCEL'
  AND sl.reference_type = 'dispatch'
  AND sl.reference_id = do_.id
  AND sl.entry_date <> do_.dispatch_date;

UPDATE stock_ledger sl
SET entry_date = pb.bill_date
FROM purchase_bills pb
WHERE sl.entry_type = 'PURCHASE_CANCEL'
  AND sl.reference_type = 'purchase_bill'
  AND sl.reference_id = pb.id
  AND sl.entry_date <> pb.bill_date;
