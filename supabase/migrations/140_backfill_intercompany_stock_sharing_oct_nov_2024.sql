-- ============================================================
-- Migration 140: backfill 29 informal inter-company stock transfers,
-- Sri Sai Steels <-> DS Steel Enterprises, Oct-Nov 2024
-- (third occurrence of the arrangement fixed in 121 and 133)
-- ============================================================
-- Found while investigating the 19 OPEN REC-005 (negative company-wide
-- stock) exceptions of 2026-09-08 — EXC-000695/699/700/701/702/704/705/706/
-- 707/708/709/712/750/755/757/761/795/796/798. Every one has the same
-- shape as 121/133: a dispatch (or job-work order) entered under one
-- company draws on stock that was purchased — or produced by job work —
-- under the OTHER company, with no inter-company transfer ever recorded:
--
--   * 18 x Sri Sai Steels (426a22ba...) bought / produced it,
--         DS Steel Enterprises (b1804696...) sold it (Oct 8 - Nov 22, 2024)
--   *  1 x DS Steel Enterprises bought it (HR1124-0001),
--         Sri Sai Steels sent it to job work (JW-MTLC7BB1-4149, Nov 10)
--
-- Plus 2 more of the same shape that never dipped negative (Over width,
-- OT0324-0001 — 1024-0375/0376, 2024-10-03) — DS Steel's negative balance
-- for that item is already covered by the IGNORED exception EXC-000326,
-- whose resolution note records the owner's confirmation (2026-08-08) that
-- "Sri Sai Steels and DS Steel Enterprises intentionally share inventory".
--
-- Root cause (not fixed here — see the session summary / memory): the
-- dispatch and job-work forms compute "available stock" from EVERY
-- company's stock_ledger rows keyed only by purchase line / material
-- (STOCK_LEDGER_LINE_QUANTITIES_QUERY has no company filter), so a DS Steel
-- dispatch can pick a Sri Sai purchase line and vice versa. Confirmed with
-- the business as a real, informal arrangement — not a wrong-company entry:
-- e.g. invoice 1024-0431 mixes DS Steel's own OT0924-0001 with Sri Sai's
-- CR0924-0048 and Sri Sai's job-work output on one invoice.
--
-- Technique: one TRANSFER_OUT (owner company, its virtual warehouse) +
-- TRANSFER_IN (consuming company, the outflow row's own warehouse) pair per
-- consuming outflow row, for exactly that row's quantity, dated on the
-- outflow's own entry_date. Unlike 121/133 (which dated the transfer on
-- the purchase date and moved whole lines), this moves only what was
-- actually consumed, when it was consumed — several of these purchase
-- lines are only partly used by the other company (e.g. CC1124-0002:
-- 7.060 bought, 2.306 sold by DS Steel, 4.754 still Sri Sai's).
--
-- Same-day ordering: fn_reconcile_rec_005, fn_stock_movement_history and
-- the Item Stock Ledger report all tie-break same-date rows by quantity
-- DESC, so the positive TRANSFER_IN always sorts before the negative
-- SALE_OUT it feeds. For the report views / diagnosis queries that order
-- by created_at alone, each pair's created_at is set to one second before
-- its outflow row's created_at, so no view ever shows a momentary dip.
--
-- Verified before writing (see the session's sim.sql): with these 58 rows
-- added, every affected (company, material, size) scope's running minimum
-- is >= 0 for both companies, except "1 X 500" at Sri Sai Steels which ends
-- at -0.001 — DS Steel sold 4.621 of an output recorded as 4.620, a 1 kg
-- weighbridge rounding difference, below REC-005's 0.001 tolerance and not
-- something this migration should paper over.
--
-- Deliberately NOT included (need a human decision first):
--   * 1124-0517 / GI0824-0037 (EXC-000798, 2.920 on 2024-11-26): Sri Sai's
--     warehouse balance for 0.90X1350 is 0 — the material is still at the
--     job-work vendor (JW-MTB42YWL-MT4Z, 5.404 pending), so this was really
--     a vendor-direct sale invoiced by DS Steel and needs a virtual return
--     posted first, not just a transfer.
--   * "0.90 X 120.50" (CR0924-0017/0018 vs CR1024-0025/0026): a symmetric
--     2 x 1.100 swap in both directions, most likely two wrong-line picks
--     of identical coils rather than a genuine share.
--
-- Idempotent: every inserted row's notes carry "[src:<outflow ledger id>]"
-- and the insert is guarded by NOT EXISTS on that marker, so re-running is
-- a no-op. To revert:  DELETE FROM stock_ledger WHERE reference_type =
-- 'transfer' AND notes LIKE '%see migration 140%';
-- ============================================================

BEGIN;

CREATE TEMP TABLE m140_src ON COMMIT DROP AS
SELECT *
FROM stock_ledger
WHERE entry_type IN ('SALE_OUT', 'JOB_WORK_OUT')
  AND id IN (
    -- Over width (OT0324-0001), Sri Sai -> DS Steel, 2024-10-03
    '92dd077e-2dbf-4d2e-8322-c3fb023b8174', -- 1024-0375  -3.340
    'd8970198-b5da-4a3a-be2c-a0d6a1d6f0f9', -- 1024-0376  -0.540
    -- 2024-10-08, invoice 1024-0431
    '319fad03-c082-48e4-b041-f87521b5cd0a', -- 2.80X150 (6Nos) job-work output  -5.370
    '560e9f57-ad08-4ab7-885a-67c5bbe4efb7', -- 1X121 (11 Nos) CR0924-0048       -3.410
    -- 2024-10-09, invoices 1024-0432 / 1024-0433
    '410659fb-1593-4a7a-9cb2-42e621e60e16', -- 2.60X150 (3Nos) job-work output  -2.526
    'd552edc2-75a8-4950-8342-e777a9104384', -- 2.80X150 (6Nos) job-work output  -2.540
    '6a91dfdd-54b1-46d2-9ee7-5f9af260f036', -- 2.70X170 (1No)  HR1024-0003      -1.164
    'a7a9c3c9-eab5-409a-8457-2316a1547d31', -- 1X121 (11 Nos)  CR0924-0048      -3.610
    '1258b38f-ac34-4ee6-bff5-24df884615f4', -- Bottom          OT1024-0001      -0.695
    -- 2024-10-19, invoices 1024-0439 / 1024-0442
    'fe40678d-92ad-45dd-baca-29b5fb1436f6', -- 1.80X1260  CR0724-0024  -0.195
    '7e5e3631-0f15-4d72-89bf-46cea5bf2643', -- 2.25X1200  CR0524-0015  -3.745
    'f20897c1-9a12-47a2-be98-a536cd7988ee', -- 1.20X1175  CR1024-0012  -1.000
    -- 2024-10-23 / 10-24 / 10-26
    'a35bed8c-6958-4ac0-8b7e-ffcd355adae1', -- 1024-0455  0.90X121 Cthro - 6 Coil output  -0.980
    '0af96e23-7bad-4c65-8452-52b31d55ad67', -- 1024-0418  1.50X1452  GI1024-0020        -10.510
    '79d1550a-bf7f-4a3b-9c40-7353e2470cdb', -- 1024-0447  1.20X1175  CR1024-0012         -0.558
    '2e2c4f13-9c16-4519-8b81-0e3aefd858be', -- 1024-0448  1X1250     CR1024-0021         -5.110
    -- 2024-11-05 / 11-07
    '19ea662c-8078-44a6-ad90-06807b89719b', -- 1124-0469  Bottom  OT1024-0001                    -0.764
    '28f1e561-d3b2-460d-9928-81de7e853151', -- JW-MTLEJE4Z-Q9E8 JOB_WORK_OUT 1.20X1175 CR1024-0012 -0.137
    -- 2024-11-09, invoice 1124-0477
    'f3a341d6-c618-481d-be59-828b29e5567f', -- Other Materials (no size) OT1124-0004  -0.215
    '281505db-a959-4ec2-b6e5-b7c82d6eaeaa', -- 1 X 1055 job-work output               -4.000
    '9fbf51c8-7812-484c-8665-044921c29c88', -- Bottom  OT1024-0001                     -0.335
    -- 2024-11-12 / 11-13, invoices 1124-0481 / 1124-0482
    '0f211578-799c-4cb4-ab6d-51a100eb46d8', -- 1 X 500  job-work output  -2.028
    'f67baa28-85f3-47ae-8bc4-144af6380afa', -- 1.80X1260 CR0724-0024     -0.308
    'edd76e3f-85bb-4daa-a7e5-20a2498f7354', -- 1 X 160  job-work output  -0.730
    'a577547b-676e-404d-a666-52f1e1508a5a', -- 1 X 500  job-work output  -0.843
    '9d806ac3-4970-4bac-a7fe-26e7805f0c10', -- 1 X 500  job-work output  -1.750
    -- 2024-11-22, invoices 1124-0504 / 1124-0505
    'b992840f-4224-4349-8942-0ff20521dd17', -- 0.80X121 (14COils) CC1124-0001  -5.110
    '899cfee4-c880-4f03-8820-6bcc7f99f57e', -- 0.80X121 (15Coils) CC1124-0002  -2.306
    -- DS Steel -> Sri Sai (reverse direction), 2024-11-10
    '9074abf2-e561-4f52-87d4-8f316a6d184e'  -- JW-MTLC7BB1-4149 JOB_WORK_OUT 2.80X150 (7Nos) HR1124-0001  -2.120
  );

DO $$
DECLARE
  v_n INT;
BEGIN
  SELECT count(*) INTO v_n FROM m140_src;
  IF v_n <> 29 THEN
    RAISE EXCEPTION 'Migration 140: expected 29 source outflow rows, found % — aborting without changes', v_n;
  END IF;
  IF EXISTS (
    SELECT 1 FROM m140_src
    WHERE company_id NOT IN ('b1804696-676d-465d-a5fe-e1bb214c8da3', '426a22ba-edb6-4947-b637-1ad4aab640b9')
  ) THEN
    RAISE EXCEPTION 'Migration 140: a source row belongs to a company outside the Sri Sai / DS Steel pair — aborting';
  END IF;
END $$;

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id, size_label,
  quantity, reference_type, reference_number, notes, entry_date, created_at,
  purchase_line_id, sub_purchase_line_id
)
SELECT
  p.entry_type, p.company_id, p.warehouse_id, p.material_type_id, p.material_size_id, p.size_label,
  p.quantity, 'transfer', p.reference_number,
  format('Backfilled inter-company stock share (%s -> %s) behind %s %s — see migration 140 [src:%s]',
         p.owner_name, p.consumer_name, p.src_entry_type, p.src_reference, p.src_id),
  p.entry_date, p.created_at,
  p.purchase_line_id, p.sub_purchase_line_id
FROM (
  -- Owner side: stock leaves the company that bought / produced it.
  SELECT
    'TRANSFER_OUT' AS entry_type,
    oc.id AS company_id,
    CASE WHEN oc.id = '426a22ba-edb6-4947-b637-1ad4aab640b9'
         THEN '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2'::uuid   -- Warehouse (SSS Virtual)
         ELSE 'c8ca6c17-e740-4525-a485-0ce962169008'::uuid   -- Warehouse (DSS virtual)
    END AS warehouse_id,
    s.material_type_id, s.material_size_id, s.size_label,
    s.quantity AS quantity,                    -- outflow rows are negative already
    'XFER-' || s.reference_number AS reference_number,
    s.entry_date,
    s.created_at - INTERVAL '1 second' AS created_at,
    s.purchase_line_id, s.sub_purchase_line_id,
    oc.name AS owner_name, cc.name AS consumer_name,
    s.entry_type AS src_entry_type, s.reference_number AS src_reference, s.id AS src_id
  FROM m140_src s
  JOIN companies cc ON cc.id = s.company_id
  JOIN companies oc ON oc.id = CASE WHEN s.company_id = 'b1804696-676d-465d-a5fe-e1bb214c8da3'
                                    THEN '426a22ba-edb6-4947-b637-1ad4aab640b9'::uuid
                                    ELSE 'b1804696-676d-465d-a5fe-e1bb214c8da3'::uuid END
  UNION ALL
  -- Consumer side: stock arrives at the company that actually sold / used it.
  SELECT
    'TRANSFER_IN',
    s.company_id,
    s.warehouse_id,
    s.material_type_id, s.material_size_id, s.size_label,
    -s.quantity,
    'XFER-' || s.reference_number,
    s.entry_date,
    s.created_at - INTERVAL '1 second',
    s.purchase_line_id, s.sub_purchase_line_id,
    oc.name, cc.name,
    s.entry_type, s.reference_number, s.id
  FROM m140_src s
  JOIN companies cc ON cc.id = s.company_id
  JOIN companies oc ON oc.id = CASE WHEN s.company_id = 'b1804696-676d-465d-a5fe-e1bb214c8da3'
                                    THEN '426a22ba-edb6-4947-b637-1ad4aab640b9'::uuid
                                    ELSE 'b1804696-676d-465d-a5fe-e1bb214c8da3'::uuid END
) p
WHERE NOT EXISTS (
  SELECT 1 FROM stock_ledger x
  WHERE x.reference_type = 'transfer'
    AND x.entry_type = p.entry_type
    AND x.notes LIKE '%[src:' || p.src_id::text || ']%'
);

COMMIT;
