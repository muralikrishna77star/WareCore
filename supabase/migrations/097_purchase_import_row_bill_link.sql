-- Lets a staging row that has already been imported link back to the real
-- purchase_bills row it became, so the batch review screen can offer a
-- "View Purchase" link into the actual bill (with its full line/tax detail)
-- instead of only ever showing the frozen staging snapshot. Nullable and
-- ON DELETE SET NULL: a batch's rows are the audit trail and must survive
-- even if the bill they produced is later deleted through the normal bill
-- lifecycle.
ALTER TABLE purchase_import_rows
  ADD COLUMN purchase_bill_id UUID REFERENCES purchase_bills(id) ON DELETE SET NULL;

CREATE INDEX idx_purchase_import_rows_bill ON purchase_import_rows (purchase_bill_id);

COMMENT ON COLUMN purchase_import_rows.purchase_bill_id IS
  'Set at import commit time (POST .../batches/:id/import) to the purchase_bills.id this row''s line became, via ResolvedLine.rowNumber tracing back to the staging row_number. NULL for STAGED/CANCELLED batches, or if the bill was later deleted.';
