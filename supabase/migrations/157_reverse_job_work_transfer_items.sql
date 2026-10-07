-- ============================================================
-- Migration 157: reverse a Job Work vendor transfer item by item
-- ============================================================
-- Until now the only way to undo a vendor transfer was "Delete transfer"
-- (delete_job_work_transfer(), migrations 059/060): all lines at once, the
-- destination order deleted outright, and any onward transfer or vendor
-- direct sale made from that order silently unwound/cancelled with it.
--
-- New behaviour (reverse_job_work_transfer_items()):
--   * reverse any subset of a transfer's lines; each reversed line's
--     quantity goes back to the line on the source order it came from;
--   * a line cannot be reversed once the material has moved on from the
--     destination order — transferred to yet another vendor, sold directly
--     from the vendor, returned/received, or processed into output. Nothing
--     downstream is undone automatically any more; the user is told what
--     blocks the line and in what order to unwind it;
--   * when the last line of the destination order is reversed, the order is
--     kept as a record and deactivated: status 'cancelled' with
--     completion_via 'transfer_reversed' (shown as "Transfer Reversed").
--
-- Ledger handling follows migration 061's convention (no reversal rows):
-- the line's own JOB_WORK_TRANSFER_OUT (source order) and
-- JOB_WORK_TRANSFER_IN (destination order) rows are removed, keeping
-- REC-009/REC-018 (items vs ledger) in agreement. Every removed row is
-- copied to stock_ledger_deletions (migration 153) first, and the transfer
-- line itself is kept with reversed_at/reversed_by/reversal_notes.
--
-- delete_job_work_transfer() now refuses (it was the cascading path), and
-- delete_job_work_order()'s transfer message (156) points at reversal.
--
-- One data fill: 50 transfer lines made before migration 120 (2026-07-18 ..
-- 2026-08-24, the old client-side transfer flow) never recorded
-- to_job_work_item_id, so reversal couldn't find their destination line.
-- Each has exactly one candidate (the destination order's transfer line
-- whose source_job_work_item_id is the transfer line's source item); the
-- link is filled only where that match is unique and unclaimed. No stock
-- or ledger data changes.
-- ============================================================

ALTER TABLE job_work_transfer_items
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_notes TEXT;

WITH candidates AS (
  SELECT ti.id AS transfer_item_id, d.id AS dest_item_id,
         count(*) OVER (PARTITION BY ti.id) AS per_transfer_item,
         count(*) OVER (PARTITION BY d.id) AS per_dest_item
  FROM job_work_transfer_items ti
  JOIN job_work_transfers t ON t.id = ti.job_work_transfer_id
  JOIN job_work_items d
    ON d.job_work_order_id = t.to_job_work_order_id
   AND d.is_transfer_line
   AND d.source_job_work_item_id = ti.from_job_work_item_id
  WHERE ti.to_job_work_item_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM job_work_transfer_items other WHERE other.to_job_work_item_id = d.id)
)
UPDATE job_work_transfer_items ti
SET to_job_work_item_id = c.dest_item_id
FROM candidates c
WHERE ti.id = c.transfer_item_id AND c.per_transfer_item = 1 AND c.per_dest_item = 1;

