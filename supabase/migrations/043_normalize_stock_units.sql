-- ============================================================
-- WareCore WMS - Normalize Stock Ledger Units
--
-- material_types.unit drives the unit LABEL shown on the Inventory and
-- Stock at Vendors pages (v_current_stock, v_stock_at_vendors), but
-- stock_ledger.quantity has no unit of its own — every ledger-writing
-- trigger/function inserts the source line item's raw quantity, trusting
-- that the source row's `unit` always matches material_types.unit.
--
-- 4 of 5 material_types rows are mislabeled 'kg' while ~99% of recorded
-- purchase/dispatch/job-work line items use 'tons'. This migration:
--   1. Adds shared unit-conversion helpers (mirrors src/lib/utils.ts)
--   2. Relabels material_types so unit labels match the recorded data
--   3. Makes every stock_ledger insertion point convert the source row's
--      quantity into material_types.unit before inserting (no-op today,
--      future-proofs against unit mismatches)
--   4. Corrects the one known historical mismatch (Paint 0.95X1250,
--      purchase_line_id = 'OT0424-0001'): recorded as "3.11" under
--      purchase_bill_items.unit='tons', but item_master/job_work_items
--      agree the real unit is kg (3.11 kg = 0.00311 tons)
--   5. Runs a diagnostic that should report 0 remaining unit mismatches
-- ============================================================

-- ============================================================
-- Part 1: Helper functions (mirror UNIT_TO_KG / convertQuantity in
-- src/lib/utils.ts)
-- ============================================================

CREATE OR REPLACE FUNCTION fn_unit_to_kg_factor(p_unit TEXT)
RETURNS NUMERIC AS $$
  SELECT CASE lower(trim(p_unit))
    WHEN 'kg' THEN 1
    WHEN 'kgs' THEN 1
    WHEN 'kilogram' THEN 1
    WHEN 'kilograms' THEN 1
    WHEN 'g' THEN 0.001
    WHEN 'gram' THEN 0.001
    WHEN 'grams' THEN 0.001
    WHEN 'mt' THEN 1000
    WHEN 'ton' THEN 1000
    WHEN 'tons' THEN 1000
    WHEN 'tonne' THEN 1000
    WHEN 'tonnes' THEN 1000
    ELSE NULL
  END;
$$ LANGUAGE sql IMMUTABLE;

-- Converts p_quantity from p_from_unit to p_to_unit. If either unit is
-- unrecognized, returns p_quantity unchanged (pass-through, never NULLs out
-- a ledger row).
CREATE OR REPLACE FUNCTION fn_convert_quantity(p_quantity NUMERIC, p_from_unit TEXT, p_to_unit TEXT)
RETURNS NUMERIC AS $$
DECLARE
  v_from NUMERIC := fn_unit_to_kg_factor(p_from_unit);
  v_to   NUMERIC := fn_unit_to_kg_factor(p_to_unit);
BEGIN
  IF v_from IS NULL OR v_to IS NULL THEN
    RETURN p_quantity;
  END IF;
  RETURN p_quantity * v_from / v_to;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- Part 2: Relabel material_types so the unit label matches recorded data
-- ============================================================

-- 4 of 5 material types are mislabeled 'kg' when ~99% of recorded data is
-- actually in 'tons'. "Other Materials and Miscellaneous Items" is already 'tons'.
UPDATE material_types SET unit = 'tons' WHERE unit = 'kg';

-- ============================================================
-- Part 3: Make every stock_ledger insertion point unit-aware
-- ============================================================

-- 1. PURCHASE BILL ITEMS -> stock_ledger (PURCHASE_IN)
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
    fn_convert_quantity(NEW.quantity, NEW.unit, v_target_unit),
    'purchase_bill', v_bill.id, v_bill.bill_number,
    NEW.notes, v_bill.bill_date, v_bill.created_by,
    NEW.purchase_line_id, NULL
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. DISPATCH ITEMS -> stock_ledger (SALE_OUT, negative quantity)
CREATE OR REPLACE FUNCTION fn_dispatch_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_dispatch dispatch_orders%ROWTYPE;
  v_target_unit TEXT;
