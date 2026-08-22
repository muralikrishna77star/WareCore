-- ============================================================
-- WareCore WMS - Job Work Edit: targeted diff instead of wipe-and-rebuild
--
-- edit_job_work_order() previously deleted EVERY job_work_items/
-- job_work_output_items row for an order and rebuilt them all from
-- whatever the current save submitted. The Edit Order frontend never
-- tracked database row ids at all, so a save only ever "knew about" what
-- it had loaded — anything that changed on that order after the page
-- loaded (another tab, a concurrent Transfer, a direct repair insert) was
-- silently deleted the next time that page saved. This caused three real
-- incidents in one day (2026-08-22): a transfer-destination line added by
-- a repair migration was wiped twice, and a sibling line's ledger row was
-- wiped once, all by ordinary Edit Order saves from tabs that didn't know
-- about the other change.
--
-- Fix: existing rows are now UPDATEd in place (their id never changes,
-- which is what actually protects anything referencing that id — a
-- transfer's source_job_work_item_id, job_work_transfer_items.
-- to_job_work_item_id, or dispatch_items.source_job_work_item_id). Only
-- rows the frontend explicitly marks as removed are deleted, and deleting
-- a line that's part of a transfer or has recorded returns/sales is
-- blocked — those cases already have a dedicated, correct reversal flow
-- (Delete Transfer, cancel Vendor Direct Sale, clear the linked output
-- row) and shouldn't be improvised here.
-- ============================================================

-- ── 1. fn_job_work_item_to_ledger(): add a quantity_sent delta branch ───────
-- Needed because an existing row's Qty Sent can now be corrected via UPDATE
-- (previously any Qty Sent change always went through a fresh INSERT, which
-- already posted the right ledger row from scratch).

