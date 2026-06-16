-- ============================================================
-- WareCore WMS - Vendor Direct Sale
--
-- Allows selling materials directly from a job work vendor to
-- a customer without physically returning to the warehouse first.
--
-- Stock effect per line item:
--   JOB_WORK_RETURN_IN  +qty  (virtual return — clears vendor stock)
--   SALE_OUT            -qty  (the actual sale)
--   Net on stock = -qty (same as a normal warehouse sale)
--
-- job_work_items.quantity_received is updated so v_stock_at_vendors
-- correctly reduces the vendor's pending balance.
-- ============================================================

-- 1. Schema additions
ALTER TABLE dispatch_orders
  ADD COLUMN IF NOT EXISTS is_vendor_direct        BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS source_job_work_order_id UUID     REFERENCES job_work_orders(id) ON DELETE SET NULL;

ALTER TABLE dispatch_items
  ADD COLUMN IF NOT EXISTS source_job_work_item_id UUID REFERENCES job_work_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dispatch_orders_vendor_direct       ON dispatch_orders(is_vendor_direct) WHERE is_vendor_direct = TRUE;
CREATE INDEX IF NOT EXISTS idx_dispatch_orders_source_jw_order     ON dispatch_orders(source_job_work_order_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_items_source_jw_item       ON dispatch_items(source_job_work_item_id);

-- ============================================================
-- 2. Update fn_dispatch_item_to_ledger to handle vendor_direct
-- ============================================================
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

  -- For vendor direct sales, add a virtual JOB_WORK_RETURN_IN and update received qty
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

    -- Update quantity_received on the source job work item
    IF NEW.source_job_work_item_id IS NOT NULL THEN
      UPDATE job_work_items
      SET    quantity_received = COALESCE(quantity_received, 0) + v_conv_qty,
             updated_at        = NOW()
      WHERE  id = NEW.source_job_work_item_id;
    ELSIF NEW.purchase_line_id IS NOT NULL THEN
      -- Fallback: match by purchase_line_id within the source JW order
      UPDATE job_work_items
      SET    quantity_received = COALESCE(quantity_received, 0) + v_conv_qty,
             updated_at        = NOW()
      WHERE  job_work_order_id = v_dispatch.source_job_work_order_id
        AND  purchase_line_id  = NEW.purchase_line_id;
    END IF;
  END IF;

  -- SALE_OUT for all active dispatches (including vendor_direct)
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

-- ============================================================
-- 3. Update cancel_dispatch_order to reverse vendor_direct
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
      p_notes, CURRENT_DATE,
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
        CURRENT_DATE,
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
