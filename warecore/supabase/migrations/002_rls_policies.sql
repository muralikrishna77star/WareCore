-- ============================================================
-- WareCore WMS - Row Level Security Policies
-- Run AFTER 001_initial_schema.sql
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_sizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_bill_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_items ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Helper function to get current user company
CREATE OR REPLACE FUNCTION get_user_company_id()
RETURNS UUID AS $$
  SELECT company_id FROM user_profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ============================================================
-- COMPANIES POLICIES
-- ============================================================
CREATE POLICY "admins_full_access_companies" ON companies
  FOR ALL USING (get_user_role() = 'admin');

CREATE POLICY "company_users_read_own" ON companies
  FOR SELECT USING (
    get_user_role() != 'admin' AND id = get_user_company_id()
  );

-- ============================================================
-- WAREHOUSES POLICIES
-- ============================================================
CREATE POLICY "admins_full_access_warehouses" ON warehouses
  FOR ALL USING (get_user_role() = 'admin');

CREATE POLICY "company_users_read_own_warehouses" ON warehouses
  FOR SELECT USING (
    get_user_role() != 'admin' AND company_id = get_user_company_id()
  );

-- ============================================================
-- SUPPLIERS & CUSTOMERS - all authenticated users can read
-- ============================================================
CREATE POLICY "authenticated_read_suppliers" ON suppliers
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "managers_manage_suppliers" ON suppliers
  FOR ALL USING (get_user_role() IN ('admin', 'company_manager', 'billing_staff'));

CREATE POLICY "authenticated_read_customers" ON customers
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "managers_manage_customers" ON customers
  FOR ALL USING (get_user_role() IN ('admin', 'company_manager', 'sales_manager', 'billing_staff'));

-- ============================================================
-- MATERIAL TYPES & SIZES - read for all, write for admins
-- ============================================================
CREATE POLICY "all_read_material_types" ON material_types
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "admins_manage_material_types" ON material_types
  FOR ALL USING (get_user_role() = 'admin');

CREATE POLICY "all_read_material_sizes" ON material_sizes
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "admins_manage_material_sizes" ON material_sizes
  FOR ALL USING (get_user_role() = 'admin');

-- ============================================================
-- USER PROFILES
-- ============================================================
CREATE POLICY "users_read_own_profile" ON user_profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "admins_full_access_profiles" ON user_profiles
  FOR ALL USING (get_user_role() = 'admin');

CREATE POLICY "admins_read_all_profiles" ON user_profiles
  FOR SELECT USING (get_user_role() = 'admin');

-- ============================================================
-- PURCHASE BILLS & ITEMS
-- ============================================================
CREATE POLICY "admins_full_bills" ON purchase_bills
  FOR ALL USING (get_user_role() = 'admin');

CREATE POLICY "company_users_manage_bills" ON purchase_bills
  FOR ALL USING (
    get_user_role() IN ('company_manager', 'billing_staff') 
    AND company_id = get_user_company_id()
  );

CREATE POLICY "all_company_users_read_bills" ON purchase_bills
  FOR SELECT USING (
    company_id = get_user_company_id()
  );

CREATE POLICY "all_read_bill_items" ON purchase_bill_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM purchase_bills pb 
      WHERE pb.id = purchase_bill_items.bill_id 
      AND pb.company_id = get_user_company_id()
    ) OR get_user_role() = 'admin'
  );

CREATE POLICY "managers_manage_bill_items" ON purchase_bill_items
  FOR ALL USING (
    get_user_role() IN ('admin', 'company_manager', 'billing_staff')
  );

-- ============================================================
-- STOCK LEDGER
-- ============================================================
CREATE POLICY "admins_full_stock_ledger" ON stock_ledger
  FOR ALL USING (get_user_role() = 'admin');

CREATE POLICY "company_users_read_stock_ledger" ON stock_ledger
  FOR SELECT USING (
    company_id = get_user_company_id()
  );

CREATE POLICY "managers_insert_stock_ledger" ON stock_ledger
  FOR INSERT WITH CHECK (
    get_user_role() IN ('admin', 'company_manager', 'warehouse_manager', 'billing_staff')
    AND company_id = get_user_company_id()
  );

-- ============================================================
-- TRANSFERS
-- ============================================================
CREATE POLICY "admins_full_transfers" ON transfers
  FOR ALL USING (get_user_role() = 'admin');

CREATE POLICY "company_users_read_transfers" ON transfers
  FOR SELECT USING (
    from_company_id = get_user_company_id() 
    OR to_company_id = get_user_company_id()
  );

CREATE POLICY "managers_create_transfers" ON transfers
  FOR INSERT WITH CHECK (
    get_user_role() IN ('admin', 'company_manager')
    AND from_company_id = get_user_company_id()
  );

CREATE POLICY "all_read_transfer_items" ON transfer_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM transfers t 
      WHERE t.id = transfer_items.transfer_id 
      AND (t.from_company_id = get_user_company_id() OR t.to_company_id = get_user_company_id())
    ) OR get_user_role() = 'admin'
  );

CREATE POLICY "managers_manage_transfer_items" ON transfer_items
  FOR ALL USING (get_user_role() IN ('admin', 'company_manager'));

-- ============================================================
-- JOB WORK
-- ============================================================
CREATE POLICY "admins_full_job_work" ON job_work_orders
  FOR ALL USING (get_user_role() = 'admin');

CREATE POLICY "company_users_manage_job_work" ON job_work_orders
  FOR ALL USING (
    get_user_role() IN ('company_manager', 'warehouse_manager')
    AND company_id = get_user_company_id()
  );

CREATE POLICY "company_users_read_job_work" ON job_work_orders
  FOR SELECT USING (company_id = get_user_company_id());

CREATE POLICY "all_read_job_work_items" ON job_work_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM job_work_orders jwo 
      WHERE jwo.id = job_work_items.job_work_order_id 
      AND jwo.company_id = get_user_company_id()
    ) OR get_user_role() = 'admin'
  );

CREATE POLICY "managers_manage_job_work_items" ON job_work_items
  FOR ALL USING (get_user_role() IN ('admin', 'company_manager', 'warehouse_manager'));

-- ============================================================
-- DISPATCH ORDERS
-- ============================================================
CREATE POLICY "admins_full_dispatch" ON dispatch_orders
  FOR ALL USING (get_user_role() = 'admin');

CREATE POLICY "company_users_manage_dispatch" ON dispatch_orders
  FOR ALL USING (
    get_user_role() IN ('company_manager', 'sales_manager', 'warehouse_manager')
    AND company_id = get_user_company_id()
  );

CREATE POLICY "company_users_read_dispatch" ON dispatch_orders
  FOR SELECT USING (company_id = get_user_company_id());

CREATE POLICY "all_read_dispatch_items" ON dispatch_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM dispatch_orders d 
      WHERE d.id = dispatch_items.dispatch_order_id 
      AND d.company_id = get_user_company_id()
    ) OR get_user_role() = 'admin'
  );

CREATE POLICY "managers_manage_dispatch_items" ON dispatch_items
  FOR ALL USING (get_user_role() IN ('admin', 'company_manager', 'sales_manager', 'warehouse_manager'));
