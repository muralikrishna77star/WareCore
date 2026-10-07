-- ============================================================
-- Migration 156: plain-language message when Delete Order is blocked
-- by a Job Work transfer
-- ============================================================
-- Deleting JW-MUPD2XWW-E7VU (created by transfer JWT-1026-0006) showed the
-- user: "update or delete on table job_work_orders violates foreign key
-- constraint job_work_transfers_to_job_work_order_id_fkey". The FK is
-- right to block it — removing only the destination order would leave the
-- source order's TRANSFER_OUT with nowhere to go — but the message meant
-- nothing to the user.
--
-- delete_job_work_order() is unchanged from migration 138 except for a new
-- pre-flight check that, when a transfer references the order, returns a
-- business message naming the transfer and the screen to delete it from:
--   (a) order created BY a transfer  -> delete that transfer instead;
--   (b) order is the SOURCE of a transfer -> delete those transfers first.
-- Function replacement only; no data is changed.
-- ============================================================

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

  -- Pre-flight (migration 156): a transfer still pointing at this order
  -- (job_work_transfers.from_/to_job_work_order_id, no ON DELETE clause)
  -- would otherwise abort the delete below with a raw foreign_key_violation.
  -- Explain it in business terms and point at the screen that can do it.

  -- (a) This order was itself created by a transfer. Deleting the transfer
  --     removes this order AND returns the material to the source order;
  --     deleting just this order would make that material vanish.
  SELECT 'This order was created by transfer ' || t.transfer_number
         || ', which moved the material here from order '
         || COALESCE(src.reference_number, '(unknown)')
         || COALESCE(' (' || sv.name || ')', '')
         || '. To remove it, open Job Work Transfers and delete transfer '
         || t.transfer_number || ' — that deletes this order and returns the material to '
         || COALESCE(src.reference_number, 'the original order') || '.'
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
  SELECT 'Material from this order has already been transferred to another vendor ('
         || string_agg(t.transfer_number || ' to order ' || COALESCE(dst.reference_number, '(unknown)')
                       || COALESCE(' / ' || dv.name, ''), ', ' ORDER BY t.created_at)
         || '). Open Job Work Transfers and delete '
         || CASE WHEN count(*) > 1 THEN 'those transfers' ELSE 'that transfer' END
         || ' first, then delete this order.'
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
