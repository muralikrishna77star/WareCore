-- ============================================================
-- WareCore WMS - Fix Edit Job Work Order Ledger Duplication
-- The previous edit_job_work_order() reversed old stock by INSERTing
-- JOB_WORK_CANCEL entries, then deleted/re-inserted line items so the
-- existing triggers created fresh JOB_WORK_OUT / JOB_WORK_OUTPUT_IN
-- entries. The CANCEL entries were never removed, so every edit left
-- behind a growing trail of offsetting (but never-cleaned-up) ledger
-- rows — net stock stayed correct, but the ledger/reports accumulated
-- duplicate-looking entries on every save.
--
-- Fix: delete this order's existing stock_ledger rows up front, then
-- delete/re-insert line items as before. The insert triggers recreate
-- exactly the entries that match the current line items — making
-- repeated edits idempotent (no growing history of reversal pairs).
-- ============================================================

CREATE OR REPLACE FUNCTION edit_job_work_order(
  p_order_id             UUID,
  p_company_id           UUID,
  p_warehouse_id         UUID,
  p_vendor_id            UUID,
  p_dispatch_date        DATE,
  p_expected_return_date DATE,
  p_work_description     TEXT,
  p_notes                TEXT,
  p_input_items          JSONB,
  p_output_items         JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order     job_work_orders%ROWTYPE;
  v_in_json   JSONB;
  v_out_json  JSONB;
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Job work order not found');
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot edit a cancelled order');
  END IF;

  IF v_order.status = 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot edit a completed order');
  END IF;

  -- Remove all stock ledger entries previously created for this order
  -- (JOB_WORK_OUT, JOB_WORK_RETURN_IN, JOB_WORK_OUTPUT_IN, and any earlier
  -- JOB_WORK_CANCEL reversals). Fresh entries are recreated below by the
  -- insert triggers based on the new line items.
  DELETE FROM stock_ledger
  WHERE reference_type = 'job_work' AND reference_id = p_order_id;

  -- Drop existing line items
  DELETE FROM job_work_items WHERE job_work_order_id = p_order_id;
  DELETE FROM job_work_output_items WHERE job_work_order_id = p_order_id;

  -- Update order header. Editing resets returns: any partial returns recorded
  -- against the old line items no longer apply to the new ones.
  UPDATE job_work_orders SET
    company_id            = p_company_id,
    warehouse_id          = p_warehouse_id,
    vendor_id             = p_vendor_id,
    dispatch_date         = p_dispatch_date,
    expected_return_date  = p_expected_return_date,
    work_description      = p_work_description,
    notes                 = p_notes,
    status                = 'dispatched',
    actual_return_date    = NULL,
    updated_at            = NOW()
  WHERE id = p_order_id;

  -- Insert new input items — trigger fn_job_work_item_to_ledger fires JOB_WORK_OUT for each
  FOR v_in_json IN SELECT * FROM jsonb_array_elements(p_input_items)
  LOOP
    INSERT INTO job_work_items (
      job_work_order_id, purchase_line_id, sub_purchase_line_id, job_line_id,
      item_master_id, item_name, material_type_id, material_size_id, size_label,
      quantity_sent, quantity_received, unit, notes
    ) VALUES (
      p_order_id,
      NULLIF(v_in_json->>'purchase_line_id', ''),
      NULLIF(v_in_json->>'sub_purchase_line_id', ''),
      NULLIF(v_in_json->>'job_line_id', ''),
      NULLIF(v_in_json->>'item_master_id', '')::UUID,
      NULLIF(v_in_json->>'item_name', ''),
      NULLIF(v_in_json->>'material_type_id', '')::UUID,
      NULLIF(v_in_json->>'material_size_id', '')::UUID,
      NULLIF(v_in_json->>'size_label', ''),
      (v_in_json->>'quantity_sent')::NUMERIC,
      0,
      COALESCE(NULLIF(v_in_json->>'unit', ''), 'MT'),
      NULLIF(v_in_json->>'notes', '')
    );
  END LOOP;

  -- Insert new output items — trigger fn_job_work_output_item_to_ledger fires JOB_WORK_OUTPUT_IN for each
  FOR v_out_json IN SELECT * FROM jsonb_array_elements(p_output_items)
  LOOP
    INSERT INTO job_work_output_items (
      job_work_order_id, item_master_id, item_name,
      material_type_id, material_size_id, size_label,
      quantity, unit, source_job_line_id, notes
    ) VALUES (
      p_order_id,
      NULLIF(v_out_json->>'item_master_id', '')::UUID,
      NULLIF(v_out_json->>'item_name', ''),
      NULLIF(v_out_json->>'material_type_id', '')::UUID,
      NULLIF(v_out_json->>'material_size_id', '')::UUID,
      NULLIF(v_out_json->>'size_label', ''),
      (v_out_json->>'quantity')::NUMERIC,
      COALESCE(NULLIF(v_out_json->>'unit', ''), 'MT'),
      NULLIF(v_out_json->>'source_job_line_id', ''),
      NULLIF(v_out_json->>'notes', '')
    );
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- One-time data fix: JW-MQ954D7A-ACNH accumulated duplicate
-- JOB_WORK_OUT / JOB_WORK_OUTPUT_IN / JOB_WORK_CANCEL rows from
-- repeated edits under the old function. Remove the reversal noise
-- and earlier superseded entries, keeping only the rows that match
-- the order's current line items.
-- ============================================================

DO $$
DECLARE
  v_order_id UUID;
BEGIN
  SELECT id INTO v_order_id FROM job_work_orders WHERE reference_number = 'JW-MQ954D7A-ACNH';

  IF v_order_id IS NOT NULL THEN
    -- Drop all reversal entries — they always net to zero and are no longer needed
    DELETE FROM stock_ledger
    WHERE reference_type = 'job_work' AND reference_id = v_order_id
      AND entry_type = 'JOB_WORK_CANCEL';

    -- Keep only the most recent JOB_WORK_OUT / JOB_WORK_OUTPUT_IN / JOB_WORK_RETURN_IN
    -- per distinct line (purchase line + material/size) — earlier duplicates from
    -- prior edits are removed.
    WITH ranked AS (
      SELECT id, row_number() OVER (
        PARTITION BY entry_type, COALESCE(purchase_line_id, ''), material_type_id, COALESCE(material_size_id::text, '')
        ORDER BY created_at DESC
      ) AS rn
      FROM stock_ledger
      WHERE reference_type = 'job_work' AND reference_id = v_order_id
        AND entry_type IN ('JOB_WORK_OUT', 'JOB_WORK_OUTPUT_IN', 'JOB_WORK_RETURN_IN')
    )
    DELETE FROM stock_ledger WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
  END IF;
END $$;
