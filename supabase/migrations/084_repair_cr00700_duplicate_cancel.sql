-- Item CR00700 (CR 1.60X1250) was missing from Job Work's Input Materials
-- picker because its net available stock across purchase lines was -0.460
-- (jobwork/new/page.tsx filters to availableStock > 0). Root cause: on
-- purchase line CR0424-0004, the item was removed from purchase bill 0424-0184
-- and a PURCHASE_CANCEL of -3.710 was logged, then removed again seconds
-- later (likely a double-submit), logging a second identical -3.710
-- PURCHASE_CANCEL before the line was re-added with a matching +3.710
-- PURCHASE_IN. Only one cancel should exist; the extra one drove the line
-- to -3.710 instead of 0. Deleting the duplicate restores CR0424-0004 to 0
-- and CR00700's total net stock to +3.250 (from line CR0724-0020).
DELETE FROM stock_ledger
WHERE id = 'd1d3b38c-eaf9-4abc-8e11-f7500c732450'
  AND purchase_line_id = 'CR0424-0004'
  AND entry_type = 'PURCHASE_CANCEL'
  AND quantity = -3.710;
