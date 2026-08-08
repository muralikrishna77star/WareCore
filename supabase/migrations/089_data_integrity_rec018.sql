-- ============================================================
-- REC-018 — Unbalanced vendor-held stock
-- ============================================================
-- Cross-checks the two independently-computed notions of "stock currently
-- held at a job-work vendor" that already exist in this schema and were
-- never checked against each other (see CURRENT_STATE_AUDIT.md §7):
--   - vw_current_vendor_stock (087, this package): derived from
--     stock_ledger via VENDOR_MOVEMENT_TYPES.
--   - v_stock_at_vendors (latest body: 056_job_work_vendor_transfer.sql):
--     derived directly from job_work_items columns
--     (quantity_sent - quantity_received - quantity_transferred_out),
--     restricted to orders with status IN ('dispatched', 'partial_return').
--
-- v_stock_at_vendors groups by size_label (text) rather than
-- material_size_id, so the join key here is (company_id, vendor_id,
-- material_type_id, size_label) with NULL-safe comparison for size_label —
-- same class of bug as REC-005's original NULL-join issue, avoided here
-- from the start with IS NOT DISTINCT FROM.
--
-- v_stock_at_vendors deliberately excludes 'completed'/'cancelled' orders;
-- vw_current_vendor_stock is order-status-agnostic (it just sums ledger
-- rows). A completed order whose raw material didn't fully net back to
-- zero in the ledger is exactly the kind of drift this rule exists to
-- catch — that's not a false positive, it's the point.
CREATE OR REPLACE FUNCTION fn_reconcile_rec_018(p_company_id UUID, p_from_date DATE, p_to_date DATE)
RETURNS SETOF reconciliation_candidate AS $$
  -- Current balance is inherently point-in-time, not a period sum — unlike
  -- the movement-scanning rules, p_from_date/p_to_date aren't applied to
  -- either side here (kept in the signature only for calling-convention
  -- consistency with every other fn_reconcile_rec_XXX()).
  WITH ledger_side AS (
    SELECT company_id, vendor_id, material_type_id, size_label, current_vendor_stock
    FROM vw_current_vendor_stock
    WHERE (p_company_id IS NULL OR company_id = p_company_id)
  ),
  source_side AS (
    SELECT company_id, vendor_id, material_type_id, size_label, SUM(pending_quantity) AS pending_quantity
    FROM v_stock_at_vendors
    WHERE (p_company_id IS NULL OR company_id = p_company_id)
    GROUP BY company_id, vendor_id, material_type_id, size_label
  ),
  compared AS (
    SELECT
      COALESCE(l.company_id, s.company_id) AS company_id,
      COALESCE(l.vendor_id, s.vendor_id) AS vendor_id,
      COALESCE(l.material_type_id, s.material_type_id) AS material_type_id,
      COALESCE(l.size_label, s.size_label) AS size_label,
      COALESCE(l.current_vendor_stock, 0) AS ledger_balance,
      COALESCE(s.pending_quantity, 0) AS source_balance
    FROM ledger_side l
    FULL OUTER JOIN source_side s
      ON s.company_id = l.company_id AND s.vendor_id = l.vendor_id AND s.material_type_id = l.material_type_id
      AND s.size_label IS NOT DISTINCT FROM l.size_label
  )
  SELECT
    'REC-018|' || company_id::text || '|' || vendor_id::text || '|' || material_type_id::text || '|' || COALESCE(size_label, 'null') AS fingerprint,
    'HIGH' AS severity,
    company_id, NULL::uuid, material_type_id, NULL::uuid, NULL::text,
    'job_work' AS source_document_type, vendor_id AS source_document_id, NULL::text, NULL::text,
    source_balance AS expected_value, ledger_balance AS actual_value, (ledger_balance - source_balance) AS difference,
    format('Vendor-held stock disagrees: ledger says %s, job_work_items says %s', ledger_balance, source_balance) AS summary,
    'vw_current_vendor_stock (derived from stock_ledger) and v_stock_at_vendors (derived from job_work_items.quantity_sent/received/transferred_out) should always agree for the same vendor/material/size and currently do not.' AS explanation,
    'A job-work return, transfer, or cancellation updated one side (the ledger or the source columns) without updating the other.' AS suspected_cause,
    jsonb_build_object('confidence', 'HIGH_PROBABILITY', 'ledger_balance', ledger_balance, 'source_balance', source_balance) AS evidence
  FROM compared
  WHERE ABS(ledger_balance - source_balance) > 0.001;
$$ LANGUAGE sql STABLE;

UPDATE reconciliation_rules SET is_enabled = TRUE, version = version + 1 WHERE rule_code = 'REC-018';
