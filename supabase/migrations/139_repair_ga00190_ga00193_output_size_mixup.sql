-- Fix GA00190 (GA 1 X 330)'s item reconciliation mismatch: ledger vendor
-- balance (3.160) didn't match job-work records (0.000).
--
-- Job work order JW-MTCNG7RN-NJ2D (vendor Arun Engineering, dispatched
-- 2024-10-18) sent three lines: JW-1810-0004 (4.080 MT, GA00193/1x380),
-- JW-1810-0005 (3.640 MT, GA00193/1x380), and JW-1810-0006 (3.160 MT,
-- GA00190/1x330). When the vendor's return was backfilled via "Output
-- Materials" on 2026-09-04, all three return lines were recorded against
-- GA00193 (1x380) — including the one for JW-1810-0006, which should have
-- been recorded against GA00190 (1x330) to match what was actually sent on
-- that line.
--
-- job_work_items.quantity_received on JW-1810-0006 was correctly set to
-- 3.160 ("fully received"), so the job-work-based expectation
-- (v_stock_at_vendors) already shows 0 pending for GA00190. But because the
-- ledger's JOB_WORK_OUTPUT_IN row for that return was posted against
-- material size 1x380 instead of 1x330, migration 123's same-material-size
-- rule never credited it back against GA00190's own ledger balance, leaving
-- it stuck at 3.160. The same misfiled row also overstated GA00193's
-- returns, understating ITS ledger vendor balance by the same 3.160 (7.160
-- vs. an expected 10.320) — one data-entry error explains both gaps.
--
-- Fix: repoint that one output-return record from GA00193/1x380 to
-- GA00190/1x330. A single UPDATE is enough — fn_job_work_output_item_to_ledger()
-- (migrations 114/136) already reverses the OLD stock_ledger row
-- (JOB_WORK_CANCEL) and reposts the NEW one (JOB_WORK_OUTPUT_IN) whenever an
-- output row's material/size/quantity actually changes, so touching
-- stock_ledger directly here would double-post. Verified live: this UPDATE
-- alone brought GA00190's vendor balance to 0 (matching job-work) and
-- GA00193's to 10.320 (matching job-work), with no stock_ledger edit needed.

UPDATE job_work_output_items
SET
  item_master_id = '778c094e-7b64-41c4-9c4d-777e6b102b6f', -- GA00190 (GA 1 X 330)
  item_name = 'GA 1 X 330',
  material_size_id = '27efb66d-60a0-4229-8b01-b184a90e6a25',
  size_label = '1 X 330',
  updated_at = NOW()
WHERE id = '9a0226a5-95b9-4564-bf5e-8e8eb02f7526'
  AND source_job_line_id = 'JW-1810-0006'
  AND material_size_id = '09ab752d-3a99-4608-b3ae-da4ddbcfcfb1'
  AND quantity = 3.160;
