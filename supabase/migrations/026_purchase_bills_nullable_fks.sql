-- Allow purchase bills to be saved without supplier/company/warehouse (needed for drafts)
ALTER TABLE purchase_bills ALTER COLUMN supplier_id DROP NOT NULL;
ALTER TABLE purchase_bills ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE purchase_bills ALTER COLUMN warehouse_id DROP NOT NULL;
