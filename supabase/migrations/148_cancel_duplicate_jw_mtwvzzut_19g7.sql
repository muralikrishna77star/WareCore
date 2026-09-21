-- ============================================================
-- Migration 148: cancel duplicate job work order JW-MTWVZZUT-19G7
-- ============================================================
-- Found comparing Stock Statement's "Stock at Vendor" total (329.165)
-- against Vendorwise Stock Movement's Balance (331.030) for
-- 01-Mar-2024 -> 31-Dec-2024. Gap 1.865, all on MODERN AGE METAL
-- PROCESSORS / GI 1.40X1250 / GI0824-0008.
--
-- JW-MTWVZZUT-19G7 (dated 2024-12-24, DC 2024-25/DS/DC/069) was entered
-- on 2026-09-11 as a fresh warehouse -> vendor dispatch of CR1224-0010
-- (0.690) and GI0824-0008 (1.865). Both lots were actually at Mass
-- Decoilers, and were re-entered correctly minutes later as vendor
-- transfers (JW-MTWXSHBP-204M for the CR, JWT-0926-0018 / JW-MTWXVZBZ-T829
-- for the GI). Confirmed with Anoop (who entered it) as a wrong entry.
--
-- What was left behind:
--   * the GI line (quantity_sent 1.865) with no JOB_WORK_OUT ledger row —
--     both of this order's JOB_WORK_OUT rows had been deleted directly
--     (most likely via the Item Ledger's admin row-delete action). Stock
--     Statement (ledger-only) ignores it; Vendorwise's quantity_sent floor
--     (migrations 125/127) counts it -> +1.865 there only.
--   * a JOB_WORK_CANCEL +0.690 (CR1224-0010) posted when the CR line was
--     removed via Edit Order — reversing a JOB_WORK_OUT that no longer
--     exists. Both reports: MODERN AGE CR 1.40X1040 shows 0 instead of
--     0.690, and the warehouse shows a phantom +0.690.
--
-- Unlike 125/127 this line is NOT backfilled: it duplicates a real
-- transfer, so posting its JOB_WORK_OUT would double-count the 1.865.
-- Instead the order goes through the same delete_job_work_order() the
-- app's Cancel button uses: archived to job_work_cancellations (visible on
-- the cancellation archive screen), every stock_ledger row it owns removed
-- (which clears the orphan CANCEL), then hard-deleted. Nothing references
-- it (no transfers, output lines, downstream lines or direct sales).
--
-- Expected after: both reports show 329.855 for the same range.
--
-- Idempotent — no-op once the order is gone (and on a blank database).
-- ============================================================

DO $$
DECLARE
  v_result jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM job_work_orders WHERE id = 'd1f3bae4-9081-40e2-a908-470b48625e30') THEN
    v_result := delete_job_work_order(
      'd1f3bae4-9081-40e2-a908-470b48625e30'::uuid,
      'Wrong entry, confirmed by Anoop — material was at Mass Decoilers and is recorded by transfers JW-MTWXSHBP-204M and JWT-0926-0018. Removed by migration 148.'
    );
    IF NOT (v_result->>'success')::boolean THEN
      RAISE EXCEPTION 'delete_job_work_order failed: %', v_result->>'error';
    END IF;
  END IF;
END $$;
