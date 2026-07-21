-- ============================================================
-- WareCore WMS - Cascading reverse of Job Work Transfers
--
-- Extends delete_job_work_transfer (migration 059) so that when the
-- transfer's destination order was itself sold directly to a customer or
-- transferred onward to another vendor, that downstream activity is
-- reversed automatically instead of just blocking:
--   - a vendor-direct sale sourced from the destination order is
--     cancelled via the existing cancel_dispatch_order() (restores
--     quantity_received and the sale's stock effect)
--   - a further transfer made FROM the destination order is reversed by
--     recursing into delete_job_work_transfer() again, however many hops
--     deep the chain goes (Vendor A -> B -> C -> D all unwind in one call)
-- The only thing that still hard-blocks (no automatic reversal exists) is
-- recorded output/production (job_work_output_items) anywhere in the chain.
--
-- preview_job_work_transfer_deletion() is a read-only companion that walks
-- the same chain and returns what WOULD be cancelled/reversed, so the UI
-- can show the user the full list before they confirm one destructive call.
-- ============================================================

CREATE OR REPLACE FUNCTION delete_job_work_transfer(
  p_transfer_id UUID,
  p_notes       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_transfer      job_work_transfers%ROWTYPE;
  v_dest_id       UUID;
  v_ti            job_work_transfer_items%ROWTYPE;
  v_dispatch      RECORD;
  v_child         RECORD;
  v_result        JSONB;
BEGIN
  SELECT * INTO v_transfer FROM job_work_transfers WHERE id = p_transfer_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transfer not found');
  END IF;

  IF v_transfer.to_job_work_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transfer has no destination order to reverse');
  END IF;

  v_dest_id := v_transfer.to_job_work_order_id;

  -- Hard block: recorded output/production has no automatic reversal.
  IF EXISTS (SELECT 1 FROM job_work_output_items WHERE job_work_order_id = v_dest_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot delete: the destination order has recorded output/production, which cannot be automatically reversed.'
    );
  END IF;

  -- Recurse depth-first into any further transfers made FROM the destination
  -- order — unwinds the chain from the bottom up before we touch our own level.
  FOR v_child IN
    SELECT id FROM job_work_transfers WHERE from_job_work_order_id = v_dest_id
  LOOP
    v_result := delete_job_work_transfer(v_child.id, COALESCE(p_notes, 'Auto-reversed while deleting an upstream transfer'));
    IF NOT (v_result->>'success')::boolean THEN
      RAISE EXCEPTION '%', (v_result->>'error');
    END IF;
  END LOOP;

  -- Cancel any active vendor-direct sale(s) sourced from the destination order.
  FOR v_dispatch IN
    SELECT id FROM dispatch_orders
    WHERE source_job_work_order_id = v_dest_id
      AND is_vendor_direct = true
      AND status <> 'cancelled'
  LOOP
    v_result := cancel_dispatch_order(v_dispatch.id, COALESCE(p_notes, 'Auto-cancelled while deleting a job work transfer'));
    IF NOT (v_result->>'success')::boolean THEN
      RAISE EXCEPTION '%', (v_result->>'error');
    END IF;
  END LOOP;

  -- Defensive re-check: by now the destination's items should be fully
  -- cleared (received and transferred_out back to 0) by the two loops above.
  IF EXISTS (
    SELECT 1 FROM job_work_items
    WHERE job_work_order_id = v_dest_id
      AND (COALESCE(quantity_received, 0) > 0 OR COALESCE(quantity_transferred_out, 0) > 0)
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot delete: destination order still has unresolved movement after reversing known downstream activity.'
    );
  END IF;

  -- Restore the transferred quantity onto the source line(s) and post the
  -- source-side reversal ledger entry (decreasing quantity_transferred_out
  -- doesn't auto-post via triggers, which only react to it increasing).
  FOR v_ti IN
    SELECT * FROM job_work_transfer_items WHERE job_work_transfer_id = p_transfer_id
  LOOP
    IF v_ti.from_job_work_item_id IS NOT NULL THEN
      UPDATE job_work_items
      SET quantity_transferred_out = GREATEST(0, COALESCE(quantity_transferred_out, 0) - v_ti.quantity_transferred),
          updated_at = NOW()
      WHERE id = v_ti.from_job_work_item_id;

      INSERT INTO stock_ledger (
        entry_type, company_id, warehouse_id, material_type_id, material_size_id,
        size_label, quantity, reference_type, reference_id, reference_number,
        notes, entry_date, purchase_line_id, sub_purchase_line_id, created_by
      )
      SELECT
        'JOB_WORK_CANCEL',
        jwo.company_id, jwo.warehouse_id,
        v_ti.material_type_id, v_ti.material_size_id, v_ti.size_label,
        v_ti.quantity_transferred,
        'job_work', jwo.id, jwo.reference_number,
        COALESCE(p_notes, 'Vendor transfer deleted — material remains with original vendor'),
        CURRENT_DATE,
        v_ti.purchase_line_id, v_ti.sub_purchase_line_id, jwo.created_by
      FROM job_work_orders jwo
      WHERE jwo.id = v_transfer.from_job_work_order_id;
    END IF;
  END LOOP;

  -- Remove the transfer row first (cascades to job_work_transfer_items) so
  -- the FK from to_job_work_order_id no longer blocks deleting that order.
  DELETE FROM job_work_transfers WHERE id = p_transfer_id;

  v_result := delete_job_work_order(v_dest_id, COALESCE(p_notes, 'Vendor transfer deleted'));

  IF NOT (v_result->>'success')::boolean THEN
    RAISE EXCEPTION 'Failed to delete destination order: %', (v_result->>'error');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── Read-only preview of the full cascade, for confirmation UIs ────────────

CREATE OR REPLACE FUNCTION preview_job_work_transfer_deletion(p_transfer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_transfer     job_work_transfers%ROWTYPE;
  v_dest_id      UUID;
  v_dest_ref     TEXT;
  v_dispatches   JSONB;
  v_transfers    JSONB := '[]'::jsonb;
  v_child        RECORD;
  v_child_preview JSONB;
BEGIN
  SELECT * INTO v_transfer FROM job_work_transfers WHERE id = p_transfer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Transfer not found');
  END IF;

  v_dest_id := v_transfer.to_job_work_order_id;
  SELECT reference_number INTO v_dest_ref FROM job_work_orders WHERE id = v_dest_id;

  IF EXISTS (SELECT 1 FROM job_work_output_items WHERE job_work_order_id = v_dest_id) THEN
    RETURN jsonb_build_object(
      'blocked', true,
      'reason', format('Destination order %s has recorded output/production, which cannot be automatically reversed.', COALESCE(v_dest_ref, v_dest_id::text))
    );
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'invoice_number', d.invoice_number,
    'sale_ref_id', d.sale_ref_id,
    'dispatch_date', d.dispatch_date,
    'customer_name', c.name
  )), '[]'::jsonb)
  INTO v_dispatches
  FROM dispatch_orders d
  LEFT JOIN customers c ON c.id = d.customer_id
  WHERE d.source_job_work_order_id = v_dest_id
    AND d.is_vendor_direct = true
    AND d.status <> 'cancelled';

  FOR v_child IN
    SELECT jt.id, jt.transfer_number, jt.transfer_date, s.name AS to_vendor_name
    FROM job_work_transfers jt
    LEFT JOIN suppliers s ON s.id = jt.to_vendor_id
    WHERE jt.from_job_work_order_id = v_dest_id
  LOOP
    v_child_preview := preview_job_work_transfer_deletion(v_child.id);
    IF COALESCE((v_child_preview->>'blocked')::boolean, false) THEN
      RETURN v_child_preview;
    END IF;

    v_transfers := v_transfers || jsonb_build_array(jsonb_build_object(
      'id', v_child.id,
      'transfer_number', v_child.transfer_number,
      'transfer_date', v_child.transfer_date,
      'to_vendor_name', v_child.to_vendor_name
    )) || COALESCE(v_child_preview->'transfers', '[]'::jsonb);
    v_dispatches := v_dispatches || COALESCE(v_child_preview->'dispatches', '[]'::jsonb);
  END LOOP;

  RETURN jsonb_build_object('blocked', false, 'dispatches', v_dispatches, 'transfers', v_transfers);
END;
$$;