BEGIN
  SELECT * INTO v_dispatch FROM dispatch_orders WHERE id = NEW.dispatch_order_id;
  IF v_dispatch.status = 'draft' THEN
    RETURN NEW;
  END IF;
  SELECT unit INTO v_target_unit FROM material_types WHERE id = NEW.material_type_id;
  INSERT INTO stock_ledger (
    entry_type, company_id, warehouse_id, material_type_id, material_size_id,
    size_label, quantity, reference_type, reference_id, reference_number,
    notes, entry_date, created_by, purchase_line_id, sub_purchase_line_id
  ) VALUES (
    'SALE_OUT', v_dispatch.company_id, v_dispatch.warehouse_id,
    NEW.material_type_id, NEW.material_size_id, NEW.size_label,
    -fn_convert_quantity(NEW.quantity, NEW.unit, v_target_unit),
    'dispatch', v_dispatch.id, v_dispatch.invoice_number,
    NEW.notes, v_dispatch.dispatch_date, v_dispatch.created_by,
    NEW.purchase_line_id, NEW.sub_purchase_line_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. TRANSFER ITEMS -> stock_ledger (TRANSFER_OUT from source, TRANSFER_IN to destination)
CREATE OR REPLACE FUNCTION fn_transfer_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_transfer transfers%ROWTYPE;
  v_target_unit TEXT;
  v_converted_qty NUMERIC;
BEGIN
  SELECT * INTO v_transfer FROM transfers WHERE id = NEW.transfer_id;
  SELECT unit INTO v_target_unit FROM material_types WHERE id = NEW.material_type_id;
  v_converted_qty := fn_convert_quantity(NEW.quantity, NEW.unit, v_target_unit);

  -- TRANSFER_OUT from source warehouse
  INSERT INTO stock_ledger (
    entry_type, company_id, warehouse_id, material_type_id, material_size_id,
    size_label, quantity, reference_type, reference_id, reference_number,
    notes, entry_date, created_by
  ) VALUES (
    'TRANSFER_OUT', v_transfer.from_company_id, v_transfer.from_warehouse_id,
    NEW.material_type_id, NEW.material_size_id, NEW.size_label,
    -v_converted_qty, 'transfer', v_transfer.id, v_transfer.reference_number,
    NEW.notes, v_transfer.transfer_date, v_transfer.created_by
  );

  -- TRANSFER_IN to destination warehouse
  INSERT INTO stock_ledger (
    entry_type, company_id, warehouse_id, material_type_id, material_size_id,
    size_label, quantity, reference_type, reference_id, reference_number,
    notes, entry_date, created_by
  ) VALUES (
    'TRANSFER_IN', v_transfer.to_company_id, v_transfer.to_warehouse_id,
    NEW.material_type_id, NEW.material_size_id, NEW.size_label,
    v_converted_qty, 'transfer', v_transfer.id, v_transfer.reference_number,
    NEW.notes, v_transfer.transfer_date, v_transfer.created_by
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. JOB WORK ITEMS -> stock_ledger (JOB_WORK_OUT on insert, JOB_WORK_RETURN_IN on return)
CREATE OR REPLACE FUNCTION fn_job_work_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_order job_work_orders%ROWTYPE;
  v_returned_delta DECIMAL(15,3);
  v_target_unit TEXT;
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = NEW.job_work_order_id;
  SELECT unit INTO v_target_unit FROM material_types WHERE id = NEW.material_type_id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id, material_type_id, material_size_id,
      size_label, quantity, reference_type, reference_id, reference_number,
      entry_date, created_by, purchase_line_id, sub_purchase_line_id
    ) VALUES (
      'JOB_WORK_OUT', v_order.company_id, v_order.warehouse_id,
      NEW.material_type_id, NEW.material_size_id, NEW.size_label,
      -fn_convert_quantity(NEW.quantity_sent, NEW.unit, v_target_unit),
      'job_work', v_order.id, v_order.reference_number,
      v_order.dispatch_date, v_order.created_by,
      NEW.purchase_line_id, NEW.sub_purchase_line_id
    );

  ELSIF TG_OP = 'UPDATE' AND NEW.quantity_received > OLD.quantity_received THEN
    v_returned_delta := NEW.quantity_received - OLD.quantity_received;
    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id, material_type_id, material_size_id,
      size_label, quantity, reference_type, reference_id, reference_number,
      entry_date, created_by, purchase_line_id, sub_purchase_line_id
    ) VALUES (
      'JOB_WORK_RETURN_IN', v_order.company_id, v_order.warehouse_id,
      NEW.material_type_id, NEW.material_size_id, NEW.size_label,
      fn_convert_quantity(v_returned_delta, NEW.unit, v_target_unit),
      'job_work', v_order.id, v_order.reference_number,
      CURRENT_DATE, v_order.created_by,
      NEW.purchase_line_id, NEW.sub_purchase_line_id
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. JOB WORK OUTPUT ITEMS -> stock_ledger (JOB_WORK_OUTPUT_IN)
CREATE OR REPLACE FUNCTION fn_job_work_output_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_order job_work_orders%ROWTYPE;
  v_purchase_line_id TEXT;
  v_sub_purchase_line_id TEXT;
  v_line_count INT;
  v_target_unit TEXT;
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = NEW.job_work_order_id;

  SELECT count(DISTINCT purchase_line_id),
         (array_agg(DISTINCT purchase_line_id))[1],
         (array_agg(DISTINCT sub_purchase_line_id))[1]
  INTO v_line_count, v_purchase_line_id, v_sub_purchase_line_id
  FROM job_work_items
  WHERE job_work_order_id = NEW.job_work_order_id AND purchase_line_id IS NOT NULL;

  IF v_line_count <> 1 THEN
    v_purchase_line_id := NULL;
    v_sub_purchase_line_id := NULL;
  END IF;

  -- Only create ledger entry if material_type_id is set
  IF NEW.material_type_id IS NOT NULL THEN
    SELECT unit INTO v_target_unit FROM material_types WHERE id = NEW.material_type_id;
    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id,
      material_type_id, material_size_id, size_label,
      quantity,
      reference_type, reference_id, reference_number,
      entry_date, created_by,
      purchase_line_id, sub_purchase_line_id
    ) VALUES (
      'JOB_WORK_OUTPUT_IN', v_order.company_id, v_order.warehouse_id,
      NEW.material_type_id, NEW.material_size_id, NEW.size_label,
      fn_convert_quantity(NEW.quantity, NEW.unit, v_target_unit),
      'job_work', v_order.id, v_order.reference_number,
      CURRENT_DATE, v_order.created_by,
      v_purchase_line_id, v_sub_purchase_line_id
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Cancel a purchase bill: reverse all line items (PURCHASE_CANCEL)
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
      CURRENT_DATE,
      v_item.purchase_line_id
    );
  END LOOP;

  UPDATE purchase_bills
  SET status = 'cancelled', cancelled_at = NOW(), cancelled_notes = p_notes, updated_at = NOW()
  WHERE id = p_bill_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 7. Reverse a single purchase line item (used when editing an active bill)
