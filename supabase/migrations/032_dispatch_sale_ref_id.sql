-- Add sale_ref_id to dispatch_orders for cross-system reference
ALTER TABLE dispatch_orders ADD COLUMN IF NOT EXISTS sale_ref_id TEXT;
