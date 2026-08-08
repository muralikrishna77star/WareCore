-- ============================================================
-- Data Integrity — seed the full 18-rule catalogue
-- ============================================================
-- is_enabled reflects whether an executable implementation exists in this
-- release (src/lib/dataIntegrity/rules/*.ts) — a scan only ever invokes
-- enabled rules, so a rule with no code behind it is seeded disabled rather
-- than left to fail at run time. The 9 rules below with is_enabled = TRUE
-- are the ones actually implemented in Phase 1; the other 9 are catalogued
-- (full description, severity, category) so their design is fixed and
-- reviewable now, and are the direct backlog for the next phase. See
-- docs/data-integrity/RULE_CATALOGUE.md for the full rationale per rule.
--
-- supports_auto_repair is uniformly FALSE for every rule in this seed —
-- it's a future capability flag, not a status of what's built. No rule has
-- an implemented repair action yet, and reconciliation_settings.repair_execution_enabled
-- is FALSE regardless of this column.

INSERT INTO reconciliation_rules (rule_code, rule_name, description, category, severity, is_enabled, supports_auto_repair, tolerance) VALUES
('REC-001', 'Exact duplicate ledger event',
 'Detects repeated stock_ledger rows representing the same business event (same entry type, source document/line, item, company, warehouse, quantity, created close together in time). Confidence-scored (CONFIRMED / HIGH_PROBABILITY / REVIEW_REQUIRED) rather than an automatic delete — two legitimate identical movements can exist. This is the rule class that would have caught CR00700''s duplicate PURCHASE_CANCEL.',
 'DUPLICATE', 'HIGH', TRUE, FALSE, NULL),

('REC-002', 'Missing ledger posting',
 'Detects an active/posted source line (purchase, dispatch, transfer, job work issue/return/output/vendor-transfer) with no corresponding stock_ledger row at all.',
 'COMPLETENESS', 'HIGH', TRUE, FALSE, NULL),

('REC-003', 'Orphan ledger entry',
 'Detects a stock_ledger row whose source document and line exist in neither the active source table nor the matching cancellation/archive table. Does not flag rows whose source was legitimately cancelled-and-archived.',
 'ORPHAN', 'MEDIUM', TRUE, FALSE, NULL),

('REC-004', 'Source-to-ledger quantity mismatch',
 'Compares every source line''s quantity against its expected net stock_ledger quantity, at line level (not category totals).',
 'QUANTITY', 'HIGH', FALSE, FALSE, 0.001),

('REC-005', 'Negative warehouse stock',
 'Computes cumulative and current stock per company/warehouse/material/size (and per purchase line where relevant) and flags any point where the running balance went negative, reporting the minimum historical balance and the transaction that caused it. Never hides a real chronological dip by reordering rows for display.',
 'BALANCE', 'CRITICAL', TRUE, FALSE, 0.001),

('REC-006', 'Invalid movement sign',
 'Validates each entry_type against its expected quantity sign per docs/data-integrity/LEDGER_EVENT_MATRIX.md (inflows positive, outflows negative), accounting for the JOB_WORK_TRANSFER_OUT/IN and vendor-direct-sale cases where sign depends on which side of the pair a row represents.',
 'SIGN', 'HIGH', FALSE, FALSE, NULL),

('REC-007', 'Reversal mismatch',
 'Validates that a reversal (PURCHASE_CANCEL/SALE_CANCEL, or an outright-delete-shaped cancellation per migrations 054/061/074/075) matches a real original event, that reversed quantity never exceeds unreversed original quantity, and that repeated/double cancellation is caught.',
 'REVERSAL', 'HIGH', TRUE, FALSE, 0.001),

('REC-008', 'Transfer pair mismatch',
 'For every inter-warehouse transfer, validates the TRANSFER_OUT and TRANSFER_IN legs both exist, match in quantity/item/unit, and agree with the transfer''s source/destination company and warehouse.',
 'TRANSFER', 'HIGH', TRUE, FALSE, 0.001),

('REC-009', 'Job Work equation mismatch',
 'Validates raw material sent vs. returned vs. transferred to another vendor vs. output received vs. cancelled vs. still held at vendor, per job work order — kept as separate typed quantities, never summed across unlike items (e.g. output material is never netted against raw material as if it were a return).',
 'JOB_WORK', 'HIGH', TRUE, FALSE, 0.001),

('REC-010', 'Company/warehouse mismatch',
 'Validates a ledger row''s company_id/warehouse_id agree with its source document and the movement''s stated direction.',
 'SCOPE', 'MEDIUM', FALSE, FALSE, NULL),

('REC-011', 'Effective-date mismatch',
 'Compares stock_ledger.entry_date against the correct business date for that event type (bill date, dispatch date, transfer date, job work dispatch/return/output-received date, or agreed cancellation business date) — never against created_at.',
 'DATE', 'LOW', FALSE, FALSE, NULL),

('REC-012', 'Backdated or late posting',
 'Flags rows where entry_date is materially earlier than created_at, as an informational signal (not itself a defect) unless another rule also fails on the same row.',
 'DATE', 'INFO', FALSE, FALSE, NULL),

('REC-013', 'Zero-stock validation',
 'Confirms a zero-balance item''s inflows and outflows genuinely net to zero via a traceable, complete set of transactions — not silently produced by a missing/orphan/duplicate defect elsewhere. Zero stock is the expected, healthy state for a fully consumed item and must never be auto-flagged as an error on its own.',
 'ZERO_STOCK', 'LOW', TRUE, FALSE, 0.001),

('REC-014', 'Report equation mismatch',
 'Validates Opening + Inward - Outward = Closing (signed, decimal-safe) for every report scope, and that a display-only filter (e.g. hiding cancelled rows) never changes the underlying accounting totals.',
 'REPORT', 'CRITICAL', TRUE, FALSE, 0.001),

('REC-015', 'Source header/detail mismatch',
 'Validates a source document''s header total against the sum of its line items (purchase bills, dispatch orders, and other applicable documents).',
 'HEADER_DETAIL', 'MEDIUM', FALSE, FALSE, 0.001),

('REC-016', 'Duplicate source business identifier',
 'Detects duplicate bill numbers, reference numbers, purchase line IDs, or sale line IDs outside their legitimate uniqueness scope.',
 'DUPLICATE_ID', 'MEDIUM', FALSE, FALSE, NULL),

('REC-017', 'Trigger-chain duplicate risk',
 'Where determinable from timing and shape, flags transactions where more than one posting/trigger path appears to have fired for the same business action.',
 'TRIGGER_RISK', 'MEDIUM', FALSE, FALSE, NULL),

('REC-018', 'Unbalanced vendor-held stock',
 'Validates material sent to / returned from / transferred between vendors reconciles between the stock_ledger-derived vendor balance (VENDOR_MOVEMENT_TYPES) and the job_work_items-derived v_stock_at_vendors balance — these are two independently-computed numbers in the current schema (see CURRENT_STATE_AUDIT.md §7) and are not currently checked against each other anywhere.',
 'VENDOR_STOCK', 'HIGH', FALSE, FALSE, 0.001);
