-- Rename material_types.name to description
-- Drop the old (optional) description column first to avoid conflict

ALTER TABLE material_types DROP COLUMN IF EXISTS description;
ALTER TABLE material_types RENAME COLUMN name TO description;

-- Update unique constraint (name had a unique constraint via the original schema)
ALTER TABLE material_types DROP CONSTRAINT IF EXISTS material_types_name_key;
ALTER TABLE material_types ADD CONSTRAINT material_types_description_key UNIQUE (description);

-- Seed initial material types
INSERT INTO material_types (code, description, unit) VALUES
  ('CR', 'Cold Rolled Steel Coils and Sheets', 'kg'),
  ('GA', 'Galvannealed Steel Coils and Products', 'kg'),
  ('GI', 'Galvanized Iron Coils and Sheets', 'kg'),
  ('HR', 'Hot Rolled Steel Coils and Channels', 'kg'),
  ('OT', 'Other Materials and Miscellaneous Items', 'tons')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, unit = EXCLUDED.unit;
