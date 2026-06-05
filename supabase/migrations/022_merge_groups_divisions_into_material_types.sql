-- ============================================================
-- Merge item_groups and divisions into material_types
-- Add a 2-char code to material_types (replaces group_code)
-- Remove item_group_id from item_master
-- Drop item_groups and divisions tables
-- ============================================================

-- 1. Add code column to material_types
ALTER TABLE material_types ADD COLUMN IF NOT EXISTS code TEXT;

-- 2. Populate code from the first 2 chars of name (admin can update if needed)
UPDATE material_types SET code = UPPER(LEFT(name, 2)) WHERE code IS NULL;

-- 3. Make code NOT NULL and UNIQUE
ALTER TABLE material_types ALTER COLUMN code SET NOT NULL;
ALTER TABLE material_types ADD CONSTRAINT material_types_code_key UNIQUE (code);

CREATE INDEX IF NOT EXISTS idx_material_types_code ON material_types(code);

-- 4. Remove item_group_id FK from item_master (material_type_id already covers this)
ALTER TABLE item_master DROP COLUMN IF EXISTS item_group_id;

-- 5. Remove division_id from item_groups before dropping
ALTER TABLE item_groups DROP CONSTRAINT IF EXISTS item_groups_division_id_fkey;
ALTER TABLE item_groups DROP COLUMN IF EXISTS division_id;

-- 6. Drop item_groups and divisions
DROP TABLE IF EXISTS item_groups;
DROP TABLE IF EXISTS divisions;
