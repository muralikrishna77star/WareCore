-- ============================================================
-- WareCore WMS - Job Work Cancellation / Transfer Deletion Ledger Cleanup
--
-- delete_job_work_order() and delete_job_work_transfer() currently INSERT
-- reversing JOB_WORK_CANCEL rows to restore stock, leaving the original
-- JOB_WORK_OUT/JOB_WORK_RETURN_IN/JOB_WORK_OUTPUT_IN/JOB_WORK_TRANSFER_OUT
-- rows permanently in stock_ledger alongside them. Net stock stays correct
-- (they sum to zero) but every cancellation/deletion leaves dead rows
-- cluttering every ledger report, and forces cross-period reconciliation
-- workarounds in Stock Verification.
--
-- This is a regression: migration 051 already fixed delete_job_work_order()
-- to delete the order's stock_ledger rows outright instead of reversing them
-- (mirrored for purchase bills in migration 054). When migration 057 added
-- vendor-transfer support it was rebuilt from the pre-051 version and
-- silently reverted to insert-a-reversal. This migration re-applies the
-- delete-outright fix, extends it to transfer deletion, adds an archive +
-- screen for deleted transfers (mirroring job_work_cancellations), and
-- retroactively cleans up rows left behind by the regressed logic.
-- ============================================================

-- ── delete_job_work_order(): delete this order's ledger rows outright ──────
-- JOB_WORK_TRANSFER_OUT is deliberately excluded: it represents this order
-- acting as the SOURCE of a transfer whose destination order lives
-- elsewhere and isn't being touched here — deleting it would silently break
-- that still-valid pairing and inflate stock. (Deleting a transfer's
-- destination order, the normal path via delete_job_work_transfer, never
-- has outgoing JOB_WORK_TRANSFER_OUT rows of its own by the time this runs —
-- any such rows were already resolved by the recursive cascade first.)

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
  -- reversal against. JOB_WORK_TRANSFER_OUT is excluded (see header comment).
  DELETE FROM stock_ledger
  WHERE reference_type = 'job_work' AND reference_id = p_order_id
    AND entry_type <> 'JOB_WORK_TRANSFER_OUT';

  -- Hard delete — cascades to job_work_items and job_work_output_items
  DELETE FROM job_work_orders WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'cancellation_id', v_cancellation_id);
END;
$$;

-- ── Archive tables for deleted Job Work Vendor Transfers ────────────────────
-- Mirrors job_work_cancellations: deleting a transfer used to just make the
-- job_work_transfers row vanish with no trace. This snapshots it before
-- delete, and links to the destination order's own job_work_cancellations
-- row (created by the delete_job_work_order() call below) so both halves of
-- "this transfer was undone" can be found from either screen.

CREATE TABLE job_work_transfer_cancellations (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  original_transfer_id     UUID,
  transfer_number          TEXT,
  transfer_date            DATE,
  from_job_work_order_id   UUID,
  from_reference_number    TEXT,
  from_vendor_id           UUID,
  from_vendor_name         TEXT,
  to_job_work_order_id     UUID,
  to_reference_number      TEXT,
  to_vendor_id             UUID,
  to_vendor_name           TEXT,
  reason                   TEXT,
  notes                    TEXT,
  job_work_cancellation_id UUID REFERENCES job_work_cancellations(id),
  cancelled_at             TIMESTAMPTZ DEFAULT NOW(),
  cancelled_notes          TEXT
);

CREATE TABLE job_work_transfer_cancellation_items (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cancellation_id      UUID NOT NULL REFERENCES job_work_transfer_cancellations(id) ON DELETE CASCADE,
  item_master_id       UUID,
  item_name            TEXT,
  material_type_id     UUID,
  material_type_name   TEXT,
  material_size_id     UUID,
  size_label           TEXT,
  quantity_transferred DECIMAL(15,3),
  unit                 TEXT,
  purchase_line_id     TEXT,
  sub_purchase_line_id TEXT
);

CREATE INDEX idx_job_work_transfer_cancellations_cancelled_at ON job_work_transfer_cancellations(cancelled_at DESC);
CREATE INDEX idx_job_work_transfer_cancellation_items_cancellation ON job_work_transfer_cancellation_items(cancellation_id);

-- ── delete_job_work_transfer(): archive, delete transfer-out row outright,
-- delete destination order (unchanged cascade/blocking logic) ──────────────

