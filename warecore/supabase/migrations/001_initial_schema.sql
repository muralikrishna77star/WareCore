-- ============================================================
-- WareCore WMS - Initial Database Schema
-- Run in Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- COMPANIES
-- ============================================================
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  short_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  phone TEXT,
  email TEXT,
  gstin TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- WAREHOUSES
-- ============================================================
CREATE TABLE warehouses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SUPPLIERS
-- ============================================================
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  gstin TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CUSTOMERS
-- ============================================================
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  gstin TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MATERIAL TYPES
-- ============================================================
CREATE TABLE material_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,  -- CR, GI, GA, HR Coil, Paint, Scrap, etc.
  unit TEXT NOT NULL DEFAULT 'tons',  -- tons, units, kg
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MATERIAL SIZES (specs per material type)
-- ============================================================
CREATE TABLE material_sizes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  material_type_id UUID NOT NULL REFERENCES material_types(id) ON DELETE CASCADE,
  size_label TEXT NOT NULL,  -- e.g., "0.80x121", "1.40x1165", "Over Width"
  thickness DECIMAL(10,3),
  width DECIMAL(10,3),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(material_type_id, size_label)
);

-- ============================================================
-- USER PROFILES (extends Supabase auth.users)
-- ============================================================
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'company_manager', 'warehouse_manager', 'sales_manager', 'billing_staff')),
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  phone TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PURCHASE BILLS
-- ============================================================
CREATE TABLE purchase_bills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  bill_number TEXT NOT NULL,
  bill_date DATE NOT NULL,
  total_quantity DECIMAL(15,3) DEFAULT 0,
  total_amount DECIMAL(15,2) DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(supplier_id, bill_number)
);

