-- ============================================================
-- Migration 135: track WHO last amended a transaction, not just who
-- created it
-- ============================================================
-- purchase_bills / dispatch_orders / job_work_orders already have
-- created_by and an updated_at trigger (update_updated_at_column, 001),
-- so "when was this last touched" was already answered — but "by whom"
-- had no column to hold it, so every edit screen could only ever show
-- the original creator. Add updated_by (same nullable, ON DELETE SET
-- NULL shape as created_by); NULL means "never edited since creation".
-- The save-edit routes are updated separately to set it on every edit.
-- ============================================================

ALTER TABLE purchase_bills ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL;
ALTER TABLE dispatch_orders ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL;
ALTER TABLE job_work_orders ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN purchase_bills.updated_by IS 'User who last edited this bill via Edit Bill. NULL if never edited since creation.';
COMMENT ON COLUMN dispatch_orders.updated_by IS 'User who last edited this sale/dispatch order via Edit Order. NULL if never edited since creation.';
COMMENT ON COLUMN job_work_orders.updated_by IS 'User who last edited this job work order via Edit Order. NULL if never edited since creation.';
