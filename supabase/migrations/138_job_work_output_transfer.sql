-- ============================================================
-- WareCore WMS - Job Work Output Transfer (multi-stage conversion)
--
-- Problem: there was no way to send an already-produced job work OUTPUT
-- item (job_work_output_items) onward to a different vendor for a further
-- processing stage. The Job Work New / dispatch screens only let you pick
-- input material via a purchase_line_id (a real purchase-bill line with
-- remaining stock — see ITEM_PURCHASE_LINES_QUERY, which only reads
-- purchase_bill_items). Output items never have their own purchase line
-- (only an optional traced one for reporting, when every input shares a
-- single line — migration 042), so they can never appear in that picker.
-- This is a UI/query dead end, not a ledger problem: the existing "Job
-- Work Transfer" feature (056/120) already covers the OTHER case — moving
-- PENDING, unconverted material from vendor to vendor mid-job.
--
-- Fix: a new atomic function create_job_work_order_from_output() creates a
-- brand-new job work order whose input line(s) are sourced directly from
-- one or more job_work_output_items rows instead of a purchase line. It
-- deliberately posts NO new ledger entry types — the new job_work_items
-- row is a completely ordinary row (is_transfer_line stays false), so it
-- fires the existing, already-hardened fn_job_work_item_to_ledger() INSERT
-- branch and posts a plain JOB_WORK_OUT, identical to any purchase-line
-- dispatch. Reusing that code path instead of inventing a new "virtual"
-- pair is what keeps this safe — every past double-posting bug in this
-- system (Vendor Direct Sale, Job Work Transfer) came from a bespoke
-- virtual-entry pattern, not from the plain JOB_WORK_OUT path.
--
-- Partial transfers: job_work_output_items.quantity_consumed tracks how
-- much of a produced line has already been sent onward (mirrors
-- quantity_transferred_out on job_work_items from migration 056), so the
-- same output line can be split across several downstream vendors/orders
-- over time without ever exceeding what was actually produced. Every
-- partial send is its own permanent job_work_items row (via the new
-- source_job_work_output_item_id FK), so the full history of "who got how
-- much and when" is just a query away — no separate audit table needed,
-- unlike job_work_transfers (which needed one because its source row is
-- mutated in place rather than each partial send getting its own row).
--
-- Guards added so quantity_consumed can never drift from reality:
--   - create_job_work_order_from_output(): locks + validates every source
--     output row FOR UPDATE before writing anything (same pattern as
--     migration 120's create_job_work_transfer).
--   - The new FK has no ON DELETE clause (defaults to RESTRICT), so an
--     output row that has already been sent onward can never be silently
--     deleted out from under a downstream order.
--   - edit_job_work_order() gets two new guards: block deleting an output
--     line once quantity_consumed > 0, and block reducing its quantity
--     below quantity_consumed. Block deleting an input line that was
--     itself sourced from another job's output (mirrors the existing
--     is_transfer_line / quantity_transferred_out / quantity_received
--     guards already there).
--   - delete_job_work_order() gets a pre-flight check refusing to delete
--     an order whose output has already been consumed downstream (instead
--     of letting the RESTRICT FK abort mid-transaction with a raw
--     exception), and — for the downstream order itself — restores
--     quantity_consumed on the source output row(s) before tearing down,
--     so deleting a mistaken downstream order correctly frees up the
--     balance again instead of leaving it permanently understated.
-- ============================================================

-- ── 1. Schema additions ─────────────────────────────────────────────────

ALTER TABLE job_work_output_items
  ADD COLUMN IF NOT EXISTS quantity_consumed DECIMAL(15,3) NOT NULL DEFAULT 0;

ALTER TABLE job_work_items
  ADD COLUMN IF NOT EXISTS source_job_work_output_item_id UUID REFERENCES job_work_output_items(id);

CREATE INDEX IF NOT EXISTS idx_job_work_items_source_output_item ON job_work_items(source_job_work_output_item_id);

-- ── 2. create_job_work_order_from_output() ──────────────────────────────

