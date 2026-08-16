-- CR00640 (1.40X1080) was flagged by the Item-to-Item Reconciliation report
-- ("Vendor-held stock went negative during the period") even though its
-- Item Ledger and current vendor balances are both correct.
--
-- Root cause: the JOB_WORK_TRANSFER_OUT (JW-MSA5JKMM-FEG0) and
-- JOB_WORK_TRANSFER_IN (JW-MSA5LD07-6ZNP) legs of the same 2024-04-24
-- transfer were backfilled by two separate historical migrations
-- (078, then redone by 082/083) roughly 2.5 hours apart in real created_at
-- time, even though both share the same entry_date. The reconciliation
-- scan's running-balance window (ordered by entry_date, created_at) sees
-- the TRANSFER_IN leg (+1.950, created 08:01:48) before the original
-- JOB_WORK_OUT (-1.950, created 09:52:31) and the TRANSFER_OUT leg
-- (created 10:38:26), producing a transient -1.950 dip in the running
-- vendor balance before it settles back to the correct 1.950 — a false
-- positive, not a real data problem.
--
-- Fix: align TRANSFER_IN's created_at with TRANSFER_OUT's, so both legs of
-- the transfer land in the same atomic step of the reconciliation route's
-- ledger_grouped CTE (GROUP BY item_id, entry_date, created_at) and net to
-- zero as a unit, matching how a same-transaction transfer (e.g. migration
-- 101) naturally behaves. No quantities, entry_dates, or balances change.
UPDATE stock_ledger
SET created_at = '2026-08-05 10:38:26.747783+00'
WHERE id = 'cebc7623-747e-4ab4-b818-41dccb3c60ca'
  AND entry_type = 'JOB_WORK_TRANSFER_IN'
  AND reference_id = '4023acca-2a8c-45dd-a272-aafaadd65b32';
