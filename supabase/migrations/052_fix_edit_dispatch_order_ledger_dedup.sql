-- ============================================================
-- WareCore WMS - Fix Edit Dispatch Order Ledger Duplication
-- The previous edit_dispatch_order() reversed old stock by INSERTing
-- SALE_CANCEL entries, then deleted/re-inserted line items so the
-- existing trigger created fresh SALE_OUT entries. The CANCEL entries
-- were never removed, so every edit left behind a growing trail of
-- offsetting (but never-cleaned-up) ledger rows — net stock stayed
-- correct, but the ledger/reports accumulated duplicate-looking
-- entries on every save. Same bug class as fixed for job work orders
-- in migration 041.
--
-- Fix: delete this order's existing stock_ledger rows up front, then
-- delete/re-insert line items as before. The insert trigger recreates
-- exactly the entries that match the current line items — making
-- repeated edits idempotent (no growing history of reversal pairs).
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
  v_order dispatch_orders%ROWTYPE;
  v_item  JSONB;
BEGIN
  SELECT * INTO v_order FROM dispatch_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Dispatch order not found');
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot edit a cancelled order');
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
-- One-time data fix: dispatch order with invoice_number 0424-0010
-- (item GI00242 / GI 2X1250) accumulated a duplicate SALE_OUT row
-- and a SALE_CANCEL reversal from a prior edit under the old function.
-- Remove the reversal noise and the superseded SALE_OUT, keeping only
-- the SALE_OUT row that matches the order's current line item (-7.823).
-- ============================================================

DELETE FROM stock_ledger
WHERE reference_type = 'dispatch'
  AND reference_id = (SELECT id FROM dispatch_orders WHERE invoice_number = '0424-0010')
  AND id IN (
    'c2f8132e-fbe8-45d2-aa94-0c64fb90dc02', -- stale SALE_OUT (-7.820, superseded)
    '96684da9-8433-4304-a8f6-e7d7105d4891'  -- SALE_CANCEL reversal (now redundant)
  );

-- ============================================================
-- One-time data fix: dispatch order with invoice_number 0424-0001
-- (item CR 0.80X1485) had the same duplicate SALE_OUT + SALE_CANCEL
-- trail from a prior no-op edit. Keep only the SALE_OUT row matching
-- the order's current line item (-4.990).
-- ============================================================

DELETE FROM stock_ledger
WHERE reference_type = 'dispatch'
  AND reference_id = (SELECT id FROM dispatch_orders WHERE invoice_number = '0424-0001')
  AND id IN (
    '51c87c8a-2d59-4db5-8a37-b4a780d66162', -- stale SALE_OUT (-4.990, superseded duplicate)
    '8c060537-206c-4b05-a13b-72b0aa2d9714'  -- SALE_CANCEL reversal (now redundant)
  );

-- ============================================================
-- One-time data fix: dispatch order with invoice_number 0424-0005
-- (item CR00105 / CR 0.65X121) had the same duplicate SALE_OUT +
-- SALE_CANCEL trail from a prior no-op edit. Keep only the SALE_OUT
-- row matching the order's current line item (-4.720).
-- ============================================================

DELETE FROM stock_ledger
WHERE reference_type = 'dispatch'
  AND reference_id = (SELECT id FROM dispatch_orders WHERE invoice_number = '0424-0005')
  AND id IN (
    'f37ba548-c0db-42e7-8142-ef73fe2e8d9f', -- stale SALE_OUT (-4.720, superseded duplicate)
    '47f92a44-6d65-4ce5-8e6e-59d2be570f81'  -- SALE_CANCEL reversal (now redundant)
  );
