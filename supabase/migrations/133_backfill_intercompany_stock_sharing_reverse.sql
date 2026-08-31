-- ============================================================
-- Migration 133: backfill 9 informal inter-company stock transfers,
-- DS Steel Enterprises -> Sri Sai Steels (reverse direction of 121)
-- ============================================================
-- Found while investigating 7 OPEN REC-005 (negative company-wide stock)
-- exceptions, all tracing to job work order JW-MTCLW4RK-9WVT: every one
-- of its 9 lines is tagged with a purchase_line_id from purchase bill
-- 1024-0320 (2024-10-13), and every one of those lines has its own
-- correctly-posted PURCHASE_IN — but bill 1024-0320 was recorded under
-- DS Steel Enterprises (company b1804696-676d-465d-a5fe-e1bb214c8da3),
-- while JW-MTCLW4RK-9WVT (the order that actually consumed the material,
-- sent it to job work, transferred it, and eventually sold it) belongs to
-- Sri Sai Steels (company 426a22ba-edb6-4947-b637-1ad4aab640b9). Same
-- informal stock-sharing arrangement already confirmed with the user and
-- fixed for the opposite direction in 121
-- (121_backfill_intercompany_stock_sharing.sql) — DS Steel purchased,
-- Sri Sai Steels actually used and sold it, never recorded as a transfer
-- between the two companies.
--
-- All 9 lines are on the same bill/date, so backfilled as one batch
-- rather than 121's per-line commentary; same technique (a same-day
-- TRANSFER_OUT/TRANSFER_IN pair per line, dated on the purchase date —
-- 2024-10-13, the same day as JW-MTCLW4RK-9WVT's own JOB_WORK_OUT
-- postings — safe because fn_reconcile_rec_005's tie-break on a shared
-- entry_date is quantity DESC, so the positive TRANSFER_IN always sorts
-- ahead of any negative same-day OUT regardless of created_at).
-- Transferred quantity is each line's full purchased amount (not the
-- job-work quantity_sent, which for one line — CR1024-0002 — is 0.003
-- less than what was purchased; a normal weighbridge/rounding variance,
-- not something this migration needs to resolve).
--
-- Verified before writing, against each material's FULL company/size
-- history (not just rows tagged with these purchase_line_ids, same
-- discipline as 121): subtracting each of these 9 quantities from DS
-- Steel Enterprises' own balance for that material/size does not produce
-- any new negative balance there — DS Steel has no other recorded activity
-- for any of these 9 material/size scopes at all.
--
-- Idempotent — guarded by NOT EXISTS on (reference_number, entry_type),
-- safe to re-run.
-- ============================================================

BEGIN;

INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, material_size_id, size_label, quantity, reference_type, reference_number, notes, entry_date, purchase_line_id)
SELECT v.entry_type, v.company_id::uuid, v.warehouse_id::uuid, v.material_type_id::uuid, v.material_size_id::uuid, v.size_label, v.quantity::numeric,
       'transfer', v.reference_number, 'Backfilled inter-company stock share (DS Steel Enterprises -> Sri Sai Steels) — see migration 133', '2024-10-13'::date, v.purchase_line_id
