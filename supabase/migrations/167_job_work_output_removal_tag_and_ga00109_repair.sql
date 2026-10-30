-- ============================================================
-- Migration 167: tag Edit Order output-removal reversals with their
-- purchase line; remove GA00109's four mistaken outputs on JW-MVP4B87R-U6XW
-- ============================================================
-- Reported 2026-10-30: GA00109 "GA 0.70 X 180" showed "2×" (more than one
-- ledger row shares this reference + line) on its Job Work Output In rows.
-- No row is double-posted — each output row has exactly one
-- JOB_WORK_OUTPUT_IN — but the four outputs themselves were entered by
-- mistake: in one Edit Order save on 2026-10-30, Arun Engineering order
-- JW-MVP4B87R-U6XW got 0.940 (0.70X121X5C) + 0.370 (0.70X140) on BOTH
-- GA00109 lines, JW-1004-0002 (GA0425-0005, sent 1.490) and JW-1004-0003
-- (GA0425-0006, sent 1.380). The user confirmed all four are to be removed
-- and the material restocked as input, i.e. each line's Qty Consumed drops
-- by its 1.310 — the same thing Edit Order does since commit 40582aa.
--
-- 1. Prevention: fn_job_work_output_item_deleted() posted its
--    JOB_WORK_CANCEL with no purchase line, while the JOB_WORK_OUTPUT_IN it
--    reverses is tagged (migration 151) — Purchase Line Movements and the
--    per-item ledger would keep the removed output on the line. It now tags
--    the reversal with fn_job_work_output_purchase_line(), like the output
--    row. Scan before applying: no existing untagged reversal.
-- 2. Repair, through edit_job_work_order() itself with the order's current
--    rows (exactly a Save Changes): delete the four outputs, Qty Sent
--    1.490 → 0.180 and 1.380 → 0.070. Posts per line a tagged CANCEL of each
--    output (dated 18-Apr-2025, their received date) and a +1.310
--    "Qty Sent corrected" JOB_WORK_OUT (10-Apr-2025, the dispatch date).
--    Net per purchase line and per item: 0.000 — GA00109 stays 2.620 in
--    stock, the vendor still holds 0.180 / 0.070; only what the 1.310 is
--    (unsent input, not returned output) changes. CR00472's 1.310 output
--    and the transferred HR lines are untouched. No-op unless all four
--    output rows still exist.
-- ============================================================

-- 1. Output-removal reversal carries the output's purchase line.
CREATE OR REPLACE FUNCTION public.fn_job_work_output_item_deleted()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_order job_work_orders%ROWTYPE;
  v_target_unit TEXT;
  v_line RECORD;
BEGIN
  IF current_setting('warecore.skip_job_work_delete_reversal', true) = 'true' THEN
    RETURN OLD;
  END IF;

  IF OLD.material_type_id IS NULL THEN
    RETURN OLD;
  END IF;

  SELECT * INTO v_order FROM job_work_orders WHERE id = OLD.job_work_order_id;
  IF v_order.id IS NULL THEN
    RETURN OLD;
  END IF;

  SELECT unit INTO v_target_unit FROM material_types WHERE id = OLD.material_type_id;
  -- Same line the JOB_WORK_OUTPUT_IN being reversed was tagged with (151).
  SELECT * INTO v_line FROM fn_job_work_output_purchase_line(OLD.job_work_order_id, OLD.source_job_line_id);

  INSERT INTO stock_ledger (
    entry_type, company_id, warehouse_id, material_type_id, material_size_id, size_label,
    quantity, reference_type, reference_id, reference_number,
    notes, entry_date, purchase_line_id, sub_purchase_line_id, created_by
  ) VALUES (
    'JOB_WORK_CANCEL', v_order.company_id, v_order.warehouse_id,
    OLD.material_type_id, OLD.material_size_id, OLD.size_label,
    -fn_convert_quantity(OLD.quantity, OLD.unit, v_target_unit),
    'job_work', v_order.id, v_order.reference_number,
    'Output line removed from order via Edit Order',
    COALESCE(OLD.received_date, v_order.dispatch_date),
    v_line.o_purchase_line_id, v_line.o_sub_purchase_line_id,
    v_order.created_by
  );

  RETURN OLD;
