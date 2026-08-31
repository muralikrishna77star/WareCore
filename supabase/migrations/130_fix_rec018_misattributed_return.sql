-- ============================================================
-- Migration 130: fix REC-018 — return misattributed to the wrong job
-- work order
-- ============================================================
-- Two job work orders were created for the same vendor
-- (fc5f4d64-3218-48d7-bc72-51ac33902f18) on the same date (2024-08-12):
-- JW-MSU3ZQPP-8V8J and JW-MSU42GU1-YT4N. JW-MSU3ZQPP-8V8J sent out 2.730
-- of material size "1x1240" (material_size_id
-- 0ad1d3bb-f9e7-4af3-bc35-35705489cc7c) and never got a return posted
-- against it. A JOB_WORK_RETURN_IN of exactly 2.730 for that same
-- material/size exists in stock_ledger dated 2024-08-17
-- (6e075d08-1e49-4d78-9204-e4448ae135ad) — but it's tagged against
-- JW-MSU42GU1-YT4N, which has no "1x1240" line at all (its lines are
-- 1.15X1240, 0.80X1270, 1x1250, 1x1500 — none matches). Confirmed by
-- comparing both orders' full job_work_items: the return can only belong
-- to JW-MSU3ZQPP-8V8J. Likely cause: the two orders' similar names/same
-- vendor/same date made it easy to pick the wrong one when recording the
-- return.
--
-- This doesn't touch any quantity or total — it corrects a misfiled
-- reference on one ledger row and syncs the one job_work_items row that
-- return actually belongs to.
--
-- First applied version of this migration forgot to guard the
-- job_work_items UPDATE with warecore.skip_job_work_return_trigger (the
-- mechanism 062/069 use for exactly this situation — see
-- 069_job_work_derived_return_no_phantom_ledger.sql) — fn_job_work_item_to_
-- ledger's normal AFTER UPDATE trigger fired on the quantity_received
-- increase and posted a second, phantom JOB_WORK_RETURN_IN (2.730, dated
-- the day this migration ran) on top of the one already correctly
-- re-pointed above, briefly regressing REC-018 in the opposite direction
-- (ledger showing -2.730 owed instead of 0). Caught immediately, confirmed
-- by created_at = the run date and notes IS NULL (matching exactly what
-- that trigger branch inserts, which sets no notes), and removed by hand
-- before this file was corrected to guard properly. Left documented here
-- instead of silently rewritten, since the DB may already be past the
-- unguarded version.
--
-- Idempotent — guarded by checking the row is still pointed at the wrong
-- order (ledger fix) / still at its original 0 (job_work_items fix, itself
-- wrapped in the skip-trigger guard) before touching anything.
-- ============================================================

BEGIN;

-- Guarded by joining on the wrong order's reference_number (rather than
-- hardcoding its id) so re-running this after the fix has already applied
-- is a no-op instead of a guess.
UPDATE stock_ledger sl
SET reference_id = '4f942643-dcf8-436c-aa7f-a75fcad9a513', -- JW-MSU3ZQPP-8V8J
    reference_number = 'JW-MSU3ZQPP-8V8J',
    notes = COALESCE(sl.notes || ' | ', '') || 'Re-attributed from JW-MSU42GU1-YT4N — see migration 130'
FROM job_work_orders wrong
WHERE sl.id = '6e075d08-1e49-4d78-9204-e4448ae135ad'
  AND sl.reference_id = wrong.id
  AND wrong.reference_number = 'JW-MSU42GU1-YT4N';

-- Skip-guarded: the return this quantity_received bump reflects is already
-- fully posted by the re-pointed ledger row above — letting the normal
-- trigger fire here would double-count it (see header comment).
SELECT set_config('warecore.skip_job_work_return_trigger', 'true', true);

UPDATE job_work_items
SET quantity_received = 2.730,
    updated_at = NOW()
WHERE id = '818319f6-53ee-4e15-97a7-5681f93a304f' -- JW-MSU3ZQPP-8V8J / 1x1240 line
  AND quantity_received = 0;

SELECT set_config('warecore.skip_job_work_return_trigger', 'false', true);

-- Cleanup for the unguarded first run, if this environment saw it: the
-- phantom row is uniquely identifiable (this order's re-pointed material/
-- size, RETURN_IN, no notes — the guarded INSERT above never omits notes
-- the way that trigger branch does).
DELETE FROM stock_ledger
WHERE reference_id = '4f942643-dcf8-436c-aa7f-a75fcad9a513' -- JW-MSU3ZQPP-8V8J
  AND material_type_id = 'cd18bd17-6f05-44ab-a59d-486d0562131b'
  AND material_size_id = '0ad1d3bb-f9e7-4af3-bc35-35705489cc7c'
  AND entry_type = 'JOB_WORK_RETURN_IN'
  AND quantity = 2.730
  AND notes IS NULL
  AND id <> '6e075d08-1e49-4d78-9204-e4448ae135ad';

COMMIT;
