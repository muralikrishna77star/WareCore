-- ============================================================
-- WareCore WMS - Custom Roles & Screen Permissions
-- Allows creating named roles with configurable read/write
-- access per application screen.
-- ============================================================

CREATE TABLE IF NOT EXISTS custom_roles (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_name    TEXT NOT NULL,
  role_code    TEXT NOT NULL UNIQUE,
  description  TEXT,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_roles_code   ON custom_roles(role_code);
CREATE INDEX IF NOT EXISTS idx_custom_roles_active ON custom_roles(is_active) WHERE is_active = TRUE;

-- One row per (role, screen) — stores read and write flags independently
CREATE TABLE IF NOT EXISTS role_permissions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_id     UUID NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  screen_code TEXT NOT NULL,
  can_read    BOOLEAN NOT NULL DEFAULT FALSE,
  can_write   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (role_id, screen_code)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role   ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_screen ON role_permissions(screen_code);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for authenticated users"
  ON custom_roles FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Enable insert for authenticated users"
  ON custom_roles FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users"
  ON custom_roles FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable delete for authenticated users"
  ON custom_roles FOR DELETE USING (auth.role() = 'authenticated');

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for authenticated users"
  ON role_permissions FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Enable insert for authenticated users"
  ON role_permissions FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users"
  ON role_permissions FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable delete for authenticated users"
  ON role_permissions FOR DELETE USING (auth.role() = 'authenticated');
