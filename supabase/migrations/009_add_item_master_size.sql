-- ============================================================
-- Add material_size_id and size_label to item_master
-- ============================================================

ALTER TABLE item_master
ADD COLUMN IF NOT EXISTS material_size_id UUID REFERENCES material_sizes(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS size_label TEXT;

CREATE INDEX IF NOT EXISTS idx_item_master_material_size ON item_master(material_size_id);
