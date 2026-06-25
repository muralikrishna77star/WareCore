-- ============================================================
-- Add Item Groups and link Item Master to Item Groups
-- ============================================================

CREATE TABLE IF NOT EXISTS item_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_code TEXT NOT NULL UNIQUE,
  group_desc TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_item_groups_code ON item_groups(group_code);
CREATE INDEX IF NOT EXISTS idx_item_groups_active ON item_groups(is_active) WHERE is_active = TRUE;

ALTER TABLE item_master
ADD COLUMN IF NOT EXISTS item_group_id UUID REFERENCES item_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_item_master_group ON item_master(item_group_id);

-- Enable row level security for the new table and the updated item master table
ALTER TABLE item_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_master ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "all_read_item_groups" ON item_groups;
CREATE POLICY "all_read_item_groups" ON item_groups
  FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "admins_manage_item_groups" ON item_groups;
CREATE POLICY "admins_manage_item_groups" ON item_groups
  FOR ALL USING (get_user_role() = 'admin');

DROP POLICY IF EXISTS "authenticated_read_item_master" ON item_master;
CREATE POLICY "authenticated_read_item_master" ON item_master
  FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "managers_manage_item_master" ON item_master;
CREATE POLICY "managers_manage_item_master" ON item_master
  FOR ALL USING (get_user_role() IN ('admin', 'company_manager', 'billing_staff', 'sales_manager'));