CREATE OR REPLACE FUNCTION reverse_purchase_item(p_bill_id uuid, p_item_id uuid)
RETURNS void AS $$
DECLARE
  v_bill purchase_bills%ROWTYPE;
  v_item purchase_bill_items%ROWTYPE;
  v_target_unit TEXT;
BEGIN
  SELECT * INTO v_bill FROM purchase_bills WHERE id = p_bill_id;
  SELECT * INTO v_item FROM purchase_bill_items WHERE id = p_item_id AND bill_id = p_bill_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT unit INTO v_target_unit FROM material_types WHERE id = v_item.material_type_id;

  INSERT INTO stock_ledger (
    entry_type, company_id, warehouse_id,
    material_type_id, material_size_id, size_label,
    quantity, reference_type, reference_id, reference_number,
    notes, entry_date, purchase_line_id
  ) VALUES (
    'PURCHASE_CANCEL',
    v_bill.company_id, v_bill.warehouse_id,
    v_item.material_type_id, v_item.material_size_id, v_item.size_label,
    -fn_convert_quantity(v_item.quantity, v_item.unit, v_target_unit),
    'purchase_bill', v_bill.id, v_bill.bill_number,
    'Edit correction', CURRENT_DATE,
    v_item.purchase_line_id
  );
END;
$$ LANGUAGE plpgsql;

