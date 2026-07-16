-- ============================================================
-- WareCore WMS - Job Work Vendor Transfer
--
-- Lets the pending (unreceived) quantity of a Job Work line be
-- handed from one vendor to another mid-job (e.g. the original
-- vendor is too slow / unsatisfactory), while staying traceable
-- back to the same Purchase Line Reference.
--
-- Design: a transfer creates a brand-new job_work_orders row for
-- the target vendor (vendor lives on the order header, not the
-- line) and a fresh job_work_items row on it, copying purchase_line_id
-- / sub_purchase_line_id / item / material fields verbatim from the
-- source line. The source line's remaining pending is reduced via a
-- new quantity_transferred_out column (NOT quantity_received, which
-- means "physically returned" and must stay untouched).
--
-- New pending formula everywhere: quantity_sent - quantity_received
-- - quantity_transferred_out.
--
-- Ledger effect: the new order always inherits company_id/warehouse_id
-- from the source order (only the vendor changes), so the
-- JOB_WORK_TRANSFER_OUT (source order, negative) and
-- JOB_WORK_TRANSFER_IN (new order, positive) entries share the same
-- warehouse_id and net to zero on real warehouse stock (v_current_stock),
-- while remaining individually attributable per vendor for the Vendor
-- Movements report.
-- ============================================================

-- ── Extend stock_ledger entry_type ───────────────────────────────────────────

ALTER TABLE stock_ledger DROP CONSTRAINT IF EXISTS stock_ledger_entry_type_check;
ALTER TABLE stock_ledger
  ADD CONSTRAINT stock_ledger_entry_type_check
  CHECK (entry_type IN (
    'PURCHASE_IN', 'VENDOR_RETURN_IN',
    'SALE_OUT',
    'JOB_WORK_OUT', 'JOB_WORK_RETURN_IN', 'JOB_WORK_CANCEL', 'JOB_WORK_OUTPUT_IN',
    'JOB_WORK_TRANSFER_OUT', 'JOB_WORK_TRANSFER_IN',
    'TRANSFER_OUT', 'TRANSFER_IN',
    'ADJUSTMENT_IN', 'ADJUSTMENT_OUT',
    'PURCHASE_CANCEL', 'SALE_CANCEL'
  ));

-- ── job_work_items additions ──────────────────────────────────────────────────

ALTER TABLE job_work_items
  ADD COLUMN IF NOT EXISTS quantity_transferred_out DECIMAL(15,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_transfer_line BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS source_job_work_item_id UUID REFERENCES job_work_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_job_work_items_source_jw_item ON job_work_items(source_job_work_item_id);

-- ── job_work_transfers / job_work_transfer_items (audit trail) ───────────────

CREATE TABLE job_work_transfers (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_number       TEXT NOT NULL UNIQUE,
  transfer_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  from_job_work_order_id UUID REFERENCES job_work_orders(id),
  from_vendor_id        UUID REFERENCES suppliers(id),
  to_job_work_order_id  UUID REFERENCES job_work_orders(id),
  to_vendor_id          UUID REFERENCES suppliers(id),
  reason                TEXT,
  notes                 TEXT,
  created_by            UUID,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE job_work_transfer_items (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_work_transfer_id   UUID NOT NULL REFERENCES job_work_transfers(id) ON DELETE CASCADE,
  from_job_work_item_id  UUID,
  to_job_work_item_id    UUID,
  purchase_line_id       TEXT,
  sub_purchase_line_id   TEXT,
  item_master_id         UUID,
  item_name              TEXT,
  material_type_id       UUID,
  material_size_id       UUID,
  size_label             TEXT,
  quantity_transferred   DECIMAL(15,3),
  unit                   TEXT
);

CREATE INDEX idx_job_work_transfers_from_order ON job_work_transfers(from_job_work_order_id);
CREATE INDEX idx_job_work_transfers_to_order ON job_work_transfers(to_job_work_order_id);
CREATE INDEX idx_job_work_transfer_items_transfer ON job_work_transfer_items(job_work_transfer_id);

-- ── v_stock_at_vendors: subtract quantity_transferred_out too ────────────────

CREATE OR REPLACE VIEW v_stock_at_vendors AS
SELECT
  jwo.vendor_id,
  s.name AS vendor_name,
  jwo.company_id,
  c.name AS company_name,
  jwi.material_type_id,
  mt.description AS material_type_name,
  COALESCE(ms.size_label, jwi.size_label) AS size_label,
  SUM(jwi.quantity_sent - COALESCE(jwi.quantity_received, 0) - COALESCE(jwi.quantity_transferred_out, 0)) AS pending_quantity,
  mt.unit
FROM job_work_orders jwo
JOIN job_work_items jwi ON jwi.job_work_order_id = jwo.id
JOIN suppliers s ON s.id = jwo.vendor_id
JOIN companies c ON c.id = jwo.company_id
JOIN material_types mt ON mt.id = jwi.material_type_id
LEFT JOIN material_sizes ms ON ms.id = jwi.material_size_id
WHERE jwo.status IN ('dispatched', 'partial_return')
GROUP BY
  jwo.vendor_id, s.name,
  jwo.company_id, c.name,
  jwi.material_type_id, mt.description,
  COALESCE(ms.size_label, jwi.size_label), mt.unit;

-- ── fn_job_work_item_to_ledger: handle transfer-in / transfer-out ───────────

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
      -- Material coming back from vendor (delta only)
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
