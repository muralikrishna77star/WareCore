-- ============================================================
-- Reconciliation rule functions — Phase 1 implemented subset
-- ============================================================
-- Each fn_reconcile_rec_XXX() returns candidate exceptions for one rule as
-- a uniform row shape, so the orchestration layer (src/lib/dataIntegrity)
-- can upsert them into reconciliation_exceptions the same way regardless of
-- rule. These are pure SELECT functions — none of them write anything.
-- p_company_id/p_from_date/p_to_date scope the scan; NULL company_id means
-- all companies. Dates scope by stock_ledger.entry_date.
--
-- Implemented here: REC-001, REC-002, REC-003, REC-005, REC-007, REC-008,
-- REC-009, REC-013, REC-014 (matching reconciliation_rules.is_enabled = TRUE
-- from 086). The remaining 9 catalogued rules are documented, not coded, in
-- this release — see docs/data-integrity/RULE_CATALOGUE.md.

CREATE TYPE reconciliation_candidate AS (
  fingerprint TEXT,
  severity TEXT,
  company_id UUID,
  warehouse_id UUID,
  material_type_id UUID,
  material_size_id UUID,
  purchase_line_id TEXT,
  source_document_type TEXT,
  source_document_id UUID,
  source_line_id TEXT,
  reference_number TEXT,
  expected_value NUMERIC,
  actual_value NUMERIC,
  difference NUMERIC,
  summary TEXT,
  explanation TEXT,
  suspected_cause TEXT,
  evidence JSONB
);

-- ============================================================
-- REC-001 — Exact duplicate ledger event
-- ============================================================
-- Groups rows sharing every business-identity column (entry type, source
-- document, line, item, company, warehouse, quantity) and confidence-scores
-- each duplicate pair by how close together they were created — the exact
-- signature of a double-submit, which is what caused the CR00700 defect
-- (two PURCHASE_CANCEL rows created 2m43s apart). Two legitimate identical
-- movements are never auto-deleted here — this only ever proposes a
-- REVIEW_REQUIRED-or-better candidate, never takes action.
CREATE OR REPLACE FUNCTION fn_reconcile_rec_001(p_company_id UUID, p_from_date DATE, p_to_date DATE)
RETURNS SETOF reconciliation_candidate AS $$
  WITH dup_groups AS (
    SELECT
      entry_type, reference_type, reference_id, purchase_line_id, sub_purchase_line_id,
      company_id, warehouse_id, material_type_id, material_size_id, quantity,
      array_agg(id ORDER BY created_at) AS ids,
      array_agg(created_at ORDER BY created_at) AS created_ats,
      array_agg(reference_number ORDER BY created_at) AS reference_numbers,
      count(*) AS dup_count,
      max(created_at) - min(created_at) AS spread
    FROM stock_ledger
    WHERE (p_company_id IS NULL OR company_id = p_company_id)
      AND entry_date BETWEEN p_from_date AND p_to_date
      -- A row with no line/reference identity at all can't be safely
      -- fingerprinted as a duplicate of another such row (too coarse) —
      -- require at least one stable line/reference key.
      AND (purchase_line_id IS NOT NULL OR sub_purchase_line_id IS NOT NULL OR reference_id IS NOT NULL)
    GROUP BY entry_type, reference_type, reference_id, purchase_line_id, sub_purchase_line_id,
             company_id, warehouse_id, material_type_id, material_size_id, quantity
    HAVING count(*) > 1
  )
  SELECT
    'REC-001|' || entry_type || '|' || COALESCE(reference_id::text, '') || '|' ||
      COALESCE(purchase_line_id, '') || '|' || COALESCE(sub_purchase_line_id, '') || '|' || quantity::text AS fingerprint,
    CASE
      WHEN spread < INTERVAL '1 hour' THEN 'HIGH'
      WHEN spread < INTERVAL '30 days' THEN 'MEDIUM'
      ELSE 'LOW'
    END AS severity,
    company_id, warehouse_id, material_type_id, material_size_id, purchase_line_id,
    reference_type AS source_document_type, reference_id AS source_document_id,
    COALESCE(purchase_line_id, sub_purchase_line_id) AS source_line_id,
    reference_numbers[1] AS reference_number,
    NULL::numeric AS expected_value, NULL::numeric AS actual_value, (quantity * (dup_count - 1)) AS difference,
    format('%s duplicate %s rows (qty %s each) found for the same %s/line', dup_count, entry_type, quantity,
           COALESCE(reference_type, 'reference')) AS summary,
    format('%s rows share identical entry_type, source reference, line, and quantity — expected exactly 1.', dup_count) AS explanation,
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
      'dup_count', dup_count
    ) AS evidence
  FROM dup_groups;