-- Why a transfer line can't be reversed right now, in business terms;
-- NULL when it can.
CREATE OR REPLACE FUNCTION job_work_transfer_item_reversal_block(p_transfer_item_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_ti          job_work_transfer_items%ROWTYPE;
  v_transfer    job_work_transfers%ROWTYPE;
  v_dest        job_work_items%ROWTYPE;
  v_src         job_work_items%ROWTYPE;
  v_dest_ref    TEXT;
  v_dest_vendor TEXT;
  v_src_status  TEXT;
  v_msg         TEXT;
BEGIN
  SELECT * INTO v_ti FROM job_work_transfer_items WHERE id = p_transfer_item_id;
  IF NOT FOUND THEN
    RETURN 'Transfer line not found.';
  END IF;
  IF v_ti.reversed_at IS NOT NULL THEN
    RETURN 'Already reversed on ' || to_char(v_ti.reversed_at AT TIME ZONE 'Asia/Kolkata', 'DD-Mon-YYYY') || '.';
  END IF;

  SELECT * INTO v_transfer FROM job_work_transfers WHERE id = v_ti.job_work_transfer_id;
  SELECT o.reference_number, s.name INTO v_dest_ref, v_dest_vendor
  FROM job_work_orders o LEFT JOIN suppliers s ON s.id = o.vendor_id
  WHERE o.id = v_transfer.to_job_work_order_id;

  SELECT * INTO v_dest FROM job_work_items
  WHERE id = v_ti.to_job_work_item_id AND job_work_order_id = v_transfer.to_job_work_order_id;
  IF NOT FOUND THEN
    RETURN format('This line is no longer on order %s, so it cannot be reversed automatically. Please report it to the administrator.', COALESCE(v_dest_ref, '(unknown)'));
  END IF;

  SELECT * INTO v_src FROM job_work_items
  WHERE id = v_ti.from_job_work_item_id AND job_work_order_id = v_transfer.from_job_work_order_id;
  IF NOT FOUND THEN
    RETURN 'The line it was transferred from is no longer on the source order, so it cannot be reversed automatically. Please report it to the administrator.';
  END IF;
  SELECT status INTO v_src_status FROM job_work_orders WHERE id = v_transfer.from_job_work_order_id;
  IF v_src_status = 'cancelled' THEN
    RETURN 'The source order has been cancelled, so the material cannot be returned to it.';
  END IF;

  -- Moved on: transferred to another vendor.
  IF COALESCE(v_dest.quantity_transferred_out, 0) > 0 THEN
    SELECT string_agg(DISTINCT t.transfer_number || ' to ' || COALESCE(s.name, '(unknown vendor)'), ', ')
      INTO v_msg
    FROM job_work_transfer_items ti
    JOIN job_work_transfers t ON t.id = ti.job_work_transfer_id
    LEFT JOIN suppliers s ON s.id = t.to_vendor_id
    WHERE ti.from_job_work_item_id = v_dest.id AND ti.reversed_at IS NULL;
    RETURN format('Already transferred on from %s to another vendor (%s). Reverse that transfer first.',
                  COALESCE(v_dest_vendor, v_dest_ref), COALESCE(v_msg, 'transfer not found'));
  END IF;

  -- Moved on: sold directly from the vendor.
  SELECT string_agg(DISTINCT COALESCE(d.invoice_number, d.sale_ref_id, 'sale') || ' dated ' || to_char(d.dispatch_date, 'DD-Mon-YYYY'), ', ')
    INTO v_msg
  FROM dispatch_items di
  JOIN dispatch_orders d ON d.id = di.dispatch_order_id
  WHERE di.source_job_work_item_id = v_dest.id AND d.status <> 'cancelled';
  IF v_msg IS NOT NULL THEN
    RETURN format('Already sold directly from %s (%s). This line cannot be reversed while that sale stands.',
                  COALESCE(v_dest_vendor, v_dest_ref), v_msg);
  END IF;

  -- Moved on: returned / received back (also covers older direct sales that
  -- predate dispatch_items.source_job_work_item_id).
  IF COALESCE(v_dest.quantity_received, 0) > 0 THEN
    RETURN format('%s of this line has already been returned or sold from %s, so it cannot be reversed.',
                  to_char(v_dest.quantity_received, 'FM999999990.000'), COALESCE(v_dest_vendor, v_dest_ref));
  END IF;

  -- Moved on: processed into output on the destination order.
  IF EXISTS (
    SELECT 1 FROM job_work_output_items oi
    WHERE oi.job_work_order_id = v_dest.job_work_order_id
      AND (oi.source_job_line_id IS NULL OR oi.source_job_line_id = v_dest.job_line_id)
  ) THEN
    RETURN format('Output has already been recorded against this material on order %s, so it cannot be reversed.', v_dest_ref);
  END IF;

  IF v_dest.quantity_sent <> v_ti.quantity_transferred THEN
    RETURN format('The quantity on order %s (%s) was changed after the transfer (%s). Correct it with Edit Order before reversing.',
                  v_dest_ref, to_char(v_dest.quantity_sent, 'FM999999990.000'),
                  to_char(v_ti.quantity_transferred, 'FM999999990.000'));
  END IF;

  IF COALESCE(v_src.quantity_transferred_out, 0) < v_ti.quantity_transferred THEN
    RETURN 'The source order no longer shows this quantity as transferred out, so it cannot be reversed automatically. Please report it to the administrator.';
  END IF;

  RETURN NULL;
END;
$$;

-- Everything the Reverse Transfer dialog needs, in one call.
CREATE OR REPLACE FUNCTION preview_job_work_transfer_reversal(p_transfer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_transfer job_work_transfers%ROWTYPE;
  v_result   JSONB;
BEGIN
  SELECT * INTO v_transfer FROM job_work_transfers WHERE id = p_transfer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Transfer not found');
  END IF;

  SELECT jsonb_build_object(
    'transfer_number', v_transfer.transfer_number,
    'transfer_date', v_transfer.transfer_date,
    'from_reference_number', fo.reference_number,
    'from_vendor_name', fs.name,
    'to_reference_number', tor.reference_number,
    'to_vendor_name', ts.name,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ti.id,
        'item_name', ti.item_name,
        'size_label', ti.size_label,
        'purchase_line_id', COALESCE(ti.sub_purchase_line_id, ti.purchase_line_id),
        'job_line_id', di.job_line_id,
        'quantity', ti.quantity_transferred,
        'unit', ti.unit,
        'reversed_at', ti.reversed_at,
        'reversal_notes', ti.reversal_notes,
        'blocked_reason', CASE WHEN ti.reversed_at IS NULL THEN job_work_transfer_item_reversal_block(ti.id) END
      ) ORDER BY di.job_line_id NULLS LAST, ti.item_name, ti.id)
      FROM job_work_transfer_items ti
      LEFT JOIN job_work_items di ON di.id = ti.to_job_work_item_id
      WHERE ti.job_work_transfer_id = p_transfer_id
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM (SELECT 1) AS _dummy
  LEFT JOIN job_work_orders fo ON fo.id = v_transfer.from_job_work_order_id
  LEFT JOIN job_work_orders tor ON tor.id = v_transfer.to_job_work_order_id
  LEFT JOIN suppliers fs ON fs.id = v_transfer.from_vendor_id
  LEFT JOIN suppliers ts ON ts.id = v_transfer.to_vendor_id;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION reverse_job_work_transfer_items(
  p_transfer_id UUID,
  p_item_ids    UUID[],
  p_notes       TEXT DEFAULT NULL,
  p_user_id     UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_transfer    job_work_transfers%ROWTYPE;
  v_ti          job_work_transfer_items%ROWTYPE;
  v_dest        job_work_items%ROWTYPE;
  v_block       TEXT;
  v_errors      TEXT[] := '{}';
  v_ledger_id   UUID;
  v_label       TEXT;
  v_reversed    INT := 0;
  v_deactivated BOOLEAN := false;
BEGIN
  SELECT * INTO v_transfer FROM job_work_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transfer not found');
  END IF;
  IF p_item_ids IS NULL OR cardinality(p_item_ids) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Select at least one line to reverse.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_item_ids) AS x(id)
    WHERE NOT EXISTS (SELECT 1 FROM job_work_transfer_items ti WHERE ti.id = x.id AND ti.job_work_transfer_id = p_transfer_id)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'One of the selected lines does not belong to this transfer — reload and try again.');
  END IF;

  -- Lock both orders' lines, then check every selected line before changing
  -- anything: all selected lines are reversed, or none are.
  PERFORM 1 FROM job_work_items
  WHERE job_work_order_id IN (v_transfer.from_job_work_order_id, v_transfer.to_job_work_order_id)
  FOR UPDATE;

  FOR v_ti IN
    SELECT * FROM job_work_transfer_items WHERE id = ANY(p_item_ids) ORDER BY item_name, id FOR UPDATE
  LOOP
    v_block := job_work_transfer_item_reversal_block(v_ti.id);
    IF v_block IS NOT NULL THEN
      v_errors := v_errors || (COALESCE(v_ti.item_name, 'Line') || COALESCE(' ' || v_ti.size_label, '')
                  || ' (' || to_char(v_ti.quantity_transferred, 'FM999999990.000') || '): ' || v_block);
    END IF;
  END LOOP;

  IF cardinality(v_errors) > 0 THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Nothing was reversed. ' || array_to_string(v_errors, ' | '));
  END IF;

  FOR v_ti IN
    SELECT * FROM job_work_transfer_items WHERE id = ANY(p_item_ids) ORDER BY item_name, id
  LOOP
    SELECT * INTO v_dest FROM job_work_items WHERE id = v_ti.to_job_work_item_id;
    v_label := COALESCE(v_ti.item_name, 'line') || COALESCE(' ' || v_ti.size_label, '');

    -- 1. Destination line: remove it and its JOB_WORK_TRANSFER_IN row.
    PERFORM set_config('warecore.skip_job_work_delete_reversal', 'true', true);
    DELETE FROM job_work_items WHERE id = v_dest.id;
    PERFORM set_config('warecore.skip_job_work_delete_reversal', 'false', true);

    v_ledger_id := NULL;
    SELECT id INTO v_ledger_id FROM stock_ledger
    WHERE reference_type = 'job_work' AND reference_id = v_transfer.to_job_work_order_id
      AND entry_type = 'JOB_WORK_TRANSFER_IN'
      AND purchase_line_id IS NOT DISTINCT FROM v_dest.purchase_line_id
      AND sub_purchase_line_id IS NOT DISTINCT FROM v_dest.sub_purchase_line_id
      AND material_type_id = v_dest.material_type_id
      AND material_size_id IS NOT DISTINCT FROM v_dest.material_size_id
      AND quantity = v_dest.quantity_sent
    ORDER BY created_at
    LIMIT 1;
    IF v_ledger_id IS NULL THEN
      RAISE EXCEPTION 'Nothing was reversed. The stock ledger has no matching "transfer received" entry for % on the new vendor''s order, so it cannot be reversed automatically. Please report it to the administrator.', v_label;
    END IF;
    INSERT INTO stock_ledger_deletions (stock_ledger_id, ledger_row, deleted_by)
    SELECT sl.id, to_jsonb(sl), p_user_id FROM stock_ledger sl WHERE sl.id = v_ledger_id;
    DELETE FROM stock_ledger WHERE id = v_ledger_id;

    -- 2. Source line: give the quantity back, remove its JOB_WORK_TRANSFER_OUT row.
    UPDATE job_work_items
    SET quantity_transferred_out = quantity_transferred_out - v_ti.quantity_transferred, updated_at = NOW()
    WHERE id = v_ti.from_job_work_item_id;

    v_ledger_id := NULL;
    SELECT id INTO v_ledger_id FROM stock_ledger
    WHERE reference_type = 'job_work' AND reference_id = v_transfer.from_job_work_order_id
      AND entry_type = 'JOB_WORK_TRANSFER_OUT'
      AND purchase_line_id IS NOT DISTINCT FROM v_ti.purchase_line_id
      AND sub_purchase_line_id IS NOT DISTINCT FROM v_ti.sub_purchase_line_id
      AND material_type_id = v_ti.material_type_id
      AND quantity = -v_ti.quantity_transferred
    ORDER BY (entry_date = v_transfer.transfer_date) DESC, created_at
    LIMIT 1;
    IF v_ledger_id IS NULL THEN
      RAISE EXCEPTION 'Nothing was reversed. The stock ledger has no matching "transferred out" entry for % on the source order, so it cannot be reversed automatically. Please report it to the administrator.', v_label;
    END IF;
    INSERT INTO stock_ledger_deletions (stock_ledger_id, ledger_row, deleted_by)
    SELECT sl.id, to_jsonb(sl), p_user_id FROM stock_ledger sl WHERE sl.id = v_ledger_id;
    DELETE FROM stock_ledger WHERE id = v_ledger_id;

    -- 3. Keep the transfer line as the record of what happened.
    UPDATE job_work_transfer_items
    SET reversed_at = NOW(), reversed_by = p_user_id, reversal_notes = p_notes
    WHERE id = v_ti.id;

    v_reversed := v_reversed + 1;
  END LOOP;

  -- Destination order emptied by reversal: keep it as a record, deactivated.
  IF NOT EXISTS (SELECT 1 FROM job_work_items WHERE job_work_order_id = v_transfer.to_job_work_order_id) THEN
    UPDATE job_work_orders
    SET status = 'cancelled', completion_via = 'transfer_reversed', actual_return_date = NULL, updated_by = p_user_id
    WHERE id = v_transfer.to_job_work_order_id;
    v_deactivated := true;
  ELSE
    UPDATE job_work_orders SET updated_by = p_user_id WHERE id = v_transfer.to_job_work_order_id;
    PERFORM fn_job_work_order_refresh_status(v_transfer.to_job_work_order_id);
  END IF;

  UPDATE job_work_orders SET updated_by = p_user_id WHERE id = v_transfer.from_job_work_order_id;
  PERFORM fn_job_work_order_refresh_status(v_transfer.from_job_work_order_id);

  RETURN jsonb_build_object('success', true, 'reversed', v_reversed, 'destination_deactivated', v_deactivated);
