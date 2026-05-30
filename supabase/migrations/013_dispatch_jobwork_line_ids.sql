-- ============================================================
-- Add purchase_line_id and sub_purchase_line_id to dispatch_items
-- and job_work_items (required by stock_ledger trigger functions
-- introduced in migration 012)
-- ============================================================

ALTER TABLE dispatch_items
  ADD COLUMN IF NOT EXISTS purchase_line_id TEXT,
  ADD COLUMN IF NOT EXISTS sub_purchase_line_id TEXT;

CREATE INDEX IF NOT EXISTS idx_dispatch_items_purchase_line_id ON dispatch_items(purchase_line_id);

ALTER TABLE job_work_items
  ADD COLUMN IF NOT EXISTS purchase_line_id TEXT,
  ADD COLUMN IF NOT EXISTS sub_purchase_line_id TEXT;

CREATE INDEX IF NOT EXISTS idx_job_work_items_purchase_line_id ON job_work_items(purchase_line_id);
