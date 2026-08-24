-- Revert migration 109. Confirmed with the user: purchase line GA0724-0002
-- (bill 0724-0189) genuinely received only the invoiced 4.875 MT — nothing
-- extra was received from the supplier. Migration 109's weighbridge-variance
-- read of the GA00128 reconciliation mismatch was wrong; the real root cause
-- of the 0.610 MT gap is still open and needs separate investigation (a job
-- work line elsewhere referencing this purchase_line_id likely shouldn't).
-- Restores received_quantity (and the PURCHASE_IN ledger row it drives) to
-- match the invoiced 4.875.

BEGIN;

UPDATE purchase_bill_items
SET received_quantity = 4.875
WHERE purchase_line_id = 'GA0724-0002'
  AND received_quantity = 5.485;

UPDATE stock_ledger
SET quantity = 4.875
WHERE entry_type = 'PURCHASE_IN'
  AND reference_type = 'purchase_bill'
  AND purchase_line_id = 'GA0724-0002'
  AND quantity = 5.485;

COMMIT;
