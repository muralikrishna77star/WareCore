-- ============================================================
-- WareCore WMS - Add item_name to line item tables
-- Allows a free-text item description on every line,
-- auto-filled from the selected material type but editable.
-- ============================================================

-- Purchase bill items
ALTER TABLE purchase_bill_items
  ADD COLUMN IF NOT EXISTS item_name TEXT;

-- Dispatch (sale) items
ALTER TABLE dispatch_items
  ADD COLUMN IF NOT EXISTS item_name TEXT;

-- Transfer items
ALTER TABLE transfer_items
  ADD COLUMN IF NOT EXISTS item_name TEXT;

-- Job work items
ALTER TABLE job_work_items
  ADD COLUMN IF NOT EXISTS item_name TEXT;
