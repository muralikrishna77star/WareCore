-- ============================================================
-- Migration 166: Edit Order — let Qty Consumed drop when Output Materials
-- are removed in the same save; refuse atomically
-- ============================================================
-- Requested 2026-10-30: removing an Output Materials row in Edit Order now
-- also takes its Qty Produced off the Job Line's Qty Consumed on screen, so
-- that material goes back to warehouse stock on save instead of staying at
-- the vendor. edit_job_work_order() refused that save: its per-line guard
-- compared the new Qty Sent with the line's STORED quantity_received, which
-- still included the output row this same save had just deleted
-- (fn_job_work_output_item_deleted() posts the ledger reversal but never
-- touches job_work_items.quantity_received). E.g. sent 10, outputs 6 + 4:
-- remove the 4 and set sent to 6 -> "6 < 10" -> refused.
--
-- That guard also returned {success:false} mid-function, AFTER the output /
-- input deletions and the header update had already run — and a normal
-- return commits — so a refused save still saved part of the edit. Same for
-- the "output below quantity_consumed" guard in the output loop.
--
-- 1. The early per-line Qty Sent guard is replaced by one check after every
--    row is written, against what the order actually holds then: each line's
--    Qty Sent must cover its transfers out, plus the greater of its recorded
--    quantity_received and (vendor direct sales + every output row on its
--    Job Line — including rows this save never knew about, so a stale tab is
--    still caught).
-- 2. Both mid-function refusals now RAISE, rolling the whole save back. The
--    save-edit route already shows a RAISE's sentence plus "Nothing was
--    saved." (migrations 163/164).
-- No data change. Live scan before applying: no existing line fails check 1.
-- Body otherwise identical to migration 138.
-- ============================================================