CREATE OR REPLACE FUNCTION fn_job_work_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_order job_work_orders%ROWTYPE;
  v_returned_delta DECIMAL(15,3);
  v_transferred_delta DECIMAL(15,3);
  v_transfer_date DATE;
  v_sent_delta DECIMAL(15,3);
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = NEW.job_work_order_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_transfer_line THEN
      INSERT INTO stock_ledger (
        entry_type, company_id, warehouse_id, material_type_id, material_size_id,
        size_label, quantity, reference_type, reference_id, reference_number,
        notes, entry_date, purchase_line_id, sub_purchase_line_id, created_by
      ) VALUES (
        'JOB_WORK_TRANSFER_IN',
        v_order.company_id,
        v_order.warehouse_id,
        NEW.material_type_id,
        NEW.material_size_id,
        NEW.size_label,
        NEW.quantity_sent,
        'job_work',
        v_order.id,
        v_order.reference_number,
        'Vendor transfer — received',
        v_order.dispatch_date,
        NEW.purchase_line_id,
        NEW.sub_purchase_line_id,
        v_order.created_by
      );
    ELSE
      INSERT INTO stock_ledger (
        entry_type, company_id, warehouse_id, material_type_id, material_size_id,
        size_label, quantity, reference_type, reference_id, reference_number,
        entry_date, created_by
      ) VALUES (
        'JOB_WORK_OUT',
        v_order.company_id,
        v_order.warehouse_id,
        NEW.material_type_id,
        NEW.material_size_id,
        NEW.size_label,
        -NEW.quantity_sent,
        'job_work',
        v_order.id,
        v_order.reference_number,
        v_order.dispatch_date,
        v_order.created_by
      );
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN

    -- NEW: correct the original JOB_WORK_OUT / JOB_WORK_TRANSFER_IN posting
    -- when Edit Order's update-in-place path changes an existing line's Qty
    -- Sent. Without this, a quantity correction on an existing row would
    -- silently never reach stock_ledger.
    IF NEW.quantity_sent <> OLD.quantity_sent THEN
      v_sent_delta := NEW.quantity_sent - OLD.quantity_sent;
      INSERT INTO stock_ledger (
        entry_type, company_id, warehouse_id, material_type_id, material_size_id,
        size_label, quantity, reference_type, reference_id, reference_number,
        notes, entry_date, purchase_line_id, sub_purchase_line_id, created_by
      ) VALUES (
        CASE WHEN NEW.is_transfer_line THEN 'JOB_WORK_TRANSFER_IN' ELSE 'JOB_WORK_OUT' END,
        v_order.company_id, v_order.warehouse_id,
        NEW.material_type_id, NEW.material_size_id, NEW.size_label,
        CASE WHEN NEW.is_transfer_line THEN v_sent_delta ELSE -v_sent_delta END,
        'job_work', v_order.id, v_order.reference_number,
        'Edit Order — Qty Sent corrected',
        v_order.dispatch_date,
        NEW.purchase_line_id, NEW.sub_purchase_line_id,
        v_order.created_by
      );
    END IF;

    IF NEW.quantity_received > OLD.quantity_received THEN
      IF current_setting('warecore.skip_job_work_return_trigger', true) = 'true' THEN
        -- fall through to the transfer check below
      ELSE
        v_returned_delta := NEW.quantity_received - OLD.quantity_received;
        INSERT INTO stock_ledger (
          entry_type, company_id, warehouse_id, material_type_id, material_size_id,
          size_label, quantity, reference_type, reference_id, reference_number,
          entry_date, created_by
        ) VALUES (
          'JOB_WORK_RETURN_IN',
          v_order.company_id,
          v_order.warehouse_id,
          NEW.material_type_id,
          NEW.material_size_id,
          NEW.size_label,
          v_returned_delta,
          'job_work',
          v_order.id,
          v_order.reference_number,
          COALESCE(NEW.received_date, CURRENT_DATE),
          v_order.created_by
        );
      END IF;
    END IF;

    IF NEW.quantity_transferred_out > OLD.quantity_transferred_out THEN
      SELECT jwo.dispatch_date INTO v_transfer_date
      FROM job_work_items jwi
      JOIN job_work_orders jwo ON jwo.id = jwi.job_work_order_id
      WHERE jwi.source_job_work_item_id = NEW.id AND jwi.is_transfer_line = true
      ORDER BY jwi.created_at DESC LIMIT 1;

      v_transferred_delta := NEW.quantity_transferred_out - OLD.quantity_transferred_out;
      INSERT INTO stock_ledger (
        entry_type, company_id, warehouse_id, material_type_id, material_size_id,
        size_label, quantity, reference_type, reference_id, reference_number,
        notes, entry_date, purchase_line_id, sub_purchase_line_id, created_by
      ) VALUES (
        'JOB_WORK_TRANSFER_OUT',
        v_order.company_id,
        v_order.warehouse_id,
        NEW.material_type_id,
        NEW.material_size_id,
        NEW.size_label,
        -v_transferred_delta,
        'job_work',
        v_order.id,
        v_order.reference_number,
        'Vendor transfer — sent to new vendor',
        COALESCE(v_transfer_date, CURRENT_DATE),
        NEW.purchase_line_id,
        NEW.sub_purchase_line_id,
        v_order.created_by
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 2. fn_job_work_item_deleted(): new AFTER DELETE trigger ─────────────────
-- Mirrors fn_bill_item_deleted() (purchase_bill_items) but blocks removal
-- of anything with downstream state — those cases have a dedicated,
-- correct reversal flow already (Delete Transfer / cancel Vendor Direct
-- Sale / clear the linked output row) and shouldn't be improvised here.

CREATE OR REPLACE FUNCTION fn_job_work_item_deleted()
RETURNS TRIGGER AS $$
DECLARE
  v_order job_work_orders%ROWTYPE;
BEGIN
  -- delete_job_work_order() already computes its own ledger cleanup for a
  -- whole-order teardown and deliberately needs to remove rows this
  -- trigger would otherwise block — this flag makes the trigger a no-op
  -- around that bulk cascade.
  IF current_setting('warecore.skip_job_work_delete_reversal', true) = 'true' THEN
    RETURN OLD;
  END IF;

  IF OLD.is_transfer_line
     OR COALESCE(OLD.quantity_transferred_out, 0) > 0
     OR COALESCE(OLD.quantity_received, 0) > 0 THEN
    RAISE EXCEPTION 'Cannot remove this line directly: it has already been transferred to another vendor, has quantity outstanding as a transfer, or has recorded returns/sales. Use the dedicated Transfer, Return, or Vendor Direct Sale cancellation flow for that line instead.';
  END IF;

  SELECT * INTO v_order FROM job_work_orders WHERE id = OLD.job_work_order_id;
  IF v_order.id IS NULL THEN
    RETURN OLD;
  END IF;

  INSERT INTO stock_ledger (
    entry_type, company_id, warehouse_id, material_type_id, material_size_id,
    size_label, quantity, reference_type, reference_id, reference_number,
    notes, entry_date, purchase_line_id, sub_purchase_line_id, created_by
  ) VALUES (
    'JOB_WORK_CANCEL',
    v_order.company_id, v_order.warehouse_id,
    OLD.material_type_id, OLD.material_size_id, OLD.size_label,
    OLD.quantity_sent,
    'job_work', v_order.id, v_order.reference_number,
    'Line removed from order via Edit Order',
    v_order.dispatch_date,
    OLD.purchase_line_id, OLD.sub_purchase_line_id,
    v_order.created_by
  );

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_job_work_item_deleted ON job_work_items;
CREATE TRIGGER trg_job_work_item_deleted
AFTER DELETE ON job_work_items
FOR EACH ROW EXECUTE FUNCTION fn_job_work_item_deleted();

-- ── 3. fn_job_work_output_item_to_ledger(): widen to handle UPDATE ──────────
-- Previously AFTER INSERT only — an in-place update to an existing output
-- row's quantity/received_date would have posted nothing, leaving the
-- ledger stale at the old value forever.

CREATE OR REPLACE FUNCTION fn_job_work_output_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_order job_work_orders%ROWTYPE;
  v_purchase_line_id TEXT;
  v_sub_purchase_line_id TEXT;
  v_line_count INT;
  v_target_unit TEXT;
  v_old_unit TEXT;
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = NEW.job_work_order_id;

  SELECT count(DISTINCT purchase_line_id),
         (array_agg(DISTINCT purchase_line_id))[1],
         (array_agg(DISTINCT sub_purchase_line_id))[1]
  INTO v_line_count, v_purchase_line_id, v_sub_purchase_line_id
  FROM job_work_items
  WHERE job_work_order_id = NEW.job_work_order_id AND purchase_line_id IS NOT NULL;

  IF v_line_count <> 1 THEN
    v_purchase_line_id := NULL;
    v_sub_purchase_line_id := NULL;
  END IF;

  -- NEW: on UPDATE, reverse whatever the OLD row posted before reposting
  -- for NEW.
  IF TG_OP = 'UPDATE' AND OLD.material_type_id IS NOT NULL THEN
    SELECT unit INTO v_old_unit FROM material_types WHERE id = OLD.material_type_id;
    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id, material_type_id, material_size_id, size_label,
      quantity, reference_type, reference_id, reference_number,
      notes, entry_date, created_by, purchase_line_id, sub_purchase_line_id
    ) VALUES (
      'JOB_WORK_CANCEL', v_order.company_id, v_order.warehouse_id,
      OLD.material_type_id, OLD.material_size_id, OLD.size_label,
      -fn_convert_quantity(OLD.quantity, OLD.unit, v_old_unit),
      'job_work', v_order.id, v_order.reference_number,
      'Output line corrected via Edit Order',
      COALESCE(OLD.received_date, v_order.dispatch_date), v_order.created_by,
      v_purchase_line_id, v_sub_purchase_line_id
    );
  END IF;

  IF NEW.material_type_id IS NOT NULL THEN
    SELECT unit INTO v_target_unit FROM material_types WHERE id = NEW.material_type_id;
    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id,
      material_type_id, material_size_id, size_label,
      quantity,
      reference_type, reference_id, reference_number,
      entry_date, created_by,
      purchase_line_id, sub_purchase_line_id
    ) VALUES (
      'JOB_WORK_OUTPUT_IN', v_order.company_id, v_order.warehouse_id,
      NEW.material_type_id, NEW.material_size_id, NEW.size_label,
      fn_convert_quantity(NEW.quantity, NEW.unit, v_target_unit),
      'job_work', v_order.id, v_order.reference_number,
      COALESCE(NEW.received_date, v_order.dispatch_date), v_order.created_by,
      v_purchase_line_id, v_sub_purchase_line_id
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_job_work_output_item_to_ledger ON job_work_output_items;
CREATE TRIGGER trg_job_work_output_item_to_ledger
AFTER INSERT OR UPDATE ON job_work_output_items
FOR EACH ROW EXECUTE FUNCTION fn_job_work_output_item_to_ledger();

-- ── 4. fn_job_work_output_item_deleted(): new AFTER DELETE trigger ──────────
-- No blocking rule needed — nothing references job_work_output_items.id.

CREATE OR REPLACE FUNCTION fn_job_work_output_item_deleted()
RETURNS TRIGGER AS $$
DECLARE
  v_order job_work_orders%ROWTYPE;
  v_target_unit TEXT;
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

  INSERT INTO stock_ledger (
    entry_type, company_id, warehouse_id, material_type_id, material_size_id, size_label,
    quantity, reference_type, reference_id, reference_number,
    notes, entry_date, created_by
  ) VALUES (
    'JOB_WORK_CANCEL', v_order.company_id, v_order.warehouse_id,
    OLD.material_type_id, OLD.material_size_id, OLD.size_label,
    -fn_convert_quantity(OLD.quantity, OLD.unit, v_target_unit),
    'job_work', v_order.id, v_order.reference_number,
    'Output line removed from order via Edit Order',
    COALESCE(OLD.received_date, v_order.dispatch_date), v_order.created_by
  );

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_job_work_output_item_deleted ON job_work_output_items;
CREATE TRIGGER trg_job_work_output_item_deleted
AFTER DELETE ON job_work_output_items
FOR EACH ROW EXECUTE FUNCTION fn_job_work_output_item_deleted();

-- ── 5. delete_job_work_order(): suppress the new triggers during teardown ───
-- Identical body to migration 061 except for the guard flag around the
-- final cascade-triggering delete.

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

  RETURN jsonb_build_object('success', true, 'cancellation_id', v_cancellation_id);
END;
$$;

-- ── 6. edit_job_work_order(): targeted diff instead of wipe-and-rebuild ─────

DROP FUNCTION IF EXISTS public.edit_job_work_order(uuid, uuid, uuid, uuid, date, date, text, text, jsonb, jsonb);

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
      AND (is_transfer_line OR COALESCE(quantity_transferred_out, 0) > 0 OR COALESCE(quantity_received, 0) > 0)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Cannot remove a line that has already been transferred to another vendor, has quantity outstanding as a transfer, or has recorded returns/sales. Use the dedicated Transfer, Return, or Vendor Direct Sale cancellation flow for that line instead, then retry this edit.');
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
      -- quantity_transferred_out are NEVER touched here — the UI never
      -- edits them, and never touching them is the actual guarantee that
      -- protects a transfer created/changed since this row was loaded.
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
      -- quantity_transferred_out default to false/NULL/0 — a brand-new
      -- line can never start pre-transferred.
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
      -- Fires the new UPDATE branch: reverses OLD's JOB_WORK_OUTPUT_IN,
      -- reposts fresh for NEW.
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
