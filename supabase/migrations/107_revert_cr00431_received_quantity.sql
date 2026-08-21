-- Revert migration 106. While this session's investigation was in progress,
-- dispatch invoice 0824-0232 (sale_line_id CR0826-0562) was independently
-- corrected live in the app from 1.960 to 1.870 (dispatch_items.updated_at /
-- the new SALE_OUT ledger row are both timestamped 2026-08-21 11:40:18) —
-- someone fixed the real weighbridge/underbilling variance from the sales
-- side instead. With that correction, invoiced purchases (15.280: 14.930 +
-- 0.350) now exactly equal invoiced sales (15.280: 0.350 + 3.240 + 4.800 +
-- 5.020 + 1.870), so CR0624-0011's earlier 0.090 shortfall is already gone —
-- 106's purchase-side bump to 15.020 is now a double-correction, overstating
-- the closing balance by +0.090. Reverting restores received_quantity (and
-- the PURCHASE_IN ledger row it drives) to match the invoiced 14.930.

BEGIN;

UPDATE purchase_bill_items
SET received_quantity = 14.930
WHERE purchase_line_id = 'CR0624-0011'
  AND received_quantity = 15.020;

UPDATE stock_ledger
SET quantity = 14.930
WHERE entry_type = 'PURCHASE_IN'
  AND reference_type = 'purchase_bill'
  AND purchase_line_id = 'CR0624-0011'
  AND quantity = 15.020;

COMMIT;
