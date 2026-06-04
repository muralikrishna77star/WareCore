-- ============================================================
-- Migration: 021_add_developer_role.sql
-- Adds 'developer' as a super-admin role with full system access
-- ============================================================

-- 1. Extend the role check constraint
ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check,
  ADD CONSTRAINT user_profiles_role_check
    CHECK (role = ANY (ARRAY[
      'developer', 'admin', 'company_manager',
      'warehouse_manager', 'sales_manager', 'billing_staff'
    ]));

-- 2. Grant developer same RLS access as admin across all tables
--    (replaces single-role checks with IN lists)

-- Companies
DROP POLICY IF EXISTS "admins_full_access_companies" ON companies;
CREATE POLICY "admins_full_access_companies" ON companies
  FOR ALL USING (get_user_role() IN ('admin', 'developer'));

DROP POLICY IF EXISTS "company_users_read_own" ON companies;
CREATE POLICY "company_users_read_own" ON companies
  FOR SELECT USING (
    get_user_role() NOT IN ('admin', 'developer') AND id = get_user_company_id()
  );

-- Warehouses
DROP POLICY IF EXISTS "admins_full_access_warehouses" ON warehouses;
CREATE POLICY "admins_full_access_warehouses" ON warehouses
  FOR ALL USING (get_user_role() IN ('admin', 'developer'));

DROP POLICY IF EXISTS "company_users_read_own_warehouses" ON warehouses;
CREATE POLICY "company_users_read_own_warehouses" ON warehouses
  FOR SELECT USING (
    get_user_role() NOT IN ('admin', 'developer') AND company_id = get_user_company_id()
  );

-- Item groups (migration 008 policies)
DROP POLICY IF EXISTS "admins_manage_item_groups" ON item_groups;
CREATE POLICY "admins_manage_item_groups" ON item_groups
  FOR ALL USING (get_user_role() IN ('admin', 'developer'));
