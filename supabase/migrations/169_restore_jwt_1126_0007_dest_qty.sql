-- ============================================================
-- Migration 169: restore Qty Sent on JW-MVZ3VU8Y-9B56 (transfer JWT-1126-0007)
-- ============================================================
-- Reported 2026-11-04: Reverse Transfer refused JWT-1126-0007 (Arun
-- Engineering → D A Industries, CR0425-0015, 1.350) because Edit Order had
-- lowered the received line JW-2605-0003 to 0.950 that day. Only the
-- destination side moved: Arun's order still shows 1.350 transferred out, and
-- the "Qty Sent corrected" row (-0.400 JOB_WORK_TRANSFER_IN) left the purchase
-- line's ledger at -0.400.
--
-- Edit Order can't put it back: Avail Stock is now -0.400 + 0.950 = 0.550, so
-- 1.350 is rejected as exceeding stock. Restored through edit_job_work_order()
-- with the order's current rows (exactly a Save Changes), which posts the
-- +0.400 "Qty Sent corrected" row: purchase line back to 0.000, D A Industries
-- 1.350, reversal unblocked. No-op unless the line is still 0.950 against an
-- unreversed 1.350 transfer.
-- ============================================================

DO $$
DECLARE
  v_order   job_work_orders%ROWTYPE;
  v_line    CONSTANT uuid := '45f5aa45-d98c-4798-8233-119d1fa5ea0a';
  v_inputs  jsonb;
  v_outputs jsonb;
  v_result  jsonb;
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE reference_number = 'JW-MVZ3VU8Y-9B56';
  IF v_order.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM job_work_items ji
    JOIN job_work_transfer_items ti ON ti.to_job_work_item_id = ji.id
    WHERE ji.id = v_line AND ji.job_work_order_id = v_order.id
      AND ji.quantity_sent = 0.950 AND ti.quantity_transferred = 1.350 AND ti.reversed_at IS NULL
  ) THEN
    RAISE NOTICE 'Migration 169: JW-MVZ3VU8Y-9B56 line already corrected or absent — skipped';
    RETURN;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', ji.id, 'purchase_line_id', ji.purchase_line_id, 'sub_purchase_line_id', ji.sub_purchase_line_id,
    'job_line_id', ji.job_line_id, 'item_master_id', ji.item_master_id, 'item_name', ji.item_name,
    'material_type_id', ji.material_type_id, 'material_size_id', ji.material_size_id, 'size_label', ji.size_label,
    'quantity_sent', CASE WHEN ji.id = v_line THEN 1.350 ELSE ji.quantity_sent END,
    'quantity_received', COALESCE((
      SELECT sum(oi.quantity) FROM job_work_output_items oi
      WHERE oi.job_work_order_id = v_order.id AND oi.source_job_line_id = ji.job_line_id
        AND oi.item_master_id IS NOT NULL), 0),
    'unit', ji.unit, 'notes', ji.notes, 'received_date', ji.received_date))
  INTO v_inputs
  FROM job_work_items ji WHERE ji.job_work_order_id = v_order.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', oi.id, 'item_master_id', oi.item_master_id, 'item_name', oi.item_name,
    'material_type_id', oi.material_type_id, 'material_size_id', oi.material_size_id, 'size_label', oi.size_label,
    'quantity', oi.quantity, 'unit', oi.unit, 'source_job_line_id', oi.source_job_line_id,
    'notes', oi.notes, 'received_date', oi.received_date)), '[]'::jsonb)
  INTO v_outputs
  FROM job_work_output_items oi WHERE oi.job_work_order_id = v_order.id;

  v_result := edit_job_work_order(
    v_order.id, v_order.company_id, v_order.warehouse_id, v_order.vendor_id,
    v_order.dispatch_date, v_order.expected_return_date, v_order.work_description, v_order.notes,
    v_inputs, v_outputs, '{}'::uuid[], '{}'::uuid[]);

  IF NOT COALESCE((v_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'Migration 169: edit_job_work_order refused: %', v_result->>'error';
  END IF;
END $$;
