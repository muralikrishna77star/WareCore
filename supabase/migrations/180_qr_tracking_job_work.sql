-- ============================================================
-- Migration 180: QR stock tracking, Phase 4 (job work)
-- ============================================================
-- Follows labelled bundles through job work: out to a vendor on a vendor
-- dispatch, back unprocessed, on to another vendor, sold at the vendor through
-- a vendor pickup, or processed into new labelled output bundles that keep a
-- permanent "made from" link to the bundles they came from.
--
-- Every change here is inside the tracking_ tables. No purchase, job work,
-- sale, transfer or ledger table is altered or written to, and no trigger is
-- added to any of them. Job work orders, transfers, output lines, sales and
-- suppliers are only read. New tables hold no foreign keys into existing
-- tables, so they can never block a job work edit, cancellation, warehouse
-- merge or backup restore.
-- ============================================================

-- ── Vendor dispatches ───────────────────────────────────────────────────────

CREATE TABLE tracking_vendor_dispatches (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_no        TEXT NOT NULL UNIQUE CHECK (dispatch_no ~ '^VD[0-9]{4}-[0-9]{4,}$'),
  company_id         UUID NOT NULL,
  warehouse_id       UUID NOT NULL,
  vendor_id          UUID NOT NULL,
  vendor_name        TEXT NOT NULL,
  vehicle_number     TEXT,
  note               TEXT,
  status             TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SENT', 'CANCELLED')),
  sent_at            TIMESTAMPTZ,
  sent_by            UUID,
  job_work_order_id  UUID,
  job_work_reference TEXT,
  cancelled_at       TIMESTAMPTZ,
  cancelled_by       UUID,
  cancel_reason      TEXT,
  created_by         UUID NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'SENT' OR sent_at IS NOT NULL),
  CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND btrim(COALESCE(cancel_reason, '')) <> '')),
  CHECK ((job_work_order_id IS NULL) = (job_work_reference IS NULL))
);
CREATE INDEX idx_tracking_vendor_dispatches_scope ON tracking_vendor_dispatches (company_id, warehouse_id, created_at DESC);
CREATE INDEX idx_tracking_vendor_dispatches_vendor ON tracking_vendor_dispatches (vendor_id);
CREATE INDEX idx_tracking_vendor_dispatches_order ON tracking_vendor_dispatches (job_work_order_id) WHERE job_work_order_id IS NOT NULL;

-- closed_at is set when the bundle stops being at the vendor (returned,
-- processed, sold or split), so a bundle can go out again later.
CREATE TABLE tracking_vendor_dispatch_units (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id      UUID NOT NULL REFERENCES tracking_vendor_dispatches(id),
  tracking_unit_id UUID NOT NULL REFERENCES tracking_units(id),
  quantity         NUMERIC(15,3) NOT NULL CHECK (quantity > 0),
  job_work_item_id UUID,
  added_by         UUID NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at       TIMESTAMPTZ,
  removed_by       UUID,
  remove_reason    TEXT,
  closed_at        TIMESTAMPTZ,
  closed_reason    TEXT
);
-- A bundle can be on only one live dispatch.
CREATE UNIQUE INDEX uq_tracking_dispatch_units_live ON tracking_vendor_dispatch_units (tracking_unit_id)
  WHERE removed_at IS NULL AND closed_at IS NULL;
CREATE INDEX idx_tracking_dispatch_units_dispatch ON tracking_vendor_dispatch_units (dispatch_id);

-- ── Moves between vendors ───────────────────────────────────────────────────

CREATE TABLE tracking_vendor_moves (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_unit_id     UUID NOT NULL REFERENCES tracking_units(id),
  company_id           UUID NOT NULL,
  from_vendor_id       UUID NOT NULL,
  from_vendor_name     TEXT NOT NULL,
  to_vendor_id         UUID NOT NULL,
  to_vendor_name       TEXT NOT NULL,
  moved_on             DATE NOT NULL,
  reason               TEXT,
  job_work_transfer_id UUID,
  transfer_number      TEXT,
  created_by           UUID NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_vendor_id <> to_vendor_id),
  CHECK ((job_work_transfer_id IS NULL) = (transfer_number IS NULL))
);
CREATE INDEX idx_tracking_vendor_moves_unit ON tracking_vendor_moves (tracking_unit_id, created_at);
CREATE INDEX idx_tracking_vendor_moves_scope ON tracking_vendor_moves (company_id, created_at DESC);

-- ── Outputs arriving from a vendor ──────────────────────────────────────────

CREATE TABLE tracking_output_receipts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no         TEXT NOT NULL UNIQUE CHECK (receipt_no ~ '^JR[0-9]{4}-[0-9]{4,}$'),
  company_id         UUID NOT NULL,
  warehouse_id       UUID NOT NULL,
  vendor_id          UUID NOT NULL,
  vendor_name        TEXT NOT NULL,
  dispatch_id        UUID REFERENCES tracking_vendor_dispatches(id),
  received_on        DATE NOT NULL,
  job_work_order_id  UUID,
  job_work_reference TEXT,
  note               TEXT,
  created_by         UUID NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((job_work_order_id IS NULL) = (job_work_reference IS NULL))
);
CREATE INDEX idx_tracking_output_receipts_scope ON tracking_output_receipts (company_id, warehouse_id, created_at DESC);

-- ── Made-from links ─────────────────────────────────────────────────────────

