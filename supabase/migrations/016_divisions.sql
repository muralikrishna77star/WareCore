-- ============================================================
-- WareCore WMS - Divisions
-- Adds a Division classification level above Item Groups
-- Hierarchy: Division → Item Group → Item
-- ============================================================

CREATE TABLE IF NOT EXISTS divisions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  division_code TEXT NOT NULL UNIQUE,
  division_name TEXT NOT NULL,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_divisions_code ON divisions(division_code);
CREATE INDEX IF NOT EXISTS idx_divisions_active ON divisions(is_active) WHERE is_active = TRUE;

-- Link item_groups to a division
ALTER TABLE item_groups
  ADD COLUMN IF NOT EXISTS division_id UUID REFERENCES divisions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_item_groups_division ON item_groups(division_id);

-- RLS
ALTER TABLE divisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users"
  ON divisions FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Enable insert for authenticated users"
  ON divisions FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Enable update for authenticated users"
  ON divisions FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
