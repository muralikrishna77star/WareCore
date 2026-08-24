-- Migration 121: backfill 4 informal inter-company stock transfers,
-- Sri Sai Steels -> DS Steel Enterprises.
--
-- Found via a system-wide scan while investigating 2 OPEN REC-005
-- (Negative company-wide stock) exceptions: every dispatch behind both
-- negative balances was created under DS Steel Enterprises
-- (company b1804696-676d-465d-a5fe-e1bb214c8da3), but the material being
-- sold was purchased under Sri Sai Steels
-- (company 426a22ba-edb6-4947-b637-1ad4aab640b9) — a different company,
-- with its own separate warehouse. Confirmed with the user this is a real,
-- informal inter-company stock-sharing arrangement (Sri Sai Steels buys,
-- DS Steel Enterprises actually sells), never recorded as a transfer between
-- the two companies. The scan found this same shape across 5 purchase
-- lines system-wide, not just the 2 that happened to dip negative:
--
--   Line          | Qty    | Purchased (date)      | Sold under DS Steel
--   CR0424-0001   | 10.320 | Sri Sai, 2024-04-18    | 3 dispatches, Apr-Aug 2024
--   CR0624-0001   |  3.220 | Sri Sai, 2024-06-06    | 1 dispatch,  2024-07-22
--   CR0624-0011   | 14.930 | Sri Sai, 2024-06-26    | 4 dispatches, Aug 2024
--   GI0424-0001   |  0.732 | Sri Sai, 2024-04-23    | 1 dispatch,  2024-04-23
--
-- A 5th line, CR0524-0065 (4.390, DS Steel dispatch dated 2024-06-06), was
-- INITIALLY included here and then reverted (applied, found wrong, deleted
-- again in the same session) once full per-company/material/size history
-- (not filtered by purchase_line_id, which hides pre-118 untagged rows)
-- showed Sri Sai Steels sent the ENTIRE 7.650 purchased on this line to a
-- job-work vendor the SAME DAY it was bought (JW-MRSZIRGC-2NEV) — none of
-- it was ever free to share. The DS Steel Enterprises dispatch citing this
-- purchase line is unexplained (DS Steel has never purchased this exact
-- material/size itself) and needs separate manual investigation — logged,
-- not backfilled here. Lesson: numbers balancing is not the same as numbers
-- being true — check what ELSE happened to the source line before assuming
-- a clean share, same as the earlier GI00069 date-logic lesson this
-- session.
--
-- The app's dedicated company-to-company "Transfers" feature (transfers/
-- transfer_items tables, /transfers screen) turned out to be non-functional
-- for this — transfers.reference_number is NOT NULL with no default/
-- generator anywhere (frontend doesn't supply one either), and the table
-- has zero rows in production, confirming it's never successfully been
-- used. Rather than fix that unrelated pre-existing gap under this task,
-- this backfills the same net effect directly into stock_ledger — same
-- technique as migration 101's missed-transfer backfill — dated on each
-- purchase's own date (before every affected dispatch), so the running
-- balance at DS Steel Enterprises never dips negative and Sri Sai Steels'
-- balance correctly reflects the material having moved on.
--
-- Verified before writing (and re-verified after the CR0524-0065 revert,
-- against each line's FULL company/material/size ledger history, not just
-- rows tagged with that purchase_line_id): subtracting each of these 4
-- quantities from Sri Sai Steels' own balance does not produce any new
-- negative balance there.

BEGIN;

-- CR0424-0001 — 10.320, transfer date 2024-04-18
INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, material_size_id, size_label, quantity, reference_type, reference_number, notes, entry_date, purchase_line_id)
VALUES
  ('TRANSFER_OUT', '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2', 'd2e3f40f-8076-46fa-a3cc-f52a661972d7', '2c4f3d6f-6eea-431b-82f9-01fe39376b53', '0.90X121', -10.320, 'transfer', 'XFER-CR0424-0001', 'Backfilled inter-company stock share (Sri Sai Steels -> DS Steel Enterprises) — see migration 121', '2024-04-18', 'CR0424-0001'),
  ('TRANSFER_IN',  'b1804696-676d-465d-a5fe-e1bb214c8da3', 'c8ca6c17-e740-4525-a485-0ce962169008', 'd2e3f40f-8076-46fa-a3cc-f52a661972d7', '2c4f3d6f-6eea-431b-82f9-01fe39376b53', '0.90X121',  10.320, 'transfer', 'XFER-CR0424-0001', 'Backfilled inter-company stock share (Sri Sai Steels -> DS Steel Enterprises) — see migration 121', '2024-04-18', 'CR0424-0001');

