-- ============================================================
-- WareCore WMS - Fix JOB_WORK_TRANSFER_OUT entry_date + add a
-- received-date input for Job Work returns
--
-- Problem 1 (found via the Item Ledger Report for CR00880 / CR 0.70X250):
-- fn_job_work_item_to_ledger()'s UPDATE branch stamps JOB_WORK_TRANSFER_OUT
-- with entry_date = CURRENT_DATE, while its paired JOB_WORK_TRANSFER_IN
-- (posted on the destination order, INSERT branch) correctly uses the
-- destination order's own dispatch_date (the "Transfer Date" the user
-- picked on /jobwork/[id]/transfer). Since job work orders in this data
-- were dispatched in 2024 but transfers were keyed in mid-2026, the two
-- legs of a single transfer end up years apart, which breaks the ledger's
-- chronological order and corrupts the running "Balance at Vendor" total
-- (Item Ledger Report, migration/feature 2026-07-28). An audit of every
-- JOB_WORK_TRANSFER_OUT/IN pair in stock_ledger shows this affects
-- essentially every vendor transfer in the system, not just CR00880.
--
-- Fix: the destination job_work_items row (is_transfer_line = true,
-- source_job_work_item_id = NEW.id) already exists by the time this
-- UPDATE fires (frontend creates it before bumping quantity_transferred_out
-- — see jobwork/[id]/transfer/page.tsx), so look up its order's
-- dispatch_date and use that instead of CURRENT_DATE. Backfill every
-- existing TRANSFER_OUT row the same way.
--
-- Problem 2: JobWorkReturnClient.tsx has no date input at all for when
-- material is actually received back from a vendor — the RETURN_IN ledger
-- row is always CURRENT_DATE (the day someone logs it), not the day it
-- physically arrived. Add job_work_items.received_date and have the
-- trigger use it (falling back to CURRENT_DATE if not supplied).
-- ============================================================

-- ── 1. New column for the actual physical return date ───────────────────────

ALTER TABLE job_work_items ADD COLUMN IF NOT EXISTS received_date DATE;

-- ── 2. Restore the trigger with both date fixes ──────────────────────────────

CREATE OR REPLACE FUNCTION fn_job_work_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_order job_work_orders%ROWTYPE;
  v_returned_delta DECIMAL(15,3);
  v_transferred_delta DECIMAL(15,3);
  v_transfer_date DATE;
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = NEW.job_work_order_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_transfer_line THEN
      -- Material already left the warehouse when originally dispatched to the
      -- source vendor — this line just re-attributes existing vendor-held
      -- stock to the new vendor. Post JOB_WORK_TRANSFER_IN (net zero against
      -- the paired JOB_WORK_TRANSFER_OUT below) instead of a fresh JOB_WORK_OUT,
      -- so warehouse totals aren't double-decremented.
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
      -- Material going out to vendor
      INSERT INTO stock_ledger (
        entry_type, company_id, warehouse_id, material_type_id, material_size_id,
        size_label, quantity, reference_type, reference_id, reference_number,
        entry_date, created_by
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
        v_order.created_by
      );
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.quantity_received > OLD.quantity_received THEN
      -- fn_dispatch_item_to_ledger() (vendor direct sale) already inserts its
      -- own richer JOB_WORK_RETURN_IN row before bumping quantity_received —
      -- skip here to avoid double-posting the same return.
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
      -- Pending quantity handed to a new vendor (delta only) — paired with the
      -- JOB_WORK_TRANSFER_IN entry inserted for the new order's line above.
      -- Use the destination transfer's own business date (its job work
      -- order's dispatch_date, i.e. the "Transfer Date" picked in the UI)
      -- instead of CURRENT_DATE, so both legs of the transfer share one date.
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

-- ── 3. Backfill: realign every existing JOB_WORK_TRANSFER_OUT row's ─────────
--      entry_date to match its paired JOB_WORK_TRANSFER_IN's entry_date.
--      Quantities are untouched — closing balances don't change, only the
--      row's position in the ledger and intermediate running totals.

UPDATE stock_ledger sl
SET entry_date = pairs.correct_date
FROM (
  SELECT out_row.id AS out_id, dest_order.dispatch_date AS correct_date
  FROM stock_ledger out_row
  JOIN job_work_items src_item
    ON src_item.job_work_order_id = out_row.reference_id
   AND src_item.purchase_line_id = out_row.purchase_line_id
  JOIN job_work_items dest_item
    ON dest_item.source_job_work_item_id = src_item.id
   AND dest_item.is_transfer_line = true
   AND dest_item.quantity_sent = -out_row.quantity
  JOIN job_work_orders dest_order ON dest_order.id = dest_item.job_work_order_id
  WHERE out_row.entry_type = 'JOB_WORK_TRANSFER_OUT'
) pairs
WHERE sl.id = pairs.out_id
  AND sl.entry_date <> pairs.correct_date;