CREATE OR REPLACE FUNCTION create_job_work_order_from_output(
  p_target_vendor_id     UUID,
  p_dispatch_date        DATE,
  p_reference_number     TEXT,
  p_expected_return_date DATE,
  p_work_description     TEXT,
  p_notes                TEXT,
  p_lines                JSONB,  -- [{source_output_item_id, job_line_id, quantity}]
  p_created_by           UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_order_id UUID;
  v_line         JSONB;
  v_output       job_work_output_items%ROWTYPE;
  v_source_order job_work_orders%ROWTYPE;
  v_company_id   UUID;
  v_warehouse_id UUID;
  v_qty          NUMERIC;
  v_remaining    NUMERIC;
BEGIN
  IF p_target_vendor_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Select a target vendor');
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No output items selected');
  END IF;

  -- Pre-flight: lock and validate every source line against its CURRENT
  -- remaining balance before writing anything, so a stale/concurrent
  -- submission fails cleanly instead of over-consuming an output line.
  -- Also confirm every line shares one company/warehouse — the new
  -- order's JOB_WORK_OUT must decrement the same warehouse the output
  -- stock actually sits in.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_output FROM job_work_output_items
    WHERE id = (v_line->>'source_output_item_id')::UUID
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'One of the selected output items no longer exists — reload and try again.');
    END IF;

    IF v_output.material_type_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'One of the selected output items has no material type set and cannot be dispatched.');
    END IF;

    v_qty := (v_line->>'quantity')::NUMERIC;
    v_remaining := v_output.quantity - COALESCE(v_output.quantity_consumed, 0);

    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > v_remaining THEN
      RETURN jsonb_build_object('success', false, 'error',
        format('Quantity for one of the selected output items exceeds its current remaining balance (%s) — reload and try again.', v_remaining));
    END IF;

    SELECT * INTO v_source_order FROM job_work_orders WHERE id = v_output.job_work_order_id;
    IF v_company_id IS NULL THEN
      v_company_id := v_source_order.company_id;
      v_warehouse_id := v_source_order.warehouse_id;
    ELSIF v_company_id <> v_source_order.company_id OR v_warehouse_id <> v_source_order.warehouse_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Selected output items belong to different companies/warehouses — send them as separate orders.');
    END IF;
  END LOOP;

  INSERT INTO job_work_orders (
    reference_number, company_id, warehouse_id, vendor_id, dispatch_date,
    expected_return_date, work_description, status, notes, created_by
  ) VALUES (
    p_reference_number, v_company_id, v_warehouse_id, p_target_vendor_id,
    p_dispatch_date, p_expected_return_date, p_work_description, 'dispatched', p_notes, p_created_by
  ) RETURNING id INTO v_new_order_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_output FROM job_work_output_items WHERE id = (v_line->>'source_output_item_id')::UUID;
    v_qty := (v_line->>'quantity')::NUMERIC;

    INSERT INTO job_work_items (
      job_work_order_id, job_line_id, item_master_id, item_name,
      material_type_id, material_size_id, size_label,
      quantity_sent, quantity_received, unit,
      source_job_work_output_item_id, notes
    ) VALUES (
      v_new_order_id, NULLIF(v_line->>'job_line_id', ''), v_output.item_master_id, v_output.item_name,
      v_output.material_type_id, v_output.material_size_id, v_output.size_label,
      v_qty, 0, v_output.unit,
      v_output.id,
      'Sourced from output ' || COALESCE(v_output.source_job_line_id, v_output.id::text)
    );
    -- Fires fn_job_work_item_to_ledger()'s INSERT branch. is_transfer_line
    -- defaults false, so this posts a plain JOB_WORK_OUT — no new ledger
    -- logic, same code path every ordinary dispatch already uses.

    UPDATE job_work_output_items
    SET quantity_consumed = COALESCE(quantity_consumed, 0) + v_qty, updated_at = NOW()
    WHERE id = v_output.id;
    -- Same transaction as the insert above — a failure anywhere rolls back
    -- the whole order instead of leaving quantity_consumed advanced with no
    -- downstream order to show for it.
  END LOOP;

  RETURN jsonb_build_object('success', true, 'job_work_order_id', v_new_order_id);
END;
$$;

-- ── 3. edit_job_work_order(): guard the two new failure modes ───────────

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
      IF (v_in_json->>'quantity_sent')::NUMERIC < (
        SELECT COALESCE(quantity_transferred_out, 0) + COALESCE(quantity_received, 0)
        FROM job_work_items WHERE id = v_existing_id
      ) THEN
        RETURN jsonb_build_object('success', false, 'error',
          'Qty Sent cannot be reduced below what has already been transferred or returned for this line — reload the order to see its current state.');
      END IF;

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
        RETURN jsonb_build_object('success', false, 'error',
          'Output quantity cannot be reduced below what has already been sent to another vendor for further processing — reload the order to see its current state.');
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

-- ── 4. delete_job_work_order(): pre-flight guard + quantity_consumed restore ─

CREATE OR REPLACE FUNCTION delete_job_work_order(
  p_order_id UUID,
  p_notes    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order           job_work_orders%ROWTYPE;
  v_cancellation_id UUID;
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
$$;