-- CR0524-0065 deliberately NOT included — see header note above.

-- CR0624-0001 — 3.220, transfer date 2024-06-06
INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, material_size_id, size_label, quantity, reference_type, reference_number, notes, entry_date, purchase_line_id)
VALUES
  ('TRANSFER_OUT', '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2', 'd2e3f40f-8076-46fa-a3cc-f52a661972d7', 'cb0142f3-a358-4c48-8179-d1dfbc7b9921', '0.70X121', -3.220, 'transfer', 'XFER-CR0624-0001', 'Backfilled inter-company stock share (Sri Sai Steels -> DS Steel Enterprises) — see migration 121', '2024-06-06', 'CR0624-0001'),
  ('TRANSFER_IN',  'b1804696-676d-465d-a5fe-e1bb214c8da3', 'c8ca6c17-e740-4525-a485-0ce962169008', 'd2e3f40f-8076-46fa-a3cc-f52a661972d7', 'cb0142f3-a358-4c48-8179-d1dfbc7b9921', '0.70X121',  3.220, 'transfer', 'XFER-CR0624-0001', 'Backfilled inter-company stock share (Sri Sai Steels -> DS Steel Enterprises) — see migration 121', '2024-06-06', 'CR0624-0001');

-- CR0624-0011 — 14.930, transfer date 2024-06-26
INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, material_size_id, size_label, quantity, reference_type, reference_number, notes, entry_date, purchase_line_id)
VALUES
  ('TRANSFER_OUT', '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2', 'd2e3f40f-8076-46fa-a3cc-f52a661972d7', 'b870d53e-c50b-4591-9df5-abc5805c5575', '1 X 121 =4Coils', -14.930, 'transfer', 'XFER-CR0624-0011', 'Backfilled inter-company stock share (Sri Sai Steels -> DS Steel Enterprises) — see migration 121', '2024-06-26', 'CR0624-0011'),
  ('TRANSFER_IN',  'b1804696-676d-465d-a5fe-e1bb214c8da3', 'c8ca6c17-e740-4525-a485-0ce962169008', 'd2e3f40f-8076-46fa-a3cc-f52a661972d7', 'b870d53e-c50b-4591-9df5-abc5805c5575', '1 X 121 =4Coils',  14.930, 'transfer', 'XFER-CR0624-0011', 'Backfilled inter-company stock share (Sri Sai Steels -> DS Steel Enterprises) — see migration 121', '2024-06-26', 'CR0624-0011');

-- GI0424-0001 — 0.732, transfer date 2024-04-23
INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, material_size_id, size_label, quantity, reference_type, reference_number, notes, entry_date, purchase_line_id)
VALUES
  ('TRANSFER_OUT', '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2', 'cd18bd17-6f05-44ab-a59d-486d0562131b', '8ecff809-81e5-4e9a-8552-45eb56f8fe5b', '0.80XPatty', -0.732, 'transfer', 'XFER-GI0424-0001', 'Backfilled inter-company stock share (Sri Sai Steels -> DS Steel Enterprises) — see migration 121', '2024-04-23', 'GI0424-0001'),
  ('TRANSFER_IN',  'b1804696-676d-465d-a5fe-e1bb214c8da3', 'c8ca6c17-e740-4525-a485-0ce962169008', 'cd18bd17-6f05-44ab-a59d-486d0562131b', '8ecff809-81e5-4e9a-8552-45eb56f8fe5b', '0.80XPatty',  0.732, 'transfer', 'XFER-GI0424-0001', 'Backfilled inter-company stock share (Sri Sai Steels -> DS Steel Enterprises) — see migration 121', '2024-04-23', 'GI0424-0001');

COMMIT;
