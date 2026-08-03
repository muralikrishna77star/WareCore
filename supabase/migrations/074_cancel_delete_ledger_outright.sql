-- ============================================================
-- WareCore WMS - cancel_dispatch_order()/cancel_purchase_bill(): delete
-- the ledger footprint outright instead of inserting a reversal entry.
--
-- Every other cancel/delete path in this codebase already does this
-- (delete_job_work_order — migration 051/061, purge_cancelled_bill —
-- migration 054, edit_dispatch_order — migration 062): the archive
-- table (dispatch_cancellations/purchase_cancellations, or the order
-- header itself staying at status='cancelled') already preserves full
-- detail, so there's nothing left to reconcile a SALE_CANCEL/
-- PURCHASE_CANCEL reversal against. Leaving the reversal in stock_ledger
-- only means the order's original PURCHASE_IN/SALE_OUT permanently
-- inflates the "sales"/"purchases" category ledger totals in Stock
-- Reconciliation against the (correctly cancelled-order-excluding)
-- source total — a permanent, unresolvable-looking mismatch for every
-- single cancellation, forever. Deleting outright makes both totals
-- actually match.
--
-- This migration also cleans up every currently-cancelled dispatch
-- order and purchase bill's existing ledger rows (both the original
-- entry and its reversal), so historical cancellations match too, not
-- just ones made after this point.
-- ============================================================

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
BEGIN
  SELECT * INTO v_order FROM dispatch_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Dispatch order not found');
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Dispatch order is already cancelled');
  END IF;

  -- For vendor-direct-sale orders: reverse the quantity_received bump and
  -- remove the virtual-return rows this order's items posted (mirrors
  -- edit_dispatch_order's cleanup) before their SALE_OUT rows are removed.
  IF v_order.is_vendor_direct AND v_order.source_job_work_order_id IS NOT NULL THEN
    FOR v_item IN SELECT * FROM dispatch_items WHERE dispatch_order_id = p_order_id
    LOOP
      SELECT unit INTO v_target_unit FROM material_types WHERE id = v_item.material_type_id;

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
    END LOOP;

    DELETE FROM stock_ledger
    WHERE reference_type = 'job_work'
      AND reference_id = v_order.source_job_work_order_id
      AND notes = 'Vendor direct sale — virtual return'
      AND (purchase_line_id, sub_purchase_line_id) IN (
        SELECT purchase_line_id, sub_purchase_line_id
        FROM dispatch_items WHERE dispatch_order_id = p_order_id
      );
  END IF;

  -- Remove this order's own stock ledger footprint outright — the order
  -- stays at status='cancelled' (or gets archived on purge), so there is
  -- nothing left to reconcile a reversal against.
  DELETE FROM stock_ledger
  WHERE reference_type = 'dispatch' AND reference_id = p_order_id;

  UPDATE dispatch_orders
  SET status         = 'cancelled',
      cancelled_at   = NOW(),
      cancelled_notes = p_notes,
      updated_at     = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

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
BEGIN
  SELECT * INTO v_bill FROM purchase_bills WHERE id = p_bill_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bill not found');
  END IF;

  IF v_bill.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bill is already cancelled');
  END IF;

  -- Remove this bill's stock ledger footprint outright — mirrors
  -- purge_cancelled_bill (migration 054); nothing left to reconcile a
  -- PURCHASE_CANCEL reversal against.
  DELETE FROM stock_ledger
  WHERE reference_type = 'purchase_bill' AND reference_id = p_bill_id;

  UPDATE purchase_bills
  SET status = 'cancelled', cancelled_at = NOW(), cancelled_notes = p_notes, updated_at = NOW()
  WHERE id = p_bill_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- One-time cleanup: every dispatch order / purchase bill already sitting
-- at status='cancelled' still has its old original + reversal ledger
-- rows (they net to zero, so stock totals are unaffected — pure clutter
-- against the "active source" comparison). Remove them outright, same as
-- what the fixed functions above now do at cancel time.
-- ============================================================

DELETE FROM stock_ledger sl
USING dispatch_orders do_
WHERE do_.status = 'cancelled'
  AND sl.reference_type = 'dispatch'
  AND sl.reference_id = do_.id;

DELETE FROM stock_ledger sl
USING dispatch_orders do_
WHERE do_.status = 'cancelled'
  AND do_.is_vendor_direct
  AND sl.reference_type = 'job_work'
  AND sl.reference_id = do_.source_job_work_order_id
  AND sl.notes IN ('Vendor direct sale — virtual return', 'Vendor direct sale cancelled — material back at vendor');

DELETE FROM stock_ledger sl
USING purchase_bills pb
WHERE pb.status = 'cancelled'
  AND sl.reference_type = 'purchase_bill'
  AND sl.reference_id = pb.id;
