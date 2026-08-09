-- ============================================================
-- Fix wrong FK target on purchase_import_batches/purchase_import_rows
-- ============================================================
-- Migration 092 declared created_by/imported_by/cancelled_by (on
-- purchase_import_batches) and reviewed_by (on purchase_import_rows) as
-- REFERENCES auth.users(id) — copying the ORIGINAL (pre-standalone-auth)
-- pattern from purchase_bills.created_by. That pattern is stale: this app
-- moved to app-managed auth in migration 003_standalone_auth.sql, real
-- users live in user_profiles (session.userId is a user_profiles.id), and
-- auth.users is now an empty stub (confirmed in production: 0 rows).
-- Every other post-003 table that references "the acting user" already
-- correctly points at user_profiles (e.g. repair_batches.requested_by/
-- approved_by/executed_by, migration 085) — 092 is the one exception.
--
-- Net effect of the bug: inserting a real session.userId into any of these
-- four columns violated the FK immediately, so no real user could ever
-- create a purchase import batch, mark a row reviewed, cancel a batch, or
-- complete an import. Caught by reproducing the exact user-reported "Could
-- not read the file" bug end-to-end against a fresh local database whose
-- only user was, like every real production user, absent from auth.users.
--
-- Safe to apply directly: these two tables were created earlier today by
-- migration 092 and the bug prevented any row from ever populating these
-- columns with a non-null value, so there is nothing to reconcile.

ALTER TABLE purchase_import_batches DROP CONSTRAINT purchase_import_batches_created_by_fkey;
ALTER TABLE purchase_import_batches ADD CONSTRAINT purchase_import_batches_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES user_profiles(id) ON DELETE SET NULL;

ALTER TABLE purchase_import_batches DROP CONSTRAINT purchase_import_batches_imported_by_fkey;
ALTER TABLE purchase_import_batches ADD CONSTRAINT purchase_import_batches_imported_by_fkey
  FOREIGN KEY (imported_by) REFERENCES user_profiles(id) ON DELETE SET NULL;

ALTER TABLE purchase_import_batches DROP CONSTRAINT purchase_import_batches_cancelled_by_fkey;
ALTER TABLE purchase_import_batches ADD CONSTRAINT purchase_import_batches_cancelled_by_fkey
  FOREIGN KEY (cancelled_by) REFERENCES user_profiles(id) ON DELETE SET NULL;

ALTER TABLE purchase_import_rows DROP CONSTRAINT purchase_import_rows_reviewed_by_fkey;
ALTER TABLE purchase_import_rows ADD CONSTRAINT purchase_import_rows_reviewed_by_fkey
  FOREIGN KEY (reviewed_by) REFERENCES user_profiles(id) ON DELETE SET NULL;
