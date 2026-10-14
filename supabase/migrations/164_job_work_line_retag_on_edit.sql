-- ============================================================
-- Migration 164: when Edit Order changes a job work line's purchase line,
-- material or size, move its dispatch ledger rows with it
-- ============================================================
-- Reported 2026-10-14: OTH00046 "Paint Over width"'s Item Stock Ledger
-- showed a dispatch of OTH00032 "Mixed Over width". JW-MTYAKT99-C8GE line
-- JW-1212-0020 (0.600) was first saved against purchase line OT0324-0003
-- (OTH00046, also 0.600), then corrected in Edit Order on 14-Oct to
-- OT0324-0001 (OTH00032). edit_job_work_order() updates the line in place,
-- but fn_job_work_item_to_ledger()'s UPDATE branch only posts when Qty Sent
-- changes — so the line's JOB_WORK_OUT row kept OT0324-0003, and the
-- per-item ledger (162) charged OTH00032's dispatch to OTH00046 (-0.600,
-- which also looked like the same purchase line sent out twice). The same
-- gap would leave a changed material / size behind on the old material.
-- A system-wide scan finds this row only: every other JOB_WORK_OUT /
-- RETURN_IN purchase line tag is on a line of its own order.
--
-- 1. Repair: re-tag that row to OT0324-0001.
-- 2. Prevention, in fn_job_work_item_to_ledger's UPDATE branch, when a
--    non-transfer line's purchase line, sub purchase line, material or size
--    changes:
--    * if the line already has returns / vendor direct sales, transfers or
--      Output Materials against it, refuse — their ledger rows carry the
--      old purchase line and would be left behind;
--    * otherwise move its JOB_WORK_OUT rows to the new purchase line /
--      material / size — in place when no other line of the order shares the
--      old values, else as a reversal under the old values plus a fresh
--      dispatch under the new ones (the old rows can't be told apart).
-- ============================================================

-- 1. Repair JW-MTYAKT99-C8GE / JW-1212-0020.
UPDATE stock_ledger sl
SET purchase_line_id = 'OT0324-0001'
FROM job_work_orders jwo
WHERE sl.id = '07e2071e-690a-496b-b7c1-37764cd41fbc'
  AND jwo.id = sl.reference_id AND jwo.reference_number = 'JW-MTYAKT99-C8GE'
  AND sl.entry_type = 'JOB_WORK_OUT' AND sl.purchase_line_id = 'OT0324-0003'
  AND EXISTS (SELECT 1 FROM job_work_items jwi
              WHERE jwi.job_work_order_id = jwo.id AND jwi.job_line_id = 'JW-1212-0020'
                AND jwi.purchase_line_id = 'OT0324-0001');

-- 2. Move a line's dispatch rows when Edit Order re-points it.
CREATE OR REPLACE FUNCTION public.fn_job_work_item_to_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_order job_work_orders%ROWTYPE;
  v_returned_delta DECIMAL(15,3);
  v_transferred_delta DECIMAL(15,3);
  v_transfer_date DATE;
  v_sent_delta DECIMAL(15,3);
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = NEW.job_work_order_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_transfer_line THEN
      INSERT INTO stock_ledger (
        entry_type, company_id, warehouse_id, material_type_id, material_size_id,
        size_label, quantity, reference_type, reference_id, reference_number,
        notes, entry_date, purchase_line_id, sub_purchase_line_id, created_by
      ) VALUES (
        'JOB_WORK_TRANSFER_IN',
        v_order.company_id,
        v_order.warehouse_id,
        NEW.material_type_id,
        NEW.material_size_id,
        NEW.size_label,
        NEW.quantity_sent,
        'job_work',
        v_order.id,
        v_order.reference_number,
        'Vendor transfer — received',
        v_order.dispatch_date,
        NEW.purchase_line_id,
        NEW.sub_purchase_line_id,
        v_order.created_by
      );
    ELSE
      -- Material going out to vendor. NEW: tag purchase_line_id/
      -- sub_purchase_line_id (previously omitted here, unlike every other
      -- branch of this trigger) so Purchase Line Movements can trace this
      -- dispatch back to the purchase it came from.
      INSERT INTO stock_ledger (
        entry_type, company_id, warehouse_id, material_type_id, material_size_id,
        size_label, quantity, reference_type, reference_id, reference_number,
        entry_date, created_by, purchase_line_id, sub_purchase_line_id
      ) VALUES (
        'JOB_WORK_OUT',
        v_order.company_id,
        v_order.warehouse_id,
        NEW.material_type_id,
        NEW.material_size_id,
        NEW.size_label,
        -NEW.quantity_sent,
        'job_work',
        v_order.id,
        v_order.reference_number,
        v_order.dispatch_date,
        v_order.created_by,
        NEW.purchase_line_id,
        NEW.sub_purchase_line_id
      );
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN

    -- 164: the line now points at a different purchase line / material /
    -- size. Its dispatch rows follow it; anything posted against it since
    -- (returns, vendor sales, transfers, outputs) blocks the change.
    IF NOT NEW.is_transfer_line AND (
         NEW.purchase_line_id     IS DISTINCT FROM OLD.purchase_line_id
      OR NEW.sub_purchase_line_id IS DISTINCT FROM OLD.sub_purchase_line_id
      OR NEW.material_type_id     IS DISTINCT FROM OLD.material_type_id
      OR NEW.material_size_id     IS DISTINCT FROM OLD.material_size_id
    ) THEN
      IF COALESCE(OLD.quantity_received, 0) > 0
         OR COALESCE(OLD.quantity_transferred_out, 0) > 0
         OR EXISTS (SELECT 1 FROM job_work_output_items oi
                    WHERE oi.job_work_order_id = OLD.job_work_order_id AND oi.source_job_line_id = OLD.job_line_id)
         OR EXISTS (SELECT 1 FROM job_work_items d WHERE d.source_job_work_item_id = OLD.id) THEN
        RAISE EXCEPTION 'Line % already has material returned, sold from the vendor, transferred or converted against purchase line %, so its purchase line, material or size can''t be changed. Reverse those entries first, or keep this line and add a new one.',
          COALESCE(OLD.job_line_id, ''), COALESCE(OLD.purchase_line_id, '(none)');
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM job_work_items o
        WHERE o.job_work_order_id = OLD.job_work_order_id AND o.id <> OLD.id AND NOT o.is_transfer_line
          AND o.purchase_line_id     IS NOT DISTINCT FROM OLD.purchase_line_id
          AND o.sub_purchase_line_id IS NOT DISTINCT FROM OLD.sub_purchase_line_id
          AND o.material_type_id     = OLD.material_type_id
          AND o.material_size_id     IS NOT DISTINCT FROM OLD.material_size_id
      ) THEN
        UPDATE stock_ledger SET
          purchase_line_id     = NEW.purchase_line_id,
          sub_purchase_line_id = NEW.sub_purchase_line_id,
          material_type_id     = NEW.material_type_id,
          material_size_id     = NEW.material_size_id,
          size_label           = NEW.size_label
        WHERE reference_type = 'job_work' AND reference_id = OLD.job_work_order_id
          AND entry_type = 'JOB_WORK_OUT'
          AND purchase_line_id     IS NOT DISTINCT FROM OLD.purchase_line_id
          AND sub_purchase_line_id IS NOT DISTINCT FROM OLD.sub_purchase_line_id
          AND material_type_id     = OLD.material_type_id
          AND material_size_id     IS NOT DISTINCT FROM OLD.material_size_id;
      ELSE
        INSERT INTO stock_ledger (
          entry_type, company_id, warehouse_id, material_type_id, material_size_id,
          size_label, quantity, reference_type, reference_id, reference_number,
          notes, entry_date, purchase_line_id, sub_purchase_line_id, created_by
        ) VALUES
        ('JOB_WORK_OUT', v_order.company_id, v_order.warehouse_id,
         OLD.material_type_id, OLD.material_size_id, OLD.size_label,
         OLD.quantity_sent, 'job_work', v_order.id, v_order.reference_number,
         'Edit Order — line moved to another purchase line', v_order.dispatch_date,
         OLD.purchase_line_id, OLD.sub_purchase_line_id, v_order.created_by),
        ('JOB_WORK_OUT', v_order.company_id, v_order.warehouse_id,
         NEW.material_type_id, NEW.material_size_id, NEW.size_label,
         -OLD.quantity_sent, 'job_work', v_order.id, v_order.reference_number,
         'Edit Order — line moved to another purchase line', v_order.dispatch_date,
         NEW.purchase_line_id, NEW.sub_purchase_line_id, v_order.created_by);
      END IF;
    END IF;

    IF NEW.quantity_sent <> OLD.quantity_sent THEN
      v_sent_delta := NEW.quantity_sent - OLD.quantity_sent;
      INSERT INTO stock_ledger (
        entry_type, company_id, warehouse_id, material_type_id, material_size_id,
        size_label, quantity, reference_type, reference_id, reference_number,
        notes, entry_date, purchase_line_id, sub_purchase_line_id, created_by
      ) VALUES (
        CASE WHEN NEW.is_transfer_line THEN 'JOB_WORK_TRANSFER_IN' ELSE 'JOB_WORK_OUT' END,
        v_order.company_id, v_order.warehouse_id,
        NEW.material_type_id, NEW.material_size_id, NEW.size_label,
        CASE WHEN NEW.is_transfer_line THEN v_sent_delta ELSE -v_sent_delta END,
        'job_work', v_order.id, v_order.reference_number,
        'Edit Order — Qty Sent corrected',
        v_order.dispatch_date,
        NEW.purchase_line_id, NEW.sub_purchase_line_id,
        v_order.created_by
      );
    END IF;

    IF NEW.quantity_received > OLD.quantity_received THEN
      IF current_setting('warecore.skip_job_work_return_trigger', true) = 'true' THEN
        -- fall through to the transfer check below
      ELSE
        v_returned_delta := NEW.quantity_received - OLD.quantity_received;
        INSERT INTO stock_ledger (
          entry_type, company_id, warehouse_id, material_type_id, material_size_id,
          size_label, quantity, reference_type, reference_id, reference_number,
          entry_date, created_by
        ) VALUES (
          'JOB_WORK_RETURN_IN',
          v_order.company_id,
          v_order.warehouse_id,
          NEW.material_type_id,
          NEW.material_size_id,
          NEW.size_label,
          v_returned_delta,
          'job_work',
          v_order.id,
          v_order.reference_number,
          COALESCE(NEW.received_date, CURRENT_DATE),
          v_order.created_by
        );
      END IF;
    END IF;

    IF NEW.quantity_transferred_out > OLD.quantity_transferred_out THEN
      SELECT jwo.dispatch_date INTO v_transfer_date
      FROM job_work_items jwi
      JOIN job_work_orders jwo ON jwo.id = jwi.job_work_order_id
      WHERE jwi.source_job_work_item_id = NEW.id AND jwi.is_transfer_line = true
      ORDER BY jwi.created_at DESC LIMIT 1;

      v_transferred_delta := NEW.quantity_transferred_out - OLD.quantity_transferred_out;
      INSERT INTO stock_ledger (
        entry_type, company_id, warehouse_id, material_type_id, material_size_id,
        size_label, quantity, reference_type, reference_id, reference_number,
        notes, entry_date, purchase_line_id, sub_purchase_line_id, created_by
      ) VALUES (
        'JOB_WORK_TRANSFER_OUT',
        v_order.company_id,
        v_order.warehouse_id,
        NEW.material_type_id,
        NEW.material_size_id,
        NEW.size_label,
        -v_transferred_delta,
        'job_work',
        v_order.id,
        v_order.reference_number,
        'Vendor transfer — sent to new vendor',
        COALESCE(v_transfer_date, CURRENT_DATE),
        NEW.purchase_line_id,
        NEW.sub_purchase_line_id,
        v_order.created_by
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
