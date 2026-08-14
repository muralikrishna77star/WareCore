-- Repair two stale/orphaned "vendor direct sale — virtual return"
-- stock_ledger rows found while investigating negative Balance-at-Vendor
-- readings that survived 094's exact-duplicate cleanup. Unlike 094, these
-- are not exact duplicates (REC-001 does not flag them) — each is a single
-- anomalous row identified by cross-checking against job_work_items and
-- dispatch_orders, with the resulting balances verified to land on clean,
-- independently-corroborated numbers before this migration was written.
--
-- CR00171 (21268357-c0ec-469e-92cd-639975026fa5): JOB_WORK_RETURN_IN
--   +4.390, 06-Jun-2024, tied to dispatch invoice 0624-0163
--   (JW-MRSZIRGC-2NEV / CR0524-0065). fn_dispatch_item_to_ledger() (see
--   062_fix_vendor_direct_sale_duplicate_return.sql) only ever creates this
--   ledger shape when dispatch_orders.is_vendor_direct = TRUE, and always
--   bumps job_work_items.quantity_received in the same transaction. Dispatch
--   0624-0163 is currently is_vendor_direct = FALSE, and
--   job_work_items.quantity_received for this job/line (5.130) reflects
--   only the later 18-Jul return, not this one — so this row could not
--   have been produced by current app code and is inconsistent with every
--   other authoritative source. Its paired SALE_OUT (48a9b59f-..., -4.390)
--   is a legitimate warehouse sale (the warehouse had real stock that day
--   from a same-day Purchase In) and is left untouched. Removing this row
--   brings the item's closing balance to 0.000 and its ledger-derived
--   vendor balance to 2.520 — exactly matching the "At Vendor (Job Work)"
--   summary figure independently computed from job_work_items.
--
-- CR00391 (424dfc0d-b5a4-4343-bbe0-ed2a1a5ca63e): JOB_WORK_RETURN_IN
--   +3.332, 24-Jun-2024, tied to dispatch invoice 0624-0096. This row has
--   no matching SALE_OUT anywhere in the ledger. dispatch_items for
--   0624-0096 was edited on 2026-08-13 down to quantity 0.790, which
--   correctly posted a fresh paired +0.790/-0.790 leg at that same
--   timestamp — but the original +3.332 leg from the dispatch's initial
--   2026-07-29 creation was never removed. Removing it brings the item's
--   closing balance to 0.000 and vendor balance to +3.075 (positive,
--   matching total-sent minus total-returned across the item's full
--   history).
BEGIN;

DELETE FROM stock_ledger
WHERE id IN (
  '21268357-c0ec-469e-92cd-639975026fa5', -- CR00171, stale virtual return (0624-0163)
  '424dfc0d-b5a4-4343-bbe0-ed2a1a5ca63e'  -- CR00391, orphaned virtual return (0624-0096, pre-edit)
)
AND entry_type = 'JOB_WORK_RETURN_IN';

COMMIT;
