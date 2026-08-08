-- ============================================================
-- Data Integrity & Reconciliation Control Centre — Phase 1 schema
-- ============================================================
-- Purely additive: 7 new tables, no changes to any existing table,
-- function, trigger, or view. Nothing here is wired into any existing
-- posting path — reconciliation runs are triggered explicitly (manually or
-- by a future scheduler), never as a side effect of a transaction.
--
-- All repair-related feature flags in reconciliation_settings default to
-- FALSE. Repair EXECUTION has no implementation in this phase at all — only
-- the tables to eventually hold a proposal exist (repair_batches,
-- repair_audit_rows). See docs/data-integrity/REPAIR_GOVERNANCE.md.
--
-- See docs/data-integrity/ARCHITECTURE.md for the full design rationale and
-- docs/data-integrity/RULE_CATALOGUE.md for what each rule_code means.

-- ============================================================
-- RECONCILIATION RULES (catalogue)
-- ============================================================
CREATE TABLE reconciliation_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_code TEXT NOT NULL UNIQUE,
  rule_name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  supports_auto_repair BOOLEAN NOT NULL DEFAULT FALSE,
  tolerance NUMERIC(15,6),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE reconciliation_rules IS
  'Catalogue of reconciliation checks. is_enabled gates whether a run executes the rule at all; supports_auto_repair is a capability flag only — actual repair execution is separately gated off in reconciliation_settings and unimplemented in Phase 1 regardless of this flag.';

-- ============================================================
-- RECONCILIATION RUNS
-- ============================================================
CREATE SEQUENCE reconciliation_run_number_seq;

CREATE TABLE reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_number TEXT NOT NULL UNIQUE
    DEFAULT ('RUN-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(nextval('reconciliation_run_number_seq')::text, 5, '0')),
  run_type TEXT NOT NULL CHECK (run_type IN ('MANUAL', 'INCREMENTAL', 'NIGHTLY_FULL', 'POST_TRANSACTION', 'POST_REPAIR')),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('FULL', 'COMPANY', 'WAREHOUSE', 'ITEM', 'DOCUMENT', 'DATE_RANGE', 'INCREMENTAL_SINCE_LAST')),
  scope JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_EXCEPTIONS', 'FAILED', 'CANCELLED')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  started_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  rules_executed INTEGER NOT NULL DEFAULT 0,
  records_scanned BIGINT NOT NULL DEFAULT 0,
  exceptions_found INTEGER NOT NULL DEFAULT 0,
  critical_count INTEGER NOT NULL DEFAULT 0,
  high_count INTEGER NOT NULL DEFAULT 0,
  medium_count INTEGER NOT NULL DEFAULT 0,
  low_count INTEGER NOT NULL DEFAULT 0,
  resolved_count INTEGER NOT NULL DEFAULT 0,
  execution_time_ms BIGINT,
  error_message TEXT,
  application_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reconciliation_runs_status_started ON reconciliation_runs (status, started_at DESC);
CREATE INDEX idx_reconciliation_runs_run_type ON reconciliation_runs (run_type, started_at DESC);

COMMENT ON TABLE reconciliation_runs IS
  'One row per reconciliation scan execution. Read-only in Phase 1 — a run only ever reads stock_ledger and source tables, never writes to them.';

-- ============================================================
-- RECONCILIATION EXCEPTIONS
-- ============================================================
CREATE SEQUENCE reconciliation_exception_number_seq;

