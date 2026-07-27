-- ============================================================
-- WareCore WMS - Fix Vendor Direct Sale Duplicate Return Rows
--
-- Bug 1 (double insert): fn_dispatch_item_to_ledger() (046) inserts its
-- own explicit JOB_WORK_RETURN_IN row (with notes 'Vendor direct sale —
-- virtual return' and the line ID) and then UPDATEs
-- job_work_items.quantity_received. That UPDATE independently re-fires
-- the generic trg_job_work_item_to_ledger trigger (001), whose UPDATE
-- branch inserts a SECOND JOB_WORK_RETURN_IN row for the same quantity
-- (blank notes, no line ID) — every vendor direct sale posts the return
-- leg twice, double-crediting stock and pending-at-vendor quantity.
--
-- Fix: set a transaction-local guard before the UPDATE so the generic
-- trigger knows the vendor-direct-sale trigger already recorded this
-- return explicitly, and skips its own insert.
--
-- Bug 2 (edit leaves stale rows): edit_dispatch_order() (052) only
-- deletes stock_ledger rows with reference_type = 'dispatch' before
-- recreating line items, so it never cleans up the JOB_WORK_RETURN_IN
-- row (reference_type = 'job_work') from a prior save. Every edit of a
-- vendor-direct-sale order piles another virtual-return pair on top of
-- the previous one, and leaves quantity_received bumped a second time.
--
-- Fix: before deleting/recreating line items, reverse the
-- quantity_received bump and delete the stale virtual-return ledger
-- rows for this order's current items.
-- ============================================================

-- 1. Guard the generic job_work_items trigger against the vendor-direct
--    sale trigger's explicit insert.
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
      entry_date, created_by
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
      v_order.created_by
    );

  ELSIF TG_OP = 'UPDATE' AND NEW.quantity_received > OLD.quantity_received THEN
    -- fn_dispatch_item_to_ledger() (vendor direct sale) already inserts its
    -- own richer JOB_WORK_RETURN_IN row before bumping quantity_received —
    -- skip here to avoid double-posting the same return.
    IF current_setting('warecore.skip_job_work_return_trigger', true) = 'true' THEN
      RETURN NEW;
    END IF;

    v_returned_delta := NEW.quantity_received - OLD.quantity_received;
    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id, material_type_id, material_size_id,
      size_label, quantity, reference_type, reference_id, reference_number,
      entry_date, created_by
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
      v_order.created_by
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Set the guard around the quantity_received bump in the vendor
--    direct sale dispatch trigger.
CREATE OR REPLACE FUNCTION fn_dispatch_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_dispatch    dispatch_orders%ROWTYPE;
  v_target_unit TEXT;
  v_jwo_id      UUID;
  v_jwo_ref     TEXT;
  v_jwo_company UUID;
  v_jwo_wh      UUID;
  v_conv_qty    NUMERIC;