CREATE TABLE tracking_unit_lineage (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_unit_id  UUID NOT NULL REFERENCES tracking_units(id),
  parent_unit_id UUID NOT NULL REFERENCES tracking_units(id),
  relation       TEXT NOT NULL CHECK (relation IN ('MADE_FROM', 'REMAINDER_OF')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (child_unit_id, parent_unit_id),
  CHECK (child_unit_id <> parent_unit_id)
);
CREATE INDEX idx_tracking_unit_lineage_parent ON tracking_unit_lineage (parent_unit_id);

-- ── Changes to Phase 2 and Phase 3 tables ───────────────────────────────────
-- An output made from more than one purchase line has no single purchase
-- line: its lines are listed in tracking_unit_origins. Units hold no foreign
-- key to the new tables, because a backup restore inserts rows in batches.

ALTER TABLE tracking_units
  ALTER COLUMN purchase_line_id DROP NOT NULL,
  ALTER COLUMN purchase_bill_id DROP NOT NULL,
  DROP CONSTRAINT tracking_units_lifecycle_status_check,
  DROP CONSTRAINT tracking_units_source_type_check,
  DROP CONSTRAINT tracking_units_not_placed,
  ADD COLUMN current_vendor_id UUID,
  ADD COLUMN current_vendor_name TEXT,
  ADD COLUMN at_vendor_since TIMESTAMPTZ,
  ADD COLUMN output_receipt_id UUID,
  ADD COLUMN job_work_output_item_id UUID;

ALTER TABLE tracking_units
  ADD CONSTRAINT tracking_units_lifecycle_status_check CHECK (lifecycle_status IN (
    'LABELLED', 'IN_STOCK', 'ON_PICKUP', 'READY', 'PICKED_UP',
    'ON_HOLD', 'MISSING', 'LEFT_WAREHOUSE', 'SPLIT', 'AT_VENDOR', 'PROCESSED')),
  ADD CONSTRAINT tracking_units_source_type_check CHECK (source_type IN (
    'NEW_PURCHASE', 'VERIFIED_EXISTING', 'SPLIT_PART', 'JOB_WORK_OUTPUT', 'JOB_WORK_REMAINDER')),
  ADD CONSTRAINT tracking_units_not_placed CHECK (lifecycle_status NOT IN (
    'LABELLED', 'PICKED_UP', 'MISSING', 'LEFT_WAREHOUSE', 'SPLIT', 'AT_VENDOR', 'PROCESSED') OR current_location_id IS NULL),
  ADD CONSTRAINT tracking_units_at_vendor CHECK (
    (lifecycle_status = 'AT_VENDOR') = (current_vendor_id IS NOT NULL)
    AND (current_vendor_id IS NULL) = (current_vendor_name IS NULL)
    AND (current_vendor_id IS NULL) = (at_vendor_since IS NULL)),
  ADD CONSTRAINT tracking_units_job_work_source CHECK (
    (source_type IN ('JOB_WORK_OUTPUT', 'JOB_WORK_REMAINDER')) = (output_receipt_id IS NOT NULL)),
  ADD CONSTRAINT tracking_units_purchase_source CHECK (
    (purchase_line_id IS NULL) = (purchase_bill_id IS NULL)
    AND (purchase_line_id IS NOT NULL OR source_type IN ('JOB_WORK_OUTPUT', 'SPLIT_PART')));

-- Outputs and remainders carry their own numbering, so the one-label-per-bundle
-- rule applies only to bundles labelled straight from a purchase line.
DROP INDEX uq_tracking_units_active_bundle;
CREATE UNIQUE INDEX uq_tracking_units_active_bundle ON tracking_units (purchase_line_id, bundle_no)
  WHERE status = 'ACTIVE' AND parent_unit_id IS NULL AND source_type IN ('NEW_PURCHASE', 'VERIFIED_EXISTING');
CREATE INDEX idx_tracking_units_vendor ON tracking_units (current_vendor_id) WHERE current_vendor_id IS NOT NULL;
CREATE INDEX idx_tracking_units_receipt ON tracking_units (output_receipt_id) WHERE output_receipt_id IS NOT NULL;
CREATE INDEX idx_tracking_unit_origins_line ON tracking_unit_origins (purchase_line_id);

ALTER TABLE tracking_pickups
  ADD COLUMN vendor_id UUID,
  ADD COLUMN vendor_name TEXT,
  ADD CONSTRAINT tracking_pickups_vendor CHECK ((vendor_id IS NULL) = (vendor_name IS NULL));

ALTER TABLE tracking_events DROP CONSTRAINT tracking_events_event_type_check;
ALTER TABLE tracking_events ADD CONSTRAINT tracking_events_event_type_check CHECK (event_type IN (
  'UNIT_CREATED', 'LABEL_PRINT_SENT', 'LABEL_PRINT_CONFIRMED', 'LABEL_PRINT_FAILED', 'SCAN_LOOKUP', 'UNIT_VOIDED',
  'PUT_AWAY', 'MOVED', 'STATUS_CHANGED', 'UNIT_SPLIT', 'ADDED_TO_PICKUP', 'REMOVED_FROM_PICKUP',
  'MARKED_READY', 'PICKED_UP', 'CUSTOMER_RETURN', 'STOCK_VERIFIED',
  'ADDED_TO_DISPATCH', 'REMOVED_FROM_DISPATCH', 'SENT_TO_VENDOR', 'RETURNED_FROM_VENDOR', 'VENDOR_CHANGED', 'PROCESSED'));

-- ── Permanent records ───────────────────────────────────────────────────────

CREATE TRIGGER trg_tracking_unit_lineage_append_only
  BEFORE UPDATE OR DELETE ON tracking_unit_lineage
  FOR EACH ROW
  WHEN (current_setting('warecore.restoring', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION fn_tracking_events_append_only();

CREATE TRIGGER trg_tracking_vendor_dispatches_no_delete
  BEFORE DELETE ON tracking_vendor_dispatches
  FOR EACH ROW
  WHEN (current_setting('warecore.restoring', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION fn_tracking_no_delete();

CREATE TRIGGER trg_tracking_vendor_dispatch_units_no_delete
  BEFORE DELETE ON tracking_vendor_dispatch_units
  FOR EACH ROW
  WHEN (current_setting('warecore.restoring', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION fn_tracking_no_delete();

CREATE TRIGGER trg_tracking_vendor_moves_no_delete
  BEFORE DELETE ON tracking_vendor_moves
  FOR EACH ROW
  WHEN (current_setting('warecore.restoring', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION fn_tracking_no_delete();

CREATE TRIGGER trg_tracking_output_receipts_no_delete
  BEFORE DELETE ON tracking_output_receipts
  FOR EACH ROW
  WHEN (current_setting('warecore.restoring', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION fn_tracking_no_delete();

-- ── Status rules ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_tracking_status_allowed(p_from TEXT, p_to TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_from, p_to) IN (
    ('LABELLED', 'IN_STOCK'),
    ('IN_STOCK', 'ON_PICKUP'), ('IN_STOCK', 'ON_HOLD'), ('IN_STOCK', 'MISSING'),
    ('IN_STOCK', 'LEFT_WAREHOUSE'), ('IN_STOCK', 'SPLIT'), ('IN_STOCK', 'AT_VENDOR'),
    ('ON_PICKUP', 'READY'), ('ON_PICKUP', 'IN_STOCK'), ('ON_PICKUP', 'SPLIT'),
    ('READY', 'PICKED_UP'), ('READY', 'IN_STOCK'),
    ('PICKED_UP', 'IN_STOCK'),
    ('ON_HOLD', 'IN_STOCK'),
    ('MISSING', 'IN_STOCK'),
    ('LEFT_WAREHOUSE', 'IN_STOCK'), ('LEFT_WAREHOUSE', 'AT_VENDOR'),
    ('AT_VENDOR', 'IN_STOCK'), ('AT_VENDOR', 'PICKED_UP'), ('AT_VENDOR', 'PROCESSED'), ('AT_VENDOR', 'SPLIT')
  )
$$;

CREATE OR REPLACE FUNCTION fn_tracking_status_words(p_status TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status
    WHEN 'LABELLED' THEN 'labelled'
    WHEN 'IN_STOCK' THEN 'in stock'
    WHEN 'ON_PICKUP' THEN 'on a pickup'
    WHEN 'READY' THEN 'ready for pickup'
    WHEN 'PICKED_UP' THEN 'picked up'
    WHEN 'ON_HOLD' THEN 'on hold'
    WHEN 'MISSING' THEN 'missing'
    WHEN 'LEFT_WAREHOUSE' THEN 'out of the warehouse'
    WHEN 'SPLIT' THEN 'split'
    WHEN 'AT_VENDOR' THEN 'at a vendor'
    WHEN 'PROCESSED' THEN 'processed'
    ELSE lower(p_status)
  END
$$;

-- ── Shared helpers ──────────────────────────────────────────────────────────

-- Job work vendors are rows in suppliers. Read only.
CREATE OR REPLACE FUNCTION fn_tracking_vendor_name(p_vendor_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_name TEXT;
BEGIN
  SELECT name INTO v_name FROM suppliers WHERE id = p_vendor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Vendor not found';
  END IF;
  RETURN v_name;
END;
$$;

-- The same window as the business date guard on stock documents.
CREATE OR REPLACE FUNCTION fn_tracking_check_business_date(p_date DATE, p_label TEXT)
RETURNS DATE
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_date IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Enter the %s', p_label);
  END IF;
  IF p_date < DATE '2015-01-01' OR p_date > (now() AT TIME ZONE 'Asia/Kolkata')::date + 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('The %s %s is not a valid date', p_label, p_date);
  END IF;
  RETURN p_date;
END;
$$;

CREATE OR REPLACE FUNCTION fn_tracking_lock_dispatch(p_dispatch_id UUID)
RETURNS tracking_vendor_dispatches
LANGUAGE plpgsql AS $$
DECLARE
  v_dispatch tracking_vendor_dispatches;
BEGIN
  SELECT * INTO v_dispatch FROM tracking_vendor_dispatches WHERE id = p_dispatch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Vendor dispatch not found';
  END IF;
  IF NOT fn_tracking_is_enabled(v_dispatch.company_id, v_dispatch.warehouse_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'QR tracking is switched off for this warehouse';
  END IF;
  RETURN v_dispatch;
END;
$$;

-- Ends a bundle's live dispatch line once it is no longer at the vendor.
CREATE OR REPLACE FUNCTION fn_tracking_close_dispatch_line(p_unit_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE tracking_vendor_dispatch_units
     SET closed_at = now(), closed_reason = p_reason
   WHERE tracking_unit_id = p_unit_id AND removed_at IS NULL AND closed_at IS NULL;
$$;

-- Matches a bundle to an input line of a job work order: same purchase line
-- first, then the same item. Read only.
CREATE OR REPLACE FUNCTION fn_tracking_match_job_work_input(p_order_id UUID, p_unit_id UUID)
RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT i.id
    FROM job_work_items i
    JOIN tracking_units u ON u.id = p_unit_id
   WHERE i.job_work_order_id = p_order_id
     AND NOT COALESCE(i.is_transfer_line, false)
     AND (i.purchase_line_id = u.purchase_line_id
          OR (u.item_master_id IS NOT NULL AND i.item_master_id = u.item_master_id))
   ORDER BY (i.purchase_line_id = u.purchase_line_id) DESC NULLS LAST, i.created_at
   LIMIT 1
$$;

-- ── Vendor dispatches ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_tracking_vendor_dispatch(
  p_company_id UUID, p_warehouse_id UUID, p_vendor_id UUID, p_vehicle TEXT, p_note TEXT, p_actor UUID
)
RETURNS tracking_vendor_dispatches
LANGUAGE plpgsql AS $$
DECLARE
  v_vendor   TEXT;
  v_prefix   TEXT := 'VD' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'MMYY') || '-';
  v_seq      INT;
  v_dispatch tracking_vendor_dispatches;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A signed-in user is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM warehouses WHERE id = p_warehouse_id AND company_id = p_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'That warehouse does not belong to this company';
  END IF;
  IF NOT fn_tracking_is_enabled(p_company_id, p_warehouse_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'QR tracking is switched off for this warehouse';
  END IF;
  v_vendor := fn_tracking_vendor_name(p_vendor_id);

  PERFORM pg_advisory_xact_lock(hashtext('tracking_dispatch_no'));
  SELECT COALESCE(MAX(substring(dispatch_no FROM 8)::int), 0) INTO v_seq
    FROM tracking_vendor_dispatches WHERE dispatch_no LIKE v_prefix || '%';

  INSERT INTO tracking_vendor_dispatches (dispatch_no, company_id, warehouse_id, vendor_id, vendor_name, vehicle_number, note, created_by)
  VALUES (v_prefix || lpad((v_seq + 1)::text, 4, '0'), p_company_id, p_warehouse_id, p_vendor_id, v_vendor,
          NULLIF(upper(btrim(COALESCE(p_vehicle, ''))), ''), NULLIF(btrim(COALESCE(p_note, '')), ''), p_actor)
  RETURNING * INTO v_dispatch;
  RETURN v_dispatch;
END;
$$;

-- A bundle stays where it is until the dispatch is sent. Bundles already sent
-- out under Phase 3 (Left warehouse) can be put on a dispatch to record where they went.
CREATE OR REPLACE FUNCTION add_tracking_dispatch_unit(p_dispatch_id UUID, p_unit_id UUID, p_actor UUID)
RETURNS tracking_vendor_dispatch_units
LANGUAGE plpgsql AS $$
DECLARE
  v_dispatch tracking_vendor_dispatches;
  v_unit     tracking_units;
  v_line     tracking_vendor_dispatch_units;
  v_other    TEXT;
BEGIN
  v_dispatch := fn_tracking_lock_dispatch(p_dispatch_id);
  IF v_dispatch.status <> 'OPEN' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Bundles can only be added while a dispatch is open';
  END IF;
  v_unit := fn_tracking_lock_active_unit(p_unit_id);
  IF v_unit.company_id <> v_dispatch.company_id OR v_unit.warehouse_id <> v_dispatch.warehouse_id THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This bundle is in a different warehouse';
  END IF;
  IF v_unit.lifecycle_status NOT IN ('IN_STOCK', 'LEFT_WAREHOUSE') THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001',
      MESSAGE = format('Bundle %s is %s, so it cannot be sent', v_unit.stock_tracking_id, fn_tracking_status_words(v_unit.lifecycle_status));
  END IF;
  SELECT d.dispatch_no INTO v_other
    FROM tracking_vendor_dispatch_units l JOIN tracking_vendor_dispatches d ON d.id = l.dispatch_id
   WHERE l.tracking_unit_id = p_unit_id AND l.removed_at IS NULL AND l.closed_at IS NULL;
  IF FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Bundle %s is already on dispatch %s', v_unit.stock_tracking_id, v_other);
  END IF;

  INSERT INTO tracking_vendor_dispatch_units (dispatch_id, tracking_unit_id, quantity, job_work_item_id, added_by)
  VALUES (p_dispatch_id, p_unit_id, v_unit.quantity,
          CASE WHEN v_dispatch.job_work_order_id IS NOT NULL THEN fn_tracking_match_job_work_input(v_dispatch.job_work_order_id, p_unit_id) END,
          p_actor)
  RETURNING * INTO v_line;

  PERFORM fn_tracking_record_event(p_unit_id, 'ADDED_TO_DISPATCH',
    jsonb_build_object('dispatch_id', p_dispatch_id, 'dispatch_no', v_dispatch.dispatch_no, 'vendor', v_dispatch.vendor_name),
    p_actor, v_unit.company_id);
  UPDATE tracking_vendor_dispatches SET updated_at = now() WHERE id = p_dispatch_id;
  RETURN v_line;
END;
$$;

CREATE OR REPLACE FUNCTION remove_tracking_dispatch_unit(p_dispatch_id UUID, p_unit_id UUID, p_reason TEXT, p_actor UUID)
RETURNS tracking_vendor_dispatches
LANGUAGE plpgsql AS $$
DECLARE
  v_dispatch tracking_vendor_dispatches;
  v_reason   TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_unit     tracking_units;
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A reason is required to remove a bundle';
  END IF;
  v_dispatch := fn_tracking_lock_dispatch(p_dispatch_id);
  IF v_dispatch.status <> 'OPEN' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Bundles can only be removed before the dispatch is sent';
  END IF;
  SELECT * INTO v_unit FROM tracking_units WHERE id = p_unit_id;

  UPDATE tracking_vendor_dispatch_units
     SET removed_at = now(), removed_by = p_actor, remove_reason = v_reason
   WHERE dispatch_id = p_dispatch_id AND tracking_unit_id = p_unit_id AND removed_at IS NULL AND closed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This bundle is not on this dispatch';
  END IF;

  PERFORM fn_tracking_record_event(p_unit_id, 'REMOVED_FROM_DISPATCH',
    jsonb_build_object('dispatch_id', p_dispatch_id, 'dispatch_no', v_dispatch.dispatch_no, 'reason', v_reason),
    p_actor, v_unit.company_id);
  UPDATE tracking_vendor_dispatches SET updated_at = now() WHERE id = p_dispatch_id RETURNING * INTO v_dispatch;
  RETURN v_dispatch;
END;
$$;

-- Every bundle on the dispatch moves to At vendor together, or none does.
CREATE OR REPLACE FUNCTION send_tracking_vendor_dispatch(p_dispatch_id UUID, p_vehicle TEXT, p_position JSONB, p_actor UUID)
RETURNS tracking_vendor_dispatches
LANGUAGE plpgsql AS $$
DECLARE
  v_dispatch tracking_vendor_dispatches;
  v_unit     tracking_units;
  v_count    INT := 0;
  v_vehicle  TEXT := NULLIF(upper(btrim(COALESCE(p_vehicle, ''))), '');
BEGIN
  v_dispatch := fn_tracking_lock_dispatch(p_dispatch_id);
  IF v_dispatch.status <> 'OPEN' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Only an open dispatch can be sent';
  END IF;

  FOR v_unit IN
    SELECT u.* FROM tracking_units u
      JOIN tracking_vendor_dispatch_units l ON l.tracking_unit_id = u.id
     WHERE l.dispatch_id = p_dispatch_id AND l.removed_at IS NULL AND l.closed_at IS NULL
     ORDER BY u.id FOR UPDATE OF u
  LOOP
    v_count := v_count + 1;
    IF v_unit.status <> 'ACTIVE' OR v_unit.lifecycle_status NOT IN ('IN_STOCK', 'LEFT_WAREHOUSE') THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001',
        MESSAGE = format('Bundle %s is now %s. Remove it from the dispatch first', v_unit.stock_tracking_id,
                         CASE WHEN v_unit.status <> 'ACTIVE' THEN 'voided' ELSE fn_tracking_status_words(v_unit.lifecycle_status) END);
    END IF;
    UPDATE tracking_units
       SET lifecycle_status = 'AT_VENDOR', current_location_id = NULL, status_reason = NULL,
           current_vendor_id = v_dispatch.vendor_id, current_vendor_name = v_dispatch.vendor_name, at_vendor_since = now()
     WHERE id = v_unit.id;
    PERFORM fn_tracking_record_event(v_unit.id, 'SENT_TO_VENDOR',
      jsonb_build_object('dispatch_id', p_dispatch_id, 'dispatch_no', v_dispatch.dispatch_no,
                         'vendor_id', v_dispatch.vendor_id, 'vendor', v_dispatch.vendor_name, 'from', v_unit.lifecycle_status),
      p_actor, v_unit.company_id, p_position);
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Scan at least one bundle first';
  END IF;

  UPDATE tracking_vendor_dispatches
     SET status = 'SENT', sent_at = now(), sent_by = p_actor, vehicle_number = COALESCE(v_vehicle, vehicle_number), updated_at = now()
   WHERE id = p_dispatch_id
   RETURNING * INTO v_dispatch;
  RETURN v_dispatch;
END;
$$;

CREATE OR REPLACE FUNCTION cancel_tracking_vendor_dispatch(p_dispatch_id UUID, p_reason TEXT, p_actor UUID)
RETURNS tracking_vendor_dispatches
LANGUAGE plpgsql AS $$
DECLARE
  v_dispatch tracking_vendor_dispatches;
  v_reason   TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_line     tracking_vendor_dispatch_units;
  v_company  UUID;
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A reason is required to cancel a dispatch';
  END IF;
  v_dispatch := fn_tracking_lock_dispatch(p_dispatch_id);
  IF v_dispatch.status <> 'OPEN' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A dispatch can only be cancelled before it is sent';
  END IF;

  FOR v_line IN
    UPDATE tracking_vendor_dispatch_units
       SET removed_at = now(), removed_by = p_actor, remove_reason = 'Dispatch cancelled: ' || v_reason
     WHERE dispatch_id = p_dispatch_id AND removed_at IS NULL AND closed_at IS NULL
     RETURNING *
  LOOP
    SELECT company_id INTO v_company FROM tracking_units WHERE id = v_line.tracking_unit_id;
    PERFORM fn_tracking_record_event(v_line.tracking_unit_id, 'REMOVED_FROM_DISPATCH',
      jsonb_build_object('dispatch_id', p_dispatch_id, 'dispatch_no', v_dispatch.dispatch_no, 'reason', 'Dispatch cancelled: ' || v_reason),
      p_actor, v_company);
  END LOOP;

  UPDATE tracking_vendor_dispatches
     SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = p_actor, cancel_reason = v_reason, updated_at = now()
   WHERE id = p_dispatch_id
   RETURNING * INTO v_dispatch;
  RETURN v_dispatch;
END;
$$;

-- p_order_id NULL removes the link. Reads the job work order and never changes it.
CREATE OR REPLACE FUNCTION link_tracking_dispatch_order(p_dispatch_id UUID, p_order_id UUID, p_actor UUID)
RETURNS tracking_vendor_dispatches
LANGUAGE plpgsql AS $$
DECLARE
  v_dispatch tracking_vendor_dispatches;
  v_order    RECORD;
BEGIN
  v_dispatch := fn_tracking_lock_dispatch(p_dispatch_id);
  IF v_dispatch.status = 'CANCELLED' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A cancelled dispatch cannot be linked to a job work order';
  END IF;

  IF p_order_id IS NULL THEN
    UPDATE tracking_vendor_dispatch_units SET job_work_item_id = NULL WHERE dispatch_id = p_dispatch_id;
    UPDATE tracking_vendor_dispatches SET job_work_order_id = NULL, job_work_reference = NULL, updated_at = now()
     WHERE id = p_dispatch_id RETURNING * INTO v_dispatch;
    RETURN v_dispatch;
  END IF;

  SELECT id, reference_number, vendor_id, company_id, status INTO v_order FROM job_work_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Job work order not found';
  END IF;
  IF v_order.company_id <> v_dispatch.company_id THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This job work order belongs to a different company';
  END IF;
  IF v_order.vendor_id <> v_dispatch.vendor_id THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Job work order %s is for a different vendor', v_order.reference_number);
  END IF;

  UPDATE tracking_vendor_dispatch_units l
     SET job_work_item_id = fn_tracking_match_job_work_input(p_order_id, l.tracking_unit_id)
   WHERE l.dispatch_id = p_dispatch_id AND l.removed_at IS NULL;

  UPDATE tracking_vendor_dispatches
     SET job_work_order_id = p_order_id, job_work_reference = v_order.reference_number, updated_at = now()
   WHERE id = p_dispatch_id
   RETURNING * INTO v_dispatch;
  RETURN v_dispatch;
END;
$$;

-- ── Back unprocessed ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION return_tracking_unit_from_vendor(p_unit_id UUID, p_location_id UUID, p_reason TEXT, p_position JSONB, p_actor UUID)
RETURNS tracking_units
LANGUAGE plpgsql AS $$
DECLARE
  v_unit     tracking_units;
  v_location tracking_locations;
  v_vendor   TEXT;
BEGIN
  v_unit := fn_tracking_lock_active_unit(p_unit_id);
  IF v_unit.lifecycle_status <> 'AT_VENDOR' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001',
      MESSAGE = format('Bundle %s is %s, not at a vendor', v_unit.stock_tracking_id, fn_tracking_status_words(v_unit.lifecycle_status));
  END IF;
  IF EXISTS (SELECT 1 FROM tracking_pickup_units WHERE tracking_unit_id = p_unit_id AND removed_at IS NULL AND returned_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Bundle %s is on a vendor pickup. Remove it from the pickup first', v_unit.stock_tracking_id);
  END IF;
  IF p_location_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Scan the location this bundle is going to';
  END IF;
  v_location := fn_tracking_usable_location(p_location_id, v_unit.company_id, v_unit.warehouse_id);
  v_vendor := v_unit.current_vendor_name;

  UPDATE tracking_units
     SET lifecycle_status = 'IN_STOCK', current_location_id = v_location.id, status_reason = NULL,
         current_vendor_id = NULL, current_vendor_name = NULL, at_vendor_since = NULL
   WHERE id = p_unit_id
   RETURNING * INTO v_unit;
  PERFORM fn_tracking_close_dispatch_line(p_unit_id, 'Returned unprocessed');

  PERFORM fn_tracking_record_event(p_unit_id, 'RETURNED_FROM_VENDOR',
    jsonb_build_object('vendor', v_vendor, 'to_location_id', v_location.id, 'to_location', v_location.code,
                       'reason', NULLIF(btrim(COALESCE(p_reason, '')), '')),
    p_actor, v_unit.company_id, p_position);
  RETURN v_unit;
END;
$$;

-- ── Moves between vendors ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION move_tracking_units_to_vendor(
  p_unit_ids UUID[], p_to_vendor_id UUID, p_moved_on DATE, p_reason TEXT, p_actor UUID
)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_to      TEXT;
  v_unit    tracking_units;
  v_id      UUID;
  v_count   INT := 0;
  v_company UUID;
  v_date    DATE := fn_tracking_check_business_date(p_moved_on, 'move date');
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A signed-in user is required';
  END IF;
  IF p_unit_ids IS NULL OR cardinality(p_unit_ids) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Choose at least one bundle';
  END IF;
  v_to := fn_tracking_vendor_name(p_to_vendor_id);

  FOR v_id IN SELECT DISTINCT x FROM unnest(p_unit_ids) AS x ORDER BY x LOOP
    v_unit := fn_tracking_lock_active_unit(v_id);
    IF v_unit.lifecycle_status <> 'AT_VENDOR' THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001',
        MESSAGE = format('Bundle %s is %s, not at a vendor', v_unit.stock_tracking_id, fn_tracking_status_words(v_unit.lifecycle_status));
    END IF;
    IF v_company IS NOT NULL AND v_company <> v_unit.company_id THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Move bundles of one company at a time';
    END IF;
    v_company := v_unit.company_id;
    IF v_unit.current_vendor_id = p_to_vendor_id THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Bundle %s is already at %s', v_unit.stock_tracking_id, v_to);
    END IF;
    IF EXISTS (SELECT 1 FROM tracking_pickup_units WHERE tracking_unit_id = v_id AND removed_at IS NULL AND returned_at IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Bundle %s is on a vendor pickup. Remove it from the pickup first', v_unit.stock_tracking_id);
    END IF;

    INSERT INTO tracking_vendor_moves (tracking_unit_id, company_id, from_vendor_id, from_vendor_name, to_vendor_id, to_vendor_name,
                                       moved_on, reason, created_by)
    VALUES (v_id, v_unit.company_id, v_unit.current_vendor_id, v_unit.current_vendor_name, p_to_vendor_id, v_to,
            v_date, NULLIF(btrim(COALESCE(p_reason, '')), ''), p_actor);

    UPDATE tracking_units SET current_vendor_id = p_to_vendor_id, current_vendor_name = v_to WHERE id = v_id;

    PERFORM fn_tracking_record_event(v_id, 'VENDOR_CHANGED',
      jsonb_build_object('from_vendor', v_unit.current_vendor_name, 'to_vendor_id', p_to_vendor_id, 'to_vendor', v_to,
                         'moved_on', v_date, 'reason', NULLIF(btrim(COALESCE(p_reason, '')), '')),
      p_actor, v_unit.company_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- p_transfer_id NULL removes the link. Reads the transfer and never changes it.
CREATE OR REPLACE FUNCTION link_tracking_vendor_move_transfer(p_move_id UUID, p_transfer_id UUID, p_actor UUID)
RETURNS tracking_vendor_moves
LANGUAGE plpgsql AS $$
DECLARE
  v_move     tracking_vendor_moves;
  v_transfer RECORD;
BEGIN
  SELECT * INTO v_move FROM tracking_vendor_moves WHERE id = p_move_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Vendor move not found';
  END IF;
  IF p_transfer_id IS NULL THEN
    UPDATE tracking_vendor_moves SET job_work_transfer_id = NULL, transfer_number = NULL WHERE id = p_move_id RETURNING * INTO v_move;
    RETURN v_move;
  END IF;

  SELECT t.id, t.transfer_number, t.from_vendor_id, t.to_vendor_id, o.company_id INTO v_transfer
    FROM job_work_transfers t LEFT JOIN job_work_orders o ON o.id = t.from_job_work_order_id
   WHERE t.id = p_transfer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Transfer not found';
  END IF;
  IF v_transfer.from_vendor_id <> v_move.from_vendor_id OR v_transfer.to_vendor_id <> v_move.to_vendor_id THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Transfer %s is between different vendors', v_transfer.transfer_number);
  END IF;
  IF v_transfer.company_id IS DISTINCT FROM v_move.company_id THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This transfer belongs to a different company';
  END IF;

  UPDATE tracking_vendor_moves SET job_work_transfer_id = p_transfer_id, transfer_number = v_transfer.transfer_number
   WHERE id = p_move_id RETURNING * INTO v_move;
  RETURN v_move;
END;
$$;

-- ── Outputs and remainders ──────────────────────────────────────────────────
-- p_outputs    = [{"item_master_id":"…","size_label":"…","quantity":"1.250","weight_basis":"weighed","parents":["<unit id>", …]}]
-- p_remainders = [{"parent":"<unit id>","quantity":"0.400","weight_basis":"weighed"}]
-- p_used_up    = source bundles that are finished. A bundle with a remainder is always finished.
-- An output's purchase lines are the purchase lines of its source bundles,
-- with the weight sent from each: the input weight, never an invented share.

CREATE OR REPLACE FUNCTION receive_tracking_outputs(
  p_company_id UUID, p_warehouse_id UUID, p_vendor_id UUID, p_dispatch_id UUID, p_received_on DATE,
  p_outputs JSONB, p_remainders JSONB, p_used_up UUID[], p_note TEXT, p_actor UUID
)
RETURNS SETOF tracking_units
LANGUAGE plpgsql AS $$
DECLARE
  v_vendor    TEXT;
  v_date      DATE := fn_tracking_check_business_date(p_received_on, 'received date');
  v_outputs   JSONB := COALESCE(p_outputs, '[]'::jsonb);
  v_rems      JSONB := COALESCE(p_remainders, '[]'::jsonb);
  v_n_out     INT;
  v_n_rem     INT;
  v_parents   UUID[];
  v_rem_ids   UUID[];
  v_finished  UUID[];
  v_id        UUID;
  v_unit      tracking_units;
  v_parent    tracking_units;
  v_new       tracking_units;
  v_o         JSONB;
  v_r         JSONB;
  v_pids      UUID[];
  v_item      RECORD;
  v_unit_word TEXT;
  v_line_id   TEXT;
  v_bill_id   UUID;
  v_bill_no   TEXT;
  v_lines     INT;
  v_ids       TEXT[];
  v_k         INT := 0;
  v_no        INT := 0;
  v_prefix    TEXT := 'JR' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'MMYY') || '-';
  v_seq       INT;
  v_receipt   tracking_output_receipts;
  v_text      TEXT;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A signed-in user is required';
  END IF;
  IF jsonb_typeof(v_outputs) <> 'array' OR jsonb_typeof(v_rems) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Outputs and remainders must be lists';
  END IF;
  v_n_out := jsonb_array_length(v_outputs);
  v_n_rem := jsonb_array_length(v_rems);
  IF v_n_out + v_n_rem = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Enter at least one output or remainder';
  END IF;
  IF v_n_out + v_n_rem > 99 THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A receipt can hold at most 99 bundles';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM warehouses WHERE id = p_warehouse_id AND company_id = p_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'That warehouse does not belong to this company';
  END IF;
  IF NOT fn_tracking_is_enabled(p_company_id, p_warehouse_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'QR tracking is switched off for this warehouse';
  END IF;
  v_vendor := fn_tracking_vendor_name(p_vendor_id);
  IF p_dispatch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tracking_vendor_dispatches WHERE id = p_dispatch_id AND company_id = p_company_id AND status = 'SENT'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Choose a sent dispatch of this company';
  END IF;

  -- Check the shape of every row before anything is written.
  FOR v_o IN SELECT value FROM jsonb_array_elements(v_outputs) LOOP
    IF jsonb_typeof(v_o -> 'parents') <> 'array' OR jsonb_array_length(v_o -> 'parents') = 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Choose the bundles each output was made from';
    END IF;
    IF COALESCE(v_o ->> 'item_master_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Choose the item for each output';
    END IF;
  END LOOP;
  PERFORM fn_tracking_weights_total(v_outputs);
  PERFORM fn_tracking_weights_total(v_rems);

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_rem_ids
    FROM (SELECT (value ->> 'parent')::uuid AS x FROM jsonb_array_elements(v_rems)) s;
  IF v_n_rem > 0 AND cardinality(v_rem_ids) <> v_n_rem THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A bundle can have only one remainder';
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_parents FROM (
    SELECT (p.value #>> '{}')::uuid AS x FROM jsonb_array_elements(v_outputs) o, jsonb_array_elements(o.value -> 'parents') p
    UNION SELECT unnest(COALESCE(v_rem_ids, '{}'::uuid[]))
  ) s;
  v_finished := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_used_up, '{}'::uuid[]) || COALESCE(v_rem_ids, '{}'::uuid[])) x ORDER BY x);
  IF EXISTS (SELECT 1 FROM unnest(v_finished) x WHERE NOT x = ANY(v_parents)) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Only bundles used for this receipt can be marked used up';
  END IF;

  -- Lock every source bundle, always in id order.
  FOREACH v_id IN ARRAY v_parents LOOP
    v_unit := fn_tracking_lock_active_unit(v_id);
    IF v_unit.lifecycle_status <> 'AT_VENDOR' OR v_unit.current_vendor_id <> p_vendor_id THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001',
        MESSAGE = format('Bundle %s is not at %s', v_unit.stock_tracking_id, v_vendor);
    END IF;
    IF v_unit.company_id <> p_company_id THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Bundle %s belongs to a different company', v_unit.stock_tracking_id);
    END IF;
    IF EXISTS (SELECT 1 FROM tracking_pickup_units WHERE tracking_unit_id = v_id AND removed_at IS NULL AND returned_at IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Bundle %s is on a vendor pickup', v_unit.stock_tracking_id);
    END IF;
  END LOOP;

  PERFORM pg_advisory_xact_lock(hashtext('tracking_receipt_no'));
  SELECT COALESCE(MAX(substring(receipt_no FROM 8)::int), 0) INTO v_seq
    FROM tracking_output_receipts WHERE receipt_no LIKE v_prefix || '%';
  INSERT INTO tracking_output_receipts (receipt_no, company_id, warehouse_id, vendor_id, vendor_name, dispatch_id, received_on, note, created_by)
  VALUES (v_prefix || lpad((v_seq + 1)::text, 4, '0'), p_company_id, p_warehouse_id, p_vendor_id, v_vendor, p_dispatch_id, v_date,
          NULLIF(btrim(COALESCE(p_note, '')), ''), p_actor)
  RETURNING * INTO v_receipt;

  v_ids := fn_tracking_next_ids(v_n_out + v_n_rem);

  -- Outputs
  FOR v_o IN SELECT value FROM jsonb_array_elements(v_outputs) LOOP
    v_k := v_k + 1;
    v_no := v_no + 1;
    v_pids := ARRAY(SELECT DISTINCT (p.value #>> '{}')::uuid FROM jsonb_array_elements(v_o -> 'parents') p);

    SELECT im.id, im.item_code, im.item_name, im.material_type_id, im.material_size_id, im.size_label, im.unit, mt.unit AS type_unit
      INTO v_item
      FROM item_master im LEFT JOIN material_types mt ON mt.id = im.material_type_id
     WHERE im.id = (v_o ->> 'item_master_id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Output item not found';
    END IF;
    SELECT MIN(unit), MAX(unit) INTO v_unit_word, v_text FROM tracking_units WHERE id = ANY(v_pids);
    IF v_unit_word IS DISTINCT FROM v_text THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Bundles measured in different units cannot make one output';
    END IF;

    SELECT count(DISTINCT purchase_line_id), MIN(purchase_line_id) INTO v_lines, v_line_id
      FROM tracking_unit_origins WHERE tracking_unit_id = ANY(v_pids);
    v_bill_id := NULL;
    v_bill_no := NULL;
    IF v_lines = 1 THEN
      SELECT b.id, b.bill_number INTO v_bill_id, v_bill_no
        FROM purchase_bill_items i JOIN purchase_bills b ON b.id = i.bill_id WHERE i.purchase_line_id = v_line_id;
    END IF;

    INSERT INTO tracking_units (
      stock_tracking_id, qr_reference, company_id, warehouse_id, purchase_line_id, purchase_bill_id,
      bill_number, receipt_date, item_master_id, item_code, item_name, material_type_id, material_size_id,
      size_label, quantity, unit, bundle_no, bundle_count, weight_basis, created_by,
      lifecycle_status, source_type, output_receipt_id
    ) VALUES (
      v_ids[v_k], fn_tracking_new_qr_reference(), p_company_id, p_warehouse_id,
      CASE WHEN v_bill_id IS NOT NULL THEN v_line_id END, v_bill_id, v_bill_no, v_date,
      v_item.id, v_item.item_code, v_item.item_name, v_item.material_type_id, v_item.material_size_id,
      COALESCE(NULLIF(btrim(COALESCE(v_o ->> 'size_label', '')), ''), v_item.size_label),
      (v_o ->> 'quantity')::numeric, COALESCE(v_unit_word, v_item.unit, v_item.type_unit), v_no, v_n_out,
      v_o ->> 'weight_basis', p_actor, 'LABELLED', 'JOB_WORK_OUTPUT', v_receipt.id
    ) RETURNING * INTO v_new;

    INSERT INTO tracking_unit_origins (tracking_unit_id, purchase_line_id, quantity)
    SELECT v_new.id, purchase_line_id, SUM(quantity)
      FROM tracking_unit_origins WHERE tracking_unit_id = ANY(v_pids)
     GROUP BY purchase_line_id;

    INSERT INTO tracking_unit_lineage (child_unit_id, parent_unit_id, relation)
    SELECT v_new.id, x, 'MADE_FROM' FROM unnest(v_pids) x;

    PERFORM fn_tracking_record_event(v_new.id, 'UNIT_CREATED',
      jsonb_build_object('receipt_id', v_receipt.id, 'receipt_no', v_receipt.receipt_no, 'vendor', v_vendor, 'kind', 'output',
                         'quantity', v_new.quantity, 'weight_basis', v_new.weight_basis,
                         'made_from', (SELECT jsonb_agg(stock_tracking_id ORDER BY stock_tracking_id) FROM tracking_units WHERE id = ANY(v_pids))),
      p_actor, p_company_id);
    RETURN NEXT v_new;
  END LOOP;

  -- Remainders: the unprocessed rest of a source bundle, weighed again.
  FOR v_r IN SELECT value FROM jsonb_array_elements(v_rems) LOOP
    v_k := v_k + 1;
    SELECT * INTO v_parent FROM tracking_units WHERE id = (v_r ->> 'parent')::uuid;
    IF (v_r ->> 'quantity')::numeric >= v_parent.quantity THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001',
        MESSAGE = format('The remainder of %s must weigh less than its %s %s. A whole bundle that comes back is returned unprocessed instead',
                         v_parent.stock_tracking_id, v_parent.quantity, v_parent.unit);
    END IF;

    INSERT INTO tracking_units (
      stock_tracking_id, qr_reference, company_id, warehouse_id, purchase_line_id, purchase_bill_id,
      bill_number, receipt_date, item_master_id, item_code, item_name, material_type_id, material_size_id,
      size_label, quantity, unit, bundle_no, bundle_count, weight_basis, created_by,
      lifecycle_status, source_type, output_receipt_id, source_verification_id
    ) VALUES (
      v_ids[v_k], fn_tracking_new_qr_reference(), p_company_id, p_warehouse_id,
      v_parent.purchase_line_id, v_parent.purchase_bill_id, v_parent.bill_number, v_parent.receipt_date,
      v_parent.item_master_id, v_parent.item_code, v_parent.item_name, v_parent.material_type_id, v_parent.material_size_id,
      v_parent.size_label, (v_r ->> 'quantity')::numeric, v_parent.unit, v_parent.bundle_no, v_parent.bundle_count,
      v_r ->> 'weight_basis', p_actor, 'LABELLED', 'JOB_WORK_REMAINDER', v_receipt.id, v_parent.source_verification_id
    ) RETURNING * INTO v_new;

    -- A remainder is a piece of the same bundle, so its share of each line is in proportion to its weight.
    INSERT INTO tracking_unit_origins (tracking_unit_id, purchase_line_id, quantity)
    SELECT v_new.id, purchase_line_id, GREATEST(round(quantity * v_new.quantity / v_parent.quantity, 3), 0.001)
      FROM tracking_unit_origins WHERE tracking_unit_id = v_parent.id;

    INSERT INTO tracking_unit_lineage (child_unit_id, parent_unit_id, relation) VALUES (v_new.id, v_parent.id, 'REMAINDER_OF');

    PERFORM fn_tracking_record_event(v_new.id, 'UNIT_CREATED',
      jsonb_build_object('receipt_id', v_receipt.id, 'receipt_no', v_receipt.receipt_no, 'vendor', v_vendor, 'kind', 'remainder',
                         'remainder_of', v_parent.stock_tracking_id, 'quantity', v_new.quantity, 'weight_basis', v_new.weight_basis),
      p_actor, p_company_id);
    RETURN NEXT v_new;
  END LOOP;

  -- Finished source bundles.
  FOREACH v_id IN ARRAY v_finished LOOP
    UPDATE tracking_units
       SET lifecycle_status = 'PROCESSED', current_vendor_id = NULL, current_vendor_name = NULL, at_vendor_since = NULL,
           status_reason = 'Used up in ' || v_receipt.receipt_no
     WHERE id = v_id
     RETURNING * INTO v_unit;
    PERFORM fn_tracking_close_dispatch_line(v_id, 'Processed in ' || v_receipt.receipt_no);
    PERFORM fn_tracking_record_event(v_id, 'PROCESSED',
      jsonb_build_object('receipt_id', v_receipt.id, 'receipt_no', v_receipt.receipt_no, 'vendor', v_vendor),
      p_actor, p_company_id);
  END LOOP;
END;
$$;

-- p_order_id NULL removes the link. Each output is matched to an output line of
-- the order by item, then size, then the closest weight. Reads the order only.
CREATE OR REPLACE FUNCTION link_tracking_receipt_order(p_receipt_id UUID, p_order_id UUID, p_actor UUID)
RETURNS tracking_output_receipts
LANGUAGE plpgsql AS $$
DECLARE
  v_receipt tracking_output_receipts;
  v_order   RECORD;
BEGIN
  SELECT * INTO v_receipt FROM tracking_output_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Output receipt not found';
  END IF;

  IF p_order_id IS NULL THEN
    UPDATE tracking_units SET job_work_output_item_id = NULL WHERE output_receipt_id = p_receipt_id;
    UPDATE tracking_output_receipts SET job_work_order_id = NULL, job_work_reference = NULL, updated_at = now()
     WHERE id = p_receipt_id RETURNING * INTO v_receipt;
    RETURN v_receipt;
  END IF;

  SELECT id, reference_number, vendor_id, company_id INTO v_order FROM job_work_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Job work order not found';
  END IF;
  IF v_order.company_id <> v_receipt.company_id THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This job work order belongs to a different company';
  END IF;
  IF v_order.vendor_id <> v_receipt.vendor_id THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Job work order %s is for a different vendor', v_order.reference_number);
  END IF;

  UPDATE tracking_units u
     SET job_work_output_item_id = (
       SELECT x.id FROM job_work_output_items x
        WHERE x.job_work_order_id = p_order_id AND x.item_master_id = u.item_master_id
        ORDER BY (x.size_label IS NOT DISTINCT FROM u.size_label) DESC, abs(x.quantity - u.quantity), x.created_at
        LIMIT 1)
   WHERE u.output_receipt_id = p_receipt_id AND u.source_type = 'JOB_WORK_OUTPUT';

  UPDATE tracking_output_receipts
     SET job_work_order_id = p_order_id, job_work_reference = v_order.reference_number, updated_at = now()
   WHERE id = p_receipt_id
   RETURNING * INTO v_receipt;
  RETURN v_receipt;
END;
$$;

-- ── Split: a bundle at a vendor can be split too ────────────────────────────
-- Parts start where the original was: in the yard at its location, or at its
-- vendor. Each part takes its share of the original's purchase lines in
-- proportion to its weight, which is physically true of a piece of one bundle.

CREATE OR REPLACE FUNCTION split_tracking_unit(p_unit_id UUID, p_parts JSONB, p_reason TEXT, p_actor UUID)
RETURNS SETOF tracking_units
LANGUAGE plpgsql AS $$
DECLARE
  v_unit   tracking_units;
  v_part   tracking_units;
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_count  INT;
  v_total  NUMERIC;
  v_ids    TEXT[];
  v_no     INT := 0;
  v_b      JSONB;
  v_line   tracking_pickup_units;
  v_at_vendor BOOLEAN;
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A reason is required to split a bundle';
  END IF;
  IF jsonb_typeof(p_parts) <> 'array' OR jsonb_array_length(p_parts) NOT BETWEEN 2 AND 20 THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A bundle splits into 2 to 20 parts';
  END IF;

  v_unit := fn_tracking_lock_active_unit(p_unit_id);
  IF v_unit.lifecycle_status NOT IN ('IN_STOCK', 'ON_PICKUP', 'AT_VENDOR') THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001',
      MESSAGE = format('A bundle that is %s cannot be split', fn_tracking_status_words(v_unit.lifecycle_status));
  END IF;
  v_at_vendor := v_unit.lifecycle_status = 'AT_VENDOR';
  IF v_at_vendor AND EXISTS (SELECT 1 FROM tracking_pickup_units WHERE tracking_unit_id = p_unit_id AND removed_at IS NULL AND returned_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Remove this bundle from its vendor pickup before splitting it';
  END IF;

  v_total := fn_tracking_weights_total(p_parts);
  IF v_total <> v_unit.quantity THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001',
      MESSAGE = format('Part weights total %s, but the bundle is %s %s', v_total, v_unit.quantity, v_unit.unit);
  END IF;

  v_count := jsonb_array_length(p_parts);

  IF v_unit.lifecycle_status = 'ON_PICKUP' THEN
    UPDATE tracking_pickup_units
       SET removed_at = now(), removed_by = p_actor, remove_reason = 'Bundle split: ' || v_reason
     WHERE tracking_unit_id = p_unit_id AND removed_at IS NULL AND returned_at IS NULL
     RETURNING * INTO v_line;
    IF FOUND THEN
      INSERT INTO tracking_pickup_events (pickup_id, event_type, details, actor_id)
      VALUES (v_line.pickup_id, 'UNIT_REMOVED', jsonb_build_object('tracking_unit_id', p_unit_id, 'reason', 'Bundle split: ' || v_reason), p_actor);
    END IF;
  END IF;
  IF v_at_vendor THEN
    PERFORM fn_tracking_close_dispatch_line(p_unit_id, 'Split: ' || v_reason);
  END IF;

  UPDATE tracking_units
     SET lifecycle_status = 'SPLIT', current_location_id = NULL, status_reason = v_reason,
         current_vendor_id = NULL, current_vendor_name = NULL, at_vendor_since = NULL
   WHERE id = p_unit_id;

  v_ids := fn_tracking_next_ids(v_count);

  WHILE v_no < v_count LOOP
    v_no := v_no + 1;
    v_b := p_parts -> (v_no - 1);

    INSERT INTO tracking_units (
      stock_tracking_id, qr_reference, company_id, warehouse_id, purchase_line_id, purchase_bill_id,
      bill_number, receipt_date, item_master_id, item_code, item_name, material_type_id, material_size_id,
      size_label, quantity, unit, bundle_no, bundle_count, weight_basis, created_by,
      lifecycle_status, current_location_id, source_type, source_verification_id, parent_unit_id, part_no,
      current_vendor_id, current_vendor_name, at_vendor_since
    ) VALUES (
      v_ids[v_no], fn_tracking_new_qr_reference(),
      v_unit.company_id, v_unit.warehouse_id, v_unit.purchase_line_id, v_unit.purchase_bill_id,
      v_unit.bill_number, v_unit.receipt_date, v_unit.item_master_id, v_unit.item_code, v_unit.item_name,
      v_unit.material_type_id, v_unit.material_size_id, v_unit.size_label, (v_b ->> 'quantity')::numeric, v_unit.unit,
      v_unit.bundle_no, v_unit.bundle_count, v_b ->> 'weight_basis', p_actor,
      CASE WHEN v_at_vendor THEN 'AT_VENDOR' ELSE 'IN_STOCK' END,
      CASE WHEN v_at_vendor THEN NULL ELSE v_unit.current_location_id END,
      'SPLIT_PART', v_unit.source_verification_id, v_unit.id, v_no,
      v_unit.current_vendor_id, v_unit.current_vendor_name, v_unit.at_vendor_since
    ) RETURNING * INTO v_part;

    INSERT INTO tracking_unit_origins (tracking_unit_id, purchase_line_id, quantity)
    SELECT v_part.id, o.purchase_line_id, GREATEST(round(o.quantity * v_part.quantity / v_unit.quantity, 3), 0.001)
      FROM tracking_unit_origins o WHERE o.tracking_unit_id = v_unit.id;

    PERFORM fn_tracking_record_event(v_part.id, 'UNIT_CREATED',
      jsonb_build_object('parent_unit_id', v_unit.id, 'parent_tracking_id', v_unit.stock_tracking_id,
                         'part_no', v_no, 'quantity', v_part.quantity, 'weight_basis', v_part.weight_basis,
                         'vendor', v_unit.current_vendor_name),
      p_actor, v_unit.company_id);

    RETURN NEXT v_part;
  END LOOP;

  PERFORM fn_tracking_record_event(p_unit_id, 'UNIT_SPLIT',
    jsonb_build_object('parts', v_count, 'reason', v_reason), p_actor, v_unit.company_id);
END;
$$;

-- ── Pickups at a vendor ─────────────────────────────────────────────────────
-- A vendor pickup closes bundles sold straight from the vendor. Nobody scans
-- there, so bundles are picked in the office and handed over in one step.

CREATE OR REPLACE FUNCTION create_tracking_vendor_pickup(p_company_id UUID, p_warehouse_id UUID, p_vendor_id UUID, p_customer_id UUID, p_actor UUID)
RETURNS tracking_pickups
LANGUAGE plpgsql AS $$
DECLARE
  v_pickup tracking_pickups;
BEGIN
  v_pickup := create_tracking_pickup(p_company_id, p_warehouse_id, p_customer_id, p_actor);
  UPDATE tracking_pickups SET vendor_id = p_vendor_id, vendor_name = fn_tracking_vendor_name(p_vendor_id)
   WHERE id = v_pickup.id RETURNING * INTO v_pickup;
  RETURN v_pickup;
END;
$$;

-- ERRCODE WC003 asks the operator for a reason, then they can try again with one.
CREATE OR REPLACE FUNCTION add_tracking_pickup_unit(p_pickup_id UUID, p_unit_id UUID, p_mismatch_reason TEXT, p_actor UUID)
RETURNS tracking_pickup_units
LANGUAGE plpgsql AS $$
DECLARE
  v_pickup tracking_pickups;
  v_unit   tracking_units;
  v_sale   TEXT;
  v_match  BOOLEAN := true;
  v_reason TEXT := NULLIF(btrim(COALESCE(p_mismatch_reason, '')), '');
  v_line   tracking_pickup_units;
  v_other  TEXT;
BEGIN
  v_pickup := fn_tracking_lock_pickup(p_pickup_id);
  IF v_pickup.status <> 'OPEN' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Bundles can only be added while a pickup is open';
  END IF;

  v_unit := fn_tracking_lock_active_unit(p_unit_id);
  IF v_unit.company_id <> v_pickup.company_id OR v_unit.warehouse_id <> v_pickup.warehouse_id THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This bundle is in a different warehouse';
  END IF;
  IF v_pickup.vendor_id IS NULL THEN
    IF v_unit.lifecycle_status <> 'IN_STOCK' THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001',
        MESSAGE = format('Bundle %s is %s, so it cannot be added', v_unit.stock_tracking_id, fn_tracking_status_words(v_unit.lifecycle_status));
    END IF;
    SELECT d.dispatch_no INTO v_other
      FROM tracking_vendor_dispatch_units l JOIN tracking_vendor_dispatches d ON d.id = l.dispatch_id
     WHERE l.tracking_unit_id = p_unit_id AND l.removed_at IS NULL AND l.closed_at IS NULL;
    IF FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Bundle %s is on vendor dispatch %s', v_unit.stock_tracking_id, v_other);
    END IF;
  ELSE
    IF v_unit.lifecycle_status <> 'AT_VENDOR' OR v_unit.current_vendor_id <> v_pickup.vendor_id THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Bundle %s is not at %s', v_unit.stock_tracking_id, v_pickup.vendor_name);
    END IF;
    IF EXISTS (SELECT 1 FROM tracking_pickup_units WHERE tracking_unit_id = p_unit_id AND removed_at IS NULL AND returned_at IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Bundle %s is already on a pickup', v_unit.stock_tracking_id);
    END IF;
  END IF;

  IF v_pickup.dispatch_order_id IS NOT NULL THEN
    SELECT d.sale_line_id INTO v_sale
      FROM dispatch_items d
     WHERE d.dispatch_order_id = v_pickup.dispatch_order_id
       AND (d.purchase_line_id = v_unit.purchase_line_id
            OR (d.item_master_id = v_unit.item_master_id AND (d.purchase_line_id IS NULL OR v_unit.purchase_line_id IS NULL)))
     ORDER BY (d.purchase_line_id = v_unit.purchase_line_id) DESC NULLS LAST
     LIMIT 1;
    v_match := FOUND;
    IF NOT v_match AND v_reason IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'WC003',
        MESSAGE = format('Bundle %s does not match the linked sale. Give a reason to add it anyway', v_unit.stock_tracking_id);
    END IF;
  END IF;

  IF v_pickup.vendor_id IS NULL THEN
    UPDATE tracking_units SET lifecycle_status = 'ON_PICKUP' WHERE id = p_unit_id RETURNING * INTO v_unit;
  END IF;

  INSERT INTO tracking_pickup_units (pickup_id, tracking_unit_id, quantity, sale_line_id, mismatch_reason, added_by)
  VALUES (p_pickup_id, p_unit_id, v_unit.quantity, v_sale, CASE WHEN v_match THEN NULL ELSE v_reason END, p_actor)
  RETURNING * INTO v_line;

  INSERT INTO tracking_pickup_events (pickup_id, event_type, details, actor_id)
  VALUES (p_pickup_id, 'UNIT_ADDED',
          jsonb_build_object('tracking_unit_id', p_unit_id, 'tracking_id', v_unit.stock_tracking_id, 'quantity', v_unit.quantity,
                             'mismatch_reason', CASE WHEN v_match THEN NULL ELSE v_reason END),
          p_actor);
  PERFORM fn_tracking_record_event(p_unit_id, 'ADDED_TO_PICKUP',
    jsonb_build_object('pickup_id', p_pickup_id, 'pickup_no', v_pickup.pickup_no, 'vendor', v_pickup.vendor_name), p_actor, v_unit.company_id);

  RETURN v_line;
END;
$$;

CREATE OR REPLACE FUNCTION remove_tracking_pickup_unit(p_pickup_id UUID, p_unit_id UUID, p_reason TEXT, p_actor UUID)
RETURNS tracking_pickups
LANGUAGE plpgsql AS $$
DECLARE
  v_pickup tracking_pickups;
  v_unit   tracking_units;
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A reason is required to remove a bundle';
  END IF;
  v_pickup := fn_tracking_lock_pickup(p_pickup_id);
  IF v_pickup.status NOT IN ('OPEN', 'READY') THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Bundles can only be removed before handover';
  END IF;
  v_unit := fn_tracking_lock_active_unit(p_unit_id);

  UPDATE tracking_pickup_units
     SET removed_at = now(), removed_by = p_actor, remove_reason = v_reason
   WHERE pickup_id = p_pickup_id AND tracking_unit_id = p_unit_id AND removed_at IS NULL AND returned_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This bundle is not on this pickup';
  END IF;

  -- A bundle on a vendor pickup never left the vendor, so its status stays.
  IF v_pickup.vendor_id IS NULL THEN
    UPDATE tracking_units SET lifecycle_status = 'IN_STOCK' WHERE id = p_unit_id;
  END IF;

  INSERT INTO tracking_pickup_events (pickup_id, event_type, details, actor_id)
  VALUES (p_pickup_id, 'UNIT_REMOVED', jsonb_build_object('tracking_unit_id', p_unit_id, 'tracking_id', v_unit.stock_tracking_id, 'reason', v_reason), p_actor);
  PERFORM fn_tracking_record_event(p_unit_id, 'REMOVED_FROM_PICKUP',
    jsonb_build_object('pickup_id', p_pickup_id, 'pickup_no', v_pickup.pickup_no, 'reason', v_reason), p_actor, v_unit.company_id);

  UPDATE tracking_pickups
     SET status = CASE WHEN EXISTS (
           SELECT 1 FROM tracking_pickup_units
            WHERE pickup_id = p_pickup_id AND removed_at IS NULL AND returned_at IS NULL
         ) THEN status ELSE 'OPEN' END,
         updated_at = now()
   WHERE id = p_pickup_id
   RETURNING * INTO v_pickup;

  RETURN v_pickup;
END;
$$;

CREATE OR REPLACE FUNCTION mark_tracking_pickup_ready(p_pickup_id UUID, p_bay_location_id UUID, p_actor UUID)
RETURNS tracking_pickups
LANGUAGE plpgsql AS $$
DECLARE
  v_pickup tracking_pickups;
  v_bay    tracking_locations;
  v_unit   tracking_units;
  v_count  INT := 0;
BEGIN
  v_pickup := fn_tracking_lock_pickup(p_pickup_id);
  IF v_pickup.vendor_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A vendor pickup has no loading bay. Hand it over directly';
  END IF;
  IF v_pickup.status <> 'OPEN' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Only an open pickup can be marked ready';
  END IF;
  IF p_bay_location_id IS NOT NULL THEN
    v_bay := fn_tracking_usable_location(p_bay_location_id, v_pickup.company_id, v_pickup.warehouse_id);
    IF v_bay.location_type <> 'PICKUP_BAY' THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Location %s is not a pickup bay', v_bay.code);
    END IF;
  END IF;

  FOR v_unit IN
    SELECT u.* FROM tracking_units u
      JOIN tracking_pickup_units l ON l.tracking_unit_id = u.id
     WHERE l.pickup_id = p_pickup_id AND l.removed_at IS NULL AND l.returned_at IS NULL
     ORDER BY u.id FOR UPDATE OF u
  LOOP
    v_count := v_count + 1;
    UPDATE tracking_units
       SET lifecycle_status = 'READY', current_location_id = COALESCE(v_bay.id, current_location_id)
     WHERE id = v_unit.id;
    PERFORM fn_tracking_record_event(v_unit.id, 'MARKED_READY',
      jsonb_build_object('pickup_id', p_pickup_id, 'pickup_no', v_pickup.pickup_no, 'to_location', v_bay.code), p_actor, v_unit.company_id);
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Scan at least one bundle first';
  END IF;

  UPDATE tracking_pickups SET status = 'READY', updated_at = now() WHERE id = p_pickup_id RETURNING * INTO v_pickup;
  INSERT INTO tracking_pickup_events (pickup_id, event_type, details, actor_id)
  VALUES (p_pickup_id, 'MARKED_READY', jsonb_build_object('bundles', v_count, 'bay', v_bay.code), p_actor);

  RETURN v_pickup;
END;
$$;

CREATE OR REPLACE FUNCTION hand_over_tracking_pickup(
  p_pickup_id UUID, p_collector_name TEXT, p_collector_phone TEXT, p_vehicle_number TEXT, p_position JSONB, p_actor UUID
)
RETURNS tracking_pickups
LANGUAGE plpgsql AS $$
DECLARE
  v_pickup  tracking_pickups;
  v_unit    tracking_units;
  v_name    TEXT := NULLIF(btrim(COALESCE(p_collector_name, '')), '');
  v_vehicle TEXT := NULLIF(upper(btrim(COALESCE(p_vehicle_number, ''))), '');
  v_phone   TEXT := NULLIF(btrim(COALESCE(p_collector_phone, '')), '');
  v_count   INT := 0;
BEGIN
  IF v_name IS NULL OR v_vehicle IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Enter the collector''s name and the vehicle number';
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^[0-9]{10,15}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Enter a valid phone number for the collector';
  END IF;

  v_pickup := fn_tracking_lock_pickup(p_pickup_id);
  IF v_pickup.vendor_id IS NULL AND v_pickup.status <> 'READY' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Mark the pickup ready before handing it over';
  END IF;
  IF v_pickup.vendor_id IS NOT NULL AND v_pickup.status <> 'OPEN' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Only an open vendor pickup can be handed over';
  END IF;

  FOR v_unit IN
    SELECT u.* FROM tracking_units u
      JOIN tracking_pickup_units l ON l.tracking_unit_id = u.id
     WHERE l.pickup_id = p_pickup_id AND l.removed_at IS NULL AND l.returned_at IS NULL
     ORDER BY u.id FOR UPDATE OF u
  LOOP
    v_count := v_count + 1;
    IF v_pickup.vendor_id IS NOT NULL AND (v_unit.lifecycle_status <> 'AT_VENDOR' OR v_unit.current_vendor_id <> v_pickup.vendor_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001',
        MESSAGE = format('Bundle %s is no longer at %s. Remove it from the pickup first', v_unit.stock_tracking_id, v_pickup.vendor_name);
    END IF;
    UPDATE tracking_units
       SET lifecycle_status = 'PICKED_UP', current_location_id = NULL,
           current_vendor_id = NULL, current_vendor_name = NULL, at_vendor_since = NULL
     WHERE id = v_unit.id;
    IF v_pickup.vendor_id IS NOT NULL THEN
      PERFORM fn_tracking_close_dispatch_line(v_unit.id, 'Sold at the vendor on ' || v_pickup.pickup_no);
    END IF;
    PERFORM fn_tracking_record_event(v_unit.id, 'PICKED_UP',
      jsonb_build_object('pickup_id', p_pickup_id, 'pickup_no', v_pickup.pickup_no, 'collector', v_name, 'vehicle', v_vehicle,
                         'vendor', v_pickup.vendor_name),
      p_actor, v_unit.company_id, p_position);
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Add at least one bundle first';
  END IF;

  UPDATE tracking_pickups
     SET status = 'HANDED_OVER', collector_name = v_name, collector_phone = v_phone, vehicle_number = v_vehicle,
         handed_over_at = now(), handed_over_by = p_actor, updated_at = now()
   WHERE id = p_pickup_id
   RETURNING * INTO v_pickup;

  INSERT INTO tracking_pickup_events (pickup_id, event_type, details, actor_id)
  VALUES (p_pickup_id, 'HANDED_OVER', jsonb_build_object('bundles', v_count, 'collector', v_name, 'vehicle', v_vehicle), p_actor);

  RETURN v_pickup;
END;
$$;

CREATE OR REPLACE FUNCTION cancel_tracking_pickup(p_pickup_id UUID, p_reason TEXT, p_actor UUID)
RETURNS tracking_pickups
LANGUAGE plpgsql AS $$
DECLARE
  v_pickup tracking_pickups;
  v_unit   tracking_units;
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A reason is required to cancel a pickup';
  END IF;
  v_pickup := fn_tracking_lock_pickup(p_pickup_id);
  IF v_pickup.status NOT IN ('OPEN', 'READY') THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A pickup can only be cancelled before handover';
  END IF;

  FOR v_unit IN
    SELECT u.* FROM tracking_units u
      JOIN tracking_pickup_units l ON l.tracking_unit_id = u.id
     WHERE l.pickup_id = p_pickup_id AND l.removed_at IS NULL AND l.returned_at IS NULL
     ORDER BY u.id FOR UPDATE OF u
  LOOP
    IF v_pickup.vendor_id IS NULL THEN
      UPDATE tracking_units SET lifecycle_status = 'IN_STOCK' WHERE id = v_unit.id;
    END IF;
    PERFORM fn_tracking_record_event(v_unit.id, 'REMOVED_FROM_PICKUP',
      jsonb_build_object('pickup_id', p_pickup_id, 'pickup_no', v_pickup.pickup_no, 'reason', 'Pickup cancelled: ' || v_reason),
      p_actor, v_unit.company_id);
  END LOOP;

  UPDATE tracking_pickup_units
     SET removed_at = now(), removed_by = p_actor, remove_reason = 'Pickup cancelled: ' || v_reason
   WHERE pickup_id = p_pickup_id AND removed_at IS NULL AND returned_at IS NULL;

  UPDATE tracking_pickups
     SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = p_actor, cancel_reason = v_reason, updated_at = now()
   WHERE id = p_pickup_id
   RETURNING * INTO v_pickup;

  INSERT INTO tracking_pickup_events (pickup_id, event_type, details, actor_id)
  VALUES (p_pickup_id, 'CANCELLED', jsonb_build_object('reason', v_reason), p_actor);

  RETURN v_pickup;
END;
$$;

-- p_dispatch_order_id NULL removes the link. Reads the sale and never changes it.
-- A vendor pickup links to a vendor direct sale, which can sit under any of the
-- company's warehouses; a yard pickup links to a sale from its own warehouse.
CREATE OR REPLACE FUNCTION link_tracking_pickup_sale(p_pickup_id UUID, p_dispatch_order_id UUID, p_actor UUID)
RETURNS tracking_pickups
LANGUAGE plpgsql AS $$
DECLARE
  v_pickup tracking_pickups;
  v_sale   RECORD;
BEGIN
  v_pickup := fn_tracking_lock_pickup(p_pickup_id);
  IF v_pickup.status = 'CANCELLED' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A cancelled pickup cannot be linked to a sale';
  END IF;

  IF p_dispatch_order_id IS NULL THEN
    UPDATE tracking_pickup_units SET sale_line_id = NULL WHERE pickup_id = p_pickup_id;
    UPDATE tracking_pickups SET dispatch_order_id = NULL, invoice_number = NULL, updated_at = now()
     WHERE id = p_pickup_id RETURNING * INTO v_pickup;
    INSERT INTO tracking_pickup_events (pickup_id, event_type, details, actor_id)
    VALUES (p_pickup_id, 'SALE_UNLINKED', '{}'::jsonb, p_actor);
    RETURN v_pickup;
  END IF;

  SELECT id, status, company_id, warehouse_id, customer_id, invoice_number, COALESCE(is_vendor_direct, false) AS is_vendor_direct
    INTO v_sale
    FROM dispatch_orders WHERE id = p_dispatch_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Sale not found';
  END IF;
  IF v_sale.status <> 'active' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Sale %s is %s', v_sale.invoice_number, v_sale.status);
  END IF;
  IF v_sale.company_id <> v_pickup.company_id
     OR (v_pickup.vendor_id IS NULL AND v_sale.warehouse_id <> v_pickup.warehouse_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This sale belongs to a different company or warehouse';
  END IF;
  IF v_pickup.vendor_id IS NOT NULL AND NOT v_sale.is_vendor_direct THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Sale %s is not a vendor direct sale', v_sale.invoice_number);
  END IF;
  IF v_sale.customer_id <> v_pickup.customer_id THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This sale is for a different customer';
  END IF;

  UPDATE tracking_pickup_units l
     SET sale_line_id = (
       SELECT d.sale_line_id FROM dispatch_items d
         JOIN tracking_units u ON u.id = l.tracking_unit_id
        WHERE d.dispatch_order_id = p_dispatch_order_id
          AND (d.purchase_line_id = u.purchase_line_id
               OR (d.item_master_id = u.item_master_id AND (d.purchase_line_id IS NULL OR u.purchase_line_id IS NULL)))
        ORDER BY (d.purchase_line_id = u.purchase_line_id) DESC NULLS LAST
        LIMIT 1)
   WHERE l.pickup_id = p_pickup_id;

  UPDATE tracking_pickups
     SET dispatch_order_id = p_dispatch_order_id, invoice_number = v_sale.invoice_number, updated_at = now()
   WHERE id = p_pickup_id
   RETURNING * INTO v_pickup;

  INSERT INTO tracking_pickup_events (pickup_id, event_type, details, actor_id)
  VALUES (p_pickup_id, 'SALE_LINKED', jsonb_build_object('dispatch_order_id', p_dispatch_order_id, 'invoice_number', v_sale.invoice_number), p_actor);

  RETURN v_pickup;
END;
$$;

-- ── Printing: a used-up bundle must never be relabelled ─────────────────────

CREATE OR REPLACE FUNCTION request_tracking_print(
  p_unit_id UUID, p_printer_id UUID, p_template_id UUID, p_reason TEXT, p_can_reprint BOOLEAN, p_actor UUID
)
RETURNS tracking_print_jobs
LANGUAGE plpgsql AS $$
DECLARE
  v_unit tracking_units;
  v_printer tracking_printers;
  v_type TEXT;
  v_job tracking_print_jobs;
BEGIN
  SELECT * INTO v_unit FROM tracking_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Tracking unit not found';
  END IF;
  IF v_unit.status <> 'ACTIVE' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A voided label cannot be printed';
  END IF;
  IF v_unit.lifecycle_status = 'SPLIT' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This bundle was split. Print the labels for its parts instead';
  END IF;
  IF v_unit.lifecycle_status = 'PROCESSED' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This bundle was used up in job work. Print the labels for its outputs instead';
  END IF;

  SELECT * INTO v_printer FROM tracking_printers WHERE id = p_printer_id;
  IF NOT FOUND OR NOT v_printer.is_active THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Choose an active printer';
  END IF;
  IF v_printer.company_id <> v_unit.company_id OR v_printer.warehouse_id <> v_unit.warehouse_id THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This printer belongs to a different warehouse';
  END IF;

  v_type := CASE WHEN EXISTS (
      SELECT 1 FROM tracking_print_jobs
       WHERE tracking_unit_id = p_unit_id AND status IN ('sent', 'confirmed')
    ) THEN 'REPRINT' ELSE 'ORIGINAL' END;

  IF v_type = 'REPRINT' AND NOT COALESCE(p_can_reprint, false) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC002', MESSAGE = 'Your role cannot reprint a label';
  END IF;
  IF v_type = 'REPRINT' AND btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A reason is required to reprint a label';
  END IF;

  INSERT INTO tracking_print_jobs (job_type, tracking_unit_id, printer_id, template_id, reason, requested_by)
  VALUES (v_type, p_unit_id, p_printer_id, p_template_id, NULLIF(btrim(COALESCE(p_reason, '')), ''), p_actor)
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;