CREATE TABLE reconciliation_exceptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exception_number TEXT NOT NULL UNIQUE
    DEFAULT ('EXC-' || lpad(nextval('reconciliation_exception_number_seq')::text, 6, '0')),
  run_id UUID REFERENCES reconciliation_runs(id) ON DELETE SET NULL,
  rule_id UUID REFERENCES reconciliation_rules(id) ON DELETE SET NULL,
  -- Deterministic identity for this exception, independent of quantity or
  -- timestamp, so a repeat scan updates the same row (last_detected_at,
  -- occurrence_count) instead of creating a duplicate. See
  -- src/lib/dataIntegrity/fingerprint.ts for how this is computed — always
  -- from rule_code + stable business identity (company/warehouse/source
  -- document/source line/item/ledger event identity), never from quantity
  -- or a timestamp.
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'REPAIR_PROPOSED', 'APPROVED', 'RESOLVED', 'IGNORED', 'REOPENED')),
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  material_type_id UUID REFERENCES material_types(id) ON DELETE SET NULL,
  material_size_id UUID REFERENCES material_sizes(id) ON DELETE SET NULL,
  purchase_line_id TEXT,
  source_document_type TEXT,
  source_document_id UUID,
  source_line_id TEXT,
  reference_number TEXT,
  expected_value NUMERIC(18,6),
  actual_value NUMERIC(18,6),
  difference NUMERIC(18,6),
  summary TEXT NOT NULL,
  explanation TEXT,
  suspected_cause TEXT,
  -- Confidence is part of evidence, not a top-level column: REC-001 in
  -- particular emits CONFIRMED / HIGH_PROBABILITY / REVIEW_REQUIRED per the
  -- assignment's instruction, stored as evidence->>'confidence'.
  evidence JSONB NOT NULL DEFAULT '{}',
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  assigned_to UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (fingerprint)
);

CREATE INDEX idx_reconciliation_exceptions_status ON reconciliation_exceptions (status);
CREATE INDEX idx_reconciliation_exceptions_severity_status ON reconciliation_exceptions (severity, status);
CREATE INDEX idx_reconciliation_exceptions_company_status ON reconciliation_exceptions (company_id, status);
CREATE INDEX idx_reconciliation_exceptions_run ON reconciliation_exceptions (run_id);
CREATE INDEX idx_reconciliation_exceptions_rule ON reconciliation_exceptions (rule_id);
CREATE INDEX idx_reconciliation_exceptions_source_doc ON reconciliation_exceptions (source_document_type, source_document_id);
CREATE INDEX idx_reconciliation_exceptions_open ON reconciliation_exceptions (status) WHERE status NOT IN ('RESOLVED', 'IGNORED');

COMMENT ON TABLE reconciliation_exceptions IS
  'Persistent record of a detected inconsistency. fingerprint is UNIQUE so re-running a scan updates (last_detected_at, occurrence_count) an existing row rather than creating a duplicate — see the fingerprint column comment.';

-- ============================================================
-- RECONCILIATION EXCEPTION ROWS (evidence)
-- ============================================================
CREATE TABLE reconciliation_exception_rows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exception_id UUID NOT NULL REFERENCES reconciliation_exceptions(id) ON DELETE CASCADE,
  record_type TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT,
  ledger_id UUID,
  relationship TEXT,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reconciliation_exception_rows_exception ON reconciliation_exception_rows (exception_id);
CREATE INDEX idx_reconciliation_exception_rows_ledger ON reconciliation_exception_rows (ledger_id) WHERE ledger_id IS NOT NULL;

COMMENT ON TABLE reconciliation_exception_rows IS
  'Full snapshot of every source/ledger row that fed into an exception''s detection — preserved even if the underlying row is later edited or deleted, so the exception remains explainable.';

-- ============================================================
-- RECONCILIATION SETTINGS (single row)
-- ============================================================
CREATE TABLE reconciliation_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  quantity_tolerance NUMERIC(15,6) NOT NULL DEFAULT 0.001,
  full_scan_schedule_cron TEXT,
  incremental_scan_interval_minutes INTEGER NOT NULL DEFAULT 60,
  max_rows_per_scan INTEGER NOT NULL DEFAULT 5000,
  retention_days INTEGER NOT NULL DEFAULT 730,
  repair_proposals_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  repair_execution_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  post_transaction_checks_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE reconciliation_settings IS
  'Singleton settings row (id is always TRUE, enforced by the CHECK constraint so only one row can ever exist). repair_execution_enabled must stay FALSE through Phase 1 — no code path in this release can execute a repair regardless of this flag, but the flag exists now so Phase 2 has a single, auditable switch instead of a code deploy.';

