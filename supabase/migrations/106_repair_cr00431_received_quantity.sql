-- Fix CR00431 (CR 1 X 121 =4Coils)'s item reconciliation mismatch: closing
-- balance was -0.090 because purchase line CR0624-0011 (bill 0624-0163,
-- 2024-06-26) was invoiced for 14.930 MT, but 4 separate real dispatch
-- invoices (0824-0229/230/231/232, Aug 2024) legitimately sold 15.020 MT
-- against it — a small weighbridge/underbilling variance, not a duplicate
-- or stale ledger row (see migration 105's header for the general fix this
-- is an instance of).
--
-- Records the true received quantity on the purchase line (now that
-- received_quantity exists to hold it, separate from the invoiced amount
-- used for billing) and applies the same correction to the PURCHASE_IN
-- ledger row already posted for it — the trigger only fires on
-- INSERT/DELETE, so updating the purchase line alone would not retroactively
-- fix stock already posted.

BEGIN;

UPDATE purchase_bill_items
SET received_quantity = 15.020
WHERE purchase_line_id = 'CR0624-0011'
  AND received_quantity = 14.930;

UPDATE stock_ledger
SET quantity = 15.020
WHERE entry_type = 'PURCHASE_IN'
  AND reference_type = 'purchase_bill'
  AND purchase_line_id = 'CR0624-0011'
  AND quantity = 14.930;

COMMIT;
