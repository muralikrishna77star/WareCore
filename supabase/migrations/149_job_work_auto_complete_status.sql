-- ============================================================
-- Migration 149: close a job work order automatically when nothing is left
-- at the vendor, and record how it closed
-- ============================================================
-- Until now an order's status was recomputed ONLY when Edit Order was saved
-- (line rule: every line's quantity_received >= quantity_sent - transferred
-- out). A vendor direct sale, a transfer or a return never touched it, so an
-- order whose material had all been sold straight from the vendor stayed
-- "In Progress" (e.g. JW-MSMYAC9J-ZIZQ). 93 orders were in that state, and
-- 96 more still said "In Progress" although part of their material had been
-- sold or returned.
--
-- fn_job_work_order_refresh_status(order) is now the single rule:
--   completed      — the line rule above holds, OR the order's stock at the
--                    vendor (SUM(vendor_delta) in vw_job_work_vendor_movements,
--                    the same figure as the Stock Statement / Item Ledger)
--                    is exactly 0 with at least one vendor movement
--   dispatched     — nothing received back on any line
--   partial_return — otherwise
-- plus completion_via: how the material left the vendor — any of
-- sold_direct, returned, transferred, processed (comma-separated); NULL
-- while the order is open. actual_return_date = the last vendor movement's
-- date (an already-completed order keeps its existing date).
-- Cancelled orders and orders with no lines are left untouched.
--
-- Applied from two triggers, so every path ends on the same answer:
--   * stock_ledger AFTER INSERT/UPDATE/DELETE of a job_work row — direct
--     sales, returns, transfers, outputs, cancellations.
--   * job_work_orders AFTER UPDATE OF status/actual_return_date when the
--     update didn't come from a trigger (pg_trigger_depth() = 1) — i.e.
--     edit_job_work_order()'s own line-rule status UPDATE, which is then
--     corrected to the shared rule without having to redefine that function.
-- ============================================================

ALTER TABLE job_work_orders ADD COLUMN IF NOT EXISTS completion_via TEXT;

