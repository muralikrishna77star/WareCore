-- ============================================================
-- WareCore WMS - Financial Entries Schema
-- ============================================================

CREATE TABLE financial_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('RECEIPT', 'PAYMENT')),
  reference_type TEXT NOT NULL CHECK (reference_type IN ('purchase_bill', 'dispatch_order')),
  reference_id UUID,
  reference_number TEXT,
  amount NUMERIC(15, 2) NOT NULL,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_mode TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX financial_entries_company_id_idx ON financial_entries(company_id);
CREATE INDEX financial_entries_supplier_id_idx ON financial_entries(supplier_id);
CREATE INDEX financial_entries_customer_id_idx ON financial_entries(customer_id);
CREATE INDEX financial_entries_reference_idx ON financial_entries(reference_type, reference_id);

CREATE TRIGGER update_financial_entries_updated_at
BEFORE UPDATE ON financial_entries
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
