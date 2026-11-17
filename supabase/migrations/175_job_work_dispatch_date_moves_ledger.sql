-- ============================================================
-- Migration 175: changing a job work order's dispatch date moves its
-- Job Work Out ledger rows with it
-- ============================================================
-- Reported 2026-11-17: Stock Statement "Stock at Vendor" and Vendorwise
-- Stock Movement disagreed by 10.380 for any To Date from 17-Jun-2025 to
-- 30-Jun-2025 (Arun Engineering, 5 CR items).
--
-- JW-MW4LI9A4-UKIQ was saved on 06-Nov-2026 with dispatch date 17-Jun-2026
-- (year typo), so fn_job_work_item_to_ledger posted its 7 JOB_WORK_OUT rows
-- (-10.380) on 17-Jun-2026. On 12-Nov-2026 the date was corrected to
-- 17-Jun-2025 in Edit Order (needed before the 25/26-Jun-2025 outputs could
-- be entered), but edit_job_work_order only updates job_work_orders —
-- nothing re-dated the ledger rows. Vendorwise counts the line's Qty Sent
-- from the order's dispatch date (its quantity_sent floor), Stock Statement
-- counts the ledger row's date, hence the gap. It also meant the warehouse
-- held 10.380 too much, and the vendor 10.380 too little, until 17-Jun-2026.
-- 17-Jun-2025 is the real date: the purchase lines (CR0625-0058..0064) were
-- invoiced on 17-Jun-2025 and the outputs came back on 25/26-Jun-2025.
-- This is the only order in the system with this problem.
--
-- Fix:
--  1. New AFTER UPDATE OF dispatch_date trigger on job_work_orders: when the
--     date really changes, the order's JOB_WORK_OUT rows still on the old
--     dispatch date move to the new one. Every JOB_WORK_OUT row is posted on
--     the order's dispatch date (initial send, "Qty Sent corrected", "line
--     moved"), so this is exactly the set that was posted from that date.
--     Transfer legs (JOB_WORK_TRANSFER_IN/OUT) are NOT moved: they carry the
--     transfer's date on both orders and must stay paired.
--     The same trigger refuses a new dispatch date that falls after material
--     already came back / moved on from this order (return, output, transfer
--     out) — the mirror of fn_validate_job_work_received_date.
--  2. Re-date JW-MW4LI9A4-UKIQ's 7 rows to 17-Jun-2025.
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

-- ── Repair JW-MW4LI9A4-UKIQ ────────────────────────────────────────────────
DO $$
DECLARE
  v_order_id UUID := '4fa7dc7a-ef44-4d0d-885e-5e7e66641db4';
  v_n INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM job_work_orders
                 WHERE id = v_order_id AND reference_number = 'JW-MW4LI9A4-UKIQ' AND dispatch_date = DATE '2025-06-17') THEN
    RAISE EXCEPTION 'JW-MW4LI9A4-UKIQ is not in the expected state (dispatch date 17-Jun-2025) — not repairing';
  END IF;

  UPDATE stock_ledger
  SET entry_date = DATE '2025-06-17'
  WHERE reference_type = 'job_work' AND reference_id = v_order_id
    AND entry_type = 'JOB_WORK_OUT' AND entry_date = DATE '2026-06-17';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n <> 7 THEN
    RAISE EXCEPTION 'Expected to re-date 7 JOB_WORK_OUT rows on JW-MW4LI9A4-UKIQ, found %', v_n;
  END IF;
END $$;
