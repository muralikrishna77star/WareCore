-- ============================================================
-- Migration 128: fix 4 reconciliation rule bugs found while triaging the
-- 24 open Data Integrity exceptions on 2026-08-31 (REC-001, REC-009,
-- REC-013, REC-014)
-- ============================================================
-- All three are bugs in the RULE functions themselves (false positives),
-- not in the underlying stock_ledger data. Confirmed by hand against real
-- rows for JW-MT76QJZ5-5J4E (REC-001/REC-009) and the b8c97094 scope
-- (REC-014) before writing this fix. No stock_ledger/job_work_items row is
-- touched by this migration — only the 3 rule functions and the canonical
-- fn_stock_movement_history() they depend on. Re-running a full scan after
-- this ships will auto-resolve every exception these rules stop detecting
-- (see src/lib/dataIntegrity/engine.ts's autoResolveSql).
--
-- 1. REC-001 (exact duplicate ledger event): flagged 2 JOB_WORK_OUTPUT_IN
--    rows of the same quantity as a "duplicate" without accounting for an
--    intervening JOB_WORK_CANCEL that reversed the first one before the
--    second was posted (Edit Order's "Output line corrected" flow, see
--    114_job_work_edit_targeted_diff.sql). Net ledger effect was already
--    correct (0.980 total received, not 1.960) — the rule just couldn't
--    see the offsetting cancel. Fix: subtract matching offsetting
--    PURCHASE_CANCEL/SALE_CANCEL/JOB_WORK_CANCEL rows (same reference,
--    scope, and quantity magnitude) from the raw duplicate count before
--    deciding something is actually duplicated.
--
-- 2. REC-009 (Job Work equation mismatch): compared job_work_items.
--    quantity_received against ONLY the ledger's JOB_WORK_RETURN_IN sum,
--    on the documented assumption that quantity_received means "raw
--    material physically returned". That assumption stopped being true in
--    069_job_work_derived_return_no_phantom_ledger.sql: quantity_received
--    is now vendor_direct_baseline + an output-derived portion, and the
--    output-derived portion is backed by JOB_WORK_OUTPUT_IN rows, not
--    JOB_WORK_RETURN_IN (posting both would double-count — that's the
--    whole point of 069's warecore.skip_job_work_return_trigger guard).
--    Verified on JW-MT76QJZ5-5J4E: for both its lines, ledger_received
--    (RETURN_IN only) + ledger_output_in (OUTPUT_IN) sums exactly to
--    quantity_received, to the thousandth. Fix: add ledger_output_in to
--    the comparison.
--
-- 3. REC-014 (report equation mismatch): asserts fn_stock_movement_history's
--    final running_balance equals fn_stock_balance_as_of for the same
--    scope/date. To find "the final row" it re-sorts in reverse and takes
--    LIMIT 1, but the reverse sort's last tiebreak was `id DESC` while the
--    forward SUM OVER window's tiebreak stopped at `created_at` (never
--    including id, and fn_stock_movement_history didn't even expose
--    created_at as an output column) — the two orderings weren't true
--    reverses of each other. For the b8c97094 scope this reproduced
--    exactly: two JOB_WORK_OUT rows for -3.260 share both entry_date AND
--    created_at (inserted in the same statement), so the forward window
--    has no deterministic tiebreak between them at all, and the reverse
--    pick's `id DESC` (a random UUID, unrelated to insertion order) could
--    land on the row with a mid-traversal balance (3.260) instead of the
--    true final one (0.000). Fix: give both orderings the same explicit,
--    fully-deterministic final tiebreak (id) so the reverse pick is a true
--    mirror of the forward computation.
-- ============================================================

-- ---- fn_stock_movement_history: expose created_at, add id as the final
-- ---- deterministic tiebreak (needed for REC-014's reverse pick to be a
-- ---- true mirror of the forward SUM OVER window). Changing the RETURNS
-- ---- TABLE shape requires DROP + CREATE, not CREATE OR REPLACE.
DROP FUNCTION IF EXISTS fn_stock_movement_history(UUID, UUID, UUID, UUID, DATE, DATE);

CREATE FUNCTION fn_stock_movement_history(
  p_material_type_id UUID,
  p_material_size_id UUID,
  p_company_id UUID,
  p_warehouse_id UUID,
  p_from_date DATE,
  p_to_date DATE
) RETURNS TABLE (
  id UUID,
  entry_type TEXT,
  entry_date DATE,
  created_at TIMESTAMPTZ,
  quantity NUMERIC,
  running_balance NUMERIC,
  reference_type TEXT,
  reference_id UUID,
  reference_number TEXT,
  purchase_line_id TEXT,
  is_cancellation BOOLEAN
) AS $$
  SELECT
    sl.id,
    sl.entry_type,
    sl.entry_date,
    sl.created_at,
    sl.quantity,
    SUM(sl.quantity) OVER (
      ORDER BY sl.entry_date, sl.quantity DESC, sl.created_at, sl.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) + fn_stock_balance_as_of(p_material_type_id, p_material_size_id, p_company_id, p_warehouse_id, p_from_date - 1) AS running_balance,
    sl.reference_type,
    sl.reference_id,
    sl.reference_number,
    sl.purchase_line_id,
    sl.entry_type IN ('PURCHASE_CANCEL', 'SALE_CANCEL', 'JOB_WORK_CANCEL') AS is_cancellation
  FROM stock_ledger sl
  WHERE sl.material_type_id = p_material_type_id
    AND (sl.material_size_id = p_material_size_id OR (p_material_size_id IS NULL AND sl.material_size_id IS NULL))
    AND (p_company_id IS NULL OR sl.company_id = p_company_id)
    AND (p_warehouse_id IS NULL OR sl.warehouse_id = p_warehouse_id)
    AND sl.entry_date BETWEEN p_from_date AND p_to_date
  ORDER BY sl.entry_date, sl.quantity DESC, sl.created_at, sl.id;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION fn_stock_movement_history IS
  'Canonical movement history with running balance for REC-014 (report equation) and for future report migration onto this layer. Opening balance for the range comes from fn_stock_balance_as_of at (from_date - 1); running_balance at the last row must equal fn_stock_balance_as_of(..., to_date) — REC-014 asserts exactly that. Ordering is fully deterministic (entry_date, quantity DESC, created_at, id) so any reverse-order "last row" pick can mirror it exactly — see migration 128.';

-- ---- REC-001: don't count a row as duplicated when an offsetting cancel
-- ---- (same reference/scope, opposite quantity) already reverses one of
-- ---- the occurrences.
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
      AND (purchase_line_id IS NOT NULL OR sub_purchase_line_id IS NOT NULL OR reference_id IS NOT NULL)
    GROUP BY entry_type, reference_type, reference_id, purchase_line_id, sub_purchase_line_id,
             company_id, warehouse_id, material_type_id, material_size_id, quantity
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
    NULL::numeric AS expected_value, NULL::numeric AS actual_value, (quantity * (net_dup_count - 1)) AS difference,
    format('%s duplicate %s rows (qty %s each) found for the same %s/line', net_dup_count, entry_type, quantity,
           COALESCE(reference_type, 'reference')) AS summary,
    format('%s rows share identical entry_type, source reference, line, and quantity — expected exactly 1 (after netting out %s offsetting cancel row(s)).', net_dup_count, dup_count - net_dup_count) AS explanation,
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
      'net_dup_count', net_dup_count
    ) AS evidence
  FROM adjusted
  WHERE net_dup_count > 1;
