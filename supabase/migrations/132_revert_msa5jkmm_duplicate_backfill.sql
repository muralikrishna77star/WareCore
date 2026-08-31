-- ============================================================
-- Migration 132: revert the ledger entry 127 backfilled for a duplicate
-- job_work_items line (JW-MSA5JKMM-FEG0)
-- ============================================================
-- While investigating REC-005 EXC-000526 (material d2e3f40f.../
-- 1805bd91..., negative company-wide -1.950), found the same defect
-- shape as migration 131: purchase line CR0324-0001 (1.950, bill
-- 0324-0004) was already legitimately sent to job work under
-- JW-MQGKF4FH-K3ON (2024-04-24, later correctly internally transferred to
-- JW-MTE2AG0W-N8HH on 2024-09-06 — a complete, self-consistent chain).
-- 127 separately found job_work_items row 59ab612b-fc3c-4e79-a075-
-- 1e62893f8fdb (JW-MSA5JKMM-FEG0 / CR0324-0001, quantity_sent 1.950) had
-- zero ledger footprint and — reasonably, given what it could see —
-- backfilled a fresh JOB_WORK_OUT for it. That row duplicates the same
-- real-world send already fully accounted for under JW-MQGKF4FH-K3ON;
-- there was only ever one 1.950 purchase and one real shipment of it.
--
-- Removing this one row returns the scope to exactly 0 (1.950 purchased,
-- 1.950 sent once, transferred once) — confirmed by direct summation
-- before writing this migration.
--
-- Deliberately NOT touched (same reasoning as 131): job_work_items row
-- 59ab612b itself remains a duplicate business record; JW-MSA5JKMM-FEG0
-- will predictably show up again in REC-002 (missing ledger post) once
-- this ships — expected and correct, a decision for the business record
-- itself rather than the ledger.
--
-- Idempotent — deletes by id, harmless to re-run.
-- ============================================================

BEGIN;

DELETE FROM stock_ledger WHERE id = '0330e69b-6959-450b-ae7a-ab00b97ee0c2'; -- JOB_WORK_OUT -1.950, backfilled by 127

COMMIT;
