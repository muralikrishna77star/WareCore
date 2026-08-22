-- ============================================================
-- WareCore WMS - Prevent Job Work dated before its purchase line
--
-- Root cause of a real incident (see migration 116): a Job Work Transfer
-- was recorded dated 2024-07-23, drawing from purchase line GI0724-0020 —
-- but that line wasn't invoiced until 2024-07-31, eight days later. The
-- material couldn't have existed yet, so the transfer was physically
-- impossible and had to be removed after a lot of investigation.
--
-- Job Work order creation (jobwork/new) and Transfer creation
-- (jobwork/[id]/transfer) both insert job_work_items directly via plain
-- Hasura mutations — there's no stored procedure gating either path — so
-- the only reliable place to enforce this is a trigger on the table
-- itself, not client-side validation (which today's incident already
-- showed isn't a strong enough guard on its own).
--
-- Two triggers: one catches a job_work_items row being inserted/re-pointed
-- at a purchase line dated after its own order's dispatch_date (covers new
-- orders, Edit Order's new-line path, and Transfer's destination-line
-- insert — the exact shape of today's bug). The other catches an existing
-- order's dispatch_date being edited to before an already-attached line's
-- purchase date.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_job_work_item_validate_purchase_date()
RETURNS TRIGGER AS $$
DECLARE
  v_bill_date DATE;
  v_order_date DATE;
BEGIN
  IF NEW.purchase_line_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pb.bill_date INTO v_bill_date
  FROM purchase_bill_items pbi
  JOIN purchase_bills pb ON pb.id = pbi.bill_id
  WHERE pbi.purchase_line_id = NEW.purchase_line_id
  LIMIT 1;

  -- Purchase line not found is a separate data-integrity question this
  -- check isn't responsible for — don't block on it.
  IF v_bill_date IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT dispatch_date INTO v_order_date FROM job_work_orders WHERE id = NEW.job_work_order_id;

  IF v_order_date IS NOT NULL AND v_order_date < v_bill_date THEN
    RAISE EXCEPTION 'Job Work dispatch date (%) is before purchase line % was invoiced (%) — the material did not exist yet.', v_order_date, NEW.purchase_line_id, v_bill_date;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_job_work_item_validate_purchase_date ON job_work_items;
CREATE TRIGGER trg_job_work_item_validate_purchase_date
BEFORE INSERT OR UPDATE OF purchase_line_id, job_work_order_id ON job_work_items
FOR EACH ROW EXECUTE FUNCTION fn_job_work_item_validate_purchase_date();

CREATE OR REPLACE FUNCTION fn_job_work_order_validate_dispatch_date()
RETURNS TRIGGER AS $$
DECLARE
  v_bad RECORD;
BEGIN
  IF NEW.dispatch_date = OLD.dispatch_date THEN
    RETURN NEW;
  END IF;

  SELECT jwi.purchase_line_id, pb.bill_date INTO v_bad
  FROM job_work_items jwi
  JOIN purchase_bill_items pbi ON pbi.purchase_line_id = jwi.purchase_line_id
  JOIN purchase_bills pb ON pb.id = pbi.bill_id
  WHERE jwi.job_work_order_id = NEW.id
    AND pb.bill_date > NEW.dispatch_date
  LIMIT 1;

  IF v_bad.purchase_line_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot set dispatch date to % — line % was invoiced later, on %.', NEW.dispatch_date, v_bad.purchase_line_id, v_bad.bill_date;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_job_work_order_validate_dispatch_date ON job_work_orders;
CREATE TRIGGER trg_job_work_order_validate_dispatch_date
BEFORE UPDATE OF dispatch_date ON job_work_orders
FOR EACH ROW EXECUTE FUNCTION fn_job_work_order_validate_dispatch_date();
