-- ============================================================
-- Migration 160: reject mistyped years on stock documents, and fix the
-- one sale that had one
-- ============================================================
-- CR00180's Item Ledger showed "Vendor-held stock went negative during the
-- period (lowest: -3.020)". Cause: vendor direct sale 0225-0851 (Mass
-- Decoilers, JW-MTWXN91K-NJJ7, 1.950 + 1.070) was keyed in with the year
-- 0025 instead of 2025. Year 0025 sorts before the 2024-12-09 purchase and
-- job work dispatch, so the sale appeared to empty the vendor 2,000 years
-- before the material arrived. Quantities were right; only the date was
-- wrong. A scan of every date column in the schema found no other date
-- outside 2015 .. today + 1 year — this sale (and its 4 ledger rows) only.
--
-- 1. Repair: 0025-02-11 -> 2025-02-11 on the sale and its ledger rows.
--    Plausibility: invoices 0225-0850 / 0225-0852 either side are dated
--    2025-02-07 / 2025-02-11, and the material went to the vendor on
--    2024-12-09, before the sale.
--
-- 2. Prevention: fn_validate_business_date() rejects a stock-affecting
--    date before 2015-01-01 or more than a year after today, with a
--    message asking the user to check the year, on: purchase bills, sales,
--    job work orders (dispatch date), job work and vendor transfers, job
--    work return / output received dates, and every stock ledger row.
--    Existing data is all inside the window (checked above), so nothing
--    already saved is affected.
-- ============================================================

-- 1. Repair sale 0225-0851.
UPDATE stock_ledger sl
SET entry_date = DATE '2025-02-11'
FROM dispatch_orders d
WHERE d.invoice_number = '0225-0851' AND d.dispatch_date = DATE '0025-02-11'
  AND sl.entry_date = DATE '0025-02-11'
  AND (
    (sl.reference_type = 'dispatch' AND sl.reference_id = d.id)
    OR (sl.reference_type = 'job_work' AND sl.reference_id = d.source_job_work_order_id
        AND sl.notes = 'Vendor direct sale — virtual return')
  );

UPDATE dispatch_orders
SET dispatch_date = DATE '2025-02-11'
WHERE invoice_number = '0225-0851' AND dispatch_date = DATE '0025-02-11';

-- 2. Guard against mistyped years from now on.
CREATE OR REPLACE FUNCTION fn_validate_business_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_value DATE := (to_jsonb(NEW) ->> TG_ARGV[0])::date;
  v_label TEXT := TG_ARGV[1];
  v_max   DATE := CURRENT_DATE + 366;
BEGIN
  IF v_value IS NOT NULL AND (v_value < DATE '2015-01-01' OR v_value > v_max) THEN
    RAISE EXCEPTION 'The % % looks mistyped — please check the year. Dates must be between 01-Jan-2015 and %.',
      v_label, to_char(v_value, 'DD-Mon-YYYY'), to_char(v_max, 'DD-Mon-YYYY');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_bills_business_date ON purchase_bills;
CREATE TRIGGER trg_purchase_bills_business_date BEFORE INSERT OR UPDATE OF bill_date ON purchase_bills
  FOR EACH ROW EXECUTE FUNCTION fn_validate_business_date('bill_date', 'bill date');

DROP TRIGGER IF EXISTS trg_dispatch_orders_business_date ON dispatch_orders;
CREATE TRIGGER trg_dispatch_orders_business_date BEFORE INSERT OR UPDATE OF dispatch_date ON dispatch_orders
  FOR EACH ROW EXECUTE FUNCTION fn_validate_business_date('dispatch_date', 'sale date');

DROP TRIGGER IF EXISTS trg_job_work_orders_business_date ON job_work_orders;
CREATE TRIGGER trg_job_work_orders_business_date BEFORE INSERT OR UPDATE OF dispatch_date ON job_work_orders
  FOR EACH ROW EXECUTE FUNCTION fn_validate_business_date('dispatch_date', 'job work dispatch date');

DROP TRIGGER IF EXISTS trg_transfers_business_date ON transfers;
CREATE TRIGGER trg_transfers_business_date BEFORE INSERT OR UPDATE OF transfer_date ON transfers
  FOR EACH ROW EXECUTE FUNCTION fn_validate_business_date('transfer_date', 'transfer date');

DROP TRIGGER IF EXISTS trg_job_work_transfers_business_date ON job_work_transfers;
CREATE TRIGGER trg_job_work_transfers_business_date BEFORE INSERT OR UPDATE OF transfer_date ON job_work_transfers
  FOR EACH ROW EXECUTE FUNCTION fn_validate_business_date('transfer_date', 'vendor transfer date');

DROP TRIGGER IF EXISTS trg_job_work_items_business_date ON job_work_items;
CREATE TRIGGER trg_job_work_items_business_date BEFORE INSERT OR UPDATE OF received_date ON job_work_items
  FOR EACH ROW EXECUTE FUNCTION fn_validate_business_date('received_date', 'received date');

DROP TRIGGER IF EXISTS trg_job_work_output_items_business_date ON job_work_output_items;
CREATE TRIGGER trg_job_work_output_items_business_date BEFORE INSERT OR UPDATE OF received_date ON job_work_output_items
  FOR EACH ROW EXECUTE FUNCTION fn_validate_business_date('received_date', 'output received date');

DROP TRIGGER IF EXISTS trg_stock_ledger_business_date ON stock_ledger;
CREATE TRIGGER trg_stock_ledger_business_date BEFORE INSERT OR UPDATE OF entry_date ON stock_ledger
  FOR EACH ROW EXECUTE FUNCTION fn_validate_business_date('entry_date', 'transaction date');