$$ LANGUAGE sql STABLE;

-- ============================================================
-- REC-002 — Missing ledger posting (purchase + dispatch)
-- ============================================================
-- Purchase side is exact, line-level (purchase_bill_items.purchase_line_id
-- is stored verbatim on stock_ledger.purchase_line_id). Dispatch side is
-- order-level: dispatch_items has no stable per-line id carried onto
-- stock_ledger (unlike purchase), so this checks total dispatched quantity
-- per order against total |SALE_OUT| for that order — coarser than the
-- purchase check, documented as a known limitation, not a hidden gap.
CREATE OR REPLACE FUNCTION fn_reconcile_rec_002(p_company_id UUID, p_from_date DATE, p_to_date DATE)
RETURNS SETOF reconciliation_candidate AS $$
  WITH missing_purchase AS (
    SELECT pbi.id, pb.company_id, pb.warehouse_id, pbi.material_type_id, pbi.material_size_id,
           pbi.purchase_line_id, pb.id AS bill_id, pb.bill_number, pbi.quantity
    FROM purchase_bill_items pbi
    JOIN purchase_bills pb ON pb.id = pbi.bill_id
    WHERE pb.status = 'active'
      AND (p_company_id IS NULL OR pb.company_id = p_company_id)
      AND pb.bill_date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (
        SELECT 1 FROM stock_ledger sl
        WHERE sl.purchase_line_id = pbi.purchase_line_id AND sl.entry_type = 'PURCHASE_IN'
      )
  ),
  missing_dispatch AS (
    SELECT do2.id AS order_id, do2.company_id, do2.warehouse_id, do2.invoice_number,
           SUM(di.quantity) AS total_dispatched,
           COALESCE((SELECT SUM(-sl.quantity) FROM stock_ledger sl
                     WHERE sl.reference_type = 'dispatch' AND sl.reference_id = do2.id AND sl.entry_type = 'SALE_OUT'), 0) AS total_posted
    FROM dispatch_orders do2
    JOIN dispatch_items di ON di.dispatch_order_id = do2.id
    WHERE do2.status = 'active'
      AND (p_company_id IS NULL OR do2.company_id = p_company_id)
      AND do2.dispatch_date BETWEEN p_from_date AND p_to_date
    GROUP BY do2.id, do2.company_id, do2.warehouse_id, do2.invoice_number
    HAVING SUM(di.quantity) - COALESCE((SELECT SUM(-sl.quantity) FROM stock_ledger sl
             WHERE sl.reference_type = 'dispatch' AND sl.reference_id = do2.id AND sl.entry_type = 'SALE_OUT'), 0) > 0.001
  )
  SELECT
    'REC-002|purchase|' || purchase_line_id AS fingerprint,
    'HIGH' AS severity, company_id, warehouse_id, material_type_id, material_size_id, purchase_line_id,
    'purchase_bill' AS source_document_type, bill_id AS source_document_id, purchase_line_id AS source_line_id,
    bill_number AS reference_number,
    quantity AS expected_value, 0::numeric AS actual_value, quantity AS difference,
    format('Active purchase line %s has no PURCHASE_IN ledger row', purchase_line_id) AS summary,
    'This line is on an active (non-draft, non-cancelled) purchase bill but never posted to stock_ledger.' AS explanation,
    'Possible trigger failure, or the line was inserted through a path that bypassed fn_bill_item_to_ledger().' AS suspected_cause,
    jsonb_build_object('confidence', 'HIGH_PROBABILITY') AS evidence
  FROM missing_purchase
  UNION ALL
  SELECT
    'REC-002|dispatch|' || order_id::text AS fingerprint,
    'HIGH' AS severity, company_id, warehouse_id, NULL::uuid, NULL::uuid, NULL::text,
    'dispatch' AS source_document_type, order_id AS source_document_id, NULL::text,
    invoice_number AS reference_number,
    total_dispatched AS expected_value, total_posted AS actual_value, (total_dispatched - total_posted) AS difference,
    format('Active dispatch %s: dispatched %s but only %s posted to the ledger', invoice_number, total_dispatched, total_posted) AS summary,
    'Order-level check (dispatch has no stable per-line ledger key) — total dispatched quantity exceeds total |SALE_OUT| posted for this order.' AS explanation,
    'Possible trigger failure, edit that removed ledger rows without reposting, or a still-draft order miscounted as active.' AS suspected_cause,
    jsonb_build_object('confidence', 'REVIEW_REQUIRED', 'granularity', 'order-level') AS evidence
  FROM missing_dispatch;
