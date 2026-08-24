-- Migration 120: create_job_work_transfer() — atomic vendor-to-vendor
-- transfer creation, replacing the client-side 5-step sequence
-- (jobwork/[id]/transfer/page.tsx: insert order, insert items, update
-- source quantity_transferred_out, insert transfer audit, insert transfer
-- items — five separate round-trip Hasura mutations with no shared
-- transaction and no rollback if one step fails partway).
--
-- Root-caused against JWT-0826-0012 (Arun Engineering -> M&M, OT0324-0006,
-- 2.300 MT, created 2026-08-17): the destination order, its transfer-line
-- item, the source item's quantity_transferred_out, and the transfer audit
-- row were ALL created correctly, but neither the JOB_WORK_TRANSFER_OUT nor
-- JOB_WORK_TRANSFER_IN stock_ledger row (both of which fn_job_work_item_to_ledger()
-- posts via trigger, and both of which fired correctly for every other
-- transfer in the system) exists for it. The exact point of failure in that
-- one request is not recoverable at this distance, but the structural fix
-- is the same one already applied to Edit Order (migration 114) and every
-- other multi-table job-work write path: one atomic function, one
-- transaction, so a failure anywhere rolls back everything instead of
-- leaving a partial state that silently understates the ledger.
--
-- Item/transfer-number generation stays exactly where it already was
-- (client-side, from the same existing queries) — this migration only
-- moves the WRITES into one atomic call; it does not change how ids are
-- allocated.

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

  RETURN jsonb_build_object('success', true, 'to_job_work_order_id', v_new_order_id, 'transfer_number', p_transfer_number);
END;
$$;
