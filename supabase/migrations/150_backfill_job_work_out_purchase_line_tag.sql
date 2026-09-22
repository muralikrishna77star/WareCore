-- ============================================================
-- WareCore WMS - Backfill purchase_line_id on historical JOB_WORK_OUT rows
--
-- Found while the user read /reports/purchase-line-ledger for GI0524-0018
-- (GI00200, GI 1MM X 1220) and saw the line stuck at a 7.702 balance
-- after migration 077's backfilled JOB_WORK_TRANSFER_OUT (15-May-2024,
-- JW-MRET3ZIS-T1QX, Mass Decoilers -> Arun Engineering). That backfilled
-- row is correct — transfer JWT-0726-0001 exists, the destination order
-- JW-MRQ2CP84-N36K holds the matching JOB_WORK_TRANSFER_IN, and later
-- vendor direct sales were made from it. The real gap is the line's
-- original 13-May-2024 JOB_WORK_OUT (-7.702), which carries no
-- purchase_line_id, so the Purchase Line Ledger (which selects rows by
-- purchase_line_id) never sees the material leave the warehouse.
--
-- Root cause is the one migration 118 fixed going forward:
-- fn_job_work_item_to_ledger()'s plain JOB_WORK_OUT branch never tagged
-- purchase_line_id/sub_purchase_line_id before 2026-08-22. Historical rows
-- were left untagged — 188 of 895 JOB_WORK_OUT rows as of 2026-09-22.
--
-- Each untagged row is tagged from its own job_work_items line: same order
-- (reference_id), same material type/size, quantity_sent equal to the
-- ledger quantity, non-transfer line. Verified before applying: every one
-- of the 188 rows matches exactly one line, no line matches two rows, no
-- line already has a tagged JOB_WORK_OUT, none is dated before its
-- purchase bill, no job_work_orders status changes via
-- trg_stock_ledger_refresh_job_work_status, and every fn_reconcile_rec_*
-- candidate count is identical before and after.
--
-- Label-only: no quantity, entry_date, company or warehouse changes, so
-- item-level stock and vendor balances are untouched. Only per-purchase-line
-- views (Purchase Line Ledger, reconcile_purchase_stock) change — to correct.
-- Generic join, no hardcoded ids: a no-op on a fresh database.
-- ============================================================

WITH matched AS (
  SELECT sl.id AS stock_ledger_id, ji.purchase_line_id, ji.sub_purchase_line_id
  FROM stock_ledger sl
  JOIN job_work_items ji
    ON ji.job_work_order_id = sl.reference_id
   AND ji.material_type_id = sl.material_type_id
   AND ji.material_size_id IS NOT DISTINCT FROM sl.material_size_id
   AND ji.quantity_sent = ABS(sl.quantity)
   AND COALESCE(ji.is_transfer_line, false) = false
  WHERE sl.entry_type = 'JOB_WORK_OUT'
    AND sl.reference_type = 'job_work'
    AND sl.purchase_line_id IS NULL
    AND sl.sub_purchase_line_id IS NULL
    AND (ji.purchase_line_id IS NOT NULL OR ji.sub_purchase_line_id IS NOT NULL)
),
unambiguous AS (
  -- Skip any ledger row that matches more than one line, or any line
  -- matched by more than one ledger row — tag only one-to-one pairs.
  SELECT m.*
  FROM matched m
  WHERE (SELECT COUNT(*) FROM matched m2 WHERE m2.stock_ledger_id = m.stock_ledger_id) = 1
    AND (SELECT COUNT(*) FROM matched m3
         WHERE m3.purchase_line_id IS NOT DISTINCT FROM m.purchase_line_id
           AND m3.sub_purchase_line_id IS NOT DISTINCT FROM m.sub_purchase_line_id
           AND (SELECT reference_id FROM stock_ledger WHERE id = m3.stock_ledger_id)
             = (SELECT reference_id FROM stock_ledger WHERE id = m.stock_ledger_id)) = 1
)
UPDATE stock_ledger sl
SET purchase_line_id = u.purchase_line_id,
    sub_purchase_line_id = u.sub_purchase_line_id
FROM unambiguous u
WHERE sl.id = u.stock_ledger_id;