$$ LANGUAGE sql STABLE;

-- ============================================================
-- REC-003 — Orphan ledger entry
-- ============================================================
-- Mirrors the exact live/archive-table pairing already used by
-- reports/item-ledger/page.tsx's findOrphanedReferences() and
-- /api/stock/verify's stale-records query, expressed once here as the
-- canonical version. A reference absent from the live table but present in
-- its archive table is a legitimate cancelled-and-purged record, not an
-- orphan.
CREATE OR REPLACE FUNCTION fn_reconcile_rec_003(p_company_id UUID, p_from_date DATE, p_to_date DATE)
RETURNS SETOF reconciliation_candidate AS $$
  SELECT
    'REC-003|' || sl.id::text AS fingerprint,
    'MEDIUM' AS severity, sl.company_id, sl.warehouse_id, sl.material_type_id, sl.material_size_id, sl.purchase_line_id,
    sl.reference_type AS source_document_type, sl.reference_id AS source_document_id, sl.purchase_line_id AS source_line_id,
    sl.reference_number,
    NULL::numeric, sl.quantity, sl.quantity,
    format('%s row references a %s that no longer exists (live or archived)', sl.entry_type, sl.reference_type) AS summary,
    'reference_id resolves to nothing in either the live source table or its cancellation/archive table.' AS explanation,
    'Source document was hard-deleted without cleaning up its ledger trace, or reference_id was corrupted/mistyped.' AS suspected_cause,
    jsonb_build_object('confidence', 'HIGH_PROBABILITY', 'ledger_id', sl.id) AS evidence
  FROM stock_ledger sl
  WHERE (p_company_id IS NULL OR sl.company_id = p_company_id)
    AND sl.entry_date BETWEEN p_from_date AND p_to_date
    AND sl.reference_id IS NOT NULL
    AND (
      (sl.reference_type = 'purchase_bill' AND NOT EXISTS (SELECT 1 FROM purchase_bills b WHERE b.id = sl.reference_id)
        AND NOT EXISTS (SELECT 1 FROM purchase_cancellations pc WHERE pc.original_bill_id = sl.reference_id))
      OR (sl.reference_type = 'dispatch' AND NOT EXISTS (SELECT 1 FROM dispatch_orders d WHERE d.id = sl.reference_id)
        AND NOT EXISTS (SELECT 1 FROM dispatch_cancellations dc WHERE dc.original_order_id = sl.reference_id))
      OR (sl.reference_type = 'job_work' AND NOT EXISTS (SELECT 1 FROM job_work_orders j WHERE j.id = sl.reference_id)
        AND NOT EXISTS (SELECT 1 FROM job_work_cancellations jc WHERE jc.original_order_id = sl.reference_id))
      OR (sl.reference_type = 'transfer' AND NOT EXISTS (SELECT 1 FROM transfers t WHERE t.id = sl.reference_id))
    );
$$ LANGUAGE sql STABLE;

