-- Add item_master linkage to job_work_items
ALTER TABLE job_work_items
  ADD COLUMN IF NOT EXISTS item_master_id UUID REFERENCES item_master(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS item_name TEXT;