CREATE OR REPLACE FUNCTION delete_job_work_transfer(
  p_transfer_id UUID,
  p_notes       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_transfer          job_work_transfers%ROWTYPE;
  v_dest_id           UUID;
  v_ti                job_work_transfer_items%ROWTYPE;
  v_dispatch          RECORD;
  v_child             RECORD;
  v_result            JSONB;
  v_transfer_cancel_id UUID;
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

  -- Archive the transfer header before it's deleted
  INSERT INTO job_work_transfer_cancellations (
    original_transfer_id, transfer_number, transfer_date,
    from_job_work_order_id, from_reference_number, from_vendor_id, from_vendor_name,
    to_job_work_order_id, to_reference_number, to_vendor_id, to_vendor_name,
    reason, notes, cancelled_notes
  )
  SELECT
    v_transfer.id, v_transfer.transfer_number, v_transfer.transfer_date,
    v_transfer.from_job_work_order_id, fo.reference_number, v_transfer.from_vendor_id, fs.name,
    v_transfer.to_job_work_order_id, do_.reference_number, v_transfer.to_vendor_id, ts.name,
    v_transfer.reason, v_transfer.notes, p_notes
  FROM (SELECT 1) AS _dummy
  LEFT JOIN job_work_orders fo ON fo.id = v_transfer.from_job_work_order_id
  LEFT JOIN job_work_orders do_ ON do_.id = v_transfer.to_job_work_order_id
  LEFT JOIN suppliers fs ON fs.id = v_transfer.from_vendor_id
  LEFT JOIN suppliers ts ON ts.id = v_transfer.to_vendor_id
  RETURNING id INTO v_transfer_cancel_id;

  INSERT INTO job_work_transfer_cancellation_items (
    cancellation_id, item_master_id, item_name,
    material_type_id, material_type_name,
    material_size_id, size_label,
    quantity_transferred, unit,
    purchase_line_id, sub_purchase_line_id
  )
  SELECT
    v_transfer_cancel_id, ti.item_master_id, ti.item_name,
    ti.material_type_id, mt.description,
    ti.material_size_id, ti.size_label,
    ti.quantity_transferred, ti.unit,
    ti.purchase_line_id, ti.sub_purchase_line_id
  FROM job_work_transfer_items ti
  LEFT JOIN material_types mt ON mt.id = ti.material_type_id
  WHERE ti.job_work_transfer_id = p_transfer_id;

  -- Restore the transferred quantity onto the source line(s) and remove this
  -- transfer's own JOB_WORK_TRANSFER_OUT ledger row outright (matched by
  -- order/line/quantity — see migration header for the known limitation on
  -- repeat transfers of the exact same line/quantity).
  FOR v_ti IN
    SELECT * FROM job_work_transfer_items WHERE job_work_transfer_id = p_transfer_id
  LOOP
    IF v_ti.from_job_work_item_id IS NOT NULL THEN
      UPDATE job_work_items
      SET quantity_transferred_out = GREATEST(0, COALESCE(quantity_transferred_out, 0) - v_ti.quantity_transferred),
          updated_at = NOW()
      WHERE id = v_ti.from_job_work_item_id;

      DELETE FROM stock_ledger
      WHERE entry_type = 'JOB_WORK_TRANSFER_OUT'
        AND reference_type = 'job_work'
        AND reference_id = v_transfer.from_job_work_order_id
        AND purchase_line_id IS NOT DISTINCT FROM v_ti.purchase_line_id
        AND sub_purchase_line_id IS NOT DISTINCT FROM v_ti.sub_purchase_line_id
        AND quantity = -v_ti.quantity_transferred;
    END IF;
  END LOOP;

  -- Remove the transfer row first (cascades to job_work_transfer_items) so
  -- the FK from to_job_work_order_id no longer blocks deleting that order.
  DELETE FROM job_work_transfers WHERE id = p_transfer_id;

  v_result := delete_job_work_order(v_dest_id, COALESCE(p_notes, 'Vendor transfer deleted'));

  IF NOT (v_result->>'success')::boolean THEN
    RAISE EXCEPTION 'Failed to delete destination order: %', (v_result->>'error');
  END IF;

  -- Link the two archive records together
  UPDATE job_work_transfer_cancellations
  SET job_work_cancellation_id = (v_result->>'cancellation_id')::uuid
  WHERE id = v_transfer_cancel_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- One-time retroactive cleanup: orders already fully cancelled under the
-- regressed reversal logic (present in job_work_cancellations, gone from
-- job_work_orders) still have both the original rows and their
-- JOB_WORK_CANCEL reversal sitting in stock_ledger. They already net to
-- zero — pure clutter, safe to remove, mirroring what the fixed function
-- above would have done at cancel time. Only targets rows whose order is
-- confirmed archived (not just "missing"), so genuinely stale/corrupt rows
-- stay visible to Stock Verification's stale-record check.
-- ============================================================

DELETE FROM stock_ledger sl
WHERE sl.reference_type = 'job_work'
  AND sl.entry_type <> 'JOB_WORK_TRANSFER_OUT'
  AND NOT EXISTS (SELECT 1 FROM job_work_orders jwo WHERE jwo.id = sl.reference_id)
  AND EXISTS (SELECT 1 FROM job_work_cancellations jwc WHERE jwc.original_order_id = sl.reference_id);

-- ============================================================
-- One-time retroactive cleanup: a still-live source order can carry a
-- stray JOB_WORK_CANCEL row left by a historical transfer deletion (the old
-- delete_job_work_transfer inserted this against the source order, which
-- isn't being archived/deleted itself). Only removable with confidence when
-- the deletion used the function's default note text — a custom reason
-- typed at delete time can't be distinguished from a real cancellation note,
-- so those are left in place for manual review instead of guessed at.
-- ============================================================

DELETE FROM stock_ledger sl
WHERE sl.reference_type = 'job_work'
  AND sl.entry_type = 'JOB_WORK_CANCEL'
  AND sl.notes = 'Vendor transfer deleted — material remains with original vendor'
  AND EXISTS (SELECT 1 FROM job_work_orders jwo WHERE jwo.id = sl.reference_id);
