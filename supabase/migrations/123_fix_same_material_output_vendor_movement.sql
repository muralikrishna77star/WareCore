-- ============================================================
-- Migration 123: vw_current_vendor_stock / fn_vendor_balance_as_of —
-- count JOB_WORK_OUTPUT_IN as a vendor movement when the output is the
-- SAME material that was sent out (no real conversion happened)
-- ============================================================
-- Found on the Item Stock Ledger report for OTH00051 — Scrap Scrap
-- (Sri Sai Steels / Arun Engineering, purchase line OT0324-0007): sent
-- 3.970 to the vendor, 3.840 came back, but the "At Vendor (Job Work)"
-- card and the ledger's running "Balance at Vendor" column both still
-- showed the full 3.970 as outstanding. This is exactly REC-018's open
-- exception for this vendor/material: ledger_balance 3.970 vs
-- source_balance (job_work_items.quantity_sent - quantity_received -
-- quantity_transferred_out) 0.130.
--
-- Root cause: this order's return was recorded as an Output Materials
-- line (job_work_output_items -> JOB_WORK_OUTPUT_IN in stock_ledger), not
-- as a rise in job_work_items.quantity_received posting a
-- JOB_WORK_RETURN_IN row. edit_job_work_order() deliberately skips
-- JOB_WORK_RETURN_IN whenever quantity_received is satisfied via an
-- Output Materials row instead (see 114's fn_job_work_item_to_ledger
-- comment) — posting both would double the warehouse-side inflow, since
-- the OUTPUT_IN row already adds the quantity back into stock. And
-- vw_current_vendor_stock (087) deliberately excludes JOB_WORK_OUTPUT_IN
-- from vendor movements, because normally an Output Materials row is a
-- *converted* item, distinct from the raw material sent to the vendor —
-- true in general, but not when the order's output line happens to be
-- recorded against the exact same material_type_id/material_size_id as
-- one of its own input lines (e.g. sorted/reprocessed scrap returned as
-- the same scrap item, no conversion). In that specific case the
-- OUTPUT_IN row genuinely *is* the vendor-return leg, and excluding it
-- left the vendor balance permanently overstated by whatever came back
-- through Output Materials instead of Qty Received.
--
-- Fix: both vw_current_vendor_stock and the new fn_vendor_balance_as_of
-- (added here for the Item Ledger report's point-in-time opening balance)
-- now also count a JOB_WORK_OUTPUT_IN row when its order has a
-- job_work_items row with the same material_type_id + material_size_id.
-- A genuinely different output item (the normal case) is still correctly
-- excluded. No stock_ledger rows are touched — this is a read-side
-- reclassification only, same as 090's sign fix.
-- ============================================================

CREATE OR REPLACE VIEW vw_current_vendor_stock AS
SELECT
  sl.company_id,
  jwo.vendor_id,
  sl.material_type_id,
  sl.material_size_id,
  sl.size_label,
  SUM(
    CASE
      WHEN sl.entry_type IN ('JOB_WORK_TRANSFER_IN', 'JOB_WORK_TRANSFER_OUT') THEN sl.quantity
      ELSE -sl.quantity
    END
  ) AS current_vendor_stock,
  COUNT(*) AS movement_count,
  MAX(sl.entry_date) AS last_movement_date
FROM stock_ledger sl
JOIN job_work_orders jwo ON jwo.id = sl.reference_id AND sl.reference_type = 'job_work'
WHERE sl.entry_type IN ('JOB_WORK_OUT', 'JOB_WORK_RETURN_IN', 'JOB_WORK_CANCEL', 'JOB_WORK_TRANSFER_OUT', 'JOB_WORK_TRANSFER_IN')
   OR (
     sl.entry_type = 'JOB_WORK_OUTPUT_IN'
     AND EXISTS (
       SELECT 1 FROM job_work_items jwi
       WHERE jwi.job_work_order_id = sl.reference_id
         AND jwi.material_type_id = sl.material_type_id
         AND jwi.material_size_id IS NOT DISTINCT FROM sl.material_size_id
     )
   )
GROUP BY sl.company_id, jwo.vendor_id, sl.material_type_id, sl.material_size_id, sl.size_label;

COMMENT ON VIEW vw_current_vendor_stock IS
  'Canonical per-vendor held stock, derived from stock_ledger. JOB_WORK_TRANSFER_IN/OUT use +quantity (090, warehouse-neutral wash); JOB_WORK_OUTPUT_IN counts as a vendor movement only when its order also has an input line of the exact same material (123) — a genuine conversion to a different output item stays excluded. See REC-018 (docs/data-integrity/RULE_CATALOGUE.md) for the cross-check against v_stock_at_vendors.';

CREATE OR REPLACE FUNCTION fn_vendor_balance_as_of(
  p_material_type_id UUID,
  p_material_size_id UUID,
  p_company_id UUID,
  p_as_of_date DATE
) RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN sl.entry_type IN ('JOB_WORK_TRANSFER_IN', 'JOB_WORK_TRANSFER_OUT') THEN sl.quantity
      ELSE -sl.quantity
    END
  ), 0)
  FROM stock_ledger sl
  WHERE sl.material_type_id = p_material_type_id
    AND (sl.material_size_id = p_material_size_id OR (p_material_size_id IS NULL AND sl.material_size_id IS NULL))
    AND (p_company_id IS NULL OR sl.company_id = p_company_id)
    AND sl.entry_date <= p_as_of_date
    AND (
      sl.entry_type IN ('JOB_WORK_OUT', 'JOB_WORK_RETURN_IN', 'JOB_WORK_CANCEL', 'JOB_WORK_TRANSFER_OUT', 'JOB_WORK_TRANSFER_IN')
      OR (
        sl.entry_type = 'JOB_WORK_OUTPUT_IN'
        AND EXISTS (
          SELECT 1 FROM job_work_items jwi
          WHERE jwi.job_work_order_id = sl.reference_id
            AND jwi.material_type_id = sl.material_type_id
            AND jwi.material_size_id IS NOT DISTINCT FROM sl.material_size_id
        )
      )
    );
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION fn_vendor_balance_as_of IS
  'Point-in-time vendor-held balance for one item/size/company scope, same inclusion/sign rules as vw_current_vendor_stock (090/123) — used by the Item Stock Ledger report''s "Balance at Vendor" opening balance.';
