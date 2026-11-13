-- ============================================================
-- Migration 174: a backup restore no longer posts stock a second time
-- ============================================================
-- restoreFromBackup() (src/lib/backup/backup.service.ts) re-inserts every
-- table row by row, documents first and stock_ledger last. Inserting a
-- document line fires its ledger-posting trigger, so a restore posted every
-- sale, purchase, job work and transfer movement ONCE MORE on top of the
-- stock_ledger rows it then restored from the backup — doubling stock.
-- fn_dispatch_item_to_ledger also re-bumped job_work_items.quantity_received
-- for vendor direct sales, and update_bill_totals recomputed bill totals.
--
-- Fix: the restore marks its own transactions with
--   SELECT set_config('warecore.restoring', 'on', true)   -- transaction-local
-- and every trigger that posts or derives data from an inserted row now has
--   WHEN (current_setting('warecore.restoring', true) IS DISTINCT FROM 'on')
-- so it stays silent inside a restore and behaves exactly as before
-- everywhere else. The setting is transaction-local: it never leaks to other
-- users' requests on a pooled connection, and nothing else is disabled
-- (validation triggers and foreign keys still apply to restored rows).
-- The restore only sets it when the backup carries stock_ledger rows — a
-- restore without the ledger still lets the triggers post, otherwise the
-- restored documents would have no stock at all.
--
-- The triggers are rebuilt from their own live definitions (pg_get_triggerdef)
-- with only the WHEN clause added, so nothing else about them changes.
--
-- Also: drop the stock_ledger.sale_return_item_id foreign key added in 173.
-- With "delete existing data first", the restore TRUNCATEs each table with
-- CASCADE, and that FK made truncating sale_returns/sale_return_items wipe
-- the ENTIRE stock_ledger. The unique index (one ledger row per return line,
-- the actual anti-doubling guard) stays; REC-002 still flags a return row
-- whose line is missing.
-- ============================================================

ALTER TABLE stock_ledger DROP CONSTRAINT IF EXISTS stock_ledger_sale_return_item_id_fkey;

DO $$
DECLARE
  r       RECORD;
  v_def   TEXT;
  v_guard CONSTANT TEXT := 'current_setting(''warecore.restoring'', true) IS DISTINCT FROM ''on''';
  v_done  INTEGER := 0;
BEGIN
  FOR r IN
    SELECT t.tgname, t.tgrelid::regclass::text AS tbl, pg_get_triggerdef(t.oid) AS def, t.tgqual IS NOT NULL AS has_when
    FROM pg_trigger t
    WHERE NOT t.tgisinternal
      AND (t.tgrelid::regclass::text, t.tgname) IN (
        ('dispatch_items',        'trg_dispatch_item_to_ledger'),
        ('purchase_bill_items',   'trg_bill_item_to_ledger'),
        ('purchase_bill_items',   'trg_bill_items_totals'),
        ('job_work_items',        'trg_job_work_item_to_ledger'),
        ('job_work_output_items', 'trg_job_work_output_item_to_ledger'),
        ('transfer_items',        'trg_transfer_item_to_ledger'),
        ('stock_ledger',          'trg_stock_ledger_refresh_job_work_status')
      )
  LOOP
    v_done := v_done + 1;
    CONTINUE WHEN r.def LIKE '%warecore.restoring%';  -- already guarded (re-run)

    IF r.has_when THEN
      v_def := regexp_replace(r.def, ' WHEN \((.*)\) EXECUTE ', ' WHEN ((\1) AND ' || v_guard || ') EXECUTE ');
    ELSE
      v_def := replace(r.def, ' EXECUTE FUNCTION ', ' WHEN (' || v_guard || ') EXECUTE FUNCTION ');
    END IF;
    IF v_def = r.def OR v_def NOT LIKE '%warecore.restoring%' THEN
      RAISE EXCEPTION 'Could not add the restore guard to trigger % on %: %', r.tgname, r.tbl, r.def;
    END IF;

    EXECUTE format('DROP TRIGGER %I ON %s', r.tgname, r.tbl);
    EXECUTE v_def;
  END LOOP;

  IF v_done <> 7 THEN
    RAISE EXCEPTION 'Expected 7 ledger-posting triggers to guard, found %', v_done;
  END IF;
END;
$$;
