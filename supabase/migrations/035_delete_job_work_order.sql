-- ============================================================
-- WareCore WMS - Delete Job Work Order with Stock Reversal
-- Adds a JOB_WORK_CANCEL ledger entry type and an atomic function
-- that restores whatever quantity is still out at the vendor
-- (quantity_sent - quantity_received) for every line item, then
-- permanently deletes the order (cascading to job_work_items).
-- ============================================================

ALTER TABLE stock_ledger DROP CONSTRAINT IF EXISTS stock_ledger_entry_type_check;
ALTER TABLE stock_ledger
  ADD CONSTRAINT stock_ledger_entry_type_check
  CHECK (entry_type IN (
    'PURCHASE_IN', 'VENDOR_RETURN_IN',
    'SALE_OUT',
    'JOB_WORK_OUT', 'JOB_WORK_RETURN_IN', 'JOB_WORK_CANCEL',
    'TRANSFER_OUT', 'TRANSFER_IN',
    'ADJUSTMENT_IN', 'ADJUSTMENT_OUT',
    'PURCHASE_CANCEL', 'SALE_CANCEL'
  ));

CREATE OR REPLACE FUNCTION delete_job_work_order(
  p_order_id UUID,
  p_notes    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order   job_work_orders%ROWTYPE;
  v_item    job_work_items%ROWTYPE;
  v_net_qty DECIMAL(15,3);
BEGIN
  -- Lock the row to prevent concurrent deletes/returns
  SELECT * INTO v_order FROM job_work_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Job work order not found');
  END IF;

  -- Restore whatever is still out at the vendor for each line item
  -- (reverses JOB_WORK_OUT net of any JOB_WORK_RETURN_IN already recorded)
  FOR v_item IN
    SELECT * FROM job_work_items WHERE job_work_order_id = p_order_id
  LOOP
    v_net_qty := v_item.quantity_sent - COALESCE(v_item.quantity_received, 0);

    IF v_net_qty <> 0 THEN
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
        v_net_qty,
        'job_work', v_order.id, v_order.reference_number,
        p_notes, CURRENT_DATE,
        v_item.purchase_line_id, v_item.sub_purchase_line_id,
        v_order.created_by
      );
    END IF;
  END LOOP;

  -- Hard delete — cascades to job_work_items
  DELETE FROM job_work_orders WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