-- 8. Cancel a dispatch order: restore stock for all dispatched items (SALE_CANCEL)
CREATE OR REPLACE FUNCTION cancel_dispatch_order(
  p_order_id UUID,
  p_notes    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order dispatch_orders%ROWTYPE;
  v_item  dispatch_items%ROWTYPE;
  v_target_unit TEXT;
BEGIN
  SELECT * INTO v_order FROM dispatch_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Dispatch order not found');
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Dispatch order is already cancelled');
  END IF;

  FOR v_item IN
    SELECT * FROM dispatch_items WHERE dispatch_order_id = p_order_id
  LOOP
    SELECT unit INTO v_target_unit FROM material_types WHERE id = v_item.material_type_id;
    INSERT INTO stock_ledger (
      entry_type,
      company_id, warehouse_id,
      material_type_id, material_size_id, size_label,
      quantity,
      reference_type, reference_id, reference_number,
      notes, entry_date,
      purchase_line_id, sub_purchase_line_id
    ) VALUES (
      'SALE_CANCEL',
      v_order.company_id, v_order.warehouse_id,
      v_item.material_type_id, v_item.material_size_id, v_item.size_label,
      fn_convert_quantity(v_item.quantity, v_item.unit, v_target_unit),
      'dispatch', v_order.id, v_order.invoice_number,
      p_notes,
      CURRENT_DATE,
      v_item.purchase_line_id,
      v_item.sub_purchase_line_id
    );
  END LOOP;

  UPDATE dispatch_orders
  SET status = 'cancelled', cancelled_at = NOW(), cancelled_notes = p_notes, updated_at = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 9. Edit a dispatch order: reverse old items (SALE_CANCEL) then insert new ones
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

  -- Reverse stock for currently-active order items
  IF v_order.status = 'active' THEN
    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id,
      material_type_id, material_size_id, size_label,
      quantity,
      reference_type, reference_id, reference_number,
      notes, entry_date,
      purchase_line_id, sub_purchase_line_id
    )
    SELECT
      'SALE_CANCEL',
      v_order.company_id, v_order.warehouse_id,
      di.material_type_id, di.material_size_id, di.size_label,
      fn_convert_quantity(di.quantity, di.unit, mt.unit),
      'dispatch', v_order.id, v_order.invoice_number,
      'Sale edit — stock reversal',
      CURRENT_DATE,
      di.purchase_line_id, di.sub_purchase_line_id
    FROM dispatch_items di
    JOIN material_types mt ON mt.id = di.material_type_id
    WHERE di.dispatch_order_id = p_order_id;
  END IF;

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

