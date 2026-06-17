-- ============================================================
-- WareCore WMS - Drop remaining auth.users FK references
--
-- Migration 003 dropped the FK from purchase_bills.created_by.
-- Migration 049 dropped it from dispatch_orders.created_by.
-- Three tables still have stale FKs to the empty auth.users stub,
-- which causes FK violations when created_by is set to a
-- user_profiles UUID (e.g. from the session-injected created_by).
-- ============================================================

ALTER TABLE stock_ledger   DROP CONSTRAINT IF EXISTS stock_ledger_created_by_fkey;
ALTER TABLE job_work_orders DROP CONSTRAINT IF EXISTS job_work_orders_created_by_fkey;
ALTER TABLE transfers       DROP CONSTRAINT IF EXISTS transfers_created_by_fkey;