-- ============================================================
-- REC-005 — Negative warehouse stock
-- ============================================================
-- Per company/warehouse/material/size scope, walks the full chronological
-- history (never reordered for display) and reports the minimum balance
-- ever reached and the current balance. Only scopes whose minimum
-- historical balance actually went below -tolerance are returned.
CREATE OR REPLACE FUNCTION fn_reconcile_rec_005(p_company_id UUID, p_from_date DATE, p_to_date DATE)
RETURNS SETOF reconciliation_candidate AS $$
  WITH running AS (
    SELECT
      company_id, warehouse_id, material_type_id, material_size_id, purchase_line_id,
      id, entry_type, quantity, entry_date, created_at,
      SUM(quantity) OVER (
        PARTITION BY company_id, warehouse_id, material_type_id, material_size_id
        ORDER BY entry_date, quantity DESC, created_at
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS running_balance
    FROM stock_ledger
    WHERE (p_company_id IS NULL OR company_id = p_company_id)
  ),
  scoped AS (
    SELECT * FROM running WHERE entry_date BETWEEN p_from_date AND p_to_date
  ),
  worst AS (
    SELECT DISTINCT ON (company_id, warehouse_id, material_type_id, material_size_id)
      company_id, warehouse_id, material_type_id, material_size_id,
      id AS worst_ledger_id, entry_type AS worst_entry_type, entry_date AS worst_date, running_balance AS min_balance
    FROM scoped
    ORDER BY company_id, warehouse_id, material_type_id, material_size_id, running_balance ASC
  ),
  latest AS (
    -- Same fix as REC-014's computed_closing subquery: to find the LAST row
    -- in the window's own ascending traversal (entry_date ASC, quantity
    -- DESC, created_at ASC), the reverse-order pick must flip quantity to
    -- ASC too, not just entry_date/created_at to DESC. Using quantity DESC
    -- here again could, for a scope with more than one row on its latest
    -- entry_date, report the wrong row's cumulative value as "current
    -- balance" (only this reported value / severity classification was at
    -- risk — min_balance below is a true MIN over all rows and unaffected).
    SELECT DISTINCT ON (company_id, warehouse_id, material_type_id, material_size_id)
      company_id, warehouse_id, material_type_id, material_size_id, running_balance AS current_balance
    FROM running
    ORDER BY company_id, warehouse_id, material_type_id, material_size_id, entry_date DESC, quantity ASC, created_at DESC
  )
  SELECT
    'REC-005|' || w.company_id::text || '|' || w.warehouse_id::text || '|' || w.material_type_id::text || '|' || COALESCE(w.material_size_id::text, 'null') AS fingerprint,
    CASE WHEN l.current_balance < -0.001 THEN 'CRITICAL' ELSE 'HIGH' END AS severity,
    w.company_id, w.warehouse_id, w.material_type_id, w.material_size_id, NULL::text,
    NULL::text, NULL::uuid, w.worst_ledger_id::text,
    NULL::text,
    0::numeric, w.min_balance, w.min_balance,
    format('Stock went negative (minimum %s) on %s, currently %s', w.min_balance, w.worst_date, l.current_balance) AS summary,
    format('Running balance for this company/warehouse/item/size dipped to %s on %s (row %s, %s), which is physically impossible for real stock.',
           w.min_balance, w.worst_date, w.worst_ledger_id, w.worst_entry_type) AS explanation,
    'Usually a duplicate cancellation, missing inflow posting, or a transfer/job-work leg recorded against the wrong scope.' AS suspected_cause,
    jsonb_build_object('confidence', 'CONFIRMED', 'minimum_balance', w.min_balance, 'current_balance', l.current_balance, 'worst_ledger_id', w.worst_ledger_id) AS evidence
  FROM worst w
  -- material_size_id is nullable, and plain equality (what USING/ON a=b
  -- would generate) never matches NULL = NULL — IS NOT DISTINCT FROM treats
  -- two NULLs as equal, matching how DISTINCT ON already grouped them
  -- within each CTE.
  JOIN latest l ON l.company_id = w.company_id AND l.warehouse_id = w.warehouse_id
    AND l.material_type_id = w.material_type_id AND l.material_size_id IS NOT DISTINCT FROM w.material_size_id
  WHERE w.min_balance < -0.001;
$$ LANGUAGE sql STABLE;

