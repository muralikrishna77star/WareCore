-- ============================================================
-- WareCore WMS - Tax Control Database
-- CGST / SGST applied on Sale/Purchase value
-- TDS applied on (Value + CGST + SGST) for purchases
-- TCS applied on (Value + CGST + SGST) for sales
-- ============================================================

CREATE TABLE IF NOT EXISTS tax_rates (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,                          -- e.g. "GST 18%", "GST 5% + TDS 2%"
  cgst_rate     NUMERIC(5,2) NOT NULL DEFAULT 0,        -- CGST %
  sgst_rate     NUMERIC(5,2) NOT NULL DEFAULT 0,        -- SGST %
  tds_rate      NUMERIC(5,2) NOT NULL DEFAULT 0,        -- TDS % (on taxable+GST, for purchases)
  tcs_rate      NUMERIC(5,2) NOT NULL DEFAULT 0,        -- TCS % (on taxable+GST, for sales)
  applicable_to TEXT NOT NULL DEFAULT 'BOTH'
                  CHECK (applicable_to IN ('BOTH','PURCHASE','SALES')),
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tax_rates_active ON tax_rates(is_active) WHERE is_active = TRUE;

-- Seed common GST slabs used in India
INSERT INTO tax_rates (name, cgst_rate, sgst_rate, tds_rate, tcs_rate, applicable_to) VALUES
  ('Exempt (0%)',          0,    0,    0, 0, 'BOTH'),
  ('GST 5%',              2.5,  2.5,  0, 0, 'BOTH'),
  ('GST 12%',             6,    6,    0, 0, 'BOTH'),
  ('GST 18%',             9,    9,    0, 0, 'BOTH'),
  ('GST 28%',            14,   14,    0, 0, 'BOTH'),
  ('GST 18% + TDS 2%',    9,    9,  2,   0, 'PURCHASE'),
  ('GST 18% + TCS 0.1%',  9,    9,  0, 0.1, 'SALES')
ON CONFLICT DO NOTHING;

-- ── Add tax columns to purchase_bill_items ───────────────────────────────────
ALTER TABLE purchase_bill_items
  ADD COLUMN IF NOT EXISTS tax_rate_id    UUID REFERENCES tax_rates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS taxable_value  NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS cgst_rate      NUMERIC(5,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_amount    NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_rate      NUMERIC(5,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount    NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tds_rate       NUMERIC(5,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tds_amount     NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_with_tax NUMERIC(15,2);

CREATE INDEX IF NOT EXISTS idx_purchase_bill_items_tax_rate ON purchase_bill_items(tax_rate_id);

-- ── Add tax columns to dispatch_items ───────────────────────────────────────
ALTER TABLE dispatch_items
  ADD COLUMN IF NOT EXISTS tax_rate_id    UUID REFERENCES tax_rates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS taxable_value  NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS cgst_rate      NUMERIC(5,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_amount    NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_rate      NUMERIC(5,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount    NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tcs_rate       NUMERIC(5,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tcs_amount     NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_with_tax NUMERIC(15,2);

CREATE INDEX IF NOT EXISTS idx_dispatch_items_tax_rate ON dispatch_items(tax_rate_id);

-- updated_at trigger for tax_rates
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_tax_rates_updated_at') THEN
    CREATE TRIGGER update_tax_rates_updated_at
    BEFORE UPDATE ON tax_rates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