-- ============================================================
-- PURCHASE BILL ITEMS
-- ============================================================
CREATE TABLE purchase_bill_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bill_id UUID NOT NULL REFERENCES purchase_bills(id) ON DELETE CASCADE,
  material_type_id UUID NOT NULL REFERENCES material_types(id),
  material_size_id UUID REFERENCES material_sizes(id),
  size_label TEXT,  -- free-form if not in material_sizes
  quantity DECIMAL(15,3) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL DEFAULT 'tons',
  rate DECIMAL(15,2),
  amount DECIMAL(15,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- STOCK LEDGER (Central ledger - every movement is recorded here)
-- ============================================================
CREATE TABLE stock_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'PURCHASE_IN',
    'VENDOR_RETURN_IN',
    'SALE_OUT',
    'JOB_WORK_OUT',
    'JOB_WORK_RETURN_IN',
    'TRANSFER_OUT',
    'TRANSFER_IN',
    'ADJUSTMENT_IN',
    'ADJUSTMENT_OUT'
  )),
  company_id UUID NOT NULL REFERENCES companies(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  material_type_id UUID NOT NULL REFERENCES material_types(id),
  material_size_id UUID REFERENCES material_sizes(id),
  size_label TEXT,  -- free-form if not in material_sizes
  quantity DECIMAL(15,3) NOT NULL,  -- positive = in, negative = out
  reference_type TEXT,  -- 'purchase_bill', 'transfer', 'job_work', 'dispatch'
  reference_id UUID,    -- FK to the respective table
  reference_number TEXT, -- human-readable reference
  notes TEXT,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast stock lookups
CREATE INDEX idx_stock_ledger_company ON stock_ledger(company_id);
CREATE INDEX idx_stock_ledger_warehouse ON stock_ledger(warehouse_id);
CREATE INDEX idx_stock_ledger_material ON stock_ledger(material_type_id);
CREATE INDEX idx_stock_ledger_date ON stock_ledger(entry_date);
CREATE INDEX idx_stock_ledger_ref ON stock_ledger(reference_type, reference_id);

-- ============================================================
-- INTER-COMPANY TRANSFERS
-- ============================================================
CREATE TABLE transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference_number TEXT NOT NULL UNIQUE,
  from_company_id UUID NOT NULL REFERENCES companies(id),
  from_warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  to_company_id UUID NOT NULL REFERENCES companies(id),
  to_warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_transit', 'completed', 'cancelled')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE transfer_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_id UUID NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  material_type_id UUID NOT NULL REFERENCES material_types(id),
  material_size_id UUID REFERENCES material_sizes(id),
  size_label TEXT,
  quantity DECIMAL(15,3) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL DEFAULT 'tons',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- JOB WORK (Outsourcing)
-- ============================================================
CREATE TABLE job_work_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference_number TEXT NOT NULL UNIQUE,
  vendor_id UUID NOT NULL REFERENCES suppliers(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  dispatch_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_return_date DATE,
  actual_return_date DATE,
  status TEXT NOT NULL DEFAULT 'dispatched' CHECK (status IN ('dispatched', 'partial_return', 'completed', 'cancelled')),
  work_description TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE job_work_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_work_order_id UUID NOT NULL REFERENCES job_work_orders(id) ON DELETE CASCADE,
  material_type_id UUID NOT NULL REFERENCES material_types(id),
  material_size_id UUID REFERENCES material_sizes(id),
  size_label TEXT,
  quantity_sent DECIMAL(15,3) NOT NULL CHECK (quantity_sent > 0),
  quantity_received DECIMAL(15,3) DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'tons',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DISPATCH / SALES ORDERS
-- ============================================================
CREATE TABLE dispatch_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number TEXT NOT NULL UNIQUE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  dispatch_date DATE NOT NULL DEFAULT CURRENT_DATE,
  vehicle_number TEXT,
  driver_name TEXT,
  total_quantity DECIMAL(15,3) DEFAULT 0,
  total_amount DECIMAL(15,2) DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE dispatch_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dispatch_order_id UUID NOT NULL REFERENCES dispatch_orders(id) ON DELETE CASCADE,
  material_type_id UUID NOT NULL REFERENCES material_types(id),
  material_size_id UUID REFERENCES material_sizes(id),
  size_label TEXT,
  quantity DECIMAL(15,3) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL DEFAULT 'tons',
  rate DECIMAL(15,2),
  amount DECIMAL(15,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- VIEWS for real-time stock calculation
-- ============================================================

-- Current stock per company/warehouse/material/size
CREATE VIEW v_current_stock AS
SELECT
  sl.company_id,
  c.name AS company_name,
  c.code AS company_code,
  sl.warehouse_id,
  w.name AS warehouse_name,
  sl.material_type_id,
  mt.name AS material_type_name,
  mt.unit,
  sl.material_size_id,
  COALESCE(ms.size_label, sl.size_label) AS size_label,
  SUM(sl.quantity) AS current_stock
FROM stock_ledger sl
JOIN companies c ON c.id = sl.company_id
JOIN warehouses w ON w.id = sl.warehouse_id
JOIN material_types mt ON mt.id = sl.material_type_id
LEFT JOIN material_sizes ms ON ms.id = sl.material_size_id
GROUP BY
  sl.company_id, c.name, c.code,
  sl.warehouse_id, w.name,
  sl.material_type_id, mt.name, mt.unit,
  sl.material_size_id, COALESCE(ms.size_label, sl.size_label);

-- Stock at vendors (job work)
CREATE VIEW v_stock_at_vendors AS
SELECT
  jwo.vendor_id,
  s.name AS vendor_name,
  jwo.company_id,
  c.name AS company_name,
  jwi.material_type_id,
  mt.name AS material_type_name,
  COALESCE(ms.size_label, jwi.size_label) AS size_label,
  SUM(jwi.quantity_sent - COALESCE(jwi.quantity_received, 0)) AS pending_quantity,
  mt.unit
FROM job_work_orders jwo
JOIN job_work_items jwi ON jwi.job_work_order_id = jwo.id
JOIN suppliers s ON s.id = jwo.vendor_id
JOIN companies c ON c.id = jwo.company_id
JOIN material_types mt ON mt.id = jwi.material_type_id
LEFT JOIN material_sizes ms ON ms.id = jwi.material_size_id
WHERE jwo.status IN ('dispatched', 'partial_return')
GROUP BY
  jwo.vendor_id, s.name,
  jwo.company_id, c.name,
  jwi.material_type_id, mt.name,
  COALESCE(ms.size_label, jwi.size_label), mt.unit;

-- ============================================================
-- TRIGGERS: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_warehouses_updated_at BEFORE UPDATE ON warehouses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_purchase_bills_updated_at BEFORE UPDATE ON purchase_bills FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_transfers_updated_at BEFORE UPDATE ON transfers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_job_work_orders_updated_at BEFORE UPDATE ON job_work_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_dispatch_orders_updated_at BEFORE UPDATE ON dispatch_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- TRIGGER: auto-update purchase_bills totals when items change
-- ============================================================
CREATE OR REPLACE FUNCTION update_bill_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_bill_id UUID;
BEGIN
  v_bill_id := COALESCE(NEW.bill_id, OLD.bill_id);
  UPDATE purchase_bills SET
    total_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM purchase_bill_items WHERE bill_id = v_bill_id),
    total_amount   = (SELECT COALESCE(SUM(amount), 0)   FROM purchase_bill_items WHERE bill_id = v_bill_id),
    updated_at = NOW()
  WHERE id = v_bill_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bill_items_totals
AFTER INSERT OR UPDATE OR DELETE ON purchase_bill_items
FOR EACH ROW EXECUTE FUNCTION update_bill_totals();

-- ============================================================
-- TRIGGERS: auto-write to stock_ledger when items are created
-- ============================================================

-- 1. PURCHASE BILL ITEMS → stock_ledger (PURCHASE_IN)
CREATE OR REPLACE FUNCTION fn_bill_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_bill purchase_bills%ROWTYPE;
BEGIN
  SELECT * INTO v_bill FROM purchase_bills WHERE id = NEW.bill_id;
  INSERT INTO stock_ledger (
    entry_type, company_id, warehouse_id, material_type_id, material_size_id,
    size_label, quantity, reference_type, reference_id, reference_number,
    notes, entry_date, created_by
  ) VALUES (
    'PURCHASE_IN',
    v_bill.company_id,
    v_bill.warehouse_id,
    NEW.material_type_id,
    NEW.material_size_id,
    NEW.size_label,
    NEW.quantity,
    'purchase_bill',
    v_bill.id,
    v_bill.bill_number,
    NEW.notes,
    v_bill.bill_date,
    v_bill.created_by
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bill_item_to_ledger
AFTER INSERT ON purchase_bill_items
FOR EACH ROW EXECUTE FUNCTION fn_bill_item_to_ledger();

-- 2. DISPATCH ITEMS → stock_ledger (SALE_OUT, negative quantity)
CREATE OR REPLACE FUNCTION fn_dispatch_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_dispatch dispatch_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_dispatch FROM dispatch_orders WHERE id = NEW.dispatch_order_id;
  INSERT INTO stock_ledger (
    entry_type, company_id, warehouse_id, material_type_id, material_size_id,
    size_label, quantity, reference_type, reference_id, reference_number,
    notes, entry_date, created_by
  ) VALUES (
    'SALE_OUT',
    v_dispatch.company_id,
    v_dispatch.warehouse_id,
    NEW.material_type_id,
    NEW.material_size_id,
    NEW.size_label,
    -NEW.quantity,
    'dispatch',
    v_dispatch.id,
    v_dispatch.invoice_number,
    NEW.notes,
    v_dispatch.dispatch_date,
    v_dispatch.created_by
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_dispatch_item_to_ledger
AFTER INSERT ON dispatch_items
FOR EACH ROW EXECUTE FUNCTION fn_dispatch_item_to_ledger();

-- 3. TRANSFER ITEMS → stock_ledger (TRANSFER_OUT from source, TRANSFER_IN to destination)
CREATE OR REPLACE FUNCTION fn_transfer_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_transfer transfers%ROWTYPE;
BEGIN
  SELECT * INTO v_transfer FROM transfers WHERE id = NEW.transfer_id;
  -- TRANSFER_OUT from source warehouse
  INSERT INTO stock_ledger (
    entry_type, company_id, warehouse_id, material_type_id, material_size_id,
    size_label, quantity, reference_type, reference_id, reference_number,
    notes, entry_date, created_by
  ) VALUES (
    'TRANSFER_OUT',
    v_transfer.from_company_id,
    v_transfer.from_warehouse_id,
    NEW.material_type_id,
    NEW.material_size_id,
    NEW.size_label,
    -NEW.quantity,
    'transfer',
    v_transfer.id,
    v_transfer.reference_number,
    NEW.notes,
    v_transfer.transfer_date,
    v_transfer.created_by
  );
  -- TRANSFER_IN to destination warehouse
  INSERT INTO stock_ledger (
    entry_type, company_id, warehouse_id, material_type_id, material_size_id,
    size_label, quantity, reference_type, reference_id, reference_number,
    notes, entry_date, created_by
  ) VALUES (
    'TRANSFER_IN',
    v_transfer.to_company_id,
    v_transfer.to_warehouse_id,
    NEW.material_type_id,
    NEW.material_size_id,
    NEW.size_label,
    NEW.quantity,
    'transfer',
    v_transfer.id,
    v_transfer.reference_number,
    NEW.notes,
    v_transfer.transfer_date,
    v_transfer.created_by
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transfer_item_to_ledger
AFTER INSERT ON transfer_items
FOR EACH ROW EXECUTE FUNCTION fn_transfer_item_to_ledger();

-- 4. JOB WORK ITEMS → stock_ledger
--    INSERT: JOB_WORK_OUT (material leaves warehouse to vendor)
--    UPDATE (quantity_received increases): JOB_WORK_RETURN_IN (material comes back)
CREATE OR REPLACE FUNCTION fn_job_work_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_order job_work_orders%ROWTYPE;
  v_returned_delta DECIMAL(15,3);
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = NEW.job_work_order_id;

  IF TG_OP = 'INSERT' THEN
    -- Material going out to vendor
    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id, material_type_id, material_size_id,
      size_label, quantity, reference_type, reference_id, reference_number,
      entry_date, created_by
    ) VALUES (
      'JOB_WORK_OUT',
      v_order.company_id,
      v_order.warehouse_id,
      NEW.material_type_id,
      NEW.material_size_id,
      NEW.size_label,
      -NEW.quantity_sent,
      'job_work',
      v_order.id,
      v_order.reference_number,
      v_order.dispatch_date,
      v_order.created_by
    );

  ELSIF TG_OP = 'UPDATE' AND NEW.quantity_received > OLD.quantity_received THEN
    -- Material coming back from vendor (delta only)
    v_returned_delta := NEW.quantity_received - OLD.quantity_received;
    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id, material_type_id, material_size_id,
      size_label, quantity, reference_type, reference_id, reference_number,
      entry_date, created_by
    ) VALUES (
      'JOB_WORK_RETURN_IN',
      v_order.company_id,
      v_order.warehouse_id,
      NEW.material_type_id,
      NEW.material_size_id,
      NEW.size_label,
      v_returned_delta,
      'job_work',
      v_order.id,
      v_order.reference_number,
      CURRENT_DATE,
      v_order.created_by
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_job_work_item_to_ledger
AFTER INSERT OR UPDATE ON job_work_items
FOR EACH ROW EXECUTE FUNCTION fn_job_work_item_to_ledger();
