-- ============================================================
-- Migration 137: remove the no-op CANCEL/OUTPUT_IN pairs the
-- pre-136 trigger bug left on JW-MTBES07O-SBT8
-- ============================================================
-- System-wide scan for the exact bug fixed in migration 136 (fn_job_
-- work_output_item_to_ledger's UPDATE branch unconditionally reversing
-- and reposting on every Edit Order save, even when nothing about the
-- output row changed) found the residue confined to one order:
-- JW-MTBES07O-SBT8 (id b5cc03ae-ff74-4fbf-a772-f68f0c686b3e), from an
-- Edit Order save at 2026-09-02 08:03:02 UTC — before 136 was deployed.
--
-- Detection: paired every JOB_WORK_CANCEL row carrying this trigger's
-- distinctive notes ('Output line corrected via Edit Order') against a
-- JOB_WORK_OUTPUT_IN row from the exact same trigger firing (identical
-- created_at, same order/material/size/entry_date/purchase_line_id,
-- exactly offsetting quantity) — i.e. a complete no-op: nothing about
-- the output line actually differed between OLD and NEW. Two such pairs
-- were found on this order, both for size "2.80X150 (6Nos)":
--   - entry_date 2024-10-09, qty 2.540 (cancel e05124e4 / repost bf7ad010),
--     reversing the original post c0e4842a
--   - entry_date 2024-10-05, qty 5.370 (cancel ba55cca6 / repost 70c7f80e),
--     reversing the original post 684aa5fa
-- A third pair-shaped CANCEL/OUTPUT_IN on a different order
-- (JW-MT76QJZ5-5J4E) was checked and excluded — entry_date differs
-- between the cancel and its repost (2024-09-06 -> 2024-09-17), meaning
-- that one is a genuine received-date correction, not this bug.
--
-- Fix: delete both the CANCEL and its matching repost from each pair.
-- The original c0e4842a/684aa5fa postings (and the unrelated, genuinely
-- new d9abc182 output line added in the same save) are untouched — this
-- restores JW-MTBES07O-SBT8 to exactly the state it would be in had
-- migration 136's guard already been live for that save. Net stock
-- effect of this delete is zero (each pair already summed to zero); this
-- only removes report clutter, matching how JW-MTBHDLZV-H92K's own
-- residue was already cleaned up by hand before this was investigated.
--
-- Idempotent — deletes by fixed row id, a repeat run deletes zero rows.
-- ============================================================

BEGIN;

DELETE FROM stock_ledger
WHERE id IN (
  'e05124e4-cc12-46da-a030-0d31ffc316ec', -- JOB_WORK_CANCEL -2.540 (10-09)
  'bf7ad010-9c32-49cd-aa73-022cf42c30ad', -- JOB_WORK_OUTPUT_IN +2.540 (10-09), no-op repost
  'ba55cca6-82cd-452f-8e32-7ad89c42ca41', -- JOB_WORK_CANCEL -5.370 (10-05)
  '70c7f80e-aa6e-47c2-b85e-12ec9cd36b12'  -- JOB_WORK_OUTPUT_IN +5.370 (10-05), no-op repost
)
AND reference_id = 'b5cc03ae-ff74-4fbf-a772-f68f0c686b3e'
AND entry_type IN ('JOB_WORK_CANCEL', 'JOB_WORK_OUTPUT_IN');

COMMIT;
