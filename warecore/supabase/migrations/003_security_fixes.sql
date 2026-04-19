-- ============================================================
-- WareCore WMS - Security Fixes
-- Run AFTER 002_rls_policies.sql
-- ============================================================

-- ============================================================
-- FIX 1: Stock Ledger — remove direct INSERT permission for
-- application roles. All ledger writes are handled exclusively
-- by DB triggers (fn_bill_item_to_ledger, etc.).
-- Allowing app-layer inserts lets a malicious user manufacture
-- fraudulent ledger entries to inflate/deflate stock.
-- ============================================================
DROP POLICY IF EXISTS "managers_insert_stock_ledger" ON stock_ledger;

-- Admins retain full access (existing policy), but no other role
-- can INSERT directly. Trigger functions run as SECURITY DEFINER
-- so they bypass RLS and can still write to the ledger.


-- ============================================================
-- FIX 2: Transfer status transitions — enforce valid state
-- machine at the DB level so client-side bypass is impossible.
-- Allowed transitions:
--   pending      → in_transit | cancelled
--   in_transit   → completed  | cancelled
-- ============================================================
CREATE OR REPLACE FUNCTION fn_validate_transfer_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'completed' OR OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'Transfer % is already % and cannot be changed.', OLD.id, OLD.status;
  END IF;

  IF OLD.status = 'pending' AND NEW.status NOT IN ('in_transit', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid transition: pending → %. Allowed: in_transit, cancelled.', NEW.status;
  END IF;

  IF OLD.status = 'in_transit' AND NEW.status NOT IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid transition: in_transit → %. Allowed: completed, cancelled.', NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transfer_status_transition ON transfers;
CREATE TRIGGER trg_transfer_status_transition
  BEFORE UPDATE OF status ON transfers
  FOR EACH ROW EXECUTE FUNCTION fn_validate_transfer_status_transition();


-- ============================================================
-- FIX 3: Job Work return quantity — enforce that quantity_received
-- cannot exceed quantity_sent at the DB level.
-- ============================================================
ALTER TABLE job_work_items
  DROP CONSTRAINT IF EXISTS chk_job_work_qty_received,
  ADD CONSTRAINT chk_job_work_qty_received
    CHECK (quantity_received >= 0 AND quantity_received <= quantity_sent);


-- ============================================================
-- FIX 4: Prevent stock_ledger UPDATE and DELETE for all non-admin
-- roles (audit trail must be immutable).
-- ============================================================
DROP POLICY IF EXISTS "prevent_ledger_update_delete" ON stock_ledger;

CREATE POLICY "only_admins_update_delete_ledger" ON stock_ledger
  FOR UPDATE USING (get_user_role() = 'admin');

-- No DELETE policy for any role — the ledger is append-only.
-- Existing admins_full_stock_ledger policy covers SELECT + INSERT for admins only now.
