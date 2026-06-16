-- Migration 048: Add item_master link and purchase_line_id to transfer_items
ALTER TABLE transfer_items
  ADD COLUMN IF NOT EXISTS item_master_id UUID REFERENCES item_master(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS item_name TEXT,
  ADD COLUMN IF NOT EXISTS purchase_line_id TEXT;