-- 10. Delete a job work order: archive + reverse stock for input/output items (JOB_WORK_CANCEL)
CREATE OR REPLACE FUNCTION delete_job_work_order(
  p_order_id UUID,
  p_notes    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order           job_work_orders%ROWTYPE;
  v_item            job_work_items%ROWTYPE;
  v_out_item        job_work_output_items%ROWTYPE;
  v_net_qty         DECIMAL(15,3);
  v_target_unit     TEXT;
  v_cancellation_id UUID;
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Job work order not found');
  END IF;

  -- Archive the order snapshot
  INSERT INTO job_work_cancellations (
    original_order_id, reference_number,
    vendor_id, vendor_name,
    company_id, company_name,
    warehouse_id, warehouse_name,
    dispatch_date, expected_return_date, actual_return_date,
    work_description, notes, status,
    cancelled_notes
  )
  SELECT
    v_order.id, v_order.reference_number,
    v_order.vendor_id, s.name,
    v_order.company_id, c.name,
    v_order.warehouse_id, w.name,
    v_order.dispatch_date, v_order.expected_return_date, v_order.actual_return_date,
    v_order.work_description, v_order.notes, v_order.status,
    p_notes
  FROM (SELECT 1) AS _dummy
  LEFT JOIN suppliers  s ON s.id = v_order.vendor_id
  LEFT JOIN companies  c ON c.id = v_order.company_id
  LEFT JOIN warehouses w ON w.id = v_order.warehouse_id
  RETURNING id INTO v_cancellation_id;

  -- Archive input line items
  INSERT INTO job_work_cancellation_items (
    cancellation_id, original_item_id,
    item_master_id, item_name,
    material_type_id, material_type_name,
    material_size_id, size_label,
    quantity_sent, quantity_received, unit,
    purchase_line_id, sub_purchase_line_id, job_line_id
  )
  SELECT
    v_cancellation_id, ji.id,
    ji.item_master_id, ji.item_name,
    ji.material_type_id, mt.description,
    ji.material_size_id, ji.size_label,
    ji.quantity_sent, ji.quantity_received, ji.unit,
    ji.purchase_line_id, ji.sub_purchase_line_id, ji.job_line_id
  FROM job_work_items ji
  LEFT JOIN material_types mt ON mt.id = ji.material_type_id
  WHERE ji.job_work_order_id = p_order_id;

  -- Archive output line items
  INSERT INTO job_work_cancellation_output_items (
    cancellation_id, original_item_id,
    item_master_id, item_name,
    material_type_id, material_type_name,
    material_size_id, size_label,
    quantity, unit,
    source_job_line_id, source_purchase_line_ids, notes
  )
  SELECT
    v_cancellation_id, oi.id,
    oi.item_master_id, oi.item_name,
    oi.material_type_id, mt.description,
    oi.material_size_id, oi.size_label,
    oi.quantity, oi.unit,
    oi.source_job_line_id, oi.source_purchase_line_ids, oi.notes
  FROM job_work_output_items oi
  LEFT JOIN material_types mt ON mt.id = oi.material_type_id
  WHERE oi.job_work_order_id = p_order_id;

  -- Restore stock for input items still out at vendor
  FOR v_item IN
    SELECT * FROM job_work_items WHERE job_work_order_id = p_order_id
  LOOP
    v_net_qty := v_item.quantity_sent - COALESCE(v_item.quantity_received, 0);

    IF v_net_qty <> 0 THEN
      SELECT unit INTO v_target_unit FROM material_types WHERE id = v_item.material_type_id;
      INSERT INTO stock_ledger (
        entry_type,
        company_id, warehouse_id,
        material_type_id, material_size_id, size_label,
        quantity,
        reference_type, reference_id, reference_number,
        notes, entry_date,
        purchase_line_id, sub_purchase_line_id,
        created_by
      ) VALUES (
        'JOB_WORK_CANCEL',
        v_order.company_id, v_order.warehouse_id,
        v_item.material_type_id, v_item.material_size_id, v_item.size_label,
        fn_convert_quantity(v_net_qty, v_item.unit, v_target_unit),
        'job_work', v_order.id, v_order.reference_number,
        p_notes, CURRENT_DATE,
        v_item.purchase_line_id, v_item.sub_purchase_line_id,
        v_order.created_by
      );
    END IF;
  END LOOP;

  -- Reverse output item stock (undo JOB_WORK_OUTPUT_IN entries)
  FOR v_out_item IN
    SELECT * FROM job_work_output_items WHERE job_work_order_id = p_order_id
  LOOP
    IF v_out_item.material_type_id IS NOT NULL THEN
      SELECT unit INTO v_target_unit FROM material_types WHERE id = v_out_item.material_type_id;
      INSERT INTO stock_ledger (
        entry_type,
        company_id, warehouse_id,
        material_type_id, material_size_id, size_label,
        quantity,
        reference_type, reference_id, reference_number,
        notes, entry_date,
        created_by
      ) VALUES (
        'JOB_WORK_CANCEL',
        v_order.company_id, v_order.warehouse_id,
        v_out_item.material_type_id, v_out_item.material_size_id, v_out_item.size_label,
        -fn_convert_quantity(v_out_item.quantity, v_out_item.unit, v_target_unit),
        'job_work', v_order.id, v_order.reference_number,
        p_notes, CURRENT_DATE,
        v_order.created_by
      );
    END IF;
  END LOOP;

  -- Hard delete — cascades to job_work_items and job_work_output_items
  DELETE FROM job_work_orders WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'cancellation_id', v_cancellation_id);
END;
$$;

-- 11. Stock at vendors (job work) — convert pending quantity to material_types.unit
CREATE OR REPLACE VIEW v_stock_at_vendors AS
SELECT
  jwo.vendor_id,
  s.name AS vendor_name,
  jwo.company_id,
  c.name AS company_name,
  jwi.material_type_id,
  mt.description AS material_type_name,
  COALESCE(ms.size_label, jwi.size_label) AS size_label,
  SUM(fn_convert_quantity(jwi.quantity_sent - COALESCE(jwi.quantity_received, 0), jwi.unit, mt.unit)) AS pending_quantity,
  mt.unit