CREATE OR REPLACE FUNCTION fn_job_work_order_refresh_status(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_order job_work_orders%ROWTYPE;
  v_lines INT;
  v_all_returned BOOLEAN;
  v_none_returned BOOLEAN;
  v_has_movement BOOLEAN;
  v_at_vendor NUMERIC;
  v_last_date DATE;
  v_sold NUMERIC;
  v_returned NUMERIC;
  v_transferred NUMERIC;
  v_processed NUMERIC;
  v_vendor_empty BOOLEAN;
  v_status TEXT;
  v_date DATE;
  v_via TEXT;
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = p_order_id;
  IF NOT FOUND OR v_order.status = 'cancelled' THEN
    RETURN;
  END IF;

  SELECT count(*),
         bool_and(quantity_received >= quantity_sent - COALESCE(quantity_transferred_out, 0)),
         bool_and(quantity_received <= 0)
  INTO v_lines, v_all_returned, v_none_returned
  FROM job_work_items WHERE job_work_order_id = p_order_id;
  IF v_lines = 0 THEN
    RETURN;
  END IF;

  SELECT count(*) > 0,
         COALESCE(sum(v.vendor_delta), 0),
         max(v.entry_date),
         COALESCE(sum(v.quantity) FILTER (
           WHERE v.entry_type = 'JOB_WORK_RETURN_IN' AND COALESCE(sl.notes, '') ILIKE '%virtual return%'), 0),
         COALESCE(sum(v.quantity) FILTER (
           WHERE (v.entry_type = 'JOB_WORK_RETURN_IN' AND COALESCE(sl.notes, '') NOT ILIKE '%virtual return%')
              OR (v.entry_type = 'JOB_WORK_OUTPUT_IN' AND NOT v.is_cross_item_output)
              OR (v.entry_type = 'JOB_WORK_CANCEL' AND v.quantity < 0 AND NOT v.is_cross_item_output)), 0),
         COALESCE(-sum(v.quantity) FILTER (WHERE v.entry_type = 'JOB_WORK_TRANSFER_OUT'), 0),
         COALESCE(-sum(v.vendor_delta) FILTER (WHERE v.is_cross_item_output), 0)
  INTO v_has_movement, v_at_vendor, v_last_date, v_sold, v_returned, v_transferred, v_processed
  FROM vw_job_work_vendor_movements v
  JOIN stock_ledger sl ON sl.id = v.id
  WHERE v.job_work_order_id = p_order_id;

  v_vendor_empty := v_has_movement AND abs(v_at_vendor) < 0.0005;

  IF v_all_returned OR v_vendor_empty THEN
    v_status := 'completed';
    v_date := CASE
      WHEN v_order.status = 'completed' AND v_order.actual_return_date IS NOT NULL THEN v_order.actual_return_date
      ELSE COALESCE(v_last_date, CURRENT_DATE)
    END;
    v_via := NULLIF(concat_ws(',',
      CASE WHEN v_sold > 0.0005 THEN 'sold_direct' END,
      CASE WHEN v_returned > 0.0005 THEN 'returned' END,
      CASE WHEN v_transferred > 0.0005 THEN 'transferred' END,
      -- Line rule met while the ledger still shows stock at the vendor: the
      -- input was converted into Output Materials of a different item.
      CASE WHEN v_processed > 0.0005 OR NOT v_vendor_empty THEN 'processed' END
    ), '');
  ELSE
    v_status := CASE WHEN v_none_returned THEN 'dispatched' ELSE 'partial_return' END;
    v_date := NULL;
    v_via := NULL;
  END IF;

  UPDATE job_work_orders
  SET status = v_status, actual_return_date = v_date, completion_via = v_via
  WHERE id = p_order_id
    AND (status, actual_return_date, completion_via) IS DISTINCT FROM (v_status, v_date, v_via);
END;
$$;

CREATE OR REPLACE FUNCTION fn_stock_ledger_refresh_job_work_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.reference_type = 'job_work' AND NEW.reference_id IS NOT NULL THEN
    PERFORM fn_job_work_order_refresh_status(NEW.reference_id);
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.reference_type = 'job_work' AND OLD.reference_id IS NOT NULL
     AND (TG_OP = 'DELETE' OR OLD.reference_id IS DISTINCT FROM NEW.reference_id) THEN
    PERFORM fn_job_work_order_refresh_status(OLD.reference_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_ledger_refresh_job_work_status ON stock_ledger;
CREATE TRIGGER trg_stock_ledger_refresh_job_work_status
  AFTER INSERT OR UPDATE OR DELETE ON stock_ledger
  FOR EACH ROW EXECUTE FUNCTION fn_stock_ledger_refresh_job_work_status();

CREATE OR REPLACE FUNCTION fn_job_work_order_status_set_directly()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only a status set by ordinary code (edit_job_work_order()); updates made
  -- by the refresh function itself run nested inside a trigger and skip this.
  IF pg_trigger_depth() = 1 THEN
    PERFORM fn_job_work_order_refresh_status(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_work_order_status_set_directly ON job_work_orders;
CREATE TRIGGER trg_job_work_order_status_set_directly
  AFTER UPDATE OF status, actual_return_date ON job_work_orders
  FOR EACH ROW EXECUTE FUNCTION fn_job_work_order_status_set_directly();

-- One-time recompute of every existing order. The updated_at trigger is
-- paused so "Last Modified On" isn't stamped with today on orders nobody
-- edited.
ALTER TABLE job_work_orders DISABLE TRIGGER update_job_work_orders_updated_at;
SELECT fn_job_work_order_refresh_status(id) FROM job_work_orders;
ALTER TABLE job_work_orders ENABLE TRIGGER update_job_work_orders_updated_at;
