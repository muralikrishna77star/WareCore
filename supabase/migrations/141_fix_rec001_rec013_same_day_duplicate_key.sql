-- ============================================================
-- Migration 141: REC-001 / REC-013 — a "duplicate" must share the
-- same entry_date
-- ============================================================
-- False positive found 2026-09-08: EXC-000696 (REC-001, MEDIUM) and its
-- derived EXC-000710 (REC-013) on job work order JW-MT74ETAR-BGSJ, line
-- GA0924-0008 — "2 duplicate JOB_WORK_RETURN_IN rows (qty 2.280 each)".
-- They are not duplicates. Two separate vendor-direct dispatches
-- (1024-0405 to PS Kumara Traders on 2024-10-21 and 1024-0451 to Yes Dee
-- Racks on 2024-10-26) each sold exactly 2.280 of the 4.560 transferred in
-- on that line, and each correctly posted its own "Vendor direct sale —
-- virtual return" row. quantity_received = 4.560 = 2.280 + 2.280; the line
-- and the ledger agree.
--
-- REC-001's duplicate key (128) was entry_type + source reference + line +
-- item + company + warehouse + quantity — everything EXCEPT entry_date, so
-- two genuinely different events of the same size on different days
-- collapsed into one "duplicate" group. A real double-submit or repeated
-- edit-save (the defect this rule exists for, e.g. CR00700's two
-- PURCHASE_CANCEL rows 2m43s apart) always shares the entry_date, so
-- adding it to the key loses nothing. Same change to REC-013's own
-- duplicate-group detection, which mirrors REC-001's key.
--
-- entry_date is added to REC-001's fingerprint too, so two distinct
-- same-day duplicate groups on one line get their own exceptions. No
-- REC-001 exception is currently IGNORED (only 1 OPEN — this one — and 6
-- RESOLVED), so no sticky-ignored identity is orphaned by the change.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_reconcile_rec_001(p_company_id UUID, p_from_date DATE, p_to_date DATE)
RETURNS SETOF reconciliation_candidate AS $$
  WITH dup_groups AS (
    SELECT
      entry_type, reference_type, reference_id, purchase_line_id, sub_purchase_line_id,
      company_id, warehouse_id, material_type_id, material_size_id, quantity, entry_date,
      array_agg(id ORDER BY created_at) AS ids,
      array_agg(created_at ORDER BY created_at) AS created_ats,
      array_agg(reference_number ORDER BY created_at) AS reference_numbers,
      count(*) AS dup_count,
      max(created_at) - min(created_at) AS spread
    FROM stock_ledger
    WHERE (p_company_id IS NULL OR company_id = p_company_id)
      AND entry_date BETWEEN p_from_date AND p_to_date
      AND (purchase_line_id IS NOT NULL OR sub_purchase_line_id IS NOT NULL OR reference_id IS NOT NULL)
    -- entry_date is part of the identity (141): the same quantity for the
    -- same line on two different business dates is two events, not one
    -- posted twice.
    GROUP BY entry_type, reference_type, reference_id, purchase_line_id, sub_purchase_line_id,
             company_id, warehouse_id, material_type_id, material_size_id, quantity, entry_date
    HAVING count(*) > 1
  ),
  adjusted AS (
    SELECT dg.*,
      dg.dup_count - COALESCE((
        SELECT COUNT(*) FROM stock_ledger c
        WHERE c.reference_type IS NOT DISTINCT FROM dg.reference_type
          AND c.reference_id IS NOT DISTINCT FROM dg.reference_id
          AND c.company_id = dg.company_id AND c.warehouse_id = dg.warehouse_id
          AND c.material_type_id = dg.material_type_id
          AND c.material_size_id IS NOT DISTINCT FROM dg.material_size_id
          AND c.quantity = -dg.quantity
          AND c.entry_type = CASE dg.entry_type
                WHEN 'JOB_WORK_OUTPUT_IN' THEN 'JOB_WORK_CANCEL'
                WHEN 'JOB_WORK_OUT' THEN 'JOB_WORK_CANCEL'
                WHEN 'JOB_WORK_RETURN_IN' THEN 'JOB_WORK_CANCEL'
                WHEN 'PURCHASE_IN' THEN 'PURCHASE_CANCEL'
                WHEN 'SALE_OUT' THEN 'SALE_CANCEL'
                ELSE NULL
              END
      ), 0) AS net_dup_count
    FROM dup_groups dg
  )
  SELECT
    'REC-001|' || entry_type || '|' || COALESCE(reference_id::text, '') || '|' ||
      COALESCE(purchase_line_id, '') || '|' || COALESCE(sub_purchase_line_id, '') || '|' || quantity::text ||
      '|' || entry_date::text AS fingerprint,
    CASE
      WHEN spread < INTERVAL '1 hour' THEN 'HIGH'
      WHEN spread < INTERVAL '30 days' THEN 'MEDIUM'
      ELSE 'LOW'
    END AS severity,
    company_id, warehouse_id, material_type_id, material_size_id, purchase_line_id,
    reference_type AS source_document_type, reference_id AS source_document_id,
    COALESCE(purchase_line_id, sub_purchase_line_id) AS source_line_id,
    reference_numbers[1] AS reference_number,
    NULL::numeric AS expected_value, NULL::numeric AS actual_value, (quantity * (net_dup_count - 1)) AS difference,
    format('%s duplicate %s rows (qty %s each, dated %s) found for the same %s/line', net_dup_count, entry_type, quantity,
           entry_date, COALESCE(reference_type, 'reference')) AS summary,
    format('%s rows share identical entry_type, source reference, line, quantity and entry_date — expected exactly 1 (after netting out %s offsetting cancel row(s)).', net_dup_count, dup_count - net_dup_count) AS explanation,
    'Likely a double-submit or repeated edit-save posting the same event more than once.' AS suspected_cause,
    jsonb_build_object(
      'confidence', CASE
        WHEN spread < INTERVAL '1 hour' THEN 'CONFIRMED'
        WHEN spread < INTERVAL '30 days' THEN 'HIGH_PROBABILITY'
        ELSE 'REVIEW_REQUIRED'
      END,
      'duplicate_ledger_ids', to_jsonb(ids),
      'created_ats', to_jsonb(created_ats),
      'created_at_spread_seconds', EXTRACT(EPOCH FROM spread),
      'dup_count', dup_count,
      'net_dup_count', net_dup_count,
      'entry_date', entry_date
    ) AS evidence
  FROM adjusted
  WHERE net_dup_count > 1;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_reconcile_rec_013(p_company_id UUID, p_from_date DATE, p_to_date DATE)
