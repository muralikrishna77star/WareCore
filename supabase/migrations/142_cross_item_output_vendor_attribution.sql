-- ============================================================
-- Migration 142: attribute a cross-item Job Work Output back to the
-- input line it consumed (vendor-held stock, REC-009, REC-018)
-- ============================================================
-- False positives found 2026-09-08: EXC-000807 (REC-009) and EXC-000809
-- (REC-018), both on JW-MTLF316W-LMUS (DS Steel Enterprises / Arun
-- Engineering). Line JW-0811-0012 sent 6.390 of OTH00042 "0.85X995"
-- (purchase line OT1124-0002); the vendor slit it and it came back on
-- 2024-11-15 as an Output Materials line of a DIFFERENT item, OT00006
-- "0.90X121", 6.190, with job_work_output_items.source_job_line_id =
-- 'JW-0811-0012'. edit_job_work_order() correctly set the input line's
-- quantity_received = 6.190 (backed by that output, per 069 — no
-- JOB_WORK_RETURN_IN is posted) and fn_job_work_output_item_to_ledger()
-- correctly posted JOB_WORK_OUTPUT_IN 6.190 under 0.90X121.
--
-- So the source of truth says 0.200 is still at the vendor for 0.85X995,
-- and it is right. But every ledger-side vendor calculation — the
-- vw_current_vendor_stock view (087/090/123), fn_vendor_balance_as_of
-- (123), REC-009's "ledger received" (128) — only credits a
-- JOB_WORK_OUTPUT_IN row against the vendor when it is the SAME
-- material/size as one of the order's input lines (123's rule for
-- "no real conversion happened"). A genuinely converted output was left
-- with the whole 6.390 still "at vendor", so REC-018 reported 6.390 vs
-- 0.200 and REC-009 reported received=6.190 vs ledger 0. This is the first
-- cross-item output in the whole ledger (every other Output Materials
-- line ever recorded uses the input's own item), so nothing else changes.
--
-- Fix (read-side only, no stock_ledger rows touched):
--   * NEW vw_job_work_vendor_movements — one row per job-work stock_ledger
--     row that counts as vendor-held-stock movement, with an EFFECTIVE
--     (material_type_id, material_size_id, size_label) scope. For a
--     JOB_WORK_OUTPUT_IN (or the JOB_WORK_CANCEL that reverses one after an
--     Edit Order correction) whose Output Materials line names a
--     source_job_line_id pointing at an input line of a different
--     material/size, the effective scope is that INPUT line's — the output
--     consumed it at the vendor, so it is the vendor-return leg for it.
--     Everything else keeps 123's rule: same-item outputs count under
--     their own scope, unrelated outputs are excluded.
--   * vw_current_vendor_stock and fn_vendor_balance_as_of are re-pointed
--     at the new view (identical columns / sign rules — 090's TRANSFER sign
--     and 123's same-item rule are preserved), so the "At Vendor" card, the
--     Item Stock Ledger's "Balance at Vendor" opening balance and REC-018
--     all agree with job_work_items again.
--   * fn_reconcile_rec_009's ledger_output_in uses the same view, so
--     quantity_received compares against RETURN_IN + attributed OUTPUT_IN.
--
-- JOB_WORK_CANCEL handling — the one deliberate behaviour change beyond
-- attribution: a CANCEL row is still always counted when the same order
-- has an input-side row (JOB_WORK_OUT / RETURN_IN / TRANSFER_IN) of the
-- same material/size (every "Line removed" reversal, every same-item
-- output correction — unchanged), but a CANCEL that reverses a CROSS-item
-- output and can no longer be attributed (its Output Materials line was
-- since re-sized or removed) is excluded, exactly like the OUTPUT_IN it
-- reverses. Before this it would have been counted as +qty "at vendor" for
-- an output item that was never sent anywhere — a latent phantom that
-- would have appeared the first time JW-MTLF316W-LMUS's output was edited.
-- ============================================================

CREATE OR REPLACE VIEW vw_job_work_vendor_movements AS
SELECT
  sl.id,
  sl.company_id,
  sl.warehouse_id,
  jwo.vendor_id,
  sl.reference_id AS job_work_order_id,
  sl.entry_type,
  sl.quantity,
  sl.entry_date,
  sl.created_at,
  -- What the row itself is posted under (the output item, for a cross-item output).
  sl.material_type_id AS own_material_type_id,
  sl.material_size_id AS own_material_size_id,
  sl.size_label       AS own_size_label,
  -- What it counts against at the vendor (the consumed input line, for a cross-item output).
  COALESCE(src.material_type_id, sl.material_type_id) AS material_type_id,
  COALESCE(src.material_size_id, sl.material_size_id) AS material_size_id,
  COALESCE(src.size_label,       sl.size_label)       AS size_label,
  (src.material_type_id IS NOT NULL) AS is_cross_item_output,
  src.output_item_id,
  -- Same sign rules as vw_current_vendor_stock has had since 090.
  CASE WHEN sl.entry_type IN ('JOB_WORK_TRANSFER_IN', 'JOB_WORK_TRANSFER_OUT') THEN sl.quantity ELSE -sl.quantity END AS vendor_delta
FROM stock_ledger sl
JOIN job_work_orders jwo ON jwo.id = sl.reference_id AND sl.reference_type = 'job_work'
LEFT JOIN LATERAL (
  -- The Output Materials line this OUTPUT_IN / CANCEL row was posted for,
  -- when that line names a source input line of a DIFFERENT material/size.
  SELECT jwi.material_type_id, jwi.material_size_id, jwi.size_label, oi.id AS output_item_id
  FROM job_work_output_items oi
  JOIN job_work_items jwi
    ON jwi.job_work_order_id = oi.job_work_order_id
   AND jwi.job_line_id = oi.source_job_line_id
  WHERE sl.entry_type IN ('JOB_WORK_OUTPUT_IN', 'JOB_WORK_CANCEL')
    AND oi.job_work_order_id = sl.reference_id
    AND oi.source_job_line_id IS NOT NULL
    AND oi.material_type_id = sl.material_type_id
    AND oi.material_size_id IS NOT DISTINCT FROM sl.material_size_id
    AND (jwi.material_type_id <> sl.material_type_id OR jwi.material_size_id IS DISTINCT FROM sl.material_size_id)
  ORDER BY (oi.quantity = ABS(sl.quantity)) DESC, oi.created_at
  LIMIT 1
) src ON TRUE
WHERE sl.entry_type IN ('JOB_WORK_OUT', 'JOB_WORK_RETURN_IN', 'JOB_WORK_TRANSFER_OUT', 'JOB_WORK_TRANSFER_IN')
   OR (
     sl.entry_type = 'JOB_WORK_OUTPUT_IN'
     AND (
       src.material_type_id IS NOT NULL
       OR EXISTS (
         -- 123's rule: same item as one of the order's own input lines = a return, not a conversion.
         SELECT 1 FROM job_work_items jwi
         WHERE jwi.job_work_order_id = sl.reference_id
           AND jwi.material_type_id = sl.material_type_id
           AND jwi.material_size_id IS NOT DISTINCT FROM sl.material_size_id
       )
     )
   )
   OR (
     sl.entry_type = 'JOB_WORK_CANCEL'
     AND (
       src.material_type_id IS NOT NULL
       OR EXISTS (
         -- Reverses something input-side (a removed line, a same-item output correction).
         SELECT 1 FROM stock_ledger o
         WHERE o.reference_type = 'job_work' AND o.reference_id = sl.reference_id
           AND o.entry_type IN ('JOB_WORK_OUT', 'JOB_WORK_RETURN_IN', 'JOB_WORK_TRANSFER_IN')
           AND o.material_type_id = sl.material_type_id
           AND o.material_size_id IS NOT DISTINCT FROM sl.material_size_id
       )
     )
   );

COMMENT ON VIEW vw_job_work_vendor_movements IS
  'Row-level canonical "does this stock_ledger row move stock to/from a job-work vendor, and against which item" (142). vendor_delta already carries the sign convention (090); material_type_id/material_size_id/size_label are the EFFECTIVE scope — for a cross-item Output Materials line they are the consumed input line''s, own_* are what the row is posted under. Every vendor-held-stock figure (vw_current_vendor_stock, fn_vendor_balance_as_of, REC-009, REC-018, the Item Stock Ledger report) derives from this view.';

CREATE OR REPLACE VIEW vw_current_vendor_stock AS
SELECT
  company_id,
  vendor_id,
  material_type_id,
  material_size_id,
  size_label,
  SUM(vendor_delta) AS current_vendor_stock,
  COUNT(*) AS movement_count,
  MAX(entry_date) AS last_movement_date
FROM vw_job_work_vendor_movements
GROUP BY company_id, vendor_id, material_type_id, material_size_id, size_label;

COMMENT ON VIEW vw_current_vendor_stock IS
  'Canonical current vendor-held stock per company/vendor/item/size, derived from vw_job_work_vendor_movements (142) — JOB_WORK_TRANSFER_IN/OUT keep their opposite sign convention (090), same-item Output Materials count as returns (123), cross-item Output Materials count against the input line they consumed (142).';

CREATE OR REPLACE FUNCTION fn_vendor_balance_as_of(
  p_material_type_id UUID,
  p_material_size_id UUID,
  p_company_id UUID,
  p_as_of_date DATE
) RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(v.vendor_delta), 0)
  FROM vw_job_work_vendor_movements v
  WHERE v.material_type_id = p_material_type_id
    AND v.material_size_id IS NOT DISTINCT FROM p_material_size_id
    AND (p_company_id IS NULL OR v.company_id = p_company_id)
    AND v.entry_date <= p_as_of_date;
$$ LANGUAGE sql STABLE;
COMMENT ON FUNCTION fn_vendor_balance_as_of IS
  'Point-in-time vendor-held balance for one item/size/company scope, same inclusion/sign rules as vw_current_vendor_stock (090/123/142) — used by the Item Stock Ledger report''s "Balance at Vendor" opening balance.';

CREATE OR REPLACE FUNCTION fn_reconcile_rec_009(p_company_id UUID, p_from_date DATE, p_to_date DATE)
RETURNS SETOF reconciliation_candidate AS $$
  WITH scopes AS (
    SELECT jwo.id AS order_id, jwo.reference_number, jwo.company_id, jwo.warehouse_id,
           jwi.material_type_id, jwi.material_size_id,
           array_agg(jwi.id) AS line_ids,
           SUM(jwi.quantity_sent) AS quantity_sent,
           SUM(COALESCE(jwi.quantity_received, 0)) AS quantity_received,
           SUM(COALESCE(jwi.quantity_transferred_out, 0)) AS quantity_transferred_out,
           COALESCE((SELECT -SUM(sl.quantity) FROM stock_ledger sl WHERE sl.reference_type = 'job_work' AND sl.reference_id = jwo.id
                     AND sl.entry_type = 'JOB_WORK_OUT' AND sl.material_type_id = jwi.material_type_id
                     AND (sl.material_size_id = jwi.material_size_id OR (sl.material_size_id IS NULL AND jwi.material_size_id IS NULL))), 0) AS ledger_sent,
           COALESCE((SELECT SUM(sl.quantity) FROM stock_ledger sl WHERE sl.reference_type = 'job_work' AND sl.reference_id = jwo.id
                     AND sl.entry_type = 'JOB_WORK_RETURN_IN' AND sl.material_type_id = jwi.material_type_id
                     AND (sl.material_size_id = jwi.material_size_id OR (sl.material_size_id IS NULL AND jwi.material_size_id IS NULL))), 0) AS ledger_received,
           -- OUTPUT_IN (+ the CANCEL rows that correct one) by EFFECTIVE scope
           -- via vw_job_work_vendor_movements (142): a same-item output counts
           -- under its own scope as before (128); an output recorded as a
           -- different item counts against the input line named by its
           -- source_job_line_id — which is the line whose quantity_received
           -- edit_job_work_order() bumped for it (069).
           COALESCE((SELECT SUM(v.quantity) FROM vw_job_work_vendor_movements v
                     WHERE v.job_work_order_id = jwo.id
                       AND v.entry_type IN ('JOB_WORK_OUTPUT_IN', 'JOB_WORK_CANCEL')
                       AND v.material_type_id = jwi.material_type_id
                       AND v.material_size_id IS NOT DISTINCT FROM jwi.material_size_id), 0) AS ledger_output_in,
           COALESCE((SELECT -SUM(sl.quantity) FROM stock_ledger sl WHERE sl.reference_type = 'job_work' AND sl.reference_id = jwo.id
                     AND sl.entry_type = 'JOB_WORK_TRANSFER_OUT' AND sl.material_type_id = jwi.material_type_id
                     AND (sl.material_size_id = jwi.material_size_id OR (sl.material_size_id IS NULL AND jwi.material_size_id IS NULL))), 0) AS ledger_transferred_out
    FROM job_work_items jwi
    JOIN job_work_orders jwo ON jwo.id = jwi.job_work_order_id
    WHERE (p_company_id IS NULL OR jwo.company_id = p_company_id)
      AND jwo.dispatch_date BETWEEN p_from_date AND p_to_date
      AND jwo.status <> 'cancelled'
      AND jwi.is_transfer_line = FALSE
    GROUP BY jwo.id, jwo.reference_number, jwo.company_id, jwo.warehouse_id, jwi.material_type_id, jwi.material_size_id
  )
  SELECT
    'REC-009|' || order_id::text || '|' || material_type_id::text || '|' || COALESCE(material_size_id::text, 'null') AS fingerprint,
    'HIGH' AS severity, company_id, warehouse_id, material_type_id, material_size_id, NULL::text,
    'job_work' AS source_document_type, order_id, array_to_string(line_ids, ','), reference_number,
    quantity_sent AS expected_value, ledger_sent AS actual_value, (quantity_sent - ledger_sent) AS difference,
    format('Job Work %s (%s line(s) for this material/size): sent=%s (ledger %s), received=%s (ledger %s), transferred_out=%s (ledger %s)',
           reference_number, array_length(line_ids, 1), quantity_sent, ledger_sent, quantity_received, (ledger_received + ledger_output_in), quantity_transferred_out, ledger_transferred_out) AS summary,
    'One or more of quantity_sent/quantity_received/quantity_transferred_out (summed across every job_work_items line sharing this order+material+size) disagrees with the corresponding ledger total for this scope. quantity_received compares against JOB_WORK_RETURN_IN + JOB_WORK_OUTPUT_IN combined (an output recorded as a different item counts against the input line its source_job_line_id names) — see 069_job_work_derived_return_no_phantom_ledger.sql and 142.' AS explanation,
    'Edit/return/transfer flow updated the source columns without reposting the ledger, or vice versa.' AS suspected_cause,
    jsonb_build_object('confidence', 'HIGH_PROBABILITY', 'line_count', array_length(line_ids, 1),
      'quantity_sent', quantity_sent, 'ledger_sent', ledger_sent,
      'quantity_received', quantity_received, 'ledger_received', ledger_received, 'ledger_output_in', ledger_output_in,
      'quantity_transferred_out', quantity_transferred_out, 'ledger_transferred_out', ledger_transferred_out) AS evidence
  FROM scopes
  WHERE ABS(quantity_sent - ledger_sent) > 0.001
     OR ABS(COALESCE(quantity_received, 0) - (ledger_received + ledger_output_in)) > 0.001
     OR ABS(COALESCE(quantity_transferred_out, 0) - ledger_transferred_out) > 0.001;
$$ LANGUAGE sql STABLE;
