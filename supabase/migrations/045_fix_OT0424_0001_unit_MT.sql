-- ============================================================
-- Fix Purchase Line OT0424-0001 (item OT00002, Paint 0.95X1250)
--
-- Migration 043 incorrectly treated quantity 3.110 as kg and divided
-- by 1000, producing a PURCHASE_IN of 0.003 MT in the stock ledger.
-- The actual purchase was 3.110 MT. This migration corrects:
--   1. purchase_bill_items.unit  kgs -> MT  (quantity 3.110 unchanged)
--   2. stock_ledger PURCHASE_IN  0.003 -> 3.110 MT
--
-- The paired JOB_WORK_OUT (-3.110 MT) and JOB_WORK_CANCEL (+3.110 MT)
-- are already in MT and net to zero, so they are left untouched.
-- After this fix net stock for OT0424-0001 = 3.110 MT.
-- ============================================================

-- 1. Correct the source unit on the purchase line
UPDATE purchase_bill_items
SET    unit = 'MT'
WHERE  purchase_line_id = 'OT0424-0001';

-- 2. Correct the PURCHASE_IN ledger entry (0.003 was 3.11 kgs / 1000 — wrong)
UPDATE stock_ledger
SET    quantity = 3.110
WHERE  purchase_line_id = 'OT0424-0001'
  AND  entry_type = 'PURCHASE_IN';

-- Diagnostic: show all ledger rows for this line after the fix
SELECT entry_type, quantity, entry_date, reference_number
FROM   stock_ledger
WHERE  purchase_line_id = 'OT0424-0001'
ORDER  BY entry_date, entry_type;
