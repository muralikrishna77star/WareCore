-- GI00057 (0.70X1305) was flagged by the Item-by-Item Reconciliation report
-- ("Vendor-held stock went negative during the period") even though its
-- closing balance and vendor balance are both correct (0.000 / 0.528,
-- matching v_stock_at_vendors exactly).
--
-- Root cause: same shape as migration 102 (CR00640). The JOB_WORK_TRANSFER_IN
-- (JW-MRQ6STJD-2GH7, created_at 2026-07-18 09:51:20) and JOB_WORK_TRANSFER_OUT
-- (JW-MR0J2NYQ-HEKS, created_at 2026-08-04 09:58:45) legs of the same
-- 2024-05-25 transfer were backfilled ~2.5 weeks apart in real created_at
-- time, even though both share the same entry_date. A vendor-direct-sale
-- return (JOB_WORK_RETURN_IN + SALE_OUT, created_at 2026-07-28) landed
-- chronologically between them. The reconciliation scan's running-balance
-- window (ordered by entry_date, created_at) sees TRANSFER_IN, then the
-- return (vendor delta -0.630), then TRANSFER_OUT — producing a transient
-- -0.630 dip in the running vendor balance before it settles back to the
-- correct 0.528. A false positive, not a real data problem.
--
-- Fix: align TRANSFER_OUT's created_at with TRANSFER_IN's, so both legs of
-- the transfer land in the same atomic step of the reconciliation route's
-- ledger_grouped CTE and net to zero as a unit, sorting before the
-- vendor-direct-sale return instead of after it. No quantities, entry_dates,
-- or balances change.
UPDATE stock_ledger
SET created_at = '2026-07-18 09:51:20.010014+00'
WHERE id = '0d70d2e8-8d78-4924-b348-5d46368b35e3'
  AND entry_type = 'JOB_WORK_TRANSFER_OUT'
  AND reference_id = '5f6d88a8-6870-4a43-9e4d-8d99505343a9';