FROM (VALUES
  ('TRANSFER_OUT', 'b1804696-676d-465d-a5fe-e1bb214c8da3', 'c8ca6c17-e740-4525-a485-0ce962169008', 'd2e3f40f-8076-46fa-a3cc-f52a661972d7', '43932572-f82c-4297-be30-c267222ceaa9', '1 X 1640X2040', '-0.313', 'XFER-CR1024-0002', 'CR1024-0002'),
  ('TRANSFER_IN',  '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2', 'd2e3f40f-8076-46fa-a3cc-f52a661972d7', '43932572-f82c-4297-be30-c267222ceaa9', '1 X 1640X2040', '0.313',  'XFER-CR1024-0002', 'CR1024-0002'),
  ('TRANSFER_OUT', 'b1804696-676d-465d-a5fe-e1bb214c8da3', 'c8ca6c17-e740-4525-a485-0ce962169008', 'd2e3f40f-8076-46fa-a3cc-f52a661972d7', '6353c168-5734-4d37-b2f0-0e4789d3a573', '0.70X1600X820', '-0.365', 'XFER-CR1024-0003', 'CR1024-0003'),
  ('TRANSFER_IN',  '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2', 'd2e3f40f-8076-46fa-a3cc-f52a661972d7', '6353c168-5734-4d37-b2f0-0e4789d3a573', '0.70X1600X820', '0.365',  'XFER-CR1024-0003', 'CR1024-0003'),
  ('TRANSFER_OUT', 'b1804696-676d-465d-a5fe-e1bb214c8da3', 'c8ca6c17-e740-4525-a485-0ce962169008', 'd2e3f40f-8076-46fa-a3cc-f52a661972d7', 'b77ce6d1-8d23-4c54-945d-c34e7988d1d5', '1 X 340X1990', '-0.584', 'XFER-CR1024-0004', 'CR1024-0004'),
  ('TRANSFER_IN',  '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2', 'd2e3f40f-8076-46fa-a3cc-f52a661972d7', 'b77ce6d1-8d23-4c54-945d-c34e7988d1d5', '1 X 340X1990', '0.584',  'XFER-CR1024-0004', 'CR1024-0004'),
  ('TRANSFER_OUT', 'b1804696-676d-465d-a5fe-e1bb214c8da3', 'c8ca6c17-e740-4525-a485-0ce962169008', '84418b20-4148-488c-a57f-cebbf249f08a', '8216570b-ad3a-4e91-a959-dc894e5cc2c1', '0.90X1200', '-3.720', 'XFER-GA1024-0001', 'GA1024-0001'),
  ('TRANSFER_IN',  '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2', '84418b20-4148-488c-a57f-cebbf249f08a', '8216570b-ad3a-4e91-a959-dc894e5cc2c1', '0.90X1200', '3.720',  'XFER-GA1024-0001', 'GA1024-0001'),
  ('TRANSFER_OUT', 'b1804696-676d-465d-a5fe-e1bb214c8da3', 'c8ca6c17-e740-4525-a485-0ce962169008', '84418b20-4148-488c-a57f-cebbf249f08a', '8216570b-ad3a-4e91-a959-dc894e5cc2c1', '0.90X1200', '-3.500', 'XFER-GA1024-0002', 'GA1024-0002'),
  ('TRANSFER_IN',  '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2', '84418b20-4148-488c-a57f-cebbf249f08a', '8216570b-ad3a-4e91-a959-dc894e5cc2c1', '0.90X1200', '3.500',  'XFER-GA1024-0002', 'GA1024-0002'),
  ('TRANSFER_OUT', 'b1804696-676d-465d-a5fe-e1bb214c8da3', 'c8ca6c17-e740-4525-a485-0ce962169008', '84418b20-4148-488c-a57f-cebbf249f08a', '496148d4-6be7-49fd-8416-129b9b4eb0aa', '1.20X1255', '-0.310', 'XFER-GA1024-0003', 'GA1024-0003'),
  ('TRANSFER_IN',  '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2', '84418b20-4148-488c-a57f-cebbf249f08a', '496148d4-6be7-49fd-8416-129b9b4eb0aa', '1.20X1255', '0.310',  'XFER-GA1024-0003', 'GA1024-0003'),
  ('TRANSFER_OUT', 'b1804696-676d-465d-a5fe-e1bb214c8da3', 'c8ca6c17-e740-4525-a485-0ce962169008', '84418b20-4148-488c-a57f-cebbf249f08a', '7cd9a448-186e-4dc0-b7f4-690490184969', '0.65X1490', '-1.760', 'XFER-GA1024-0004', 'GA1024-0004'),
  ('TRANSFER_IN',  '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2', '84418b20-4148-488c-a57f-cebbf249f08a', '7cd9a448-186e-4dc0-b7f4-690490184969', '0.65X1490', '1.760',  'XFER-GA1024-0004', 'GA1024-0004'),
  ('TRANSFER_OUT', 'b1804696-676d-465d-a5fe-e1bb214c8da3', 'c8ca6c17-e740-4525-a485-0ce962169008', '84418b20-4148-488c-a57f-cebbf249f08a', '7cd9a448-186e-4dc0-b7f4-690490184969', '0.65X1490', '-0.930', 'XFER-GA1024-0005', 'GA1024-0005'),
  ('TRANSFER_IN',  '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2', '84418b20-4148-488c-a57f-cebbf249f08a', '7cd9a448-186e-4dc0-b7f4-690490184969', '0.65X1490', '0.930',  'XFER-GA1024-0005', 'GA1024-0005'),
  ('TRANSFER_OUT', 'b1804696-676d-465d-a5fe-e1bb214c8da3', 'c8ca6c17-e740-4525-a485-0ce962169008', '84418b20-4148-488c-a57f-cebbf249f08a', '401827e3-8a52-4dff-b92b-33c140a725f8', '0.70X1205', '-0.510', 'XFER-GA1024-0006', 'GA1024-0006'),
  ('TRANSFER_IN',  '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2', '84418b20-4148-488c-a57f-cebbf249f08a', '401827e3-8a52-4dff-b92b-33c140a725f8', '0.70X1205', '0.510',  'XFER-GA1024-0006', 'GA1024-0006')
) AS v(entry_type, company_id, warehouse_id, material_type_id, material_size_id, size_label, quantity, reference_number, purchase_line_id)
WHERE NOT EXISTS (
  SELECT 1 FROM stock_ledger sl
  WHERE sl.reference_number = v.reference_number AND sl.entry_type = v.entry_type AND sl.reference_type = 'transfer'
);

COMMIT;
