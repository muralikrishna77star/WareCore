-- ============================================================
-- Migration 176: remove the leftover +/-0.400 "Qty Sent corrected" pair on
-- reversed order JW-MVZ3VU8Y-9B56
-- ============================================================
-- Reported 2026-11-17: for 01-Mar-2024 .. 30-Jun-2025, Vendorwise Stock
-- Movement's summary said "Not reconciled": Opening + Job Work Out +
-- Transfers In - Returns - Direct Sales - Transfers Out = 334.607, while
-- its Closing Balance (and Stock Statement's Stock at Vendor) = 333.807.
-- Transfers In (526.600) and Transfers Out (525.800) should be equal.
--
-- All 0.800 sits on D A INDUSTRIES / CR 0.70 X 175. On 2026-11-04 Edit
-- Order cut JWT-1126-0007's received line 1.350 -> 0.950, posting a
-- -0.400 JOB_WORK_TRANSFER_IN; migration 169 put it back with a +0.400 row;
-- migration 170 then reversed JWT-1126-0007 (removing the 1.350 transfer
-- legs and the order's line) and re-entered it as JWT-1126-0008 at 0.950.
-- The +/-0.400 pair stayed behind on JW-MVZ3VU8Y-9B56 (Transfer Reversed,
-- no lines left). It nets to zero, so no stock figure was wrong, but the
-- report added both with Math.abs, showing 1.750 transferred in for a
-- 0.950 balance. The report now sums signed quantities (code fix in the
-- same change); this removes the pair so the reversed order carries no
-- ledger rows, as migration 157's reversal leaves every other one.
--
-- Rows are copied to stock_ledger_deletions first (visible on
-- /ledger-deletions). The order is cancelled, so the status-refresh
-- trigger does nothing.
-- ============================================================

DO $$
DECLARE
  v_order_id UUID;
  v_count INT;
  v_net NUMERIC;
BEGIN
  SELECT id INTO v_order_id FROM job_work_orders
  WHERE reference_number = 'JW-MVZ3VU8Y-9B56' AND status = 'cancelled';
  IF v_order_id IS NULL THEN
    RAISE NOTICE 'Migration 176: JW-MVZ3VU8Y-9B56 not found or not cancelled — skipped';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM job_work_items WHERE job_work_order_id = v_order_id) THEN
    RAISE EXCEPTION 'Migration 176: JW-MVZ3VU8Y-9B56 still has lines — not touching it';
  END IF;

  SELECT count(*), COALESCE(sum(quantity), 0) INTO v_count, v_net
  FROM stock_ledger
  WHERE reference_type = 'job_work' AND reference_id = v_order_id;

  IF v_count = 0 THEN
    RAISE NOTICE 'Migration 176: no ledger rows left on JW-MVZ3VU8Y-9B56 — already done';
    RETURN;
  END IF;

  IF v_count <> 2 OR abs(v_net) > 0.0005 OR EXISTS (
    SELECT 1 FROM stock_ledger
    WHERE reference_type = 'job_work' AND reference_id = v_order_id
      AND (entry_type <> 'JOB_WORK_TRANSFER_IN' OR abs(abs(quantity) - 0.400) > 0.0005)
  ) THEN
    RAISE EXCEPTION 'Migration 176: JW-MVZ3VU8Y-9B56 ledger is not the expected +/-0.400 TRANSFER_IN pair (% rows, net %)', v_count, v_net;
  END IF;

  INSERT INTO stock_ledger_deletions (stock_ledger_id, ledger_row, deleted_by)
  SELECT sl.id, to_jsonb(sl), NULL
  FROM stock_ledger sl
  WHERE sl.reference_type = 'job_work' AND sl.reference_id = v_order_id;

  DELETE FROM stock_ledger
  WHERE reference_type = 'job_work' AND reference_id = v_order_id;

  RAISE NOTICE 'Migration 176: removed % net-zero rows from JW-MVZ3VU8Y-9B56', v_count;
END $$;
