-- ============================================================
-- Migration 144: repair 10 more REC-005 negative-stock candidates,
-- CR1224-00xx purchase lines, DS Steel Enterprises
-- (fifth occurrence of the Sri Sai Steels <-> DS Steel Enterprises
-- informal sharing arrangement — same shape as migration 143 Part 1)
-- ============================================================
-- Found live via fn_reconcile_rec_005 immediately after applying migration
-- 143: two job-work orders (JW-MTWTIH5N-BU2Z, JW-MTWTN4HT-V2ML, both dated
-- 2024-12-12) were entered 2026-09-11 10:33-10:36 UTC — DURING the same
-- session that fixed the prior 11 exceptions — confirming this is an
-- actively, currently recurring data-entry pattern, not historical noise.
--
-- Same PART 1 technique as migration 143: each of these 10 purchase lines
-- (bill 1224-0380, purchased under Sri Sai Steels) was consumed 100% by a
-- DS Steel Enterprises job-work order, with any further activity (job-work
-- vendor transfer in/out, on CR1224-0032/0033) also entirely under DS
-- Steel Enterprises — nothing depends on the original PURCHASE_IN staying
-- under Sri Sai Steels, so the ledger row is reattributed rather than
-- adding a transfer leg. The purchase bill itself (and any other lines on
-- it not in this list) is left untouched — only the stock_ledger row
-- moves.
--
-- Idempotent: the UPDATE only touches rows still under Sri Sai Steels with
-- these exact purchase_line_ids (a rerun after company_id has already
-- changed matches zero rows).
--
-- To revert: UPDATE stock_ledger SET company_id =
-- '426a22ba-edb6-4947-b637-1ad4aab640b9', warehouse_id =
-- '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2' WHERE notes LIKE
-- '%reattributed-by-migration-144%';
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_n INT;
BEGIN
  SELECT count(*) INTO v_n
  FROM stock_ledger
  WHERE entry_type = 'PURCHASE_IN'
    AND company_id = '426a22ba-edb6-4947-b637-1ad4aab640b9'  -- Sri Sai Steels
    AND purchase_line_id IN (
      'CR1224-0030','CR1224-0032','CR1224-0033','CR1224-0034',
      'CR1224-0038','CR1224-0039','CR1224-0041','CR1224-0043',
      'CR1224-0045','CR1224-0047'
    );
  IF v_n <> 10 THEN
    RAISE EXCEPTION 'Migration 144: expected 10 PURCHASE_IN rows still under Sri Sai Steels, found % — aborting without changes', v_n;
  END IF;
END $$;

UPDATE stock_ledger
SET company_id = 'b1804696-676d-465d-a5fe-e1bb214c8da3',   -- DS Steel Enterprises
    warehouse_id = 'c8ca6c17-e740-4525-a485-0ce962169008',  -- Warehouse (DSS virtual)
    notes = format(
      'Reattributed from Sri Sai Steels to DS Steel Enterprises — this purchase line''s entire quantity (%s) was consumed by DS Steel Enterprises job work order %s with no other activity under Sri Sai Steels; the vendor invoice (bill 1224-0380) stays recorded under Sri Sai Steels, only this stock ledger inflow moved — see migration 144 [reattributed-by-migration-144]',
      quantity,
      (SELECT reference_number FROM stock_ledger jw
       WHERE jw.purchase_line_id = stock_ledger.purchase_line_id AND jw.entry_type = 'JOB_WORK_OUT'
       LIMIT 1)
    )
WHERE entry_type = 'PURCHASE_IN'
  AND company_id = '426a22ba-edb6-4947-b637-1ad4aab640b9'
  AND purchase_line_id IN (
    'CR1224-0030','CR1224-0032','CR1224-0033','CR1224-0034',
    'CR1224-0038','CR1224-0039','CR1224-0041','CR1224-0043',
    'CR1224-0045','CR1224-0047'
  );

COMMIT;
