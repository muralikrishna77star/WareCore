-- ============================================================
-- Migration 126: fix edit_dispatch_order()'s NULL-unsafe stale-row cleanup
-- + repair the resulting orphaned/duplicate vendor-direct-sale returns
-- ============================================================
-- Found on the Item Stock Ledger report for GI00148 (Sri Sai Steels /
-- Mass Decoilers, job work order JW-MSU42GU1-YT4N): "Balance at Vendor"
-- showed -2.730, an impossible negative. Root cause: edit_dispatch_order()
-- (062) is supposed to delete a vendor-direct-sale dispatch's OLD
-- "Vendor direct sale — virtual return" stock_ledger row before the
-- trigger reposts a fresh one for the edited line items:
--
--   DELETE FROM stock_ledger
--   WHERE ... AND (purchase_line_id, sub_purchase_line_id) IN (
--     SELECT purchase_line_id, sub_purchase_line_id
--     FROM dispatch_items WHERE dispatch_order_id = p_order_id
--   );
--
-- Postgres row-value comparison treats (x, NULL) = (y, NULL) as UNKNOWN,
-- never TRUE, even when x = y — standard NULL semantics. sub_purchase_line_id
-- is NULL on effectively every dispatch item (it's only populated for
-- purchase-bill sub-lines), so this DELETE has been silently matching
-- nothing and doing nothing on every edit of a vendor-direct-sale
-- dispatch order since 062 shipped. Every such edit therefore leaves the
-- previous virtual-return row behind (a duplicate if the line's quantity
-- was unchanged, an orphan overstating a DIFFERENT item's vendor balance
-- if the line was removed/changed) while the trigger inserts a fresh one
-- for the new state.
--
-- Fix: rewrite the DELETE as a NULL-safe EXISTS using
-- IS NOT DISTINCT FROM, which correctly matches NULL = NULL.
--
-- A system-wide scan (comparing total "virtual return" ledger quantity per
-- (job_work_order_id, purchase_line_id, sub_purchase_line_id) key against
-- the total quantity of CURRENT vendor-direct dispatch_items sharing that
-- key) found 5 affected rows across 4 job work orders — repaired below,
-- each confirmed against its own job_work_items.quantity_received before
-- deciding whether that field also needed correcting:
--   - JW-MSU42GU1-YT4N / GI0824-0024 (GI00248): exact duplicate return
--     (two 3.024 rows, quantity_received already correct at 3.024 — the
--     stale row's earlier presence never double-bumped it) — delete the
--     later duplicate.
--   - JW-MSU42GU1-YT4N / GI0824-0026 (GI00148): orphaned 2.730 return
--     with no surviving dispatch line at all (quantity_received already
--     correct at 21.460, matching the 3 real returns) — delete the
--     orphan. This is the row causing the reported -2.730.
--   - JW-MSMYPYE8-8181 / GA0724-0014: exact duplicate return (two 2.300
--     rows 30 seconds apart, quantity_received already correct at 2.300)
--     — delete the later duplicate.
--   - JW-MR0J2NYQ-HEKS / GI0524-0021 (GI00103): orphaned 2.705 return —
--     the dispatch that created it no longer exists at all (0 current
--     vendor-direct dispatch_items on this key), and quantity_received
--     (2.705) was never reversed by that removal — delete the orphan and
--     zero out quantity_received.
--   - JW-MR5XV0TQ-YODF / GI0524-0029 (GI00058): same pattern as above —
--     delete the orphan 2.210 return and zero out quantity_received.
-- ============================================================

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

    -- NULL-safe replacement for the old row-value IN comparison (126) —
    -- sub_purchase_line_id is NULL on effectively every dispatch item, and
    -- (x, NULL) = (y, NULL) is UNKNOWN in SQL, not TRUE, so the old
    -- comparison silently matched nothing and never deleted anything.
    DELETE FROM stock_ledger sl
    WHERE sl.reference_type = 'job_work'
      AND sl.reference_id = v_order.source_job_work_order_id
      AND sl.notes = 'Vendor direct sale — virtual return'
      AND EXISTS (
        SELECT 1 FROM dispatch_items di
        WHERE di.dispatch_order_id = p_order_id
          AND di.purchase_line_id IS NOT DISTINCT FROM sl.purchase_line_id
          AND di.sub_purchase_line_id IS NOT DISTINCT FROM sl.sub_purchase_line_id
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
-- One-time repair: delete the 5 stale duplicate/orphan virtual-return
-- rows found by the system-wide scan, each keyed by id so this is
-- idempotent on re-run.
-- ============================================================

DELETE FROM stock_ledger WHERE id IN (
  '7ebe64f2-fb95-4abb-ae22-4f8708d90be6', -- duplicate return, GI0824-0024 (GI00248), JW-MSU42GU1-YT4N
  '9d659697-929f-4de7-8bbb-9d0ffe4e13eb', -- orphaned return, GI0824-0026 (GI00148), JW-MSU42GU1-YT4N -- the reported bug
  'b96e8667-50bb-400b-b08a-d65dbc538daa', -- duplicate return, GA0724-0014, JW-MSMYPYE8-8181
  '28eb08ae-36fb-4e0f-9b7a-9423a5e86f64', -- orphaned return, GI0524-0021 (GI00103), JW-MR0J2NYQ-HEKS
  'a26b90e7-7948-4830-8b86-a0afaf8f694d'  -- orphaned return, GI0524-0029 (GI00058), JW-MR5XV0TQ-YODF
);

-- The two fully-orphaned returns above (no surviving vendor-direct dispatch
-- at all) had bumped quantity_received with nothing left to justify it —
-- zero it out. Conditioned on the exact stale value so this is a no-op if
-- the migration is re-run after the value has already been corrected.
UPDATE job_work_items SET quantity_received = 0.000, updated_at = NOW()
WHERE id = '2005c94b-7462-496d-b976-69c6fee535e2' AND quantity_received = 2.705; -- JW-MR0J2NYQ-HEKS / GI0524-0021

UPDATE job_work_items SET quantity_received = 0.000, updated_at = NOW()
WHERE id = 'f15662f7-818b-4e9a-ad69-3e96afda9ef1' AND quantity_received = 2.210; -- JW-MR5XV0TQ-YODF / GI0524-0029