-- ============================================================
-- REC-007 — Reversal mismatch
-- ============================================================
-- Two independent checks sharing one rule code: purchase-line cancellations
-- exceeding what was ever purchased on that line, and dispatch-order
-- cancellations exceeding what was ever dispatched on that order. This is
-- the accounting-invariant angle on the same CR00700 defect REC-001 catches
-- by duplicate-shape — it also catches cases where the two cancel rows were
-- created far enough apart that REC-001 would only rate them REVIEW_REQUIRED.
CREATE OR REPLACE FUNCTION fn_reconcile_rec_007(p_company_id UUID, p_from_date DATE, p_to_date DATE)
RETURNS SETOF reconciliation_candidate AS $$
  WITH purchase_reversal AS (
    SELECT purchase_line_id,
           (array_agg(company_id) FILTER (WHERE entry_type = 'PURCHASE_IN'))[1] AS company_id,
           (array_agg(warehouse_id) FILTER (WHERE entry_type = 'PURCHASE_IN'))[1] AS warehouse_id,
           (array_agg(material_type_id))[1] AS material_type_id,
           (array_agg(material_size_id))[1] AS material_size_id,
           (array_agg(reference_number))[1] AS reference_number,
           COALESCE(SUM(quantity) FILTER (WHERE entry_type = 'PURCHASE_IN'), 0) AS total_in,
           COALESCE(-SUM(quantity) FILTER (WHERE entry_type = 'PURCHASE_CANCEL'), 0) AS total_cancelled
    FROM stock_ledger
    WHERE purchase_line_id IS NOT NULL
      AND (p_company_id IS NULL OR company_id = p_company_id)
      AND entry_date BETWEEN p_from_date AND p_to_date
    GROUP BY purchase_line_id
    HAVING COALESCE(-SUM(quantity) FILTER (WHERE entry_type = 'PURCHASE_CANCEL'), 0)
         > COALESCE(SUM(quantity) FILTER (WHERE entry_type = 'PURCHASE_IN'), 0) + 0.001
  ),
  dispatch_reversal AS (
    SELECT reference_id AS order_id,
           (array_agg(company_id))[1] AS company_id, (array_agg(warehouse_id))[1] AS warehouse_id,
           (array_agg(reference_number))[1] AS reference_number,
           COALESCE(SUM(-quantity) FILTER (WHERE entry_type = 'SALE_OUT'), 0) AS total_out,
           COALESCE(SUM(quantity) FILTER (WHERE entry_type = 'SALE_CANCEL'), 0) AS total_cancelled
    FROM stock_ledger
    WHERE reference_type = 'dispatch'
      AND (p_company_id IS NULL OR company_id = p_company_id)
      AND entry_date BETWEEN p_from_date AND p_to_date
    GROUP BY reference_id
    HAVING COALESCE(SUM(quantity) FILTER (WHERE entry_type = 'SALE_CANCEL'), 0)
         > COALESCE(SUM(-quantity) FILTER (WHERE entry_type = 'SALE_OUT'), 0) + 0.001
  )
  SELECT
    'REC-007|purchase|' || purchase_line_id AS fingerprint,
    'HIGH' AS severity, company_id, warehouse_id, material_type_id, material_size_id, purchase_line_id,
    'purchase_bill' AS source_document_type, NULL::uuid, purchase_line_id, reference_number,
    total_in AS expected_value, total_cancelled AS actual_value, (total_cancelled - total_in) AS difference,
    format('Purchase line %s: cancelled %s but only %s was ever purchased', purchase_line_id, total_cancelled, total_in) AS summary,
    'Sum of PURCHASE_CANCEL rows exceeds the sum of PURCHASE_IN rows for this line — more was reversed than was ever posted.' AS explanation,
    'Duplicate cancellation (see REC-001) or a cancel posted against the wrong purchase_line_id.' AS suspected_cause,
    jsonb_build_object('confidence', 'CONFIRMED', 'total_in', total_in, 'total_cancelled', total_cancelled) AS evidence
  FROM purchase_reversal
  UNION ALL
  SELECT
    'REC-007|dispatch|' || order_id::text AS fingerprint,
    'HIGH' AS severity, company_id, warehouse_id, NULL::uuid, NULL::uuid, NULL::text,
    'dispatch' AS source_document_type, order_id, NULL::text, reference_number,
    total_out AS expected_value, total_cancelled AS actual_value, (total_cancelled - total_out) AS difference,
    format('Dispatch %s: cancelled %s but only %s was ever dispatched', reference_number, total_cancelled, total_out) AS summary,
    'Sum of SALE_CANCEL rows exceeds the sum of |SALE_OUT| rows for this order.' AS explanation,
    'Duplicate cancellation or a cancel posted against the wrong dispatch order.' AS suspected_cause,
    jsonb_build_object('confidence', 'CONFIRMED', 'total_out', total_out, 'total_cancelled', total_cancelled) AS evidence
  FROM dispatch_reversal;
$$ LANGUAGE sql STABLE;

