-- ============================================================
-- Migration 177: install the dispatch-date trigger from migration 175 on
-- databases that can't run 175's production repair
-- ============================================================
-- Migration 175 does two things in one transaction: it creates this trigger,
-- then repairs order JW-MW4LI9A4-UKIQ, raising an error if that order isn't
-- there in the expected state. A blank database has no such order, so 175
-- stopped every fresh install and the database-backed test suite.
--
-- 175 is now listed in scripts/desktop/productionDataMigrations.mjs, so those
-- databases skip it, and with it the trigger. This migration puts the trigger
-- back for them. The definitions are identical to 175's, so running this on a
-- database that already has them changes nothing.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_job_work_order_dispatch_date_moves_ledger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_bad RECORD;
BEGIN
  IF NEW.dispatch_date IS NOT DISTINCT FROM OLD.dispatch_date THEN
    RETURN NEW;
  END IF;

  SELECT sl.entry_type, sl.entry_date INTO v_bad
  FROM stock_ledger sl
  WHERE sl.reference_type = 'job_work' AND sl.reference_id = NEW.id
    AND sl.entry_type IN ('JOB_WORK_RETURN_IN', 'JOB_WORK_OUTPUT_IN', 'JOB_WORK_TRANSFER_OUT')
    AND sl.entry_date < NEW.dispatch_date
  ORDER BY sl.entry_date
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Cannot set the dispatch date of % to % — material already came back or moved on from this order on % (%). Please check the date (often the year).',
      NEW.reference_number, to_char(NEW.dispatch_date, 'DD-Mon-YYYY'),
      to_char(v_bad.entry_date, 'DD-Mon-YYYY'),
      CASE v_bad.entry_type
        WHEN 'JOB_WORK_RETURN_IN' THEN 'a return'
        WHEN 'JOB_WORK_OUTPUT_IN' THEN 'an output'
        ELSE 'a transfer to another vendor'
      END;
  END IF;

  UPDATE stock_ledger
  SET entry_date = NEW.dispatch_date
  WHERE reference_type = 'job_work' AND reference_id = NEW.id
    AND entry_type = 'JOB_WORK_OUT'
    AND entry_date = OLD.dispatch_date;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_work_order_dispatch_date_moves_ledger ON job_work_orders;
CREATE TRIGGER trg_job_work_order_dispatch_date_moves_ledger
  AFTER UPDATE OF dispatch_date ON job_work_orders
  FOR EACH ROW
  WHEN (current_setting('warecore.restoring', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION fn_job_work_order_dispatch_date_moves_ledger();
