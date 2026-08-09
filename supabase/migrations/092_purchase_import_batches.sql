-- ============================================================
-- Purchase Import: persistent staging + review/correction workflow
-- ============================================================
-- Replaces the ephemeral "upload -> preview -> commit" bulk import flow
-- with a durable batch of staged rows a user can load, correct field-by-
-- field, mark reviewed, and only then import — see
-- src/app/(app)/bills/import/[batchId]/page.tsx and
-- src/app/api/bills/import/batches/**.
--
-- No raw file storage: purchase_import_rows.current_data is the
-- authoritative post-parse record once staged; final import reconstructs
-- ParsedRow[] from it and never re-parses the original file.
--
-- Deliberately minimal status set: STAGED / IMPORTED / CANCELLED. No
-- PROCESSING (parsing is synchronous, no queue), no PARTIALLY_IMPORTED
-- (all-or-nothing import is a hard product requirement — see
-- resolveImport() in src/lib/purchaseImport/resolve.ts), no persisted
-- FAILED (a failed import attempt isn't terminal — the batch just stays
-- STAGED for retry; last_import_error/last_import_attempted_at carry the
-- detail). "Ready to import" and valid/invalid/reviewed progress are
-- derived LIVE from purchase_import_rows via COUNT(*) FILTER queries, never
-- persisted redundantly here — they cannot drift out of sync with
-- row-level corrections that way.

CREATE SEQUENCE purchase_import_batch_number_seq;

CREATE TABLE purchase_import_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_number TEXT NOT NULL UNIQUE
    DEFAULT ('PIB-' || lpad(nextval('purchase_import_batch_number_seq')::text, 6, '0')),
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,              -- sha256 hex of raw uploaded bytes — idempotency/duplicate-upload warning
  file_size_bytes INTEGER NOT NULL,
  row_count INTEGER NOT NULL,           -- data rows parsed (blank rows excluded, matches parseWorkbook today)
  status TEXT NOT NULL DEFAULT 'STAGED' CHECK (status IN ('STAGED', 'IMPORTED', 'CANCELLED')),
  duplicate_of_batch_id UUID REFERENCES purchase_import_batches(id) ON DELETE SET NULL,
  notes TEXT,
  last_import_error TEXT,
  last_import_attempted_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  imported_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX idx_purchase_import_batches_status_created ON purchase_import_batches (status, created_at DESC);
CREATE INDEX idx_purchase_import_batches_file_hash ON purchase_import_batches (file_hash);

COMMENT ON TABLE purchase_import_batches IS
  'One row per uploaded purchase-import file. Raw file bytes are NOT retained — purchase_import_rows.current_data is authoritative. Progress/ready-to-import counts are derived live from purchase_import_rows, never persisted here.';

CREATE TABLE purchase_import_rows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES purchase_import_batches(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,          -- original 1-based spreadsheet row (gaps allowed — blank rows are skipped upstream)
  raw_data JSONB NOT NULL,              -- ParsedRow exactly as first uploaded — never mutated by corrections
  current_data JSONB NOT NULL,          -- ParsedRow-shaped working/corrected values; = raw_data on creation
  resolved_field_ids JSONB,             -- cached resolveRowIndependent() output (ids+labels), DISPLAY ONLY — never trusted at commit time
  validation_errors JSONB NOT NULL DEFAULT '[]',  -- RowError[] — every independent failed check, not just the first
  is_valid BOOLEAN NOT NULL DEFAULT FALSE,        -- maintained by app code alongside validation_errors
  reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  correction_history JSONB NOT NULL DEFAULT '[]', -- append-only [{at, by, changes: {field: {old, new}}}]
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, row_number)
);

CREATE INDEX idx_purchase_import_rows_batch ON purchase_import_rows (batch_id);
CREATE INDEX idx_purchase_import_rows_batch_valid ON purchase_import_rows (batch_id, is_valid);
CREATE INDEX idx_purchase_import_rows_batch_reviewed ON purchase_import_rows (batch_id, reviewed);

COMMENT ON TABLE purchase_import_rows IS
  'One row per staged spreadsheet data row. raw_data is a permanent "as uploaded" snapshot; current_data is what corrections mutate and what final import reconstructs into ParsedRow[] for the single authoritative resolveImport() call at commit time (src/lib/purchaseImport/resolve.ts). resolved_field_ids is a display cache only.';

CREATE OR REPLACE FUNCTION fn_purchase_import_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_purchase_import_batches_updated_at
  BEFORE UPDATE ON purchase_import_batches
  FOR EACH ROW EXECUTE FUNCTION fn_purchase_import_touch_updated_at();

CREATE TRIGGER trg_purchase_import_rows_updated_at
  BEFORE UPDATE ON purchase_import_rows
  FOR EACH ROW EXECUTE FUNCTION fn_purchase_import_touch_updated_at();
