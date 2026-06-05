-- Add 'draft' to purchase_bills status constraint
ALTER TABLE purchase_bills DROP CONSTRAINT IF EXISTS purchase_bills_status_check;
ALTER TABLE purchase_bills ADD CONSTRAINT purchase_bills_status_check
  CHECK (status IN ('draft', 'active', 'cancelled'));
