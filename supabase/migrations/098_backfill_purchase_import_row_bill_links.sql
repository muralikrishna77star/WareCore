-- One-time backfill of purchase_import_rows.purchase_bill_id (added in
-- migration 097) for the single batch that was already IMPORTED before that
-- column existed. Matches each staging row to its resulting
-- purchase_bill_items row via company/warehouse/supplier/bill_date +
-- material_type/material_size + quantity/rate — verified unambiguous
-- (exactly one candidate per row) before writing this migration. Going
-- forward, the import route (POST .../batches/:id/import) sets this link
-- itself at commit time.
BEGIN;

WITH rows AS (
  SELECT
    pir.id AS row_id,
    (pir.resolved_field_ids->>'companyId')::uuid AS company_id,
    (pir.resolved_field_ids->>'warehouseId')::uuid AS warehouse_id,
    (pir.resolved_field_ids->>'supplierId')::uuid AS supplier_id,
    (pir.current_data->>'billDate')::date AS bill_date,
    (pir.resolved_field_ids->>'materialTypeId')::uuid AS material_type_id,
    NULLIF(pir.resolved_field_ids->>'materialSizeId','')::uuid AS material_size_id,
    (pir.current_data->>'quantity')::numeric AS quantity,
    (pir.current_data->>'rate')::numeric AS rate
  FROM purchase_import_rows pir
  JOIN purchase_import_batches pib ON pib.id = pir.batch_id
  WHERE pib.status = 'IMPORTED' AND pir.purchase_bill_id IS NULL
),
matched AS (
  SELECT r.row_id, pb.id AS bill_id
  FROM rows r
  JOIN purchase_bills pb
    ON pb.company_id = r.company_id AND pb.warehouse_id = r.warehouse_id AND pb.supplier_id = r.supplier_id
   AND pb.bill_date = r.bill_date
  JOIN purchase_bill_items pbi
    ON pbi.bill_id = pb.id
   AND pbi.material_type_id = r.material_type_id
   AND pbi.material_size_id IS NOT DISTINCT FROM r.material_size_id
   AND pbi.quantity = r.quantity
   AND pbi.rate = r.rate
)
UPDATE purchase_import_rows pir
SET purchase_bill_id = m.bill_id
FROM matched m
WHERE pir.id = m.row_id;

COMMIT;
