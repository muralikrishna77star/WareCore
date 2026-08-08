-- ============================================================
-- Canonical stock calculation layer
-- ============================================================
-- Read-only views/functions over the EXISTING stock_ledger table — nothing
-- here alters stock_ledger, and no existing report or picker is repointed
-- at these yet (per the assignment: "First create and test the canonical
-- layer... compare it against current reports, and document differences"
-- before any report migrates onto it). All arithmetic is done in Postgres
-- NUMERIC, never in application-layer floating point.
--
-- Equation: opening stock + signed movements up to the requested date =
-- closing stock. Cancellation rows always participate — there is no
-- "hide cancelled" mode here; that's strictly a presentation concern for
-- whatever UI eventually consumes this layer (see 084/this session's fix to
-- reports/item-ledger/page.tsx for the equivalent principle already applied
-- there by hand).

-- ============================================================
-- vw_stock_ledger_normalized
-- ============================================================
-- One row per stock_ledger row, with a few derived columns rule
-- implementations and reports repeatedly need: whether the row is a
-- cancellation/reversal type, and (for job-work rows only) which vendor it
-- belongs to — derived via reference_id -> job_work_orders.vendor_id, the
-- same join every job-work-aware report in this codebase already performs
-- by hand (see CURRENT_STATE_AUDIT.md §7).
CREATE VIEW vw_stock_ledger_normalized AS
SELECT
  sl.id,
  sl.entry_type,
  sl.company_id,
  sl.warehouse_id,
  sl.material_type_id,
  sl.material_size_id,
  sl.size_label,
  sl.quantity,
  sl.reference_type,
  sl.reference_id,
  sl.reference_number,
  sl.notes,
  sl.entry_date,
  sl.created_by,
  sl.created_at,
  sl.purchase_line_id,
  sl.sub_purchase_line_id,
  sl.entry_type IN ('PURCHASE_CANCEL', 'SALE_CANCEL', 'JOB_WORK_CANCEL') AS is_cancellation,
  sl.entry_type IN ('JOB_WORK_OUT', 'JOB_WORK_RETURN_IN', 'JOB_WORK_CANCEL', 'JOB_WORK_TRANSFER_OUT', 'JOB_WORK_TRANSFER_IN') AS is_vendor_movement,
  sl.entry_type IN ('VENDOR_RETURN_IN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT') AS is_unreachable_entry_type,
  CASE WHEN sl.reference_type = 'job_work' THEN jwo.vendor_id ELSE NULL END AS vendor_id
FROM stock_ledger sl
LEFT JOIN job_work_orders jwo ON jwo.id = sl.reference_id AND sl.reference_type = 'job_work';

COMMENT ON VIEW vw_stock_ledger_normalized IS
  'stock_ledger with derived is_cancellation/is_vendor_movement/vendor_id columns. is_unreachable_entry_type flags VENDOR_RETURN_IN/ADJUSTMENT_IN/ADJUSTMENT_OUT — schema-legal but, per CURRENT_STATE_AUDIT.md §3, never produced by any current code path; a TRUE here is itself worth investigating.';

-- ============================================================
-- vw_current_warehouse_stock
-- ============================================================
-- All-time net balance per company/warehouse/material/size, from every
-- stock_ledger row unconditionally (cancellations included — see header).
CREATE VIEW vw_current_warehouse_stock AS
SELECT
  company_id,
  warehouse_id,
  material_type_id,
  material_size_id,
  size_label,
  SUM(quantity) AS current_stock,
  COUNT(*) AS movement_count,
  MIN(entry_date) AS first_movement_date,
  MAX(entry_date) AS last_movement_date
FROM stock_ledger
GROUP BY company_id, warehouse_id, material_type_id, material_size_id, size_label;

COMMENT ON VIEW vw_current_warehouse_stock IS
  'Canonical all-time warehouse balance. Compare against the existing v_current_stock (001_initial_schema.sql) and jobwork/new/page.tsx''s client-side per-purchase-line sum before repointing anything at this — see docs/data-integrity/ARCHITECTURE.md.';

