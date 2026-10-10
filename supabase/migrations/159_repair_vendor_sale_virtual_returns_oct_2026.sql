-- ============================================================
-- Migration 159: repair vendor-direct-sale virtual returns damaged by the
-- edit / cancel bugs fixed in migration 158
-- ============================================================
-- Found from the GI00132 Item Ledger (warehouse balance -7.150; open
-- exceptions EXC-001149 REC-005, EXC-001154 / EXC-001155 REC-009) and a
-- system-wide scan comparing each job work line's virtual-return rows
-- with its active vendor direct sales (5 mismatches; 4 real, below; the
-- fifth — sale 0824-0246 — is posted on its true order JW-MSU3ZQPP-8V8J
-- and balances; only its header points elsewhere, already resolved as
-- EXC-000559/562, so it is left alone).
--
-- 1. MISSING returns — wiped on 2026-10-09 when the 2025-02-12 scrap sales
--    0225-0976 / 0225-0979 were edited (edit_dispatch_order deleted every
--    virtual return on the line, not just their own). Re-posted exactly as
--    fn_dispatch_item_to_ledger posts them, from the surviving sale lines:
--      * 1224-0627  2.980 MT  GI1224-0039  JW-MTY7QFY4-57JD  2024-12-22
--      * 0125-0692  4.170 MT  GI1224-0048  JW-MTY99X37-SP1X  2025-01-09
--    Plausibility: both orders were dispatched to Arun Engineering on/before
--    those dates (2024-12-22 / 2024-12-30) and their lines already show the
--    full quantity received (3.054 / 4.294 = these sales + the scrap sales).
--
-- 2. STALE returns — left behind when sale 0125-0783 (JW-MU6RYYXX-1R1B,
--    0.910 CR0125-0062 + 0.900 CR0125-0064) was cancelled on 2026-10-10
--    (cancel_dispatch_order's delete matched nothing) and the sale was
--    re-entered as 0125-1009 / 0125-1010, which posted their own returns.
--    The two 2026-09-29 rows from the cancelled sale are removed (copied
--    to stock_ledger_deletions first).
--
-- job_work_items quantities were already correct in every case; only the
-- ledger rows were wrong. Guarded: each step acts only on the exact rows
-- described and is a no-op if they are absent or already repaired.
-- ============================================================

-- 1. Re-post the two missing virtual returns.
INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, created_by, purchase_line_id, sub_purchase_line_id
)
SELECT
  'JOB_WORK_RETURN_IN', d.company_id, d.warehouse_id, di.material_type_id, di.material_size_id,
  di.size_label, fn_convert_quantity(di.quantity, di.unit, mt.unit),
  'job_work', o.id, o.reference_number,
  'Vendor direct sale — virtual return', d.dispatch_date, d.created_by,
  di.purchase_line_id, di.sub_purchase_line_id
FROM dispatch_items di
JOIN dispatch_orders d ON d.id = di.dispatch_order_id
JOIN job_work_orders o ON o.id = d.source_job_work_order_id
JOIN material_types mt ON mt.id = di.material_type_id
WHERE di.id IN ('ab32bffa-25ad-4405-abba-c7a4cec34a5e', '7ccdcd96-f14f-47a2-b33a-63974c4b6f0f')
  AND d.status = 'active' AND d.is_vendor_direct
  AND NOT EXISTS (
    SELECT 1 FROM stock_ledger sl
    WHERE sl.reference_type = 'job_work' AND sl.reference_id = o.id
      AND sl.notes = 'Vendor direct sale — virtual return'
      AND sl.purchase_line_id IS NOT DISTINCT FROM di.purchase_line_id
      AND sl.entry_date = d.dispatch_date
      AND sl.quantity = fn_convert_quantity(di.quantity, di.unit, mt.unit)
  );

-- 2. Remove the two stale returns of cancelled sale 0125-0783.
INSERT INTO stock_ledger_deletions (stock_ledger_id, ledger_row, deleted_by)
SELECT sl.id, to_jsonb(sl), NULL
FROM stock_ledger sl
WHERE sl.id IN ('0e46575a-693d-43f2-bcea-d67b3fc0e14b', '2b270d42-848c-4e0d-ad00-54132b5c2108')
  AND sl.notes = 'Vendor direct sale — virtual return';

DELETE FROM stock_ledger
WHERE id IN ('0e46575a-693d-43f2-bcea-d67b3fc0e14b', '2b270d42-848c-4e0d-ad00-54132b5c2108')
  AND notes = 'Vendor direct sale — virtual return';