END;
$$;

-- The old all-at-once delete cascaded into onward transfers and direct
-- sales, which is no longer allowed. Kept only so a stale caller gets a
-- clear answer instead of the old behaviour.
CREATE OR REPLACE FUNCTION delete_job_work_transfer(p_transfer_id UUID, p_notes TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN jsonb_build_object('success', false, 'error',
    'Transfers are no longer deleted. Use Reverse on the Job Work Transfers screen to reverse the transfer line by line.');
END;
$$;

-- delete_job_work_order(): same as migration 156 apart from the transfer
-- pre-flight messages, which now point at reversal (see header).
CREATE OR REPLACE FUNCTION public.delete_job_work_order(p_order_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_order           job_work_orders%ROWTYPE;
  v_cancellation_id UUID;
  v_msg             TEXT;
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Job work order not found');
  END IF;

  -- Pre-flight: refuse to delete an order whose output has already been
  -- sent onward to another vendor for further processing — the new FK
  -- (source_job_work_output_item_id, no ON DELETE clause) would otherwise
  -- abort this transaction with a raw foreign_key_violation once the
  -- cascade below tries to remove its job_work_output_items rows.
  IF EXISTS (
    SELECT 1 FROM job_work_output_items oi
    JOIN job_work_items downstream ON downstream.source_job_work_output_item_id = oi.id
    WHERE oi.job_work_order_id = p_order_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Cannot delete this order — some of its output has already been sent to another vendor for further processing. Delete that downstream job work order first.');
  END IF;

  -- Pre-flight (migrations 156, 157): a transfer still pointing at this
  -- order (job_work_transfers.from_/to_job_work_order_id, no ON DELETE
  -- clause) would otherwise abort the delete below with a raw
  -- foreign_key_violation. Explain it in business terms instead. Transfers
  -- are never deleted any more (157) — they are reversed line by line and
  -- kept as the record — so an order a transfer touches cannot be deleted.

  -- (a) This order was itself created by a transfer.
  SELECT CASE
           WHEN v_order.status = 'cancelled' AND v_order.completion_via = 'transfer_reversed' THEN
             'This order was created by transfer ' || t.transfer_number
             || ' and that transfer has been fully reversed. The order is kept as a record of the reversal and cannot be deleted.'
           ELSE
             'This order was created by transfer ' || t.transfer_number
             || ', which moved the material here from order '
             || COALESCE(src.reference_number, '(unknown)')
             || COALESCE(' (' || sv.name || ')', '')
             || ', so it cannot be deleted. To undo the transfer, open Job Work Transfers and use Reverse on '
             || t.transfer_number || ' — the material goes back to '
             || COALESCE(src.reference_number, 'the original order')
             || ' line by line, and once every line is reversed this order is deactivated.'
         END
    INTO v_msg
  FROM job_work_transfers t
  LEFT JOIN job_work_orders src ON src.id = t.from_job_work_order_id
  LEFT JOIN suppliers sv ON sv.id = t.from_vendor_id
  WHERE t.to_job_work_order_id = p_order_id
  ORDER BY t.created_at
  LIMIT 1;

  IF v_msg IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_msg);
  END IF;

  -- (b) Material from this order has been transferred on to another vendor.
  SELECT 'Material from this order has been transferred to another vendor ('
         || string_agg(t.transfer_number || ' to order ' || COALESCE(dst.reference_number, '(unknown)')
                       || COALESCE(' / ' || dv.name, '')
                       || CASE WHEN EXISTS (SELECT 1 FROM job_work_transfer_items ti WHERE ti.job_work_transfer_id = t.id)
                                AND NOT EXISTS (SELECT 1 FROM job_work_transfer_items ti
                                                WHERE ti.job_work_transfer_id = t.id AND ti.reversed_at IS NULL)
                               THEN ', reversed' ELSE '' END,
                       ', ' ORDER BY t.created_at)
         || '), and transfers are kept as a permanent record, so this order cannot be deleted.'
         || CASE WHEN bool_or(EXISTS (SELECT 1 FROM job_work_transfer_items ti
                                      WHERE ti.job_work_transfer_id = t.id AND ti.reversed_at IS NULL))
                 THEN ' To bring the material back, open Job Work Transfers and use Reverse.'
                 ELSE '' END
    INTO v_msg
  FROM job_work_transfers t
  LEFT JOIN job_work_orders dst ON dst.id = t.to_job_work_order_id
  LEFT JOIN suppliers dv ON dv.id = t.to_vendor_id
  WHERE t.from_job_work_order_id = p_order_id
  HAVING count(*) > 0;

  IF v_msg IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_msg);
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

  -- If this (downstream) order's own input lines drew from another job's
  -- output, restore that source line's quantity_consumed before it's gone
  -- — otherwise deleting a mistaken downstream order would leave the
  -- source line's remaining balance permanently understated forever.
  UPDATE job_work_output_items src
  SET quantity_consumed = GREATEST(0, COALESCE(src.quantity_consumed, 0) - ji.quantity_sent),
      updated_at = NOW()
  FROM job_work_items ji
  WHERE ji.job_work_order_id = p_order_id
    AND ji.source_job_work_output_item_id = src.id;

  -- Remove this order's stock ledger footprint outright — the archive above
  -- already preserves full detail, so there is nothing left to reconcile a
  -- reversal against. JOB_WORK_TRANSFER_OUT is excluded (see header comment
  -- from migration 061).
  DELETE FROM stock_ledger
  WHERE reference_type = 'job_work' AND reference_id = p_order_id
    AND entry_type <> 'JOB_WORK_TRANSFER_OUT';

  -- Hard delete — cascades to job_work_items and job_work_output_items,
  -- firing fn_job_work_item_deleted()/fn_job_work_output_item_deleted() per
  -- row. The flag makes both a no-op, so this whole-order teardown is never
  -- blocked by the new "risky line" rule and never double-posts a per-row
  -- reversal on top of the bulk delete above.
  PERFORM set_config('warecore.skip_job_work_delete_reversal', 'true', true);
  DELETE FROM job_work_orders WHERE id = p_order_id;
  PERFORM set_config('warecore.skip_job_work_delete_reversal', 'false', true);

  RETURN jsonb_build_object('success', true);
END;
$function$;