-- ============================================================
-- REC-008 — Transfer pair mismatch
-- ============================================================
-- Per transfer + material/size, the sum of transfer_items.quantity must
-- equal both the |TRANSFER_OUT| at the source warehouse and the
-- |TRANSFER_IN| at the destination warehouse. Any of the three missing or
-- disagreeing is flagged.
CREATE OR REPLACE FUNCTION fn_reconcile_rec_008(p_company_id UUID, p_from_date DATE, p_to_date DATE)
RETURNS SETOF reconciliation_candidate AS $$
  WITH expected AS (
    SELECT t.id AS transfer_id, t.reference_number, t.from_company_id, t.from_warehouse_id, t.to_company_id, t.to_warehouse_id,
           ti.material_type_id, ti.material_size_id, SUM(ti.quantity) AS expected_qty
    FROM transfers t
    JOIN transfer_items ti ON ti.transfer_id = t.id
    WHERE (p_company_id IS NULL OR t.from_company_id = p_company_id OR t.to_company_id = p_company_id)
      AND t.transfer_date BETWEEN p_from_date AND p_to_date
      AND t.status <> 'cancelled'
    GROUP BY t.id, t.reference_number, t.from_company_id, t.from_warehouse_id, t.to_company_id, t.to_warehouse_id, ti.material_type_id, ti.material_size_id
  ),
  actual AS (
    SELECT
      e.transfer_id, e.reference_number, e.from_company_id, e.from_warehouse_id, e.to_company_id, e.to_warehouse_id,
      e.material_type_id, e.material_size_id, e.expected_qty,
      COALESCE((SELECT -SUM(sl.quantity) FROM stock_ledger sl WHERE sl.reference_type = 'transfer' AND sl.reference_id = e.transfer_id
                AND sl.entry_type = 'TRANSFER_OUT' AND sl.material_type_id = e.material_type_id
                AND (sl.material_size_id = e.material_size_id OR (sl.material_size_id IS NULL AND e.material_size_id IS NULL))), 0) AS out_qty,
      COALESCE((SELECT SUM(sl.quantity) FROM stock_ledger sl WHERE sl.reference_type = 'transfer' AND sl.reference_id = e.transfer_id
                AND sl.entry_type = 'TRANSFER_IN' AND sl.material_type_id = e.material_type_id
                AND (sl.material_size_id = e.material_size_id OR (sl.material_size_id IS NULL AND e.material_size_id IS NULL))), 0) AS in_qty
    FROM expected e
  )
  SELECT
    'REC-008|' || transfer_id::text || '|' || material_type_id::text || '|' || COALESCE(material_size_id::text, 'null') AS fingerprint,
    'HIGH' AS severity, from_company_id, from_warehouse_id, material_type_id, material_size_id, NULL::text,
    'transfer' AS source_document_type, transfer_id, NULL::text, reference_number,
    expected_qty AS expected_value,
    LEAST(out_qty, in_qty) AS actual_value,
    GREATEST(ABS(expected_qty - out_qty), ABS(expected_qty - in_qty)) AS difference,
    format('Transfer %s: expected %s, TRANSFER_OUT=%s, TRANSFER_IN=%s', reference_number, expected_qty, out_qty, in_qty) AS summary,
    'transfer_items quantity does not equal both ledger legs — one leg is missing, short, or over-posted.' AS explanation,
    'Trigger fired for only one leg, or an edit changed transfer_items without reposting both legs.' AS suspected_cause,
    jsonb_build_object('confidence', 'CONFIRMED', 'expected_qty', expected_qty, 'out_qty', out_qty, 'in_qty', in_qty,
                        'to_company_id', to_company_id, 'to_warehouse_id', to_warehouse_id) AS evidence
  FROM actual
  WHERE ABS(expected_qty - out_qty) > 0.001 OR ABS(expected_qty - in_qty) > 0.001;
$$ LANGUAGE sql STABLE;

