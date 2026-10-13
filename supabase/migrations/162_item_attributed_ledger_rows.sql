-- ============================================================
-- Migration 162: which stock ledger rows belong to an item, when several
-- items share the same material type + size
-- ============================================================
-- stock_ledger carries material_type_id + material_size_id, not an item.
-- The Item Stock Ledger finds an item's rows by material + size, which is
-- exact when one item owns that combination — but 53 combinations are
-- shared by 2-5 active items (e.g. HR00028 "HR Channel 2.50 inches" and
-- HR00116 "HRPO 2.50 inches" are both HR / 2.50 inches). Each of them then
-- showed the whole combination's stock: HR00028 showed 1.959 MT it never
-- bought, which Sale Entry (item-exact) rightly would not offer for sale.
-- 17 items were in that position.
--
-- fn_item_attributed_ledger_rows(item) returns, for an item in a shared
-- combination, the ledger rows that belong to it:
--   1. the item its purchase line was bought as (purchase_bill_items), when
--      that item is in the combination — stock follows the purchase line
--      through job work, transfers and sales;
--   2. otherwise the item on the row's own document line (sale, warehouse
--      transfer, or job work output line);
--   3. otherwise unknown: returned with shared = true so the report shows it
--      under every item of the combination, flagged (nothing disappears).
-- Also covers vendor-only rows (job work output posted under another item
-- that consumed this combination's material — vw_job_work_vendor_movements'
-- cross-item rows), attributed the same way.
-- Read-only function; no data is changed.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_item_attributed_ledger_rows(p_item_id UUID)
RETURNS TABLE (ledger_id UUID, shared BOOLEAN)
LANGUAGE sql
STABLE
AS $$
  WITH item AS (
    SELECT material_type_id, material_size_id FROM item_master WHERE id = p_item_id
  ), grp AS (
    SELECT im.id FROM item_master im, item
    WHERE im.is_active
      AND im.material_type_id = item.material_type_id
      AND im.material_size_id IS NOT DISTINCT FROM item.material_size_id
  ), candidate AS (
    -- this combination's own rows
    SELECT sl.* FROM stock_ledger sl, item
    WHERE sl.material_type_id = item.material_type_id
      AND sl.material_size_id IS NOT DISTINCT FROM item.material_size_id
    UNION
    -- vendor-only rows whose effective scope is this combination
    SELECT sl.* FROM vw_job_work_vendor_movements v
    JOIN stock_ledger sl ON sl.id = v.id, item
    WHERE v.is_cross_item_output
      AND v.material_type_id = item.material_type_id
      AND v.material_size_id IS NOT DISTINCT FROM item.material_size_id
  ), attributed AS (
    SELECT c.id,
      COALESCE(
        (SELECT p.item_master_id FROM purchase_bill_items p
          WHERE p.purchase_line_id = COALESCE(c.sub_purchase_line_id, c.purchase_line_id)
            AND p.item_master_id IN (SELECT id FROM grp)
          LIMIT 1),
        (SELECT d.item_master_id FROM (
            SELECT di.item_master_id FROM dispatch_items di
             WHERE c.reference_type = 'dispatch' AND di.dispatch_order_id = c.reference_id
               AND di.material_type_id = c.material_type_id AND di.material_size_id IS NOT DISTINCT FROM c.material_size_id
            UNION ALL
            SELECT ti.item_master_id FROM transfer_items ti
             WHERE c.reference_type = 'transfer' AND ti.transfer_id = c.reference_id
               AND ti.material_type_id = c.material_type_id AND ti.material_size_id IS NOT DISTINCT FROM c.material_size_id
            UNION ALL
            SELECT oi.item_master_id FROM job_work_output_items oi
             WHERE c.reference_type = 'job_work' AND oi.job_work_order_id = c.reference_id
               AND c.entry_type IN ('JOB_WORK_OUTPUT_IN', 'JOB_WORK_CANCEL')
               AND oi.material_type_id = c.material_type_id AND oi.material_size_id IS NOT DISTINCT FROM c.material_size_id
          ) d
          WHERE d.item_master_id IN (SELECT id FROM grp)
          LIMIT 1)
      ) AS item_id
    FROM candidate c
  )
  SELECT id, item_id IS NULL
  FROM attributed
  WHERE item_id = p_item_id OR item_id IS NULL;
$$;

COMMENT ON FUNCTION fn_item_attributed_ledger_rows(UUID) IS
  'Ledger rows belonging to an item whose material+size is shared with other active items: by purchase line item, else document line item; shared=true when neither identifies an item in the combination.';
