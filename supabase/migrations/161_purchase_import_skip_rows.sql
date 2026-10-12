-- ============================================================
-- Migration 161: skip individual lines of a purchase import batch
-- ============================================================
-- A staged batch imports all-or-nothing: every row must be valid and
-- reviewed. When one or a few lines of an uploaded file shouldn't be
-- imported, the only option was to delete the whole batch and upload a
-- corrected file. A row can now be marked skipped: it stays in the batch
-- as a record (who skipped it, when, why) but is left out of validation
-- gating, counts and the import itself. All-or-nothing still applies to
-- every row that is NOT skipped.
-- ============================================================

ALTER TABLE purchase_import_rows
  ADD COLUMN IF NOT EXISTS excluded BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS excluded_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS excluded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exclusion_reason TEXT;

COMMENT ON COLUMN purchase_import_rows.excluded IS
  'Skipped by the user: not imported, and not required to be valid or reviewed for the rest of the batch to import.';
