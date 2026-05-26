-- ============================================================
-- CREATE ITEM_MASTER TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS item_master (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_code TEXT NOT NULL UNIQUE,
  item_name TEXT NOT NULL,
  material_type_id UUID NOT NULL REFERENCES material_types(id) ON DELETE CASCADE,
  description TEXT,
  unit TEXT DEFAULT 'tons',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_item_master_code ON item_master(item_code);
CREATE INDEX idx_item_master_name ON item_master(item_name);
CREATE INDEX idx_item_master_material_type ON item_master(material_type_id);
CREATE INDEX idx_item_master_active ON item_master(is_active) WHERE is_active = TRUE;

-- ============================================================
-- ADD PURCHASE_LINE_ID AND ITEM_MASTER_ID COLUMNS TO PURCHASE_BILL_ITEMS
-- ============================================================

ALTER TABLE purchase_bill_items
ADD COLUMN IF NOT EXISTS purchase_line_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS line_number INTEGER,
ADD COLUMN IF NOT EXISTS item_master_id UUID REFERENCES item_master(id) ON DELETE SET NULL;

-- Create index for fast lookups
CREATE INDEX idx_purchase_bill_items_purchase_line_id ON purchase_bill_items(purchase_line_id);
CREATE INDEX idx_purchase_bill_items_line_number ON purchase_bill_items(bill_id, line_number);
CREATE INDEX idx_purchase_bill_items_item_master ON purchase_bill_items(item_master_id);


-- Function to generate auto-incremented purchase_line_id
-- Format: BL-{bill_id_first_8_chars}-{sequential_number}
CREATE OR REPLACE FUNCTION generate_purchase_line_id()
RETURNS TRIGGER AS $$
DECLARE
  v_bill_prefix TEXT;
  v_line_count INTEGER;
BEGIN
  IF NEW.purchase_line_id IS NULL THEN
    v_bill_prefix := SUBSTR(NEW.bill_id::TEXT, 1, 8);
    v_line_count := COALESCE((
      SELECT COALESCE(MAX(CAST(SUBSTRING(purchase_line_id, '\d+$') AS INTEGER)), 0)
      FROM purchase_bill_items
      WHERE bill_id = NEW.bill_id
    ), 0);
    NEW.purchase_line_id := 'BL-' || v_bill_prefix || '-' || LPAD((v_line_count + 1)::TEXT, 4, '0');
  END IF;
  
  -- Auto-increment line_number if not provided
  IF NEW.line_number IS NULL THEN
    NEW.line_number := COALESCE((
      SELECT MAX(line_number) + 1
      FROM purchase_bill_items
      WHERE bill_id = NEW.bill_id
    ), 1);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-generating purchase_line_id
DROP TRIGGER IF EXISTS trg_generate_purchase_line_id ON purchase_bill_items;
CREATE TRIGGER trg_generate_purchase_line_id
BEFORE INSERT ON purchase_bill_items
FOR EACH ROW
EXECUTE FUNCTION generate_purchase_line_id();

-- ============================================================
-- RLS POLICIES FOR PURCHASE_BILL_ITEMS
-- ============================================================
ALTER TABLE purchase_bill_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users"
  ON purchase_bill_items FOR SELECT
  USING (TRUE);

CREATE POLICY "Enable insert for authenticated users"
  ON purchase_bill_items FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users"
  ON purchase_bill_items FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable delete for authenticated users"
  ON purchase_bill_items FOR DELETE
  USING (auth.role() = 'authenticated');
