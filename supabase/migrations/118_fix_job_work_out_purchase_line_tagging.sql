-- Two things, found via the Purchase Line Movements report showing
-- GI0724-0020's balance as 8.960 instead of the correct 4.480.
--
-- 1. Data cleanup: the bogus GI00069 dispatch removed by migration 116
--    left two ledger rows behind that exactly cancel each other at the
--    item level (deleting both changes GI00069's overall balance by zero)
--    but were individually visible/invisible in different reports because
--    of bug #2 below: the original JOB_WORK_OUT (-4.480, no
--    purchase_line_id) was already invisible to Purchase Line Movements,
--    while the reversal fn_job_work_item_deleted() posted (+4.480, WITH
--    purchase_line_id) was visible — making the line look like it
--    received 4.480 extra it never did. Deleting both restores a clean
--    single Purchase In entry.
--
-- 2. Root cause, general going forward: fn_job_work_item_to_ledger()'s
--    plain JOB_WORK_OUT INSERT branch has never set purchase_line_id/
--    sub_purchase_line_id (only the transfer-destination branch does) --
--    this predates this session entirely (migration 001/065), but
--    migration 114's new fn_job_work_item_deleted() reversal DOES tag
--    purchase_line_id, so any future clean-line removal will reproduce
--    this same asymmetry for whichever item it touches. Fixed by tagging
--    the plain JOB_WORK_OUT insert the same way the transfer branch
--    already does, so Purchase Line Movements shows the complete history
--    for every job work dispatch from here on.

BEGIN;

DELETE FROM stock_ledger WHERE id = 'e4a21c05-eb46-4312-a99d-49378417b2e6' AND entry_type = 'JOB_WORK_CANCEL';
DELETE FROM stock_ledger WHERE id = '43881e3c-3b77-48ea-b009-416e396724c9' AND entry_type = 'JOB_WORK_OUT';

COMMIT;

CREATE OR REPLACE FUNCTION fn_job_work_item_to_ledger()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;