FROM job_work_orders jwo
JOIN job_work_items jwi ON jwi.job_work_order_id = jwo.id
JOIN suppliers s ON s.id = jwo.vendor_id
JOIN companies c ON c.id = jwo.company_id
JOIN material_types mt ON mt.id = jwi.material_type_id
LEFT JOIN material_sizes ms ON ms.id = jwi.material_size_id
WHERE jwo.status IN ('dispatched', 'partial_return')
GROUP BY
  jwo.vendor_id, s.name,
  jwo.company_id, c.name,
  jwi.material_type_id, mt.description,
  COALESCE(ms.size_label, jwi.size_label), mt.unit;

-- ============================================================
-- Part 4: One-off historical correction — 'Paint 0.95X1250'
-- (purchase_line_id = 'OT0424-0001') was recorded as "3.11" under
-- purchase_bill_items.unit='tons' (the table-wide default), but item_master
-- lists this item's unit as 'kgs', and the paired job_work_items row
-- (job_line_id JW-2704-0002) correctly recorded unit='KG'. The true
-- quantity is 3.11 kg = 0.00311 tons.
--
-- Relabel the purchase line to 'kgs' (quantity unchanged — still "3.11", now
-- correctly meaning kg) and re-derive every paired stock_ledger row for this
-- purchase line from kg to material_types.unit='tons' ("Other Materials and
-- Miscellaneous Items"). 'kgs' and 'KG' both have kg-factor 1, so this single
-- conversion is correct for both the PURCHASE_IN (+3.11 -> +0.00311) and
-- JOB_WORK_OUT (-3.11 -> -0.00311) rows — net stays zero.
-- ============================================================

UPDATE purchase_bill_items
SET unit = 'kgs'
WHERE purchase_line_id = 'OT0424-0001';

UPDATE stock_ledger
SET quantity = fn_convert_quantity(quantity, 'kgs', 'tons')
WHERE purchase_line_id = 'OT0424-0001';

-- ============================================================
-- Part 5: Diagnostic — verify no unit mismatches remain.
-- Informational only; modifies nothing. Should report 0 rows.
-- ============================================================

DO $$
DECLARE
  v_row RECORD;
  v_count INT := 0;
BEGIN
  FOR v_row IN
    SELECT sl.id, sl.entry_type, sl.quantity, sl.purchase_line_id,
           mt.unit AS target_unit, src.unit AS source_unit
    FROM stock_ledger sl
    JOIN material_types mt ON mt.id = sl.material_type_id
    LEFT JOIN LATERAL (
      SELECT unit FROM purchase_bill_items WHERE purchase_line_id = sl.purchase_line_id AND sl.entry_type IN ('PURCHASE_IN','PURCHASE_CANCEL')
      UNION ALL
      SELECT unit FROM dispatch_items WHERE purchase_line_id = sl.purchase_line_id AND sl.entry_type IN ('SALE_OUT','SALE_CANCEL')
      UNION ALL
      SELECT unit FROM job_work_items WHERE purchase_line_id = sl.purchase_line_id AND sl.entry_type IN ('JOB_WORK_OUT','JOB_WORK_RETURN_IN','JOB_WORK_CANCEL')
      LIMIT 1
    ) src ON true
    WHERE src.unit IS NOT NULL
      AND fn_unit_to_kg_factor(src.unit) IS NOT NULL
      AND fn_unit_to_kg_factor(mt.unit) IS NOT NULL
      AND fn_unit_to_kg_factor(src.unit) <> fn_unit_to_kg_factor(mt.unit)
  LOOP
    v_count := v_count + 1;
    RAISE NOTICE 'Unit mismatch: stock_ledger.id=%, entry_type=%, qty=%, purchase_line_id=%, source_unit=%, target_unit=%',
      v_row.id, v_row.entry_type, v_row.quantity, v_row.purchase_line_id, v_row.source_unit, v_row.target_unit;
  END LOOP;

  RAISE NOTICE 'Diagnostic complete: % unit-mismatch row(s) found (informational only, no changes made)', v_count;
END $$;
