-- ============================================================
-- WareCore WMS - Financial Entry Line IDs
-- ============================================================

ALTER TABLE financial_entries
  ADD COLUMN IF NOT EXISTS purchase_line_id TEXT,
  ADD COLUMN IF NOT EXISTS sub_purchase_line_id TEXT;

CREATE INDEX IF NOT EXISTS financial_entries_purchase_line_id_idx ON financial_entries(purchase_line_id);
CREATE INDEX IF NOT EXISTS financial_entries_sub_purchase_line_id_idx ON financial_entries(sub_purchase_line_id);
