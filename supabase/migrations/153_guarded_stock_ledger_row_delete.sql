-- ============================================================
-- Migration 153: guarded + audited stock_ledger row deletion
-- ============================================================
-- The Item Ledger's admin "Delete Selected" action (/api/stock/ledger-entries)
-- ran a bare DELETE FROM stock_ledger WHERE id IN (...). Nothing stopped it
-- from removing one half of a document's ledger pair, and nothing recorded
-- what was removed or by whom. It has now silently corrupted stock twice:
--   * migration 148 — both JOB_WORK_OUT rows of JW-MTWVZZUT-19G7 deleted
--     while the order still existed;
--   * migration 152 — the 3 PURCHASE_CANCEL rows for CR0125-0075/76/77
--     deleted, leaving 7.130 MT of phantom CR 2.30 X 377 stock.
-- Both took a long investigation because no trace of the deletion was left.
--
-- delete_stock_ledger_rows() replaces the bare DELETE. In one transaction it:
--   1. copies every row to stock_ledger_deletions (who, when, full row);
--   2. deletes the rows;
--   3. checks each (reference, purchase line) group touched, and RAISEs —
--      rolling everything back — unless the deletion is harmless:
--        a. the reference document no longer exists at all (not live, not
--           in its cancellation archive) — the orphan clean-up the tool was
--           built for; or
--        b. the deleted rows of the group net to zero (e.g. a stray
--           PURCHASE_IN + its PURCHASE_CANCEL from repeated edits); or
--        c. purchase rows only: after the delete, the line's PURCHASE_IN +
--           PURCHASE_CANCEL total equals what the bill says it should be
--           (the live line's received quantity on an active bill, else 0) —
--           e.g. removing a duplicated PURCHASE_IN.
--      Anything else (like deleting only the CANCEL of a removed bill line,
--      or only the JOB_WORK_OUT of a live order) is refused with a message
--      naming the line; such repairs belong in a reviewed migration.
-- ============================================================

CREATE TABLE IF NOT EXISTS stock_ledger_deletions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stock_ledger_id UUID NOT NULL,
  ledger_row JSONB NOT NULL,
  deleted_by UUID,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_deletions_ledger_id ON stock_ledger_deletions (stock_ledger_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_deletions_deleted_at ON stock_ledger_deletions (deleted_at);

CREATE OR REPLACE FUNCTION delete_stock_ledger_rows(p_ids UUID[], p_deleted_by UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted INTEGER;
  g RECORD;
  v_ref_exists BOOLEAN;
  v_after NUMERIC;
  v_expected NUMERIC;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _sl_delete ON COMMIT DROP AS
    SELECT * FROM stock_ledger WITH NO DATA;
  TRUNCATE _sl_delete;
  INSERT INTO _sl_delete SELECT * FROM stock_ledger WHERE id = ANY(p_ids);

  INSERT INTO stock_ledger_deletions (stock_ledger_id, ledger_row, deleted_by)
  SELECT d.id, to_jsonb(d), p_deleted_by FROM _sl_delete d;

  DELETE FROM stock_ledger WHERE id IN (SELECT id FROM _sl_delete);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  FOR g IN
    SELECT d.reference_type, d.reference_id, max(d.reference_number) AS reference_number,
           COALESCE(d.sub_purchase_line_id, d.purchase_line_id) AS line_id,
           bool_and(d.entry_type IN ('PURCHASE_IN', 'PURCHASE_CANCEL')) AS purchase_only,
           SUM(d.quantity) AS deleted_net,
           string_agg(d.entry_type || ' ' || d.quantity::text, ', ' ORDER BY d.created_at) AS summary
    FROM _sl_delete d
    GROUP BY d.reference_type, d.reference_id, COALESCE(d.sub_purchase_line_id, d.purchase_line_id)
  LOOP
    -- (a) reference gone from both the live table and its archive
    v_ref_exists := CASE g.reference_type
      WHEN 'purchase_bill' THEN
        EXISTS (SELECT 1 FROM purchase_bills WHERE id = g.reference_id)
        OR EXISTS (SELECT 1 FROM purchase_cancellations WHERE original_bill_id = g.reference_id)
      WHEN 'dispatch' THEN
        EXISTS (SELECT 1 FROM dispatch_orders WHERE id = g.reference_id)
        OR EXISTS (SELECT 1 FROM dispatch_cancellations WHERE original_order_id = g.reference_id)
      WHEN 'job_work' THEN
        EXISTS (SELECT 1 FROM job_work_orders WHERE id = g.reference_id)
        OR EXISTS (SELECT 1 FROM job_work_cancellations WHERE original_order_id = g.reference_id)
      WHEN 'transfer' THEN
        EXISTS (SELECT 1 FROM transfers WHERE id = g.reference_id)
      ELSE g.reference_id IS NOT NULL
    END;
    CONTINUE WHEN NOT v_ref_exists;

    -- (b) the deleted rows cancel each other out
    CONTINUE WHEN abs(g.deleted_net) < 0.0005;

    -- (c) purchase rows: what's left now matches the bill
    IF g.reference_type = 'purchase_bill' AND g.purchase_only AND g.line_id IS NOT NULL THEN
      SELECT COALESCE(SUM(quantity), 0) INTO v_after
      FROM stock_ledger
      WHERE reference_id = g.reference_id AND purchase_line_id = g.line_id
        AND entry_type IN ('PURCHASE_IN', 'PURCHASE_CANCEL');

      SELECT COALESCE(SUM(fn_convert_quantity(COALESCE(pbi.received_quantity, pbi.quantity), pbi.unit, mt.unit)), 0)
      INTO v_expected
      FROM purchase_bill_items pbi
      JOIN purchase_bills pb ON pb.id = pbi.bill_id AND pb.status = 'active'
      LEFT JOIN material_types mt ON mt.id = pbi.material_type_id
      WHERE pbi.bill_id = g.reference_id AND pbi.purchase_line_id = g.line_id;

      CONTINUE WHEN abs(v_after - v_expected) < 0.0005;

      RAISE EXCEPTION 'Cannot delete: line % on bill % would be left at % in the stock ledger, but the bill says %. Deleting % would leave stock that no bill supports. Nothing was deleted.',
        g.line_id, g.reference_number, round(v_after, 3), round(v_expected, 3), g.summary;
    END IF;

    RAISE EXCEPTION 'Cannot delete: % % still exists, and the selected rows for line % (%) do not cancel each other out (net %). Deleting them would change stock that the document still accounts for. Nothing was deleted.',
      replace(g.reference_type, '_', ' '), g.reference_number, COALESCE(g.line_id, '—'), g.summary, round(g.deleted_net, 3);
  END LOOP;

  RETURN v_deleted;
END;
$$;
