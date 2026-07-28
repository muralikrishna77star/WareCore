-- ============================================================
-- WareCore WMS - Restore job work vendor-transfer ledger logic
-- lost in migration 062
--
-- Migration 062 rewrote fn_job_work_item_to_ledger() to fix the
-- vendor-direct-sale duplicate-return bug, but based its rewrite on
-- the pre-056 function body — silently dropping the two branches
-- migration 056 (job work vendor transfer) had added:
--   - INSERT: is_transfer_line rows must post JOB_WORK_TRANSFER_IN
--     (not a fresh JOB_WORK_OUT, which double-decrements warehouse
--     stock that already left via the original order's JOB_WORK_OUT).
--   - UPDATE: quantity_transferred_out increasing must post the
--     offsetting JOB_WORK_TRANSFER_OUT on the source order's item.
--
-- Net effect since 062 shipped: every vendor-to-vendor job work
-- transfer posts an unpaired JOB_WORK_TRANSFER_IN (or, worse, a
-- wrongly-signed JOB_WORK_OUT) with no offsetting entry, inflating
-- the item's stock ledger balance by the transferred quantity.
--
-- This migration merges 056's transfer branches back in alongside
-- 062's dedup guard (warecore.skip_job_work_return_trigger), so both
-- fixes are preserved together, and backfills the two ledger rows
-- that went missing for real transfers made while the regression was
-- live (found by auditing every job_work_transfers row against its
-- expected TRANSFER_IN/TRANSFER_OUT pair):
--   - JWT-0726-0017 (JW-MRKJHEXQ-RP3D -> JW-MRQC6HY0-TSUN,
--     CR0624-0003, 5.760): TRANSFER_OUT posted, TRANSFER_IN missing.
--   - JWT-0726-0018 (JW-MQGKK6Q0-NI2X -> JW-MRSTPTAS-8O78,
--     CR0424-0002, 7.280): TRANSFER_IN posted, TRANSFER_OUT missing
--     (this is the case flagged from the Item Ledger Report, where it
--     inflated CR00880's closing balance by 7.280).
-- ============================================================

-- ── 1. Restore the merged trigger function ──────────────────────────────────

CREATE OR REPLACE FUNCTION fn_job_work_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_order job_work_orders%ROWTYPE;
  v_returned_delta DECIMAL(15,3);
  v_transferred_delta DECIMAL(15,3);
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
          CURRENT_DATE,
          v_order.created_by
        );
      END IF;
    END IF;

    IF NEW.quantity_transferred_out > OLD.quantity_transferred_out THEN
      -- Pending quantity handed to a new vendor (delta only) — paired with the
      -- JOB_WORK_TRANSFER_IN entry inserted for the new order's line above.
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
        CURRENT_DATE,
        NEW.purchase_line_id,
        NEW.sub_purchase_line_id,
        v_order.created_by
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 2. Backfill the two ledger rows that went missing while the ─────────────
--      regression was live (audited against every job_work_transfers row)

-- JWT-0726-0017: JW-MRQC6HY0-TSUN never got its JOB_WORK_TRANSFER_IN.
INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id
) VALUES (
  'JOB_WORK_TRANSFER_IN',
  '426a22ba-edb6-4947-b637-1ad4aab640b9',
  '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2',
  'd2e3f40f-8076-46fa-a3cc-f52a661972d7',
  '3441d0e1-c60b-45b9-ae6e-af8e5cf3d223',
  '0.75X1690',
  5.760,
  'job_work',
  '04ad9b25-1258-40aa-a800-77b94aa7e40a',
  'JW-MRQC6HY0-TSUN',
  'Vendor transfer — received (backfilled, missing since original transfer)',
  '2024-06-28',
  'CR0624-0003',
  NULL
);

-- JWT-0726-0018: JW-MQGKK6Q0-NI2X never got its JOB_WORK_TRANSFER_OUT
-- (the case originally flagged from the Item Ledger Report — CR00880's
-- closing balance was overstated by 7.280 as a result).
INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id
) VALUES (
  'JOB_WORK_TRANSFER_OUT',
  '426a22ba-edb6-4947-b637-1ad4aab640b9',
  'f30a7bb1-c547-4d13-bab1-05a3d4b8c221',
  'd2e3f40f-8076-46fa-a3cc-f52a661972d7',
  '2fbfac86-22fe-4070-abf7-fe278b9572c1',
  '0.70X250',
  -7.280,
  'job_work',
  'aa14020c-fd1a-4ecf-b3aa-e5900c866cc4',
  'JW-MQGKK6Q0-NI2X',
  'Vendor transfer — sent to new vendor (backfilled, missing since original transfer)',
  '2026-07-20',
  'CR0424-0002',
  NULL
);
