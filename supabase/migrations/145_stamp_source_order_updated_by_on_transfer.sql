-- ============================================================
-- Migration 145: stamp the SOURCE order's updated_by when a Job Work
-- Transfer or Job Work Output Transfer is created
-- ============================================================
-- Found while investigating why Item Ledger's "Modified On" column stays
-- blank for some Job Work Out rows: create_job_work_transfer() (120) and
-- create_job_work_order_from_output() (138) both genuinely modify the
-- SOURCE order — the first via job_work_items.quantity_transferred_out,
-- the second via job_work_output_items.quantity_consumed — but neither
-- ever touches job_work_orders.updated_by/updated_at for that source
-- order, only for the brand-new destination order they create. The
-- destination order's own "Created By" was always correct; this only
-- affects whether the SOURCE order shows a "Last Modified" trail after
-- part of it is transferred elsewhere.
--
-- (Most genuinely blank "Created By" cells are a separate, non-code issue:
-- job work orders created before 2026-09-02/commit 790c360 never captured
-- a creator at all, and that can't be reconstructed after the fact.)
--
-- job_work_orders already has a BEFORE UPDATE trigger
-- (update_job_work_orders_updated_at, migration 001) that sets updated_at
-- automatically, so only updated_by needs to be set explicitly here.
-- ============================================================

CREATE OR REPLACE FUNCTION create_job_work_transfer(
  p_source_order_id  UUID,
  p_target_vendor_id UUID,
  p_transfer_date    DATE,
  p_reference_number TEXT,
  p_transfer_number  TEXT,
  p_reason           TEXT,
  p_notes            TEXT,
  p_lines            JSONB,  -- [{source_item_id, job_line_id, quantity}]
  p_created_by       UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_source_order  job_work_orders%ROWTYPE;
  v_new_order_id  UUID;
  v_transfer_id   UUID;
  v_line          JSONB;
  v_source_item   job_work_items%ROWTYPE;
  v_new_item_id   UUID;
  v_qty           NUMERIC;
  v_pending       NUMERIC;
BEGIN
  SELECT * INTO v_source_order FROM job_work_orders WHERE id = p_source_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Source job work order not found');
  END IF;

  IF p_target_vendor_id IS NULL OR p_target_vendor_id = v_source_order.vendor_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Select a target vendor different from the source vendor');
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No items to transfer');
  END IF;

  -- Pre-flight: lock and validate every line against its CURRENT pending
  -- balance before writing anything, so a stale/concurrent submission fails
  -- cleanly with no partial writes instead of over-transferring.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_source_item FROM job_work_items
    WHERE id = (v_line->>'source_item_id')::UUID AND job_work_order_id = p_source_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'One of the selected lines no longer exists on the source order — reload and try again.');
    END IF;

    v_qty := (v_line->>'quantity')::NUMERIC;
    v_pending := v_source_item.quantity_sent - COALESCE(v_source_item.quantity_received, 0) - v_source_item.quantity_transferred_out;

    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > v_pending THEN
      RETURN jsonb_build_object('success', false, 'error',
        format('Transfer quantity for one of the selected lines exceeds its current pending balance (%s) — reload and try again.', v_pending));
    END IF;
  END LOOP;

  INSERT INTO job_work_orders (
    reference_number, company_id, warehouse_id, vendor_id, dispatch_date,
    expected_return_date, work_description, status, notes, created_by
  ) VALUES (
    p_reference_number, v_source_order.company_id, v_source_order.warehouse_id, p_target_vendor_id,
    p_transfer_date, v_source_order.expected_return_date,
    'Transferred from ' || v_source_order.reference_number, 'dispatched', p_reason, p_created_by
  ) RETURNING id INTO v_new_order_id;

  INSERT INTO job_work_transfers (
    transfer_number, transfer_date, from_job_work_order_id, from_vendor_id,
    to_job_work_order_id, to_vendor_id, reason, notes, created_by
  ) VALUES (
    p_transfer_number, p_transfer_date, p_source_order_id, v_source_order.vendor_id,
    v_new_order_id, p_target_vendor_id, p_reason, p_notes, p_created_by
  ) RETURNING id INTO v_transfer_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_source_item FROM job_work_items WHERE id = (v_line->>'source_item_id')::UUID;
    v_qty := (v_line->>'quantity')::NUMERIC;

    INSERT INTO job_work_items (
      job_work_order_id, purchase_line_id, sub_purchase_line_id, job_line_id,
      item_master_id, item_name, material_type_id, material_size_id, size_label,
      quantity_sent, quantity_received, unit, is_transfer_line, source_job_work_item_id, notes
    ) VALUES (
      v_new_order_id, v_source_item.purchase_line_id, v_source_item.sub_purchase_line_id,
      NULLIF(v_line->>'job_line_id', ''), v_source_item.item_master_id, v_source_item.item_name,
      v_source_item.material_type_id, v_source_item.material_size_id, v_source_item.size_label,
      v_qty, 0, v_source_item.unit, true, v_source_item.id,
      'Transferred from ' || v_source_order.reference_number
    ) RETURNING id INTO v_new_item_id;
    -- Fires fn_job_work_item_to_ledger()'s INSERT branch: posts JOB_WORK_TRANSFER_IN.

    UPDATE job_work_items
    SET quantity_transferred_out = quantity_transferred_out + v_qty, updated_at = NOW()
    WHERE id = v_source_item.id;
    -- Fires fn_job_work_item_to_ledger()'s UPDATE branch: posts JOB_WORK_TRANSFER_OUT.
    -- Both inserts above are in the SAME transaction as this function call —
    -- if either trigger raised, or any later statement in this loop fails,
    -- the entire transfer (order, items, audit row) rolls back together.
    -- No more possibility of the partial state JWT-0826-0012 was found in.

    INSERT INTO job_work_transfer_items (
      job_work_transfer_id, from_job_work_item_id, to_job_work_item_id,
      purchase_line_id, sub_purchase_line_id, item_master_id, item_name,
      material_type_id, material_size_id, size_label, quantity_transferred, unit
    ) VALUES (
      v_transfer_id, v_source_item.id, v_new_item_id,
      v_source_item.purchase_line_id, v_source_item.sub_purchase_line_id,
      v_source_item.item_master_id, v_source_item.item_name,
      v_source_item.material_type_id, v_source_item.material_size_id, v_source_item.size_label,
      v_qty, v_source_item.unit
    );
  END LOOP;

  -- NEW (145): the source order was genuinely modified above
  -- (quantity_transferred_out on its own items) — record that on the order
  -- itself so Item Ledger / the order detail view show a Last Modified
  -- trail for it, not just for the brand-new destination order.
  UPDATE job_work_orders SET updated_by = p_created_by WHERE id = p_source_order_id;

  RETURN jsonb_build_object('success', true, 'to_job_work_order_id', v_new_order_id, 'transfer_number', p_transfer_number);
END;
$$;

CREATE OR REPLACE FUNCTION create_job_work_order_from_output(
  p_target_vendor_id     UUID,
  p_dispatch_date        DATE,
  p_reference_number     TEXT,
  p_expected_return_date DATE,
  p_work_description     TEXT,
  p_notes                TEXT,
  p_lines                JSONB,  -- [{source_output_item_id, job_line_id, quantity}]
  p_created_by           UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_order_id UUID;
  v_line         JSONB;
  v_output       job_work_output_items%ROWTYPE;
  v_source_order job_work_orders%ROWTYPE;
  v_company_id   UUID;
  v_warehouse_id UUID;
  v_qty          NUMERIC;
  v_remaining    NUMERIC;
BEGIN
  IF p_target_vendor_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Select a target vendor');
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No output items selected');
  END IF;

  -- Pre-flight: lock and validate every source line against its CURRENT
  -- remaining balance before writing anything, so a stale/concurrent
  -- submission fails cleanly instead of over-consuming an output line.
  -- Also confirm every line shares one company/warehouse — the new
  -- order's JOB_WORK_OUT must decrement the same warehouse the output
  -- stock actually sits in.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_output FROM job_work_output_items
    WHERE id = (v_line->>'source_output_item_id')::UUID
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'One of the selected output items no longer exists — reload and try again.');
    END IF;

    IF v_output.material_type_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'One of the selected output items has no material type set and cannot be dispatched.');
    END IF;

    v_qty := (v_line->>'quantity')::NUMERIC;
    v_remaining := v_output.quantity - COALESCE(v_output.quantity_consumed, 0);

    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > v_remaining THEN
      RETURN jsonb_build_object('success', false, 'error',
        format('Quantity for one of the selected output items exceeds its current remaining balance (%s) — reload and try again.', v_remaining));
    END IF;

    SELECT * INTO v_source_order FROM job_work_orders WHERE id = v_output.job_work_order_id;
    IF v_company_id IS NULL THEN
      v_company_id := v_source_order.company_id;
      v_warehouse_id := v_source_order.warehouse_id;
    ELSIF v_company_id <> v_source_order.company_id OR v_warehouse_id <> v_source_order.warehouse_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Selected output items belong to different companies/warehouses — send them as separate orders.');
    END IF;
  END LOOP;

  INSERT INTO job_work_orders (
    reference_number, company_id, warehouse_id, vendor_id, dispatch_date,
    expected_return_date, work_description, status, notes, created_by
  ) VALUES (
    p_reference_number, v_company_id, v_warehouse_id, p_target_vendor_id,
    p_dispatch_date, p_expected_return_date, p_work_description, 'dispatched', p_notes, p_created_by
  ) RETURNING id INTO v_new_order_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_output FROM job_work_output_items WHERE id = (v_line->>'source_output_item_id')::UUID;
    v_qty := (v_line->>'quantity')::NUMERIC;

    INSERT INTO job_work_items (
      job_work_order_id, job_line_id, item_master_id, item_name,
      material_type_id, material_size_id, size_label,
      quantity_sent, quantity_received, unit,
      source_job_work_output_item_id, notes
    ) VALUES (
      v_new_order_id, NULLIF(v_line->>'job_line_id', ''), v_output.item_master_id, v_output.item_name,
      v_output.material_type_id, v_output.material_size_id, v_output.size_label,
      v_qty, 0, v_output.unit,
      v_output.id,
      'Sourced from output ' || COALESCE(v_output.source_job_line_id, v_output.id::text)
    );
    -- Fires fn_job_work_item_to_ledger()'s INSERT branch. is_transfer_line
    -- defaults false, so this posts a plain JOB_WORK_OUT — no new ledger
    -- logic, same code path every ordinary dispatch already uses.

    UPDATE job_work_output_items
    SET quantity_consumed = COALESCE(quantity_consumed, 0) + v_qty, updated_at = NOW()
    WHERE id = v_output.id;
    -- Same transaction as the insert above — a failure anywhere rolls back
    -- the whole order instead of leaving quantity_consumed advanced with no
    -- downstream order to show for it.
  END LOOP;

  -- NEW (145): every source order whose output was consumed above was
  -- genuinely modified — stamp each one's updated_by (may be more than one
  -- order if lines were sourced from different orders' output).
  UPDATE job_work_orders
  SET updated_by = p_created_by
  WHERE id IN (
    SELECT DISTINCT jwoi.job_work_order_id
    FROM job_work_output_items jwoi
    WHERE jwoi.id IN (
      SELECT (elem->>'source_output_item_id')::UUID FROM jsonb_array_elements(p_lines) elem
    )
  );

  RETURN jsonb_build_object('success', true, 'job_work_order_id', v_new_order_id);
END;
$$;
