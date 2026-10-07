-- ============================================================
-- Migration 155: repair the open Data Integrity exceptions of 2026-10-02
-- (14 REC-005 + 1 REC-009 + 2 REC-018 on the 2026-09-28 scan, plus one
-- REC-005 that appeared after it)
-- ============================================================
-- Four root causes, one PART each. EXC-000811 (OT "Others", dispatch
-- 1124-0544, -0.180) is deliberately NOT touched — still no matching inflow
-- anywhere, left OPEN for manual investigation (see migration 143).
-- EXC-001050 (HR, NULL size, -5.380) already stopped firing after
-- migration 154 gave HR00206 its size.
--
-- PART 1 — source reattribution, 20 purchase lines (migration 143/144
--   technique; sixth occurrence of the Sri Sai Steels <-> DS Steel
--   Enterprises sharing arrangement). Bills 1224-0380 / 1224-0387 /
--   1224-0388 were purchased under Sri Sai Steels; DS Steel job-work orders
--   JW-MTWTIH5N-BU2Z, JW-MTWTN4HT-V2ML, JW-MTWV7RKP-TT3Q, JW-MTWVC1C5-XOJO
--   and JW-MTWW3MEU-F0RN (all entered 2026-09-11, before the cross-company
--   picker warning reached that user's browser) consumed these lines 100%,
--   and every later return / vendor transfer / sale on them is also DS
--   Steel. Sri Sai Steels has nothing on these lines but the PURCHASE_IN, so
--   that row moves to DS Steel; the bills themselves stay under Sri Sai.
--   Fixes EXC-000828..000835, 000837, 000838.
--
-- PART 2 — transfer legs for CR1224-0031 (migration 140/143 technique).
--   Mixed usage, so it can't be reattributed: purchased by Sri Sai, sent to
--   job work by DS Steel (JW-MTWTIH5N-BU2Z, 6.985), output received back
--   by DS Steel 2025-01-06, then sold by BOTH companies — Sri Sai 6.089 in
--   four sales, DS Steel 0.872. One pair per consuming outflow: Sri Sai ->
--   DS Steel behind the job-work dispatch, DS Steel -> Sri Sai behind each
--   of Sri Sai's four sales. Fixes EXC-000836.
--
-- PART 3 — remove two stale backfilled transfer pairs. Migrations 140/143
--   bridged dispatches 1024-0455 and 1124-0560 with Sri Sai -> DS Steel
--   transfers because they were invoiced under DS Steel. Both dispatches
--   have since been re-saved under Sri Sai Steels (2026-09-30 / 2026-09-26),
--   so the SALE_OUT the pair was written for no longer exists and Sri Sai
--   now sells its own stock directly — the pair double-counts (Sri Sai
--   short, DS Steel holding phantom stock). Fixes EXC-001051 and the new
--   CS "0.90X121 Cthro - 6 Coil" -0.980. The 6 other backfilled dispatches
--   whose source row was re-created by an edit are still under DS Steel
--   and their pairs remain correct — not touched.
--
-- PART 4 — HR job work JW-MU6VHLCZ-HG9W (EXC-001064 REC-009,
--   EXC-001065/001066 REC-018):
--   a. HR0125-0030 was removed from this order via Edit Order 2026-09-26
--      11:35, which correctly posted a JOB_WORK_CANCEL +3.480 — but the
--      order's original JOB_WORK_OUT -3.480 for the line was later deleted
--      by hand (Item Ledger "Delete Selected", before migration 153's guard
--      existed). The line now lives on JW-MUIBGNOV-GQGN with its own OUT, so
--      the orphan CANCEL is 3.480 of phantom warehouse stock / negative
--      vendor stock. It is removed (archived to stock_ledger_deletions).
--   b. HR00205/HR00206 had no size when these job-work lines were entered,
--      so the lines and their ledger rows carry size_label NULL (migration
--      154 fixed material_size_id only). REC-018 matches vendor stock by
--      size_label text, so the ledger side never met the job_work_items
--      side. size_label is filled from material_sizes wherever it is NULL
--      but material_size_id is set (system-wide this is exactly these rows).
--      A size_label-only UPDATE posts nothing from fn_job_work_item_to_ledger.
--
-- Idempotent: PART 1 only matches rows still under Sri Sai; PART 2 is
-- guarded by NOT EXISTS on its [src:<id>] marker; PART 3 / 4a delete rows
-- that are gone on a rerun; PART 4b only touches NULL size_labels.
--
-- To revert:
--   PART 1: UPDATE stock_ledger SET company_id =
--     '426a22ba-edb6-4947-b637-1ad4aab640b9', warehouse_id =
--     '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2' WHERE notes LIKE
--     '%reattributed-by-migration-155%';
--   PART 2: DELETE FROM stock_ledger WHERE reference_type = 'transfer' AND
--     notes LIKE '%see migration 155%';
--   PART 3 / 4a: re-insert from stock_ledger_deletions WHERE deleted_at is
--     this migration's run (the full row is in ledger_row).
-- ============================================================

BEGIN;

-- ---------- PART 1: source reattribution ----------

CREATE TEMP TABLE m155_lines (purchase_line_id TEXT PRIMARY KEY) ON COMMIT DROP;
INSERT INTO m155_lines VALUES
  ('CR1224-0035'),('CR1224-0036'),('CR1224-0037'),('CR1224-0040'),('CR1224-0042'),
  ('CR1224-0044'),('CR1224-0046'),('CR1224-0067'),('CR1224-0068'),('CR1224-0069'),
  ('CR1224-0070'),('CR1224-0071'),('CR1224-0072'),('CR1224-0076'),('CR1224-0077'),
  ('CR1224-0078'),('CR1224-0079'),('CR1224-0080'),('CR1224-0081'),('CR1224-0082');

DO $$
DECLARE
  v_n INT;
BEGIN
  SELECT count(*) INTO v_n
  FROM stock_ledger
  WHERE entry_type = 'PURCHASE_IN'
    AND company_id = '426a22ba-edb6-4947-b637-1ad4aab640b9'  -- Sri Sai Steels
    AND purchase_line_id IN (SELECT purchase_line_id FROM m155_lines);
  -- 0 = already applied (rerun); anything else but 20 means the data moved.
  IF v_n NOT IN (0, 20) THEN
    RAISE EXCEPTION 'Migration 155 Part 1: expected 20 PURCHASE_IN rows still under Sri Sai Steels, found % — aborting without changes', v_n;
  END IF;
  IF EXISTS (
    SELECT 1 FROM stock_ledger
    WHERE company_id = '426a22ba-edb6-4947-b637-1ad4aab640b9'
      AND entry_type <> 'PURCHASE_IN'
      AND purchase_line_id IN (SELECT purchase_line_id FROM m155_lines)
  ) THEN
    RAISE EXCEPTION 'Migration 155 Part 1: Sri Sai Steels now has other activity on these lines — reattribution no longer safe, aborting';
  END IF;
END $$;

UPDATE stock_ledger
SET company_id = 'b1804696-676d-465d-a5fe-e1bb214c8da3',   -- DS Steel Enterprises
    warehouse_id = 'c8ca6c17-e740-4525-a485-0ce962169008',  -- Warehouse (DSS virtual)
    notes = format(
      'Reattributed from Sri Sai Steels to DS Steel Enterprises — this purchase line''s entire quantity (%s) was consumed by DS Steel Enterprises job work order %s with no other activity under Sri Sai Steels; the vendor invoice (bill %s) stays recorded under Sri Sai Steels, only this stock ledger inflow moved — see migration 155 [reattributed-by-migration-155]',
      quantity,
      (SELECT reference_number FROM stock_ledger jw
       WHERE jw.purchase_line_id = stock_ledger.purchase_line_id AND jw.entry_type = 'JOB_WORK_OUT'
       ORDER BY jw.created_at LIMIT 1),
      reference_number
    )
WHERE entry_type = 'PURCHASE_IN'
  AND company_id = '426a22ba-edb6-4947-b637-1ad4aab640b9'
  AND purchase_line_id IN (SELECT purchase_line_id FROM m155_lines);

-- ---------- PART 2: transfer legs for CR1224-0031 ----------

CREATE TEMP TABLE m155_src ON COMMIT DROP AS
SELECT * FROM stock_ledger
WHERE purchase_line_id = 'CR1224-0031'
  AND id IN (
    '8f57b608-83db-493d-b539-ca1efa14f258', -- DS Steel JOB_WORK_OUT JW-MTWTIH5N-BU2Z  -6.985  2024-12-12
    'adc4480d-dff3-45ac-a186-f50c9c1dde5b', -- Sri Sai  SALE_OUT     0125-0799          -1.787  2025-01-07
    '4d445f5f-7d55-49b6-842e-6b31144f1cba', -- Sri Sai  SALE_OUT     0125-0801          -2.066  2025-01-17
    'c8aab1f0-394f-45c5-b2f4-7ee839321835', -- Sri Sai  SALE_OUT     0125-0747          -0.764  2025-01-21
    'f9c35aec-9152-4fe9-a39d-8768e7d930ca'  -- Sri Sai  SALE_OUT     0125-0756          -1.472  2025-01-25
  );

DO $$
DECLARE
  v_n INT;
BEGIN
  SELECT count(*) INTO v_n FROM m155_src;
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'Migration 155 Part 2: expected 5 source outflow rows on CR1224-0031, found % — aborting without changes', v_n;
  END IF;
  IF EXISTS (
    SELECT 1 FROM m155_src
    WHERE company_id NOT IN ('b1804696-676d-465d-a5fe-e1bb214c8da3', '426a22ba-edb6-4947-b637-1ad4aab640b9')
  ) THEN
    RAISE EXCEPTION 'Migration 155 Part 2: a source row belongs to a company outside the Sri Sai / DS Steel pair — aborting';
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
  format('Backfilled inter-company stock share (%s -> %s) behind %s %s — see migration 155 [src:%s]',
         p.owner_name, p.consumer_name, p.src_entry_type, p.src_reference, p.src_id),
  p.entry_date, p.created_at,
  p.purchase_line_id, p.sub_purchase_line_id
FROM (
  -- Owner side: stock leaves the company that holds it.
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
  FROM m155_src s
  JOIN companies cc ON cc.id = s.company_id
  JOIN companies oc ON oc.id = CASE WHEN s.company_id = 'b1804696-676d-465d-a5fe-e1bb214c8da3'
                                    THEN '426a22ba-edb6-4947-b637-1ad4aab640b9'::uuid
                                    ELSE 'b1804696-676d-465d-a5fe-e1bb214c8da3'::uuid END
  UNION ALL
  -- Consumer side: stock arrives at the company that used / sold it.
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
  FROM m155_src s
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

-- ---------- PART 3: stale backfilled transfer pairs ----------

CREATE TEMP TABLE m155_stale ON COMMIT DROP AS
SELECT t.* FROM stock_ledger t
WHERE t.reference_type = 'transfer'
  AND (t.notes LIKE '%[src:a35bed8c-6958-4ac0-8b7e-ffcd355adae1]%'   -- 1024-0455 (migration 140)
    OR t.notes LIKE '%[src:dafbcccb-0208-4169-8e86-77ebea8af64f]%'   -- 1124-0560 (migration 143)
    OR t.notes LIKE '%[src:0164bc44-7c6e-4c48-974e-2a5ce5e8710a]%'); -- 1124-0560 (migration 143)

DO $$
DECLARE
  v_n INT;
BEGIN
  SELECT count(*) INTO v_n FROM m155_stale;
  IF v_n NOT IN (0, 6) THEN
    RAISE EXCEPTION 'Migration 155 Part 3: expected 6 stale transfer rows, found % — aborting', v_n;
  END IF;
  IF v_n > 0 AND EXISTS (
    SELECT 1 FROM stock_ledger WHERE id IN (
      'a35bed8c-6958-4ac0-8b7e-ffcd355adae1', 'dafbcccb-0208-4169-8e86-77ebea8af64f', '0164bc44-7c6e-4c48-974e-2a5ce5e8710a')
  ) THEN
    RAISE EXCEPTION 'Migration 155 Part 3: a source SALE_OUT the pair was written for still exists — pair is not stale, aborting';
  END IF;
  IF v_n > 0 AND EXISTS (
    SELECT 1 FROM dispatch_orders
    WHERE invoice_number IN ('1024-0455', '1124-0560')
      AND company_id <> '426a22ba-edb6-4947-b637-1ad4aab640b9'
  ) THEN
    RAISE EXCEPTION 'Migration 155 Part 3: dispatch 1024-0455 / 1124-0560 is no longer under Sri Sai Steels — pair may still be needed, aborting';
  END IF;
END $$;

INSERT INTO stock_ledger_deletions (stock_ledger_id, ledger_row, deleted_by)
SELECT s.id, to_jsonb(s) || jsonb_build_object('deleted_reason', 'migration 155 part 3: stale inter-company transfer, dispatch re-saved under Sri Sai Steels'), NULL
FROM m155_stale s;

DELETE FROM stock_ledger WHERE id IN (SELECT id FROM m155_stale);

-- ---------- PART 4a: orphan JOB_WORK_CANCEL on JW-MU6VHLCZ-HG9W ----------

CREATE TEMP TABLE m155_orphan ON COMMIT DROP AS
SELECT * FROM stock_ledger
WHERE id = '3b71bc1a-8af2-4cc5-a419-b0f535f8267d'
  AND entry_type = 'JOB_WORK_CANCEL'
  AND reference_id = '1d18716b-3536-49bb-8547-a326ec999801'   -- JW-MU6VHLCZ-HG9W
  AND purchase_line_id = 'HR0125-0030';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM m155_orphan) AND (
    EXISTS (SELECT 1 FROM stock_ledger
            WHERE reference_id = '1d18716b-3536-49bb-8547-a326ec999801'
              AND purchase_line_id = 'HR0125-0030' AND entry_type = 'JOB_WORK_OUT')
    OR EXISTS (SELECT 1 FROM job_work_items
               WHERE job_work_order_id = '1d18716b-3536-49bb-8547-a326ec999801'
                 AND purchase_line_id = 'HR0125-0030')
  ) THEN
    RAISE EXCEPTION 'Migration 155 Part 4a: JW-MU6VHLCZ-HG9W has a JOB_WORK_OUT or a live line for HR0125-0030 again — the CANCEL is not orphaned, aborting';
  END IF;
END $$;

INSERT INTO stock_ledger_deletions (stock_ledger_id, ledger_row, deleted_by)
SELECT o.id, to_jsonb(o) || jsonb_build_object('deleted_reason', 'migration 155 part 4a: JOB_WORK_CANCEL whose JOB_WORK_OUT had been deleted by hand; line now on JW-MUIBGNOV-GQGN'), NULL
FROM m155_orphan o;

DELETE FROM stock_ledger WHERE id IN (SELECT id FROM m155_orphan);

-- ---------- PART 4b: fill missing size_label text ----------

UPDATE job_work_items ji
SET size_label = ms.size_label
FROM material_sizes ms
WHERE ms.id = ji.material_size_id
  AND ji.size_label IS NULL;

UPDATE stock_ledger sl
SET size_label = ms.size_label
FROM material_sizes ms
WHERE ms.id = sl.material_size_id
  AND sl.size_label IS NULL;

COMMIT;
