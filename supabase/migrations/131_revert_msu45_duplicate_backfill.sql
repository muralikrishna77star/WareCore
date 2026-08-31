-- ============================================================
-- Migration 131: revert the ledger entries 127/129 backfilled for a
-- duplicate job_work_items line
-- ============================================================
-- While investigating REC-005 EXC-000580 (material cd18bd17.../
-- e662ffd6..., negative company-wide), found that job_work_items line
-- 497cc83b-e726-4e60-9a4f-d14b59a3a607 (order JW-MSU45A12-1WVF,
-- "0.90X1235", quantity_sent 2.705, quantity_received 2.650) is a
-- duplicate of an already-correctly-ledgered transfer: job_work_order
-- JW-MTE5YV8V-ABDX has its own single line (7bcf91ff-897e-428b-be83-
-- 65872992c78f) for the exact same material/size/quantity_sent/
-- quantity_received, same vendor (a9281561...), same date (2024-08-13),
-- explicitly flagged is_transfer_line = TRUE with
-- source_job_work_item_id pointing back to the real originating line
-- under JW-MR0J2NYQ-HEKS — a fully legitimate, fully-ledgered transfer
-- chain. There is only one real 2.705 purchase (bill 0524-0036) and only
-- one real transfer of it; 497cc83b represents the same event a second
-- time under a different order number, not a second real shipment.
--
-- 127 (last session, before this one) found 497cc83b had zero ledger
-- footprint and — reasonably, given what it could see — treated it as
-- a genuine standalone order missing its ledger post, backfilling a
-- fresh JOB_WORK_OUT/JOB_WORK_RETURN_IN for it. That backfill is what
-- actually manufactured the negative-stock dip: it invented a second
-- "2.705 sent to vendor" event for material that was only ever sent out
-- once. 129 (this session, earlier today) then posted dispatch
-- 0824-0235's SALE_OUT without yet knowing 0824-0235 (sourced from
-- JW-MSU45A12-1WVF) is itself very likely the same real sale as the
-- already-correctly-posted dispatch 0824-0393 (sourced from
-- JW-MTE5YV8V-ABDX) — same customer, same date, same amount (172780.00),
-- same qty (2.650) — duplicated because the job-work side was duplicated.
--
-- This migration removes exactly the 3 rows 127/129 added for this
-- duplicate (identified by their own backfill notes tags, not
-- re-derived), and nothing else — 127's other two backfills (for
-- JW-MSA5JKMM-FEG0 / CR0324-0001 and JW-MSA6FLFY-5OWM / CR0324-0008) are
-- unrelated single-order orphans with no such duplicate sibling and are
-- untouched, as is JW-MSU45A12-1WVF's other, independently-legitimate
-- line (e0ac18f4, tied into JW-MSU3ZQPP-8V8J's own real transfer).
--
-- Deliberately NOT touched here (out of scope for a ledger-only revert,
-- and a business decision rather than an arithmetic one): job_work_items
-- row 497cc83b itself (quantity_sent/received) and dispatch_orders row
-- 5177b14e (0824-0235) both remain as duplicate business records. Once
-- this migration ships, REC-002 and REC-009 will predictably re-flag
-- them (dispatch 0824-0235 missing its ledger post again, job work order
-- JW-MSU45A12-1WVF's sent/received disagreeing with the ledger again) —
-- expected, and correct: those are the honest signals of "this is a
-- duplicate record that still needs a decision" rather than "the ledger
-- is broken". Left open as a follow-up once confirmed against source
-- records.
--
-- Idempotent — each DELETE matches by id, harmless to re-run.
-- ============================================================

BEGIN;

DELETE FROM stock_ledger WHERE id = 'c4e4dc44-bae1-4078-a8e8-a853755358f0'; -- JOB_WORK_OUT -2.705, backfilled by 127
DELETE FROM stock_ledger WHERE id = '09d31685-e1a0-409c-b7d3-01df57e473bf'; -- JOB_WORK_RETURN_IN +2.650, backfilled by 127
DELETE FROM stock_ledger WHERE id = 'bfa2498c-34d7-4959-a0a0-037766e5ca44'; -- SALE_OUT -2.650, backfilled by 129

COMMIT;
