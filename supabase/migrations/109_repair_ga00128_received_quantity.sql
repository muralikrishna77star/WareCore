-- Fix GA00128 (GA 0.70X1248)'s item reconciliation mismatch: closing
-- balance was -0.610 because purchase line GA0724-0002 (bill 0724-0189,
-- 2024-07-15) was invoiced for 4.875 MT, but that MT was fully accounted for
-- via one job work transfer chain (Metalex -> Arun Engineering -> M&M, all
-- internally consistent) while a SEPARATE job work order
-- (JW-MSWZ4GL8-HKJI, dispatched to Arun Engineering 2024-07-23) also sent
-- 0.610 MT against the same purchase line, on top of the already-fully-
-- committed 4.875 MT. No orphaned/unmatched transfer elsewhere in the
-- system explains the 0.610 MT as a relabeled transfer leg (ruling out the
-- migration-101 "missed vendor transfer" pattern) — same shape as CR00431:
-- a weighbridge/underbilling variance, confirmed with the user.
--
-- Records the true received quantity (now that received_quantity exists to
-- hold it, per migration 105) and applies the same correction to the
-- PURCHASE_IN ledger row already posted for it — the trigger only fires on
-- INSERT/DELETE, so updating the purchase line alone would not retroactively
-- fix stock already posted.

BEGIN;

UPDATE purchase_bill_items
SET received_quantity = 5.485
WHERE purchase_line_id = 'GA0724-0002'
  AND received_quantity = 4.875;

UPDATE stock_ledger
SET quantity = 5.485
WHERE entry_type = 'PURCHASE_IN'
  AND reference_type = 'purchase_bill'
  AND purchase_line_id = 'GA0724-0002'
  AND quantity = 4.875;

COMMIT;
