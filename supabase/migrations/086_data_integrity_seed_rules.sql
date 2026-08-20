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

-- Explicit ids (matching production's actual current values) rather than
-- the default uuid_generate_v4() — same class of bug as material_types
-- (migrations 019/023, see 023's comment for the full explanation): every
-- fresh database got its own random ids for these 18 rows, and a full
-- backup restore afterward silently dropped reconciliation_exceptions
-- wholesale (100% loss, not partial — every exception's rule_id pointed at
-- an id that only existed in the *production* rule set) since ON CONFLICT
-- (rule_code) DO NOTHING kept whichever random-id row this fresh install's
-- own migration had already created. Has no effect on any database this
-- migration already ran on.
INSERT INTO reconciliation_rules (id, rule_code, rule_name, description, category, severity, is_enabled, supports_auto_repair, tolerance) VALUES
('4eb67feb-9a0e-46dd-aff0-4f9f1d644a06', 'REC-001', 'Exact duplicate ledger event',
 'Detects repeated stock_ledger rows representing the same business event (same entry type, source document/line, item, company, warehouse, quantity, created close together in time). Confidence-scored (CONFIRMED / HIGH_PROBABILITY / REVIEW_REQUIRED) rather than an automatic delete — two legitimate identical movements can exist. This is the rule class that would have caught CR00700''s duplicate PURCHASE_CANCEL.',
 'DUPLICATE', 'HIGH', TRUE, FALSE, NULL),

('93621809-0573-4204-bb05-7f003702ba7f', 'REC-002', 'Missing ledger posting',
 'Detects an active/posted source line (purchase, dispatch, transfer, job work issue/return/output/vendor-transfer) with no corresponding stock_ledger row at all.',
 'COMPLETENESS', 'HIGH', TRUE, FALSE, NULL),

('82e6c8d5-e44d-46b1-8b8a-59617fbfb7a7', 'REC-003', 'Orphan ledger entry',
 'Detects a stock_ledger row whose source document and line exist in neither the active source table nor the matching cancellation/archive table. Does not flag rows whose source was legitimately cancelled-and-archived.',
 'ORPHAN', 'MEDIUM', TRUE, FALSE, NULL),

('8ef89d70-1a3d-4083-a11b-4942bca50b83', 'REC-004', 'Source-to-ledger quantity mismatch',
 'Compares every source line''s quantity against its expected net stock_ledger quantity, at line level (not category totals).',
 'QUANTITY', 'HIGH', FALSE, FALSE, 0.001),

('a7146e83-3167-43c5-a54b-13a718ec393b', 'REC-005', 'Negative warehouse stock',
 'Computes cumulative and current stock per company/warehouse/material/size (and per purchase line where relevant) and flags any point where the running balance went negative, reporting the minimum historical balance and the transaction that caused it. Never hides a real chronological dip by reordering rows for display.',
 'BALANCE', 'CRITICAL', TRUE, FALSE, 0.001),

('b1b0b591-a12a-4421-b1d2-7fbb93ca7ea1', 'REC-006', 'Invalid movement sign',
 'Validates each entry_type against its expected quantity sign per docs/data-integrity/LEDGER_EVENT_MATRIX.md (inflows positive, outflows negative), accounting for the JOB_WORK_TRANSFER_OUT/IN and vendor-direct-sale cases where sign depends on which side of the pair a row represents.',
 'SIGN', 'HIGH', FALSE, FALSE, NULL),

('4ec01620-8c23-40b4-8d31-c57ef67d2ea5', 'REC-007', 'Reversal mismatch',
 'Validates that a reversal (PURCHASE_CANCEL/SALE_CANCEL, or an outright-delete-shaped cancellation per migrations 054/061/074/075) matches a real original event, that reversed quantity never exceeds unreversed original quantity, and that repeated/double cancellation is caught.',
 'REVERSAL', 'HIGH', TRUE, FALSE, 0.001),

('2a32dd47-8989-4329-acdc-59744b5726ca', 'REC-008', 'Transfer pair mismatch',
 'For every inter-warehouse transfer, validates the TRANSFER_OUT and TRANSFER_IN legs both exist, match in quantity/item/unit, and agree with the transfer''s source/destination company and warehouse.',
 'TRANSFER', 'HIGH', TRUE, FALSE, 0.001),

('d9102e47-70e3-4feb-bd57-bba76bb32edf', 'REC-009', 'Job Work equation mismatch',
 'Validates raw material sent vs. returned vs. transferred to another vendor vs. output received vs. cancelled vs. still held at vendor, per job work order — kept as separate typed quantities, never summed across unlike items (e.g. output material is never netted against raw material as if it were a return).',
 'JOB_WORK', 'HIGH', TRUE, FALSE, 0.001),

('b81baed6-f70d-4f8c-bac9-a002c85c34b9', 'REC-010', 'Company/warehouse mismatch',
 'Validates a ledger row''s company_id/warehouse_id agree with its source document and the movement''s stated direction.',
 'SCOPE', 'MEDIUM', FALSE, FALSE, NULL),

('c64832ec-782b-46cc-9d8e-f30c8f435d77', 'REC-011', 'Effective-date mismatch',
 'Compares stock_ledger.entry_date against the correct business date for that event type (bill date, dispatch date, transfer date, job work dispatch/return/output-received date, or agreed cancellation business date) — never against created_at.',
 'DATE', 'LOW', FALSE, FALSE, NULL),

('6f904e96-ef13-404b-b82e-8b16d5b428cc', 'REC-012', 'Backdated or late posting',
 'Flags rows where entry_date is materially earlier than created_at, as an informational signal (not itself a defect) unless another rule also fails on the same row.',
 'DATE', 'INFO', FALSE, FALSE, NULL),

('fcbb8323-65b1-4582-ae00-77a9423f2d6c', 'REC-013', 'Zero-stock validation',
 'Confirms a zero-balance item''s inflows and outflows genuinely net to zero via a traceable, complete set of transactions — not silently produced by a missing/orphan/duplicate defect elsewhere. Zero stock is the expected, healthy state for a fully consumed item and must never be auto-flagged as an error on its own.',
 'ZERO_STOCK', 'LOW', TRUE, FALSE, 0.001),

('3ea9fe23-f586-4325-8edb-59385a276d17', 'REC-014', 'Report equation mismatch',
 'Validates Opening + Inward - Outward = Closing (signed, decimal-safe) for every report scope, and that a display-only filter (e.g. hiding cancelled rows) never changes the underlying accounting totals.',
 'REPORT', 'CRITICAL', TRUE, FALSE, 0.001),

('6569daf2-8ba5-48d7-bf13-0725734281f5', 'REC-015', 'Source header/detail mismatch',
 'Validates a source document''s header total against the sum of its line items (purchase bills, dispatch orders, and other applicable documents).',
 'HEADER_DETAIL', 'MEDIUM', FALSE, FALSE, 0.001),

('b5f6f25b-597a-47be-a82a-4e80ab0d4cc9', 'REC-016', 'Duplicate source business identifier',
 'Detects duplicate bill numbers, reference numbers, purchase line IDs, or sale line IDs outside their legitimate uniqueness scope.',
 'DUPLICATE_ID', 'MEDIUM', FALSE, FALSE, NULL),

('0a90ce3b-524e-4fc2-b4ff-55fbe07dbcea', 'REC-017', 'Trigger-chain duplicate risk',
 'Where determinable from timing and shape, flags transactions where more than one posting/trigger path appears to have fired for the same business action.',
 'TRIGGER_RISK', 'MEDIUM', FALSE, FALSE, NULL),

('9092693b-bfd6-45cf-9d26-747d4a1ce511', 'REC-018', 'Unbalanced vendor-held stock',
 'Validates material sent to / returned from / transferred between vendors reconciles between the stock_ledger-derived vendor balance (VENDOR_MOVEMENT_TYPES) and the job_work_items-derived v_stock_at_vendors balance — these are two independently-computed numbers in the current schema (see CURRENT_STATE_AUDIT.md §7) and are not currently checked against each other anywhere.',
 'VENDOR_STOCK', 'HIGH', FALSE, FALSE, 0.001);