BEGIN
  SELECT * INTO v_dispatch FROM dispatch_orders WHERE id = NEW.dispatch_order_id;
  IF v_dispatch.status = 'draft' THEN
    RETURN NEW;
  END IF;

  SELECT unit INTO v_target_unit FROM material_types WHERE id = NEW.material_type_id;
  v_conv_qty := fn_convert_quantity(NEW.quantity, NEW.unit, v_target_unit);

  IF v_dispatch.is_vendor_direct AND v_dispatch.source_job_work_order_id IS NOT NULL THEN
    SELECT id, reference_number, company_id, warehouse_id
      INTO v_jwo_id, v_jwo_ref, v_jwo_company, v_jwo_wh
      FROM job_work_orders WHERE id = v_dispatch.source_job_work_order_id;

    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id, material_type_id, material_size_id,
      size_label, quantity, reference_type, reference_id, reference_number,
      notes, entry_date, created_by, purchase_line_id, sub_purchase_line_id
    ) VALUES (
      'JOB_WORK_RETURN_IN',
      v_dispatch.company_id, v_dispatch.warehouse_id,
      NEW.material_type_id, NEW.material_size_id, NEW.size_label,
      v_conv_qty,
      'job_work', v_jwo_id, v_jwo_ref,
      'Vendor direct sale — virtual return',
      v_dispatch.dispatch_date, v_dispatch.created_by,
      NEW.purchase_line_id, NEW.sub_purchase_line_id
    );

    -- Guard: the UPDATE below would otherwise re-fire
    -- trg_job_work_item_to_ledger and post a second, duplicate return row.
    PERFORM set_config('warecore.skip_job_work_return_trigger', 'true', true);

    IF NEW.source_job_work_item_id IS NOT NULL THEN
      UPDATE job_work_items
      SET    quantity_received = COALESCE(quantity_received, 0) + v_conv_qty,
             updated_at        = NOW()
      WHERE  id = NEW.source_job_work_item_id;
    ELSIF NEW.purchase_line_id IS NOT NULL THEN
      UPDATE job_work_items
      SET    quantity_received = COALESCE(quantity_received, 0) + v_conv_qty,
             updated_at        = NOW()
      WHERE  job_work_order_id = v_dispatch.source_job_work_order_id
        AND  purchase_line_id  = NEW.purchase_line_id;
    END IF;

    PERFORM set_config('warecore.skip_job_work_return_trigger', 'false', true);
  END IF;

  INSERT INTO stock_ledger (
    entry_type, company_id, warehouse_id, material_type_id, material_size_id,
    size_label, quantity, reference_type, reference_id, reference_number,
    notes, entry_date, created_by, purchase_line_id, sub_purchase_line_id
  ) VALUES (
    'SALE_OUT',
    v_dispatch.company_id, v_dispatch.warehouse_id,
    NEW.material_type_id, NEW.material_size_id, NEW.size_label,
    -v_conv_qty,
    'dispatch', v_dispatch.id, v_dispatch.invoice_number,
    NEW.notes, v_dispatch.dispatch_date, v_dispatch.created_by,
    NEW.purchase_line_id, NEW.sub_purchase_line_id
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. edit_dispatch_order: reverse the quantity_received bump and remove
--    stale virtual-return ledger rows for a vendor-direct-sale order's
--    CURRENT items before they're deleted/recreated, so repeated edits
--    stay idempotent (matches the reference_type = 'dispatch' cleanup
--    already done for the SALE_OUT leg).
CREATE OR REPLACE FUNCTION edit_dispatch_order(
  p_order_id        UUID,
  p_invoice_number  TEXT,
  p_dispatch_date   DATE,
  p_vehicle_number  TEXT,
  p_driver_name     TEXT,
  p_notes           TEXT,
  p_company_id      UUID,
  p_warehouse_id    UUID,
  p_customer_id     UUID,
  p_sale_ref_id     TEXT,
  p_status          TEXT,
  p_total_quantity  NUMERIC,
  p_total_amount    NUMERIC,
  p_items           JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order        dispatch_orders%ROWTYPE;
  v_item         JSONB;
  v_old_item     dispatch_items%ROWTYPE;
  v_target_unit  TEXT;
BEGIN
  SELECT * INTO v_order FROM dispatch_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Dispatch order not found');
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot edit a cancelled order');
  END IF;

  -- For vendor-direct-sale orders: reverse the quantity_received bump and
  -- remove the virtual-return rows this order's CURRENT items previously
  -- posted, before those items are deleted below.
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

    DELETE FROM stock_ledger
    WHERE reference_type = 'job_work'
      AND reference_id = v_order.source_job_work_order_id
      AND notes = 'Vendor direct sale — virtual return'
      AND (purchase_line_id, sub_purchase_line_id) IN (
        SELECT purchase_line_id, sub_purchase_line_id
        FROM dispatch_items WHERE dispatch_order_id = p_order_id
      );
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
      tcs_rate, tcs_amount, total_with_tax
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
      NULLIF(v_item->>'total_with_tax', '')::NUMERIC
    );
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- 4. One-time data fix for the JW-MRET3ZIS-T1QX / GI0524-0050 case
--    (dispatch 0524-0018, created then edited on the same day): remove
--    the 3 stray duplicate JOB_WORK_RETURN_IN rows, keeping only the
--    one explicit row that matches the order's current line item, and
--    undo the resulting double quantity_received bump.
-- ============================================================

DELETE FROM stock_ledger
WHERE id IN (
  '4ea6d0d8-91d2-4593-bbb0-d0c2d1d6079f', -- stale explicit virtual-return (pre-edit)
  'a8a186c1-ef47-45d8-bd10-878a459e6b0d', -- implicit duplicate (pre-edit)
  '911206a3-0014-413c-b8c4-6a99babee27f'  -- implicit duplicate (post-edit)
);

UPDATE job_work_items
SET quantity_received = 6.275,
    updated_at = NOW()
WHERE purchase_line_id = 'GI0524-0050'
  AND quantity_received = 12.550;