END;
$function$;

-- 2. Repair JW-MVP4B87R-U6XW.
DO $$
DECLARE
  v_order   job_work_orders%ROWTYPE;
  v_removed uuid[] := ARRAY[
    '0d1bab03-293b-43d2-97a3-36acd6f37d0a',  -- JW-1004-0002  0.940
    'ddc149eb-dc03-4e43-9c44-c37cc466b2a6',  -- JW-1004-0002  0.370
    '70e04f85-ef0f-44e5-a84d-523d3a455752',  -- JW-1004-0003  0.940
    'b56141b1-45dd-442e-9ea4-ba0ab55901e5'   -- JW-1004-0003  0.370
  ]::uuid[];
  v_inputs  jsonb;
  v_outputs jsonb;
  v_result  jsonb;
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE reference_number = 'JW-MVP4B87R-U6XW';
  IF v_order.id IS NULL OR (
    SELECT count(*) FROM job_work_output_items
    WHERE id = ANY(v_removed) AND job_work_order_id = v_order.id
  ) <> 4 THEN
    RAISE NOTICE 'Migration 167: JW-MVP4B87R-U6XW outputs already removed or absent — skipped';
    RETURN;
  END IF;

  -- Every input line as it stands; the two GA00109 lines lose the removed
  -- outputs' quantity from Qty Sent. quantity_received is what's left on
  -- each Job Line (the function adds vendor-direct sales itself).
  SELECT jsonb_agg(jsonb_build_object(
    'id', ji.id, 'purchase_line_id', ji.purchase_line_id, 'sub_purchase_line_id', ji.sub_purchase_line_id,
    'job_line_id', ji.job_line_id, 'item_master_id', ji.item_master_id, 'item_name', ji.item_name,
    'material_type_id', ji.material_type_id, 'material_size_id', ji.material_size_id, 'size_label', ji.size_label,
    'quantity_sent', ji.quantity_sent - COALESCE((
      SELECT sum(oi.quantity) FROM job_work_output_items oi
      WHERE oi.id = ANY(v_removed) AND oi.source_job_line_id = ji.job_line_id), 0),
    'quantity_received', COALESCE((
      SELECT sum(oi.quantity) FROM job_work_output_items oi
      WHERE oi.job_work_order_id = v_order.id AND oi.source_job_line_id = ji.job_line_id
        AND oi.item_master_id IS NOT NULL AND oi.id <> ALL(v_removed)), 0),
    'unit', ji.unit, 'notes', ji.notes, 'received_date', ji.received_date))
  INTO v_inputs
  FROM job_work_items ji WHERE ji.job_work_order_id = v_order.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', oi.id, 'item_master_id', oi.item_master_id, 'item_name', oi.item_name,
    'material_type_id', oi.material_type_id, 'material_size_id', oi.material_size_id, 'size_label', oi.size_label,
    'quantity', oi.quantity, 'unit', oi.unit, 'source_job_line_id', oi.source_job_line_id,
    'notes', oi.notes, 'received_date', oi.received_date)), '[]'::jsonb)
  INTO v_outputs
  FROM job_work_output_items oi WHERE oi.job_work_order_id = v_order.id AND oi.id <> ALL(v_removed);

  v_result := edit_job_work_order(
    v_order.id, v_order.company_id, v_order.warehouse_id, v_order.vendor_id,
    v_order.dispatch_date, v_order.expected_return_date, v_order.work_description, v_order.notes,
    v_inputs, v_outputs, '{}'::uuid[], v_removed);

  IF NOT COALESCE((v_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'Migration 167: edit_job_work_order refused: %', v_result->>'error';
  END IF;
END $$;