$$ LANGUAGE sql STABLE;

-- ---- REC-009: quantity_received (per 069_job_work_derived_return_no_
-- ---- phantom_ledger.sql) is vendor_direct_baseline (RETURN_IN-backed) +
-- ---- output-derived portion (OUTPUT_IN-backed, RETURN_IN deliberately
-- ---- skipped to avoid double-counting) — compare it against the sum of
-- ---- both ledger legs, not RETURN_IN alone.
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
           -- JOB_WORK_CANCEL is netted in here too: within a scope that
           -- still has live job_work_items rows, a surviving CANCEL row
           -- almost always reverses a corrected OUTPUT_IN/RETURN_IN (Edit
           -- Order's "Output line corrected" flow), not a whole-line
           -- removal — a full line delete's CANCEL (reversing
           -- quantity_sent) only survives in-scope if a sibling line here
           -- was deleted, which would surface as its own new mismatch to
           -- investigate rather than silently miscorrecting anything.
           COALESCE((SELECT SUM(sl.quantity) FROM stock_ledger sl WHERE sl.reference_type = 'job_work' AND sl.reference_id = jwo.id
                     AND sl.entry_type IN ('JOB_WORK_OUTPUT_IN', 'JOB_WORK_CANCEL') AND sl.material_type_id = jwi.material_type_id
                     AND (sl.material_size_id = jwi.material_size_id OR (sl.material_size_id IS NULL AND jwi.material_size_id IS NULL))), 0) AS ledger_output_in,
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
    'One or more of quantity_sent/quantity_received/quantity_transferred_out (summed across every job_work_items line sharing this order+material+size) disagrees with the corresponding ledger total for this scope. quantity_received compares against JOB_WORK_RETURN_IN + JOB_WORK_OUTPUT_IN combined — see 069_job_work_derived_return_no_phantom_ledger.sql for why quantity_received is backed by both ledger legs.' AS explanation,
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

-- ---- REC-013: same offsetting-cancel blind spot as REC-001 (which it
-- ---- explicitly defers to — "Run REC-001 scoped to this item/warehouse
-- ---- for the specific duplicate rows"), just with its own independent
-- ---- duplicate-detection query. Apply the identical net-of-cancel fix so
-- ---- it doesn't advise investigating a REC-001 duplicate that REC-001
-- ---- itself no longer considers one.
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
           sl.entry_type, sl.reference_type, sl.reference_id, sl.purchase_line_id, sl.quantity,
           count(*) AS dup_count
    FROM stock_ledger sl
    JOIN zero_scopes z ON z.company_id = sl.company_id AND z.warehouse_id = sl.warehouse_id
      AND z.material_type_id = sl.material_type_id
      AND (z.material_size_id = sl.material_size_id OR (z.material_size_id IS NULL AND sl.material_size_id IS NULL))
    WHERE sl.entry_date BETWEEN p_from_date AND p_to_date
    GROUP BY sl.company_id, sl.warehouse_id, sl.material_type_id, sl.material_size_id,
             sl.entry_type, sl.reference_type, sl.reference_id, sl.purchase_line_id, sl.quantity
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

-- ---- REC-014: mirror the forward window's ordering exactly (now that
-- ---- fn_stock_movement_history exposes created_at and both orderings
-- ---- include id as a final deterministic tiebreak).
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
           (SELECT h.running_balance FROM fn_stock_movement_history(s.material_type_id, s.material_size_id, s.company_id, s.warehouse_id, p_from_date, p_to_date) h
            ORDER BY h.entry_date DESC, h.quantity ASC, h.created_at DESC, h.id DESC LIMIT 1) AS computed_closing
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
