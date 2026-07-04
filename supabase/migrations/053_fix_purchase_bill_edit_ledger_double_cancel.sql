-- ============================================================
-- WareCore WMS - Fix Purchase Bill Edit Double-Reversal
-- When editing an active bill, the save-edit route called
-- reverse_purchase_item() to insert a PURCHASE_CANCEL for each removed
-- line, then deleted the purchase_bill_items row. But migration 029
-- already added an AFTER DELETE trigger (tr_bill_item_deleted) that
-- inserts its own PURCHASE_CANCEL for every deleted row. Both fired for
-- the same removal, so every edited/replaced line posted TWO reversals
-- instead of one — understating stock by the line's quantity and
-- showing duplicate Purchase/Cancellation entries in the Item Ledger.
--
-- Fix: drop reverse_purchase_item() and its call site (src/app/api/bills/
-- [id]/save-edit/route.ts) — the trigger already reverses the deleted
-- item on its own, so no explicit call is needed.
-- ============================================================

DROP FUNCTION IF EXISTS reverse_purchase_item(uuid, uuid);

-- ============================================================
-- One-time data fix: bill 0526-0015 / line GI0526-0001 (item GI00148,
-- GI 1.15X1240) had its line edited once, which posted a duplicate
-- PURCHASE_CANCEL pair (-6.275 from reverse_purchase_item's "Edit
-- correction" note, plus -6.275 from the trigger's "Item removed from
-- bill" note) instead of a single -6.275 reversal. Remove the redundant
-- one and keep the trigger-created row.
-- ============================================================

DELETE FROM stock_ledger
WHERE id = '3457a6b3-d62c-43a2-a809-356c6a245d54'
  AND entry_type = 'PURCHASE_CANCEL'
  AND notes = 'Edit correction';
