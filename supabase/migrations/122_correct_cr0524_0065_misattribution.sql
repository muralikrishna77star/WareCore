-- Migration 122: correct a mis-tagged purchase_line_id and complete the
-- inter-company backfill for the remaining 4.390 MT.
--
-- Follow-up to migration 121, which reverted CR0524-0065's transfer after
-- finding that purchase line's entire 7.650 MT was sent to a job-work
-- vendor the same day it was purchased (2024-05-29) — none of it was ever
-- free to share with DS Steel Enterprises.
--
-- Re-examining Sri Sai Steels' full ledger for this exact material/size
-- (CR 0.70X121) after that revert showed a genuine, currently-unexplained
-- 4.390 MT surplus sitting there — the entire remainder of CR0624-0001
-- (purchased 7.610 MT on 2024-06-06, only 3.220 MT transferred to DS Steel
-- Enterprises so far via migration 121). That is the exact quantity, exact
-- material/size, and the exact date (2024-06-06) of the DS Steel
-- Enterprises dispatch (stock_ledger id 48a9b59f-86ab-4ca8-9f6e-75d99ff8938e,
-- reference 0624-0163) currently tagged against CR0524-0065 — a purchase
-- line bought 5 days earlier, same material/size, already fully consumed
-- elsewhere. This is almost certainly a wrong purchase-line reference
-- picked at entry time (both lines share material/size; CR0624-0001 was
-- purchased the same day as this dispatch), corrected here:
--   1. Re-tag that dispatch's ledger row to the line it actually drew
--      from, CR0624-0001.
--   2. Backfill the same informal inter-company transfer as migration 121
--      for the remaining 4.390 MT.

BEGIN;

UPDATE stock_ledger
SET purchase_line_id = 'CR0624-0001'
WHERE id = '48a9b59f-86ab-4ca8-9f6e-75d99ff8938e'
  AND purchase_line_id = 'CR0524-0065';

INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, material_size_id, size_label, quantity, reference_type, reference_number, notes, entry_date, purchase_line_id)
VALUES
  ('TRANSFER_OUT', '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2', 'd2e3f40f-8076-46fa-a3cc-f52a661972d7', 'cb0142f3-a358-4c48-8179-d1dfbc7b9921', '0.70X121', -4.390, 'transfer', 'XFER-CR0624-0001-B', 'Backfilled inter-company stock share (Sri Sai Steels -> DS Steel Enterprises) — remainder of CR0624-0001 after correcting a mis-tagged dispatch (see migration 122)', '2024-06-06', 'CR0624-0001'),
  ('TRANSFER_IN',  'b1804696-676d-465d-a5fe-e1bb214c8da3', 'c8ca6c17-e740-4525-a485-0ce962169008', 'd2e3f40f-8076-46fa-a3cc-f52a661972d7', 'cb0142f3-a358-4c48-8179-d1dfbc7b9921', '0.70X121',  4.390, 'transfer', 'XFER-CR0624-0001-B', 'Backfilled inter-company stock share (Sri Sai Steels -> DS Steel Enterprises) — remainder of CR0624-0001 after correcting a mis-tagged dispatch (see migration 122)', '2024-06-06', 'CR0624-0001');

COMMIT;
