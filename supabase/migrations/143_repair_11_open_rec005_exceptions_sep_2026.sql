-- ============================================================
-- Migration 143: repair the 11 open REC-005 (negative company-wide
-- stock) exceptions detected 2026-09-09/10 — DS Steel Enterprises
-- (fourth occurrence of the Sri Sai Steels <-> DS Steel Enterprises
-- informal sharing arrangement previously fixed in 121, 133, 140/141/142)
-- ============================================================
-- All 11 rows entered stock_ledger AFTER migration 140 ran (2026-09-08):
-- the purchase-import batch and the two job-work orders below were
-- created 2026-09-09/10, and the same root cause (dispatch/job-work forms
-- compute "available stock" without a company filter, see migration 140's
-- comment) let a new round of cross-company activity through undetected.
--
-- Two different repair techniques, chosen per-line based on whether the
-- purchase line has ANY other activity besides the one cross-company
-- outflow:
--
-- PART 1 — source reattribution (9 purchase lines / 6 exceptions):
--   GI1124-0014..0022 (bill 1124-0366, purchased 2024-11-29 under Sri Sai
--   Steels) were consumed 100% by a single DS Steel Enterprises job-work
--   order each (JW-MTVI7SNJ-01F4 or JW-MTVHFKCV-4AGY, 2024-12-04/07) with
--   NO other ledger activity on these lines at all. Since nothing else
--   depends on these rows being under Sri Sai Steels, the PURCHASE_IN
--   ledger row itself is reattributed to the company that actually used
--   the stock (company_id + warehouse_id), with an explanatory note. The
--   purchase bill and its other ~23 unrelated lines (also on bill
--   1124-0366) are left untouched — only the stock_ledger row moves, not
--   the vendor invoice.
--
-- PART 2 — transfer-leg backfill, same technique as migration 140
-- (4 exceptions, 6 outflow rows):
--   CR0724-0024, GI0824-0037, HR1124-0001 and the untracked "GA 1 X 164"
--   purchase all have an extensive chain of legitimate activity within the
--   owning company BEFORE the one cross-company outflow (vendor job-work
--   transfers, output-ins, prior sales/returns already correctly
--   attributed). Reattributing or shrinking those original PURCHASE_IN
--   rows would risk pushing the owning company's own mid-chain running
--   balance negative (e.g. CR0724-0024's same-day 2.520/2.400 vendor
--   transfers depend on the full original purchase being present). These
--   get an added TRANSFER_OUT (owner) / TRANSFER_IN (consumer) pair for
--   exactly the unbacked outflow instead, leaving all prior history as-is.
--   (GI0824-0037/EXC-000798 was explicitly deferred by migration 140
--   pending a JOB_WORK_OUTPUT_IN that hadn't posted yet — it has since
--   been posted 2026-09-10, entry_date 2024-11-20, before the 2024-11-26
--   dispatch, so this is now a plain missing-transfer case like the rest.)
--
-- EXC-000811 ("OT / Others", HRPO 2X250X1250, dispatch 1124-0544,
-- 2024-11-14, -0.180) is intentionally NOT touched here: no matching
-- inflow exists anywhere in the system, under either company, for this
-- exact item — left OPEN for manual investigation per the user's decision.
--
-- Idempotent: PART 1's UPDATE only touches rows still under Sri Sai
-- Steels with the exact expected quantities (a rerun after the company_id
-- has already changed matches zero rows). PART 2 follows migration 140's
-- own idempotency guard: every inserted row's notes carry
-- "[src:<outflow ledger id>]" and the insert is guarded by NOT EXISTS on
-- that marker.
--
-- To revert PART 1: UPDATE stock_ledger SET company_id =
-- '426a22ba-edb6-4947-b637-1ad4aab640b9', warehouse_id =
-- '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2' WHERE notes LIKE
-- '%reattributed-by-migration-143%';
-- To revert PART 2: DELETE FROM stock_ledger WHERE reference_type =
-- 'transfer' AND notes LIKE '%see migration 143%';
-- ============================================================

BEGIN;

