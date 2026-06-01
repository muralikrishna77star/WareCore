-- ============================================================
-- Add sale_line_id and item_master_id to dispatch_items
-- sale_line_id: auto-generated ID for each sale line ({GroupCode2}{MMYY}-{GlobalSeq})
-- item_master_id: FK to item_master for the item being sold
-- ============================================================

ALTER TABLE dispatch_items
  ADD COLUMN IF NOT EXISTS sale_line_id TEXT,
  ADD COLUMN IF NOT EXISTS item_master_id UUID REFERENCES item_master(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dispatch_items_sale_line_id ON dispatch_items(sale_line_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_items_item_master ON dispatch_items(item_master_id);
