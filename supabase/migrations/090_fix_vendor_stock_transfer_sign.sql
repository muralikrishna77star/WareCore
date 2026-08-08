-- ============================================================
-- Fix vw_current_vendor_stock's sign handling for vendor-to-vendor
-- transfers (JOB_WORK_TRANSFER_IN / JOB_WORK_TRANSFER_OUT)
-- ============================================================
-- Root cause, found tracing 5 REC-018 exception pairs (METALEX STEEL
-- PROCESSOR <-> MODERN AGE METAL PROCESSORS and others) back to their raw
-- stock_ledger rows:
--
-- fn_job_work_item_to_ledger() (056/065/etc.) posts JOB_WORK_TRANSFER_OUT
-- as NEGATIVE and JOB_WORK_TRANSFER_IN as POSITIVE quantity — the OPPOSITE
-- polarity of JOB_WORK_OUT (negative) / JOB_WORK_RETURN_IN (positive). This
-- is correct and intentional for the trigger's own purpose: the transfer
-- pair is posted against each order's own company warehouse_id so the two
-- legs net to zero on warehouse-level totals, since the material never
-- physically re-enters the warehouse (see the trigger body's own comment,
-- "net zero against the paired JOB_WORK_TRANSFER_OUT below").
--
-- vw_current_vendor_stock (087) applied a single uniform formula,
-- -SUM(quantity), to every entry type in VENDOR_MOVEMENT_TYPES. That
-- formula is correct for JOB_WORK_OUT/JOB_WORK_RETURN_IN/JOB_WORK_CANCEL
-- (whose sign means "warehouse delta", and vendor custody is the
-- warehouse-delta's negation) but wrong for JOB_WORK_TRANSFER_IN/
-- JOB_WORK_TRANSFER_OUT, whose sign already means "warehouse-neutral
-- wash", not "warehouse delta" — negating it again flips the wrong way.
--
-- Verified by hand against production: METALEX STEEL PROCESSOR / CR /
-- 0.78X1710 raw ledger rows are JOB_WORK_OUT -2.260,-3.530,-3.230 and
-- JOB_WORK_TRANSFER_OUT -3.230,-3.530,-2.260 (all NEGATIVE per
-- fn_job_work_item_to_ledger). Old formula: -SUM = -(-18.040) = 18.040
-- (matches the old buggy EXC-000110 actual_value exactly). Corrected
-- formula below: 18.040 (from JOB_WORK_OUT/-quantity is fine's already
-- correct part unchanged) ... paired against 18.040 (TRANSFER_OUT's own
-- outflow) = 0.000, matching v_stock_at_vendors's source_balance of
-- 0.000 for the same vendor/material/size exactly.
--
-- No stock_ledger rows are touched by this migration — production ledger
-- data was correct and internally consistent all along (204/204
-- JOB_WORK_OUT rows negative, 125/125 JOB_WORK_RETURN_IN positive, 33/33
-- JOB_WORK_TRANSFER_IN positive, 33/33 JOB_WORK_TRANSFER_OUT negative —
-- verified with a GROUP BY sign-count query before writing this fix). Only
-- the reconciliation view's formula changes.
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
GROUP BY sl.company_id, jwo.vendor_id, sl.material_type_id, sl.material_size_id, sl.size_label;

COMMENT ON VIEW vw_current_vendor_stock IS
  'Canonical per-vendor held stock, derived from stock_ledger. See REC-018 (docs/data-integrity/RULE_CATALOGUE.md) for the cross-check against v_stock_at_vendors. JOB_WORK_TRANSFER_IN/OUT use +quantity (not -quantity like the other vendor-movement types) because fn_job_work_item_to_ledger() gives them the opposite sign convention on purpose, for warehouse-level netting — see this migration''s header for the full explanation and the production sign-audit that confirmed it.';
