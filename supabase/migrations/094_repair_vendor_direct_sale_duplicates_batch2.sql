-- Repair a second batch of duplicate/erroneous vendor-movement stock_ledger
-- rows, found by running fn_reconcile_rec_001 (see 088) across all
-- companies/dates. Each row below double-counted a JOB_WORK_RETURN_IN or
-- JOB_WORK_OUT event, which both inflated the item's warehouse Total In
-- and over-drained its "Balance at Vendor" running total into negative
-- territory. Confirmed by re-deriving each group fresh via
-- fn_reconcile_rec_001 immediately before writing this migration.
--
-- CR00171 (JW-MRSZIRGC-2NEV / CR0524-0065): two identical
--   JOB_WORK_RETURN_IN +5.130 rows for the same 18-Jul-2024 vendor-direct
--   sale (0724-0164). Keeping the earlier one (paired-with-SALE_OUT
--   timestamp match on the later one is coincidental — both rows are
--   numerically identical so either could be kept; earliest kept for
--   consistency with the archival convention in fn_repair_archive_
--   duplicate_ledger_row).
-- CR00407 (JW-MSMU64R4-JKI7): two duplicate pairs, CR0724-0014 (+2.880 x2)
--   and CR0724-0015 (+2.905 x2), both 24-Jul-2024.
-- CR00425 (JW-MSMU64R4-JKI7 / CR0724-0018): +3.370 x2, 24-Jul-2024.
-- CR00437 (JW-MSMU64R4-JKI7 / CR0724-0013): +2.850 x2, 24-Jul-2024.
-- CR00524 (JW-MSMUJ9FA-V7R4): two byte-identical JOB_WORK_OUT -2.350 rows,
--   created_at identical to the microsecond (spread = 0s) — a plain
--   double-submit, not an edit-replay. Either row may be kept.
-- GI00082 (JW-MSIVFMXM-MGPZ / GI0724-0001): two JOB_WORK_RETURN_IN +7.426
--   rows, but here entry_date differs — one row was posted with
--   entry_date = 2026-08-11 (the row's own created_at date, i.e. a
--   CURRENT_DATE fallback bug per 076_fix_job_work_output_date_fallback),
--   the other with the correct entry_date = 2024-07-09 matching the job
--   work's actual timeline. The wrong-dated row is deleted; the
--   correctly-dated row is kept (the only group here where "keep earliest
--   created_at" would have kept the WRONG row).
--
-- None of these dispatches carry a source_job_work_item_id link (verified
-- against dispatch_items), so unlike 071_repair_vendor_direct_sale_
-- duplicates.sql there is no job_work_items.quantity_received to correct —
-- job_work_items quantities were confirmed unaffected (already <=
-- quantity_sent) before writing this migration.
BEGIN;

DELETE FROM stock_ledger
WHERE id IN (
  'f0c4dc92-9fc3-4a92-98b4-00659ac6287b', -- CR00171, dup of 6117cb9b-...
  '3e00cba7-4e76-4a9a-85b1-b5229465fa96', -- CR00407 CR0724-0014, dup of 507ede65-...
  '8b9b2982-bad3-4744-87a5-1c8a987e93b3', -- CR00407 CR0724-0015, dup of 2225d479-...
  '6e2d3eb2-061d-4f29-b87e-6fcca1d40bdc', -- CR00425 CR0724-0018, dup of cb9b86f7-...
  '3039d5e3-599e-4e5a-be23-0004912a8edb', -- CR00437 CR0724-0013, dup of 49a6ea84-...
  '45bae91d-fa04-4543-a7b0-cf880dd47094', -- CR00524, dup of beda240d-...
  '65ba0397-949b-4503-836d-8e5bff94dc7d'  -- GI00082, wrong entry_date, dup of c9b1b3cb-...
)
AND entry_type IN ('JOB_WORK_RETURN_IN', 'JOB_WORK_OUT');

COMMIT;