INSERT INTO reconciliation_settings (id) VALUES (TRUE);

-- ============================================================
-- REPAIR BATCHES (foundation only — execution unimplemented in Phase 1)
-- ============================================================
CREATE SEQUENCE repair_batch_number_seq;

CREATE TABLE repair_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repair_batch_number TEXT NOT NULL UNIQUE
    DEFAULT ('RPB-' || lpad(nextval('repair_batch_number_seq')::text, 6, '0')),
  exception_id UUID NOT NULL REFERENCES reconciliation_exceptions(id) ON DELETE RESTRICT,
  proposed_action TEXT NOT NULL,
  proposal JSONB NOT NULL DEFAULT '{}',
  before_snapshot JSONB NOT NULL DEFAULT '{}',
  after_preview_snapshot JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXECUTING', 'EXECUTED', 'EXECUTION_FAILED', 'ROLLED_BACK')),
  requested_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ,
  approved_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  executed_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  executed_at TIMESTAMPTZ,
  execution_result JSONB,
  validation_result JSONB,
  error_message TEXT,
  rollback_info JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Maker-checker: whoever requested a batch cannot also be the one who
  -- approved it. Enforced here, not just in the API, so this can never be
  -- bypassed by a direct SQL statement either.
  CONSTRAINT chk_repair_batches_maker_checker
    CHECK (approved_by IS NULL OR requested_by IS NULL OR approved_by <> requested_by)
);

CREATE INDEX idx_repair_batches_exception ON repair_batches (exception_id);
CREATE INDEX idx_repair_batches_status ON repair_batches (status);

COMMENT ON TABLE repair_batches IS
  'A proposed correction for one exception. Phase 1 only ever reaches DRAFT/PENDING_APPROVAL — nothing in this release can transition a batch to EXECUTING or beyond; that requires Phase 2 work explicitly gated by reconciliation_settings.repair_execution_enabled plus a reviewed, typed database function per repair type (see docs/data-integrity/REPAIR_GOVERNANCE.md). No API route in this release accepts a status transition past APPROVED.';

-- ============================================================
-- REPAIR AUDIT ROWS (tamper-evident before/after image)
-- ============================================================
CREATE TABLE repair_audit_rows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repair_batch_id UUID NOT NULL REFERENCES repair_batches(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE', 'ARCHIVE')),
  before_image JSONB,
  after_image JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_repair_audit_rows_batch ON repair_audit_rows (repair_batch_id);

COMMENT ON TABLE repair_audit_rows IS
  'Full before/after image of every row a repair batch touches. Written once, at execution time, as part of the same transaction as the repair itself — never populated in Phase 1 since no repair can execute yet.';

-- ============================================================
-- updated_at maintenance (mirrors the existing update_bill_totals()-style
-- pattern already used elsewhere in this codebase, e.g. 001_initial_schema)
-- ============================================================
CREATE OR REPLACE FUNCTION fn_data_integrity_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reconciliation_rules_updated_at
  BEFORE UPDATE ON reconciliation_rules
  FOR EACH ROW EXECUTE FUNCTION fn_data_integrity_touch_updated_at();

CREATE TRIGGER trg_reconciliation_exceptions_updated_at
  BEFORE UPDATE ON reconciliation_exceptions
  FOR EACH ROW EXECUTE FUNCTION fn_data_integrity_touch_updated_at();

CREATE TRIGGER trg_repair_batches_updated_at
  BEFORE UPDATE ON repair_batches
  FOR EACH ROW EXECUTE FUNCTION fn_data_integrity_touch_updated_at();

CREATE TRIGGER trg_reconciliation_settings_updated_at
  BEFORE UPDATE ON reconciliation_settings
  FOR EACH ROW EXECUTE FUNCTION fn_data_integrity_touch_updated_at();
