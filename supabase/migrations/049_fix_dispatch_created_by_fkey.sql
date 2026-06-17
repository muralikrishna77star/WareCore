-- ============================================================
-- WareCore WMS - Fix dispatch_orders.created_by FK
--
-- Migration 003 removed the auth.users FK from purchase_bills
-- but missed dispatch_orders. Now that CreateDispatchOrder
-- injects created_by from the session (a user_profiles UUID),
-- inserting fails because auth.users is an empty stub table.
-- ============================================================

ALTER TABLE dispatch_orders
  DROP CONSTRAINT IF EXISTS dispatch_orders_created_by_fkey;