RETURNS SETOF reconciliation_candidate AS $$
  WITH zero_scopes AS (
    SELECT company_id, warehouse_id, material_type_id, material_size_id
    FROM vw_current_warehouse_stock
    WHERE ABS(current_stock) <= 0.001
      AND (p_company_id IS NULL OR company_id = p_company_id)
  ),
  dup_groups AS (
    SELECT sl.company_id, sl.warehouse_id, sl.material_type_id, sl.material_size_id,
           sl.entry_type, sl.reference_type, sl.reference_id, sl.purchase_line_id, sl.quantity, sl.entry_date,
           count(*) AS dup_count
    FROM stock_ledger sl
    JOIN zero_scopes z ON z.company_id = sl.company_id AND z.warehouse_id = sl.warehouse_id
      AND z.material_type_id = sl.material_type_id
      AND (z.material_size_id = sl.material_size_id OR (z.material_size_id IS NULL AND sl.material_size_id IS NULL))
    WHERE sl.entry_date BETWEEN p_from_date AND p_to_date
    -- Same duplicate identity as REC-001 (141): entry_date is part of the key.
    GROUP BY sl.company_id, sl.warehouse_id, sl.material_type_id, sl.material_size_id,
             sl.entry_type, sl.reference_type, sl.reference_id, sl.purchase_line_id, sl.quantity, sl.entry_date
    HAVING count(*) > 1
  ),
  suspect_dupes AS (
    SELECT DISTINCT dg.company_id, dg.warehouse_id, dg.material_type_id, dg.material_size_id
    FROM dup_groups dg
    WHERE dg.dup_count - COALESCE((
      SELECT COUNT(*) FROM stock_ledger c
      WHERE c.reference_type IS NOT DISTINCT FROM dg.reference_type
        AND c.reference_id IS NOT DISTINCT FROM dg.reference_id
        AND c.company_id = dg.company_id AND c.warehouse_id = dg.warehouse_id
        AND c.material_type_id = dg.material_type_id
        AND c.material_size_id IS NOT DISTINCT FROM dg.material_size_id
        AND c.quantity = -dg.quantity
        AND c.entry_type = CASE dg.entry_type
              WHEN 'JOB_WORK_OUTPUT_IN' THEN 'JOB_WORK_CANCEL'
              WHEN 'JOB_WORK_OUT' THEN 'JOB_WORK_CANCEL'
              WHEN 'JOB_WORK_RETURN_IN' THEN 'JOB_WORK_CANCEL'
              WHEN 'PURCHASE_IN' THEN 'PURCHASE_CANCEL'
              WHEN 'SALE_OUT' THEN 'SALE_CANCEL'
              ELSE NULL
            END
    ), 0) > 1
  )
  SELECT
    'REC-013|' || company_id::text || '|' || warehouse_id::text || '|' || material_type_id::text || '|' || COALESCE(material_size_id::text, 'null') AS fingerprint,
    'LOW' AS severity, company_id, warehouse_id, material_type_id, material_size_id, NULL::text,
    NULL::text, NULL::uuid, NULL::text, NULL::text,
    0::numeric, 0::numeric, 0::numeric,
    'Zero-balance item has a duplicate ledger event in its history — the zero may be coincidental, not clean' AS summary,
    'This item currently nets to zero, but its ledger history contains an exact-duplicate row pattern (see REC-001) in the same scope. The zero could be two defects cancelling out rather than a genuinely balanced set of transactions.' AS explanation,
    'Run REC-001 scoped to this item/warehouse for the specific duplicate rows.' AS suspected_cause,
    jsonb_build_object('confidence', 'REVIEW_REQUIRED') AS evidence
  FROM suspect_dupes;
$$ LANGUAGE sql STABLE;
