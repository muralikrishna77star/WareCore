-- Migration 146: create_job_work_order() — atomic Job Work order creation,
-- replacing the client-side 3-step sequence in jobwork/new/page.tsx
-- (insert order, insert input items, insert output items — three separate
-- Hasura mutations with no shared transaction and no rollback if a later
-- step fails).
--
-- Root-caused against a live failure on 2026-09-18: a user creating a Job
-- Work order for CR 2.30 X 377 dated 2025-01-30 drawing on purchase line
-- CR0125-0076 (invoiced 2025-01-31) was correctly refused by migration
-- 117's purchase-date trigger — but only the *items* insert was refused.
-- The order header from step 1 had already committed, leaving
-- JW-MU6WPI5U-AZ5A behind as a header with no lines, no ledger footprint
-- and no way for the user to tell it existed. Two older headers from the
-- same failure mode were still sitting in the table (JW-MU5HXNF2-IGSM,
-- JW-MSA5JKMM-FEG0).
--
-- This is the same structural fix already applied to Edit Order (114),
-- vendor transfers (120) and order deletion: one function, one
-- transaction, so a trigger rejection anywhere rolls the whole order back
-- instead of leaving a partial header. Any RAISE from the validation
-- triggers propagates out of this function unchanged, so the user still
-- sees the real reason.
--
-- Reference-number and job-line-id generation stay exactly where they are
-- (client-side, from the same existing queries) — this migration only
-- moves the WRITES into one atomic call.

CREATE OR REPLACE FUNCTION create_job_work_order(
  p_reference_number     TEXT,
  p_company_id           UUID,
  p_warehouse_id         UUID,
  p_vendor_id            UUID,
  p_dispatch_date        DATE,
  p_expected_return_date DATE,
  p_work_description     TEXT,
  p_status               TEXT,
  p_notes                TEXT,
  p_inputs               JSONB,  -- [{purchase_line_id, sub_purchase_line_id, job_line_id, item_master_id, item_name, material_type_id, material_size_id, size_label, quantity_sent, unit}]
  p_outputs              JSONB,  -- [{item_master_id, item_name, material_type_id, material_size_id, size_label, quantity, unit, source_job_line_id, notes}]
  p_created_by           UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id UUID;
  v_line     JSONB;
  v_qty      NUMERIC;
BEGIN
  IF p_inputs IS NULL OR jsonb_array_length(p_inputs) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'At least one input line is required');
  END IF;

  IF p_dispatch_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Dispatch date is required');
  END IF;

  INSERT INTO job_work_orders (
    reference_number, company_id, warehouse_id, vendor_id,
    dispatch_date, expected_return_date, work_description,
    status, notes, created_by
  ) VALUES (
    p_reference_number, p_company_id, p_warehouse_id, p_vendor_id,
    p_dispatch_date, p_expected_return_date, p_work_description,
    COALESCE(NULLIF(p_status, ''), 'dispatched'), p_notes, p_created_by
  )
  RETURNING id INTO v_order_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_inputs) LOOP
    v_qty := NULLIF(v_line->>'quantity_sent', '')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error',
        format('Input line %s has no usable quantity', COALESCE(v_line->>'job_line_id', v_line->>'item_name', '?')));
    END IF;

    INSERT INTO job_work_items (
      job_work_order_id, purchase_line_id, sub_purchase_line_id, job_line_id,
      item_master_id, item_name, material_type_id, material_size_id, size_label,
      quantity_sent, quantity_received, unit
    ) VALUES (
      v_order_id,
      NULLIF(v_line->>'purchase_line_id', ''),
      NULLIF(v_line->>'sub_purchase_line_id', ''),
      NULLIF(v_line->>'job_line_id', ''),
      NULLIF(v_line->>'item_master_id', '')::uuid,
      NULLIF(v_line->>'item_name', ''),
      NULLIF(v_line->>'material_type_id', '')::uuid,
      NULLIF(v_line->>'material_size_id', '')::uuid,
      NULLIF(v_line->>'size_label', ''),
      v_qty,
      0,
      COALESCE(NULLIF(v_line->>'unit', ''), 'MT')
    );
  END LOOP;

  IF p_outputs IS NOT NULL AND jsonb_array_length(p_outputs) > 0 THEN
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_outputs) LOOP
      v_qty := NULLIF(v_line->>'quantity', '')::numeric;
      CONTINUE WHEN v_qty IS NULL OR v_qty <= 0;

      INSERT INTO job_work_output_items (
        job_work_order_id, item_master_id, item_name,
        material_type_id, material_size_id, size_label,
        quantity, unit, source_job_line_id, notes
      ) VALUES (
        v_order_id,
        NULLIF(v_line->>'item_master_id', '')::uuid,
        NULLIF(v_line->>'item_name', ''),
        NULLIF(v_line->>'material_type_id', '')::uuid,
        NULLIF(v_line->>'material_size_id', '')::uuid,
        NULLIF(v_line->>'size_label', ''),
        v_qty,
        COALESCE(NULLIF(v_line->>'unit', ''), 'MT'),
        NULLIF(v_line->>'source_job_line_id', ''),
        NULLIF(v_line->>'notes', '')
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true, 'job_work_order_id', v_order_id);
END;
$$;
