-- ============================================================
-- WareCore WMS - Delete Job Work Transfer (reverse a vendor transfer)
--
-- Deleting a transfer means deleting the destination job work order it
-- created for the receiving vendor, restoring the transferred quantity
-- back onto the source line (so it's pending at the original vendor
-- again), and removing the job_work_transfers audit row.
--
-- Blocked when the destination order has ANY further movement:
--   - material returned or sold directly (quantity_received > 0 — vendor
--     direct sale posts a "virtual return" that also bumps this field,
--     see migration 046)
--   - transferred again to a third vendor (quantity_transferred_out > 0)
--   - recorded output/production (job_work_output_items)
-- This is what enforces reverse-hierarchical-order deletion: if a
-- transfer's destination order was itself transferred onward, that later
-- transfer must be deleted first (it clears the block), then this one.
--
-- job_work_transfers.to_job_work_order_id / from_job_work_order_id have
-- no ON DELETE action (default RESTRICT), so the transfer row must be
-- deleted BEFORE delete_job_work_order() can remove the destination
-- order — ordering below reflects that.
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
  v_ti            job_work_transfer_items%ROWTYPE;
  v_blocked_count INT;
  v_delete_result JSONB;
BEGIN
  SELECT * INTO v_transfer FROM job_work_transfers WHERE id = p_transfer_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transfer not found');
  END IF;

  IF v_transfer.to_job_work_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transfer has no destination order to reverse');
  END IF;

  SELECT COUNT(*) INTO v_blocked_count
  FROM job_work_items
  WHERE job_work_order_id = v_transfer.to_job_work_order_id
    AND (COALESCE(quantity_received, 0) > 0 OR COALESCE(quantity_transferred_out, 0) > 0);

  IF v_blocked_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot delete: material on the destination order has already been returned, sold directly, or transferred to another vendor. Delete transfers in reverse order (most recent first).'
    );
  END IF;

  IF EXISTS (SELECT 1 FROM job_work_output_items WHERE job_work_order_id = v_transfer.to_job_work_order_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot delete: the destination order already has recorded output/production. Undo that first.'
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

  v_delete_result := delete_job_work_order(
    v_transfer.to_job_work_order_id,
    COALESCE(p_notes, 'Vendor transfer deleted')
  );

  IF NOT (v_delete_result->>'success')::boolean THEN
    RAISE EXCEPTION 'Failed to delete destination order: %', (v_delete_result->>'error');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;