-- ============================================================
-- vw_current_vendor_stock
-- ============================================================
-- Per-vendor balance currently held at each job-work vendor, derived from
-- stock_ledger via VENDOR_MOVEMENT_TYPES (matching src/lib/stockLedger.ts's
-- constant exactly — deliberately excludes JOB_WORK_OUTPUT_IN, which posts
-- against the *output* item, not raw material held at the vendor). Sign is
-- inverted from the ledger's own convention: JOB_WORK_OUT is negative
-- (leaves the warehouse) but *increases* what's held at the vendor.
--
-- This is intentionally comparable to (but computed independently from) the
-- existing v_stock_at_vendors view (latest body: 056_job_work_vendor_transfer.sql),
-- which derives the same concept directly from job_work_items columns
-- (quantity_sent - quantity_received - quantity_transferred_out) rather
-- than from stock_ledger. REC-018 checks these two agree.
CREATE VIEW vw_current_vendor_stock AS
SELECT
  sl.company_id,
  jwo.vendor_id,
  sl.material_type_id,
  sl.material_size_id,
  sl.size_label,
  -SUM(sl.quantity) AS current_vendor_stock,
  COUNT(*) AS movement_count,
  MAX(sl.entry_date) AS last_movement_date
FROM stock_ledger sl
JOIN job_work_orders jwo ON jwo.id = sl.reference_id AND sl.reference_type = 'job_work'
WHERE sl.entry_type IN ('JOB_WORK_OUT', 'JOB_WORK_RETURN_IN', 'JOB_WORK_CANCEL', 'JOB_WORK_TRANSFER_OUT', 'JOB_WORK_TRANSFER_IN')
GROUP BY sl.company_id, jwo.vendor_id, sl.material_type_id, sl.material_size_id, sl.size_label;

COMMENT ON VIEW vw_current_vendor_stock IS
  'Canonical per-vendor held stock, derived from stock_ledger. See REC-018 (docs/data-integrity/RULE_CATALOGUE.md) for the cross-check against v_stock_at_vendors.';

-- ============================================================
-- fn_stock_balance_as_of
-- ============================================================
-- Decimal-safe opening/closing balance for one material/size/company/
-- warehouse scope, as of (inclusive of) a given date. NULL warehouse_id
-- means "all warehouses for this company"; NULL company_id means "all
-- companies" — matching the existing reports' "All Companies"/"All
-- Warehouses" filter semantics.
CREATE OR REPLACE FUNCTION fn_stock_balance_as_of(
  p_material_type_id UUID,
  p_material_size_id UUID,
  p_company_id UUID,
  p_warehouse_id UUID,
  p_as_of_date DATE
) RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(quantity), 0)
  FROM stock_ledger
  WHERE material_type_id = p_material_type_id
    AND (material_size_id = p_material_size_id OR (p_material_size_id IS NULL AND material_size_id IS NULL))
    AND (p_company_id IS NULL OR company_id = p_company_id)
    AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id)
    AND entry_date <= p_as_of_date;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION fn_stock_balance_as_of IS
  'Canonical, decimal-safe closing balance for one item/size/scope as of a date. Includes cancellations unconditionally (see module header).';

-- ============================================================
-- fn_stock_movement_history
-- ============================================================
-- Ordered movement rows with a running balance, for one item/size/scope
-- and date range. Tie-break on the same entry_date is quantity DESC before
-- created_at — inflows before outflows/cancellations on the same day — the
-- same fix already applied by hand to the Item Ledger report's GraphQL
-- query this session (queries.ts's ITEM_STOCK_LEDGER_QUERY), now expressed
-- as the canonical, reusable ordering.
CREATE OR REPLACE FUNCTION fn_stock_movement_history(
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
    sl.quantity,
    SUM(sl.quantity) OVER (
      ORDER BY sl.entry_date, sl.quantity DESC, sl.created_at
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
  ORDER BY sl.entry_date, sl.quantity DESC, sl.created_at;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION fn_stock_movement_history IS
  'Canonical movement history with running balance for REC-014 (report equation) and for future report migration onto this layer. Opening balance for the range comes from fn_stock_balance_as_of at (from_date - 1); running_balance at the last row must equal fn_stock_balance_as_of(..., to_date) — REC-014 asserts exactly that.';
