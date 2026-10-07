-- ============================================================
-- Migration 152: restore 3 deleted PURCHASE_CANCEL rows on bill 0125-0428
-- ============================================================
-- Found 2026-09-24: Item Ledger showed 3 purchases (7.130 MT) for
-- CR00760 — CR 2.30 X 377 as on 31-Jan-2025, but the Purchase Bills screen
-- (filtered by item) found none.
--
-- Timeline:
--   * 2026-09-17 bill 0125-0428 (31-Jan-2025, JSW MI - SAI) imported with
--     CR0125-0075/0076/0077 as CR 2.30 X 377 (0.390 / 3.480 / 3.260).
--   * 2026-09-18 12:12 UTC Anoop removed 7 lines via Edit Bill. The
--     tr_bill_item_deleted trigger posted a PURCHASE_CANCEL for all 7
--     (confirmed present at 13:32 UTC in that day's investigation session).
--   * 2026-09-19 the same coils re-entered correctly as HR 2.30X377
--     (HR00205) on bill 0125-0429 — HR0125-0029/0030/0031, same date/qty.
--   * Some time after 13:32 UTC on 2026-09-18, the 3 CR 2.30 X 377
--     PURCHASE_CANCEL rows were deleted directly — the Item Ledger's admin
--     "Delete Selected" action (/api/stock/ledger-entries) is the only app
--     path that deletes stock_ledger rows by id. The other 4 cancels from the
--     same edit (other items, not on that item's ledger page) survived.
--
-- Result: 7.130 MT of phantom CR 2.30 X 377 stock with no bill line behind
-- it. A system-wide scan (PURCHASE_IN/CANCEL net <> 0 with no remaining
-- purchase_bill_items row) found exactly these 3 lines and nothing else.
-- Nothing else references them (no job work, dispatch, transfer, archive).
--
-- Fix: re-post the 3 reversals exactly as fn_bill_item_deleted() did.
-- Migration 153 closes the hole that allowed the deletion.
--
-- Also: item master HR00205 (HR 2.30X377) had no size, although all 3 of
-- its purchase lines carry size 2.30 X 377 (HR). The Item Ledger filters by
-- material type + the item's size, so choosing HR00205 missed its own
-- purchases. It is the only HR item with that size.
--
-- Idempotent — each cancel is only inserted while its line still nets
-- non-zero; a no-op on a blank database.
-- ============================================================

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id
)
SELECT
  'PURCHASE_CANCEL', sl.company_id, sl.warehouse_id, sl.material_type_id, sl.material_size_id,
  sl.size_label, -sl.quantity, 'purchase_bill', sl.reference_id, sl.reference_number,
  'Item removed from bill (restored by migration 152)', sl.entry_date, sl.purchase_line_id
FROM stock_ledger sl
WHERE sl.entry_type = 'PURCHASE_IN'
  AND sl.reference_id = '7a53234c-98c2-4e9f-95f7-c7cccce40abb'
  AND sl.purchase_line_id IN ('CR0125-0075', 'CR0125-0076', 'CR0125-0077')
  AND NOT EXISTS (SELECT 1 FROM purchase_bill_items pbi WHERE pbi.purchase_line_id = sl.purchase_line_id)
  AND (SELECT COALESCE(SUM(x.quantity), 0) FROM stock_ledger x
        WHERE x.purchase_line_id = sl.purchase_line_id
          AND x.entry_type IN ('PURCHASE_IN', 'PURCHASE_CANCEL')) <> 0;

UPDATE item_master
SET material_size_id = '8f9b91cb-5bd9-4d66-bb04-4597ac7f9db9'
WHERE id = '900968e3-8ece-4986-a019-4faaa45c697d'
  AND material_size_id IS NULL
  AND EXISTS (SELECT 1 FROM material_sizes WHERE id = '8f9b91cb-5bd9-4d66-bb04-4597ac7f9db9');