-- ============================================================
-- REC-009 — Job Work equation mismatch
-- ============================================================
-- Per job_work_items line, the source-of-truth quantities
-- (quantity_sent/quantity_received/quantity_transferred_out) must match
-- what's actually posted to the ledger for that line's order. Output
-- (JOB_WORK_OUTPUT_IN) is intentionally never compared here — it's a
-- different item, not a return of the raw material (see
-- LEDGER_EVENT_MATRIX.md).
CREATE OR REPLACE FUNCTION fn_reconcile_rec_009(p_company_id UUID, p_from_date DATE, p_to_date DATE)
RETURNS SETOF reconciliation_candidate AS $$
  WITH lines AS (
    SELECT jwi.id AS line_id, jwo.id AS order_id, jwo.reference_number, jwo.company_id, jwo.warehouse_id,
           jwi.material_type_id, jwi.material_size_id,
           jwi.quantity_sent, jwi.quantity_received, jwi.quantity_transferred_out,
           COALESCE((SELECT -SUM(sl.quantity) FROM stock_ledger sl WHERE sl.reference_type = 'job_work' AND sl.reference_id = jwo.id
                     AND sl.entry_type = 'JOB_WORK_OUT' AND sl.material_type_id = jwi.material_type_id
                     AND (sl.material_size_id = jwi.material_size_id OR (sl.material_size_id IS NULL AND jwi.material_size_id IS NULL))), 0) AS ledger_sent,
           COALESCE((SELECT SUM(sl.quantity) FROM stock_ledger sl WHERE sl.reference_type = 'job_work' AND sl.reference_id = jwo.id
                     AND sl.entry_type = 'JOB_WORK_RETURN_IN' AND sl.material_type_id = jwi.material_type_id
                     AND (sl.material_size_id = jwi.material_size_id OR (sl.material_size_id IS NULL AND jwi.material_size_id IS NULL))), 0) AS ledger_received,
           COALESCE((SELECT -SUM(sl.quantity) FROM stock_ledger sl WHERE sl.reference_type = 'job_work' AND sl.reference_id = jwo.id
                     AND sl.entry_type = 'JOB_WORK_TRANSFER_OUT' AND sl.material_type_id = jwi.material_type_id
                     AND (sl.material_size_id = jwi.material_size_id OR (sl.material_size_id IS NULL AND jwi.material_size_id IS NULL))), 0) AS ledger_transferred_out
    FROM job_work_items jwi
    JOIN job_work_orders jwo ON jwo.id = jwi.job_work_order_id
    WHERE (p_company_id IS NULL OR jwo.company_id = p_company_id)
      AND jwo.dispatch_date BETWEEN p_from_date AND p_to_date
      AND jwo.status <> 'cancelled'
      AND jwi.is_transfer_line = FALSE
  )
  SELECT
    'REC-009|' || line_id::text AS fingerprint,
    'HIGH' AS severity, company_id, warehouse_id, material_type_id, material_size_id, NULL::text,
    'job_work' AS source_document_type, order_id, line_id::text, reference_number,
    quantity_sent AS expected_value, ledger_sent AS actual_value, (quantity_sent - ledger_sent) AS difference,
    format('Job Work %s line: sent=%s (ledger %s), received=%s (ledger %s), transferred_out=%s (ledger %s)',
           reference_number, quantity_sent, ledger_sent, quantity_received, ledger_received, quantity_transferred_out, ledger_transferred_out) AS summary,
    'One or more of quantity_sent/quantity_received/quantity_transferred_out on job_work_items disagrees with its corresponding ledger total for this line.' AS explanation,
    'Edit/return/transfer flow updated the source columns without reposting the ledger, or vice versa.' AS suspected_cause,
    jsonb_build_object('confidence', 'HIGH_PROBABILITY',
      'quantity_sent', quantity_sent, 'ledger_sent', ledger_sent,
      'quantity_received', quantity_received, 'ledger_received', ledger_received,
      'quantity_transferred_out', quantity_transferred_out, 'ledger_transferred_out', ledger_transferred_out) AS evidence
  FROM lines
  WHERE ABS(quantity_sent - ledger_sent) > 0.001
     OR ABS(COALESCE(quantity_received, 0) - ledger_received) > 0.001
     OR ABS(COALESCE(quantity_transferred_out, 0) - ledger_transferred_out) > 0.001;
$$ LANGUAGE sql STABLE;