-- ---------- PART 1: source reattribution ----------

DO $$
DECLARE
  v_n INT;
BEGIN
  SELECT count(*) INTO v_n
  FROM stock_ledger
  WHERE entry_type = 'PURCHASE_IN'
    AND company_id = '426a22ba-edb6-4947-b637-1ad4aab640b9'  -- Sri Sai Steels
    AND purchase_line_id IN (
      'GI1124-0014','GI1124-0015','GI1124-0016','GI1124-0017',
      'GI1124-0018','GI1124-0019','GI1124-0020','GI1124-0021','GI1124-0022'
    );
  IF v_n <> 9 THEN
    RAISE EXCEPTION 'Migration 143 Part 1: expected 9 PURCHASE_IN rows still under Sri Sai Steels, found % — aborting without changes', v_n;
  END IF;
END $$;

UPDATE stock_ledger
SET company_id = 'b1804696-676d-465d-a5fe-e1bb214c8da3',   -- DS Steel Enterprises
    warehouse_id = 'c8ca6c17-e740-4525-a485-0ce962169008',  -- Warehouse (DSS virtual)
    notes = format(
      'Reattributed from Sri Sai Steels to DS Steel Enterprises — this purchase line''s entire quantity (%s) was consumed by DS Steel Enterprises job work order %s with no other activity on the line; the vendor invoice (bill 1124-0366) stays recorded under Sri Sai Steels, only this stock ledger inflow moved — see migration 143 [reattributed-by-migration-143]',
      quantity,
      (SELECT reference_number FROM stock_ledger jw
       WHERE jw.purchase_line_id = stock_ledger.purchase_line_id AND jw.entry_type = 'JOB_WORK_OUT'
       LIMIT 1)
    )
WHERE entry_type = 'PURCHASE_IN'
  AND company_id = '426a22ba-edb6-4947-b637-1ad4aab640b9'
  AND purchase_line_id IN (
    'GI1124-0014','GI1124-0015','GI1124-0016','GI1124-0017',
    'GI1124-0018','GI1124-0019','GI1124-0020','GI1124-0021','GI1124-0022'
  );

-- ---------- PART 2: transfer-leg backfill (migration 140 technique) ----------

CREATE TEMP TABLE m143_src ON COMMIT DROP AS
SELECT * FROM stock_ledger
WHERE entry_type = 'SALE_OUT'
  AND id IN (
    '970f0e56-af8b-4be4-9814-1aaa001dad17', -- CR0724-0024   1124-0531  -1.852  EXC-000708
    'df3a628f-c836-4fb0-a049-b778dc6cc7c0', -- GI0824-0037   1124-0517  -2.920  EXC-000798
    'a2fc01c8-2631-4da3-b4ab-7b9ead3b33df', -- HR1124-0001   1124-0534  -1.408  EXC-000813
    '9853ffab-46ee-43f1-8676-a00cd47d169d', -- HR1124-0001   1124-0529  -0.288  EXC-000813
    'dafbcccb-0208-4169-8e86-77ebea8af64f', -- GA 1 X 164    1124-0560  -0.150  EXC-000818
    '0164bc44-7c6e-4c48-974e-2a5ce5e8710a'  -- GA 1 X 164    1124-0560  -0.730  EXC-000818
  );

DO $$
DECLARE
  v_n INT;
BEGIN
  SELECT count(*) INTO v_n FROM m143_src;
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'Migration 143 Part 2: expected 6 source outflow rows, found % — aborting without changes', v_n;
  END IF;
  IF EXISTS (
    SELECT 1 FROM m143_src
    WHERE company_id NOT IN ('b1804696-676d-465d-a5fe-e1bb214c8da3', '426a22ba-edb6-4947-b637-1ad4aab640b9')
  ) THEN
    RAISE EXCEPTION 'Migration 143 Part 2: a source row belongs to a company outside the Sri Sai / DS Steel pair — aborting';
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
  format('Backfilled inter-company stock share (%s -> %s) behind %s %s — see migration 143 [src:%s]',
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
  FROM m143_src s
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
  FROM m143_src s
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
