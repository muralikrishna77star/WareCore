-- ============================================================
-- Migration 134: remove the two duplicate job_work_items lines
-- identified while investigating REC-005 (497cc83b, 59ab612b), and
-- cancel the duplicate dispatch that depended on one of them
-- ============================================================
-- 131 and 132 already reverted the phantom ledger entries these two
-- duplicate lines caused (see those migrations for full evidence: each
-- duplicates an already-correctly-ledgered real transaction, same
-- quantity/material/vendor/date). Left in place at the time were the
-- job_work_items rows themselves and dispatch 0824-0235 (which sold the
-- material 497cc83b claimed to have received) — deliberately deferred
-- pending a decision on how to handle duplicate business records.
--
-- This migration:
-- 1. Cancels dispatch 0824-0235 via the app's own cancel_dispatch_order()
--    — it's a duplicate of dispatch 0824-0393 (same customer, date,
--    amount, qty; different but themselves-duplicate source job-work
--    lines). This correctly zeroes 497cc83b's quantity_received back to 0
--    (GREATEST(0, ...) branch) and cleans up any virtual-return rows.
-- 2. Deletes both duplicate job_work_items rows outright. Both are safe
--    to remove per fn_job_work_item_deleted's own guard (quantity_
--    received = 0, quantity_transferred_out = 0, not a transfer line) —
--    but that trigger unconditionally posts a JOB_WORK_CANCEL of
--    +quantity_sent on any delete, which would recreate exactly the
--    phantom-stock problem 131/132 just fixed (there's no longer a
--    JOB_WORK_OUT for it to offset). Guarded with warecore.skip_job_
--    work_delete_reversal — the same flag delete_job_work_order() uses
--    for its own bulk cascade — to delete cleanly with zero ledger
--    footprint.
--
-- Order JW-MSU45A12-1WVF's other line (e0ac18f4, independently
-- legitimate, tied to JW-MSU3ZQPP-8V8J's real transfer) and order
-- JW-MSA5JKMM-FEG0 itself (which becomes line-less) are untouched — an
-- empty job work order is a pre-existing, harmless state elsewhere in
-- this schema (e.g. a cancelled order can retain a header with no
-- surviving lines).
-- ============================================================

BEGIN;

-- Step 1 done separately (see session) via:
--   SELECT cancel_dispatch_order('5177b14e-6d08-4a65-95b7-95d098970993',
--     'Duplicate of dispatch 0824-0393 — see migrations 131/134');
-- Re-run here, guarded, so this file is a complete, replayable record.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM dispatch_orders WHERE id = '5177b14e-6d08-4a65-95b7-95d098970993' AND status <> 'cancelled'
  ) THEN
    PERFORM cancel_dispatch_order('5177b14e-6d08-4a65-95b7-95d098970993',
      'Duplicate of dispatch 0824-0393 — same job-work transfer double-recorded under JW-MSU45A12-1WVF; see migrations 131/134');
  END IF;
END $$;

SELECT set_config('warecore.skip_job_work_delete_reversal', 'true', true);

DELETE FROM job_work_items
WHERE id = '497cc83b-e726-4e60-9a4f-d14b59a3a607' AND quantity_received = 0 AND quantity_transferred_out = 0;

DELETE FROM job_work_items
WHERE id = '59ab612b-fc3c-4e79-a075-1e62893f8fdb' AND quantity_received = 0 AND quantity_transferred_out = 0;

SELECT set_config('warecore.skip_job_work_delete_reversal', 'false', true);

COMMIT;