-- ============================================================
-- REC-013 — Zero-stock validation
-- ============================================================
-- Zero balance is the EXPECTED, healthy state for a fully-consumed item —
-- this rule never flags a clean zero. It only surfaces a LOW-severity
-- advisory when a zero-balance scope's own history contains an exact
-- duplicate ledger event (the same shape REC-001 detects), i.e. when the
-- zero was reached by two defects cancelling each other out rather than by
-- a genuinely clean set of transactions.
CREATE OR REPLACE FUNCTION fn_reconcile_rec_013(p_company_id UUID, p_from_date DATE, p_to_date DATE)
RETURNS SETOF reconciliation_candidate AS $$
  WITH zero_scopes AS (
    SELECT company_id, warehouse_id, material_type_id, material_size_id
    FROM vw_current_warehouse_stock
    WHERE ABS(current_stock) <= 0.001
      AND (p_company_id IS NULL OR company_id = p_company_id)
  ),
  suspect_dupes AS (
    SELECT DISTINCT sl.company_id, sl.warehouse_id, sl.material_type_id, sl.material_size_id
    FROM stock_ledger sl
    JOIN zero_scopes z ON z.company_id = sl.company_id AND z.warehouse_id = sl.warehouse_id
      AND z.material_type_id = sl.material_type_id
      AND (z.material_size_id = sl.material_size_id OR (z.material_size_id IS NULL AND sl.material_size_id IS NULL))
    WHERE sl.entry_date BETWEEN p_from_date AND p_to_date
    GROUP BY sl.company_id, sl.warehouse_id, sl.material_type_id, sl.material_size_id,
             sl.entry_type, sl.reference_id, sl.purchase_line_id, sl.quantity
    HAVING count(*) > 1
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

-- ============================================================
-- REC-014 — Report equation mismatch
-- ============================================================
-- Asserts fn_stock_movement_history's own internal invariant: the running
-- balance at the last row of a range must equal fn_stock_balance_as_of at
-- the range's end date. This is a self-consistency check on the canonical
-- layer itself (Opening + Inward - Outward = Closing) — if this ever fails,
-- the canonical functions have a bug, not the data.
CREATE OR REPLACE FUNCTION fn_reconcile_rec_014(p_company_id UUID, p_from_date DATE, p_to_date DATE)
RETURNS SETOF reconciliation_candidate AS $$
  WITH scopes AS (
    SELECT DISTINCT company_id, warehouse_id, material_type_id, material_size_id
    FROM stock_ledger
    WHERE (p_company_id IS NULL OR company_id = p_company_id)
      AND entry_date BETWEEN p_from_date AND p_to_date
  ),
  checked AS (
    SELECT s.company_id, s.warehouse_id, s.material_type_id, s.material_size_id,
           fn_stock_balance_as_of(s.material_type_id, s.material_size_id, s.company_id, s.warehouse_id, p_to_date) AS expected_closing,
           -- Must pick the LAST row in fn_stock_movement_history's own
           -- traversal order (entry_date ASC, quantity DESC, created_at ASC)
           -- to get its true final cumulative value — i.e. the reverse of
           -- that order, LIMIT 1. Using quantity DESC here again (instead of
           -- ASC) was a bug: for any scope with more than one row sharing
           -- its latest entry_date, it could pick a row from the middle of
           -- that date's tie-break sequence instead of the last one,
           -- producing a false REC-014 mismatch. Found via the Stage B
           -- shadow test (docs/data-integrity/ROLLOUT_PLAN.md) against real
           -- production data — the synthetic test suite's scenarios never
           -- had more than one same-date row in a REC-014 scope, so this
           -- didn't surface until a real, denser dataset was scanned.
           (SELECT h.running_balance FROM fn_stock_movement_history(s.material_type_id, s.material_size_id, s.company_id, s.warehouse_id, p_from_date, p_to_date) h
            ORDER BY h.entry_date DESC, h.quantity ASC, h.id DESC LIMIT 1) AS computed_closing
    FROM scopes s
  )
  SELECT
    'REC-014|' || company_id::text || '|' || warehouse_id::text || '|' || material_type_id::text || '|' || COALESCE(material_size_id::text, 'null') || '|' || p_to_date::text AS fingerprint,
    'CRITICAL' AS severity, company_id, warehouse_id, material_type_id, material_size_id, NULL::text,
    NULL::text, NULL::uuid, NULL::text, NULL::text,
    expected_closing, computed_closing, (computed_closing - expected_closing),
    format('Opening + movements != Closing for this scope as of %s (expected %s, computed %s)', p_to_date, expected_closing, computed_closing) AS summary,
    'fn_stock_movement_history''s final running_balance disagrees with fn_stock_balance_as_of for the same scope and date — the two canonical calculations should always agree by construction.' AS explanation,
    'Indicates a bug in the canonical layer itself, not the underlying data — investigate fn_stock_balance_as_of/fn_stock_movement_history before trusting either.' AS suspected_cause,
    jsonb_build_object('confidence', 'CONFIRMED') AS evidence
  FROM checked
  WHERE computed_closing IS NOT NULL AND ABS(computed_closing - expected_closing) > 0.001;
$$ LANGUAGE sql STABLE;
