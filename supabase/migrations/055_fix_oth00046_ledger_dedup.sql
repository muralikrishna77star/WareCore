-- ============================================================
-- WareCore WMS - One-time data fix: OTH00046 (Paint Over width) ledger dedup
-- Bill 0324-0004 (still active) had its two "Over width" lines
-- (OT0324-0001, qty 17.344 and OT0324-0003, qty 0.600) repeatedly
-- edited under the old reverse_purchase_item() path (dropped in
-- migration 053). Each edit round left behind a PURCHASE_IN +
-- PURCHASE_CANCEL pair instead of being cleaned up, so the Item
-- Ledger showed 6 Purchase entries / 5 Cancellations for the first
-- line and 4 Purchase entries / 3 Cancellations for the second,
-- instead of the 1 current entry each actually represents today.
--
-- Fix (data only — migration 053 already fixed the code path):
-- drop all PURCHASE_CANCEL reversal rows for these two lines (they
-- always net to zero and are superseded), then keep only the most
-- recent PURCHASE_IN per line, matching the bill's current items.
-- ============================================================

DELETE FROM stock_ledger
WHERE reference_type = 'purchase_bill'
  AND reference_id = 'dbc59e59-2379-4fed-acef-243c72c0cc90'
  AND purchase_line_id IN ('OT0324-0001', 'OT0324-0003')
  AND entry_type = 'PURCHASE_CANCEL';

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY purchase_line_id
    ORDER BY created_at DESC
  ) AS rn
  FROM stock_ledger
  WHERE reference_type = 'purchase_bill'
    AND reference_id = 'dbc59e59-2379-4fed-acef-243c72c0cc90'
    AND purchase_line_id IN ('OT0324-0001', 'OT0324-0003')
    AND entry_type = 'PURCHASE_IN'
)
DELETE FROM stock_ledger WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