CREATE OR REPLACE FUNCTION public.edit_job_work_order(
  p_order_id uuid,
  p_company_id uuid,
  p_warehouse_id uuid,
  p_vendor_id uuid,
  p_dispatch_date date,
  p_expected_return_date date,
  p_work_description text,
  p_notes text,
  p_input_items jsonb,
  p_output_items jsonb,
  p_deleted_input_ids uuid[] DEFAULT '{}'::uuid[],
  p_deleted_output_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_order           job_work_orders%ROWTYPE;
  v_in_json         JSONB;
  v_out_json        JSONB;
  v_item_id         UUID;
  v_existing_id     UUID;
  v_vendor_baseline NUMERIC;
  v_form_qty        NUMERIC;
  v_all_returned    BOOLEAN;
  v_none_returned   BOOLEAN;
  v_short_line      TEXT;
  v_short_sent      NUMERIC;
  v_short_held      NUMERIC;
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Job work order not found');
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot edit a cancelled order');
  END IF;

  -- Pre-flight: block removal of anything risky BEFORE deleting anything,
  -- so this returns a normal {success:false} instead of an uncaught
  -- exception from fn_job_work_item_deleted() aborting mid-transaction.
  IF EXISTS (
    SELECT 1 FROM job_work_items
    WHERE id = ANY(p_deleted_input_ids)
      AND job_work_order_id = p_order_id
      AND (is_transfer_line OR COALESCE(quantity_transferred_out, 0) > 0 OR COALESCE(quantity_received, 0) > 0
           OR source_job_work_output_item_id IS NOT NULL)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Cannot remove a line that has already been transferred to another vendor, has quantity outstanding as a transfer, was sourced from another job''s output, or has recorded returns/sales. Use the dedicated Transfer, Return, Vendor Direct Sale, or full order delete flow for that line instead, then retry this edit.');
  END IF;

  -- Same idea for output lines: once part of a produced line has been sent
  -- onward to another vendor for further processing (quantity_consumed >
  -- 0), it can't be silently removed here.
  IF EXISTS (
    SELECT 1 FROM job_work_output_items
    WHERE id = ANY(p_deleted_output_ids)
      AND job_work_order_id = p_order_id
      AND COALESCE(quantity_consumed, 0) > 0
  ) THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Cannot remove an output line that has already been sent to another vendor for further processing. Delete the downstream job work order first if this was a mistake.');
  END IF;

  -- Explicit removals only. Anything not named here — including rows this
  -- save never knew existed — is left completely untouched. Scoped to
  -- p_order_id defensively so a stray/mismatched id from another order is a
  -- silent no-op rather than a cross-order delete.
  DELETE FROM job_work_output_items
  WHERE id = ANY(p_deleted_output_ids) AND job_work_order_id = p_order_id;

  DELETE FROM job_work_items
  WHERE id = ANY(p_deleted_input_ids) AND job_work_order_id = p_order_id;

  UPDATE job_work_orders SET
    company_id            = p_company_id,
    warehouse_id          = p_warehouse_id,
    vendor_id             = p_vendor_id,
    dispatch_date         = p_dispatch_date,
    expected_return_date  = p_expected_return_date,
    work_description      = p_work_description,
    notes                 = p_notes,
    updated_at            = NOW()
  WHERE id = p_order_id;

  -- ── Input items: UPDATE in place for existing rows, INSERT for new ──────
  FOR v_in_json IN SELECT * FROM jsonb_array_elements(p_input_items)
  LOOP
    v_existing_id := NULLIF(v_in_json->>'id', '')::UUID;

    SELECT COALESCE(SUM(quantity), 0) INTO v_vendor_baseline
    FROM stock_ledger
    WHERE reference_type = 'job_work' AND reference_id = p_order_id
      AND entry_type = 'JOB_WORK_RETURN_IN' AND notes = 'Vendor direct sale — virtual return'
      AND purchase_line_id = NULLIF(v_in_json->>'purchase_line_id', '');

    v_form_qty := v_vendor_baseline + COALESCE((v_in_json->>'quantity_received')::NUMERIC, 0);

    IF v_existing_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM job_work_items WHERE id = v_existing_id AND job_work_order_id = p_order_id
    ) THEN
      -- Existing row: update only the fields Edit Order exposes as
      -- editable. is_transfer_line / source_job_work_item_id /
      -- quantity_transferred_out / source_job_work_output_item_id are
      -- NEVER touched here — the UI never edits them, and never touching
      -- them is the actual guarantee that protects a transfer or
      -- output-sourced line created/changed since this row was loaded.
      -- (Qty Sent vs transferred/returned is checked after every row is
      -- written — see the end of this function, migration 166.)
      UPDATE job_work_items SET
        purchase_line_id     = NULLIF(v_in_json->>'purchase_line_id', ''),
        sub_purchase_line_id = NULLIF(v_in_json->>'sub_purchase_line_id', ''),
        job_line_id          = NULLIF(v_in_json->>'job_line_id', ''),
        item_master_id       = NULLIF(v_in_json->>'item_master_id', '')::UUID,
        item_name            = NULLIF(v_in_json->>'item_name', ''),
        material_type_id     = NULLIF(v_in_json->>'material_type_id', '')::UUID,
        material_size_id     = NULLIF(v_in_json->>'material_size_id', '')::UUID,
        size_label           = NULLIF(v_in_json->>'size_label', ''),
        quantity_sent        = (v_in_json->>'quantity_sent')::NUMERIC,
        unit                 = COALESCE(NULLIF(v_in_json->>'unit', ''), 'MT'),
        notes                = NULLIF(v_in_json->>'notes', ''),
        updated_at           = NOW()
      WHERE id = v_existing_id;
      -- Fires fn_job_work_item_to_ledger's UPDATE branch: posts a
      -- JOB_WORK_OUT/JOB_WORK_TRANSFER_IN delta if quantity_sent changed.

      -- quantity_received's real stock effect is posted separately (by the
      -- output row's own insert/update/delete, or already posted by
      -- vendor-direct-sale) — always skip-guarded, both directions, same
      -- as today's behavior.
      PERFORM set_config('warecore.skip_job_work_return_trigger', 'true', true);
      UPDATE job_work_items
      SET quantity_received = v_form_qty,
          received_date = NULLIF(v_in_json->>'received_date', '')::DATE,
          updated_at = NOW()
      WHERE id = v_existing_id;
      PERFORM set_config('warecore.skip_job_work_return_trigger', 'false', true);

    ELSE
      -- New row. is_transfer_line/source_job_work_item_id/
      -- quantity_transferred_out/source_job_work_output_item_id default to
      -- false/NULL/0/NULL — a brand-new line added from this screen can
      -- never start pre-transferred or output-sourced (those only ever
      -- come from the dedicated Transfer / Send Output flows).
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
        v_vendor_baseline,
        COALESCE(NULLIF(v_in_json->>'unit', ''), 'MT'),
        NULLIF(v_in_json->>'notes', '')
      )
      RETURNING id INTO v_item_id;

      IF v_form_qty > v_vendor_baseline THEN
        PERFORM set_config('warecore.skip_job_work_return_trigger', 'true', true);
        UPDATE job_work_items
        SET quantity_received = v_form_qty,
            received_date = NULLIF(v_in_json->>'received_date', '')::DATE
        WHERE id = v_item_id;
        PERFORM set_config('warecore.skip_job_work_return_trigger', 'false', true);
      END IF;
    END IF;
  END LOOP;

  -- ── Output items: UPDATE in place for existing rows, INSERT for new ─────
  FOR v_out_json IN SELECT * FROM jsonb_array_elements(p_output_items)
  LOOP
    v_existing_id := NULLIF(v_out_json->>'id', '')::UUID;

    IF v_existing_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM job_work_output_items WHERE id = v_existing_id AND job_work_order_id = p_order_id
    ) THEN
      -- quantity can never drop below what's already been sent onward to
      -- another vendor — that would let a later send appear to exceed the
      -- line's (now-smaller) recorded output, silently understating what
      -- was actually produced.
      IF (v_out_json->>'quantity')::NUMERIC < (
        SELECT COALESCE(quantity_consumed, 0) FROM job_work_output_items WHERE id = v_existing_id
      ) THEN
        RAISE EXCEPTION 'Output quantity cannot be reduced below what has already been sent to another vendor for further processing — reload the order to see its current state.';
      END IF;

      UPDATE job_work_output_items SET
        item_master_id     = NULLIF(v_out_json->>'item_master_id', '')::UUID,
        item_name          = NULLIF(v_out_json->>'item_name', ''),
        material_type_id   = NULLIF(v_out_json->>'material_type_id', '')::UUID,
        material_size_id   = NULLIF(v_out_json->>'material_size_id', '')::UUID,
        size_label         = NULLIF(v_out_json->>'size_label', ''),
        quantity           = (v_out_json->>'quantity')::NUMERIC,
        unit               = COALESCE(NULLIF(v_out_json->>'unit', ''), 'MT'),
        source_job_line_id = NULLIF(v_out_json->>'source_job_line_id', ''),
        notes              = NULLIF(v_out_json->>'notes', ''),
        received_date      = NULLIF(v_out_json->>'received_date', '')::DATE,
        updated_at         = NOW()
      WHERE id = v_existing_id;
      -- quantity_consumed is NEVER touched here — only
      -- create_job_work_order_from_output() and the delete-restore step in
      -- delete_job_work_order() may change it.
    ELSE
      INSERT INTO job_work_output_items (
        job_work_order_id, item_master_id, item_name,
        material_type_id, material_size_id, size_label,
        quantity, unit, source_job_line_id, notes, received_date
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
        NULLIF(v_out_json->>'notes', ''),
        NULLIF(v_out_json->>'received_date', '')::DATE
      );
    END IF;
  END LOOP;

  -- Every line must still cover what's been transferred, sold direct or
  -- produced against it — checked on the saved state, so output rows removed
  -- in this save no longer count and rows added elsewhere since still do.
  SELECT ji.job_line_id, ji.quantity_sent, x.held
  INTO v_short_line, v_short_sent, v_short_held
  FROM job_work_items ji
  CROSS JOIN LATERAL (
    SELECT COALESCE(ji.quantity_transferred_out, 0) + GREATEST(
      COALESCE(ji.quantity_received, 0),
      (SELECT COALESCE(SUM(sl.quantity), 0) FROM stock_ledger sl
        WHERE sl.reference_type = 'job_work' AND sl.reference_id = p_order_id
          AND sl.entry_type = 'JOB_WORK_RETURN_IN' AND sl.notes = 'Vendor direct sale — virtual return'
          AND sl.purchase_line_id = ji.purchase_line_id)
      + (SELECT COALESCE(SUM(oi.quantity), 0) FROM job_work_output_items oi
          WHERE oi.job_work_order_id = p_order_id AND oi.source_job_line_id = ji.job_line_id
            AND oi.item_master_id IS NOT NULL)
    ) AS held
  ) x
  WHERE ji.job_work_order_id = p_order_id
    AND ji.quantity_sent + 0.0005 < x.held
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Qty Consumed for % (%) is less than what has already been transferred, sold direct or produced against it (%) — lower its Output Materials first, or reload the order to see its current state.',
      COALESCE(v_short_line, 'a line'), round(v_short_sent, 3), round(v_short_held, 3);
  END IF;

  -- Status recompute scans the FULL current set, deliberately including any
  -- rows this save never knew about.
  SELECT
    bool_and(quantity_received >= quantity_sent - COALESCE(quantity_transferred_out, 0)),
    bool_and(quantity_received <= 0)
  INTO v_all_returned, v_none_returned
  FROM job_work_items WHERE job_work_order_id = p_order_id;

  UPDATE job_work_orders SET
    status = CASE WHEN v_all_returned THEN 'completed' WHEN v_none_returned THEN 'dispatched' ELSE 'partial_return' END,
    actual_return_date = CASE WHEN v_all_returned THEN CURRENT_DATE ELSE NULL END,
    updated_at = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;
