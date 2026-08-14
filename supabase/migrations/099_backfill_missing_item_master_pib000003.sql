-- One-time backfill: creates Item Master rows for the 13 material/size
-- combos purchased in batch PIB-000003 that had none (found while
-- investigating why that batch's stock wasn't reachable from the Item
-- Stock Ledger report's item picker — the stock itself was always correct
-- in stock_ledger, see migration 097/098's commit message). Going forward,
-- the import route creates these automatically at commit time (see
-- resolveNewItems()/buildNewItemsInsertScript() in
-- src/lib/purchaseImport/resolve.ts and buildInsertScript.ts).
--
-- Mirrors generateItemCode()'s algorithm exactly: {MaterialTypeCode}{next
-- 5-digit sequence for that prefix}, continuing past whatever's already on
-- the books, with sequential numbers within this batch for combos sharing
-- one prefix (GI has 8 of the 13).
BEGIN;

WITH batch AS (
  SELECT id FROM purchase_import_batches WHERE batch_number = 'PIB-000003'
),
imported_bills AS (
  SELECT DISTINCT pir.purchase_bill_id AS bill_id
  FROM purchase_import_rows pir JOIN batch b ON b.id = pir.batch_id
  WHERE pir.purchase_bill_id IS NOT NULL
),
combos AS (
  SELECT DISTINCT
    pbi.material_type_id, pbi.material_size_id, pbi.size_label,
    mt.code AS mt_code, mt.description AS mt_description, mt.unit AS mt_unit
  FROM purchase_bill_items pbi
  JOIN imported_bills ib ON ib.bill_id = pbi.bill_id
  JOIN material_types mt ON mt.id = pbi.material_type_id
  LEFT JOIN item_master im
    ON im.material_type_id = pbi.material_type_id
   AND im.material_size_id IS NOT DISTINCT FROM pbi.material_size_id
  WHERE im.id IS NULL
),
prefix_max AS (
  SELECT mt.code AS mt_code,
         COALESCE(MAX((regexp_match(im.item_code, '^' || mt.code || '(\d+)$'))[1]::int), 0) AS max_seq
  FROM material_types mt
  LEFT JOIN item_master im ON im.item_code ~ ('^' || mt.code || '[0-9]+$')
  GROUP BY mt.code
),
numbered AS (
  SELECT c.*, row_number() OVER (PARTITION BY c.mt_code ORDER BY c.size_label) AS rn
  FROM combos c
)
INSERT INTO item_master (item_code, item_name, material_type_id, material_size_id, size_label, unit, is_active)
SELECT
  n.mt_code || lpad((pm.max_seq + n.rn)::text, 5, '0'),
  n.mt_description || COALESCE(' - ' || n.size_label, ''),
  n.material_type_id, n.material_size_id, n.size_label, n.mt_unit, true
FROM numbered n
JOIN prefix_max pm ON pm.mt_code = n.mt_code;

COMMIT;
