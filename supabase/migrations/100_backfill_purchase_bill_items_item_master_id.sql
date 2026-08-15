-- One-time backfill: sets purchase_bill_items.item_master_id for every line
-- imported via batch PIB-000003. Migration 099 already created Item Master
-- rows for the 13 material/size combos that batch purchased with no
-- existing Item, but nothing ever linked ANY of the batch's 60 lines back
-- to an item_master row (not the 13 new ones, not the 47 that already had
-- an Item) — buildInsertScript() never included item_master_id in its
-- INSERT column list until now (see buildInsertScript.ts and
-- src/app/api/bills/import/batches/[id]/import/route.ts's fix in the same
-- change). Job Work's "available to send" query strictly requires
-- item_master_id IS NOT NULL, so every line from this batch was invisible
-- there even though its stock_ledger postings were always correct.
--
-- Matches by material_type_id + material_size_id, same identity resolveNewItems()
-- already uses to decide "does this combo have an Item".
BEGIN;

UPDATE purchase_bill_items pbi
SET item_master_id = im.id
FROM purchase_import_rows pir, purchase_import_batches b, item_master im
WHERE b.id = pir.batch_id
  AND b.batch_number = 'PIB-000003'
  AND pbi.bill_id = pir.purchase_bill_id
  AND pir.purchase_bill_id IS NOT NULL
  AND im.material_type_id = pbi.material_type_id
  AND im.material_size_id IS NOT DISTINCT FROM pbi.material_size_id
  AND pbi.item_master_id IS NULL;

COMMIT;
