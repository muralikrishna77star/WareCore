-- ============================================================
-- Migration: 020_purchase_line_id_format.sql
-- Changes purchase_line_id format from:
--   BL-{uuid_prefix}-{seq}
-- to:
--   {group_code}{bill_number}-{seq}
-- Example: CR0626-0002-0001
-- ============================================================

CREATE OR REPLACE FUNCTION generate_purchase_line_id()
RETURNS TRIGGER AS $$
DECLARE
  v_bill_number TEXT;
  v_group_code  TEXT;
  v_seq         INTEGER;
BEGIN
  IF NEW.purchase_line_id IS NULL THEN

    -- Fetch human-readable bill number (e.g. '0626-0002')
    SELECT bill_number INTO v_bill_number
    FROM purchase_bills
    WHERE id = NEW.bill_id;

    -- Fetch item group code via item_master → item_groups (item_master_id is nullable)
    IF NEW.item_master_id IS NOT NULL THEN
      SELECT ig.group_code INTO v_group_code
      FROM item_master im
      JOIN item_groups ig ON ig.id = im.item_group_id
      WHERE im.id = NEW.item_master_id;
    END IF;

    v_group_code := COALESCE(v_group_code, '');

    -- Sequential number within this bill, derived from current max line_number
    v_seq := COALESCE((
      SELECT MAX(line_number)
      FROM purchase_bill_items
      WHERE bill_id = NEW.bill_id
    ), 0);

    -- e.g. CR0626-0002-0001
    NEW.purchase_line_id := v_group_code
                         || v_bill_number
                         || '-'
                         || LPAD((v_seq + 1)::TEXT, 4, '0');
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
