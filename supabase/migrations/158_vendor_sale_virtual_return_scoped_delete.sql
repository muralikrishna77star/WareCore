-- ============================================================
-- Migration 158: editing or cancelling a vendor direct sale removes only
-- THAT sale's own "virtual return" rows
-- ============================================================
-- A vendor direct sale posts two ledger rows per line
-- (fn_dispatch_item_to_ledger): SALE_OUT against the dispatch, and a
-- JOB_WORK_RETURN_IN "Vendor direct sale — virtual return" against the
-- SOURCE JOB WORK ORDER. The virtual return carries no link back to the
-- sale that posted it, and both clean-up paths picked rows too loosely:
--
--   * edit_dispatch_order() (since migration 126) deleted EVERY virtual
--     return on the source order for the same purchase line — including
--     ones belonging to other, earlier sales. GI00132: editing the two
--     scrap sales of 2025-02-12 (0225-0976, 0225-0979) on 2026-10-09 wiped
--     the 2.980 and 4.170 returns of sales 1224-0627 / 0125-0692, leaving
--     the item's warehouse balance at -7.150 (EXC-001149/1154/1155).
--   * cancel_dispatch_order() still used the row-value IN comparison that
--     migration 126 fixed in the edit path: sub_purchase_line_id is NULL on
--     effectively every line, so it matched nothing and a cancelled sale's
--     virtual returns stayed behind (JW-MU6RYYXX-1R1B, sale 0125-0783,
--     cancelled 2026-10-10: +0.910 / +0.900 phantom returns).
--
-- Fix: fn_delete_dispatch_virtual_returns() removes, for each line of the
-- given sale, exactly ONE virtual-return row matching that line (source
-- order, purchase/sub line, material, size, quantity in the material's
-- unit, and the sale's dispatch date — the values the trigger posted it
-- with). Two identical sales are interchangeable, so either row may go.
-- If a line's row is already missing, nothing else is touched (and an
-- edit then re-posts it). Removed rows are kept in stock_ledger_deletions.
--
-- Also: edit_dispatch_order() re-inserted lines without
-- source_job_work_item_id, so after any edit the trigger fell back to
-- bumping quantity_received on every job work line sharing the purchase
-- line. It now carries the link over from the old lines (by purchase/sub
-- line, only when unambiguous).
--
-- Function changes only; the GI00132 / JW-MU6RYYXX-1R1B data is repaired
-- separately in migration 159.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_delete_dispatch_virtual_returns(p_order_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_order   dispatch_orders%ROWTYPE;
  v_item    dispatch_items%ROWTYPE;
  v_unit    TEXT;
  v_qty     NUMERIC;
  v_row_id  UUID;
  v_deleted INTEGER := 0;
BEGIN
  SELECT * INTO v_order FROM dispatch_orders WHERE id = p_order_id;
  IF NOT FOUND OR NOT v_order.is_vendor_direct OR v_order.source_job_work_order_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_item IN SELECT * FROM dispatch_items WHERE dispatch_order_id = p_order_id ORDER BY id
  LOOP
    SELECT unit INTO v_unit FROM material_types WHERE id = v_item.material_type_id;
    v_qty := fn_convert_quantity(v_item.quantity, v_item.unit, v_unit);

    v_row_id := NULL;
    SELECT sl.id INTO v_row_id
    FROM stock_ledger sl
    WHERE sl.reference_type = 'job_work'
      AND sl.reference_id = v_order.source_job_work_order_id
      AND sl.entry_type = 'JOB_WORK_RETURN_IN'
      AND sl.notes = 'Vendor direct sale — virtual return'
      AND sl.purchase_line_id IS NOT DISTINCT FROM v_item.purchase_line_id
      AND sl.sub_purchase_line_id IS NOT DISTINCT FROM v_item.sub_purchase_line_id
      AND sl.material_type_id = v_item.material_type_id
      AND sl.material_size_id IS NOT DISTINCT FROM v_item.material_size_id
      AND sl.quantity = v_qty
      AND sl.entry_date = v_order.dispatch_date
    ORDER BY sl.created_at DESC
    LIMIT 1;

    IF v_row_id IS NOT NULL THEN
      INSERT INTO stock_ledger_deletions (stock_ledger_id, ledger_row, deleted_by)
      SELECT sl.id, to_jsonb(sl), NULL FROM stock_ledger sl WHERE sl.id = v_row_id;
      DELETE FROM stock_ledger WHERE id = v_row_id;
      v_deleted := v_deleted + 1;
    END IF;
  END LOOP;

  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_dispatch_order(p_order_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
  -- remove the virtual-return rows THIS order's items posted (158) before
  -- their SALE_OUT rows are removed.
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

    PERFORM fn_delete_dispatch_virtual_returns(p_order_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.edit_dispatch_order(p_order_id uuid, p_invoice_number text, p_dispatch_date date, p_vehicle_number text, p_driver_name text, p_notes text, p_company_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_sale_ref_id text, p_status text, p_total_quantity numeric, p_total_amount numeric, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_order        dispatch_orders%ROWTYPE;
  v_item         JSONB;
  v_old_item     dispatch_items%ROWTYPE;
  v_target_unit  TEXT;
  v_source_map   JSONB := '{}'::jsonb;
BEGIN
  SELECT * INTO v_order FROM dispatch_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Dispatch order not found');
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot edit a cancelled order');
  END IF;

  -- For vendor-direct-sale orders: reverse the quantity_received bump and
  -- remove the virtual-return rows THIS order's current items posted (158),
  -- before those items are deleted below.
  IF v_order.is_vendor_direct AND v_order.source_job_work_order_id IS NOT NULL THEN
    FOR v_old_item IN SELECT * FROM dispatch_items WHERE dispatch_order_id = p_order_id
    LOOP
      SELECT unit INTO v_target_unit FROM material_types WHERE id = v_old_item.material_type_id;

      IF v_old_item.source_job_work_item_id IS NOT NULL THEN
        UPDATE job_work_items
        SET    quantity_received = GREATEST(0,
                 COALESCE(quantity_received, 0)
                 - fn_convert_quantity(v_old_item.quantity, v_old_item.unit, v_target_unit)),
               updated_at = NOW()
        WHERE  id = v_old_item.source_job_work_item_id;
      ELSIF v_old_item.purchase_line_id IS NOT NULL THEN
        UPDATE job_work_items
        SET    quantity_received = GREATEST(0,
                 COALESCE(quantity_received, 0)
                 - fn_convert_quantity(v_old_item.quantity, v_old_item.unit, v_target_unit)),
               updated_at = NOW()
        WHERE  job_work_order_id = v_order.source_job_work_order_id
          AND  purchase_line_id  = v_old_item.purchase_line_id;
      END IF;
    END LOOP;

    PERFORM fn_delete_dispatch_virtual_returns(p_order_id);

    -- Remember which job work line each purchase/sub line was sold from,
    -- so the re-inserted lines keep it (only where it is unambiguous).
    SELECT COALESCE(jsonb_object_agg(k, src), '{}'::jsonb) INTO v_source_map
    FROM (
      SELECT COALESCE(purchase_line_id, '') || '|' || COALESCE(sub_purchase_line_id, '') AS k,
             (array_agg(DISTINCT source_job_work_item_id))[1]::text AS src
      FROM dispatch_items
      WHERE dispatch_order_id = p_order_id AND source_job_work_item_id IS NOT NULL
      GROUP BY 1
      HAVING count(DISTINCT source_job_work_item_id) = 1
    ) m;
  END IF;

  -- Remove all stock ledger entries previously created for this order
  -- (SALE_OUT and any earlier SALE_CANCEL reversals). Fresh entries are
  -- recreated below by the insert trigger based on the new line items.
  DELETE FROM stock_ledger
  WHERE reference_type = 'dispatch' AND reference_id = p_order_id;

  -- Delete existing items
  DELETE FROM dispatch_items WHERE dispatch_order_id = p_order_id;

  -- Update order header (status updated BEFORE inserting items so trigger sees correct status)
  UPDATE dispatch_orders SET
    invoice_number = p_invoice_number,
    dispatch_date  = p_dispatch_date,
    vehicle_number = p_vehicle_number,
    driver_name    = p_driver_name,
    notes          = p_notes,
    company_id     = p_company_id,
    warehouse_id   = p_warehouse_id,
    customer_id    = p_customer_id,
    sale_ref_id    = p_sale_ref_id,
    status         = p_status,
    total_quantity = p_total_quantity,
    total_amount   = p_total_amount,
    updated_at     = NOW()
  WHERE id = p_order_id;

  -- Insert new items — trigger fn_dispatch_item_to_ledger fires SALE_OUT for each (if status='active')
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO dispatch_items (
      dispatch_order_id,
      item_master_id, sale_line_id, purchase_line_id,
      item_name, material_type_id, material_size_id, size_label,
      quantity, unit, rate, amount, notes,
      tax_rate_id, taxable_value,
      cgst_rate, cgst_amount, sgst_rate, sgst_amount,
      tcs_rate, tcs_amount, total_with_tax,
      source_job_work_item_id
    ) VALUES (
      p_order_id,
      NULLIF(v_item->>'item_master_id', '')::UUID,
      NULLIF(v_item->>'sale_line_id', ''),
      NULLIF(v_item->>'purchase_line_id', ''),
      NULLIF(v_item->>'item_name', ''),
      (v_item->>'material_type_id')::UUID,
      NULLIF(v_item->>'material_size_id', '')::UUID,
      NULLIF(v_item->>'size_label', ''),
      (v_item->>'quantity')::NUMERIC,
      COALESCE(NULLIF(v_item->>'unit', ''), 'tons'),
      NULLIF(v_item->>'rate', '')::NUMERIC,
      NULLIF(v_item->>'amount', '')::NUMERIC,
      NULLIF(v_item->>'notes', ''),
      NULLIF(v_item->>'tax_rate_id', '')::UUID,
      NULLIF(v_item->>'taxable_value', '')::NUMERIC,
      NULLIF(v_item->>'cgst_rate', '')::NUMERIC,
      NULLIF(v_item->>'cgst_amount', '')::NUMERIC,
      NULLIF(v_item->>'sgst_rate', '')::NUMERIC,
      NULLIF(v_item->>'sgst_amount', '')::NUMERIC,
      NULLIF(v_item->>'tcs_rate', '')::NUMERIC,
      NULLIF(v_item->>'tcs_amount', '')::NUMERIC,
      NULLIF(v_item->>'total_with_tax', '')::NUMERIC,
      COALESCE(
        NULLIF(v_item->>'source_job_work_item_id', '')::UUID,
        NULLIF(v_source_map->>(COALESCE(NULLIF(v_item->>'purchase_line_id', ''), '') || '|' || COALESCE(NULLIF(v_item->>'sub_purchase_line_id', ''), '')), '')::UUID
      )
    );
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$function$;
