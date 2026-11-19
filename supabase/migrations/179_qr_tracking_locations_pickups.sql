-- ============================================================
-- Migration 179: QR stock tracking, Phase 3
-- ============================================================
-- Adds warehouse locations, a status lifecycle for each bundle, customer
-- pickups, optional GPS and labelling of physically verified existing stock.
--
-- Every change here is inside the tracking_ tables. No purchase, job work,
-- sale, transfer or ledger table is altered or written to, and no trigger is
-- added to any of them. Existing tables are only read: customers, sales,
-- purchase lines and stock_ledger balances. New tables hold no foreign keys
-- into existing tables, so they can never block a bill edit, cancellation,
-- purge, warehouse merge or backup restore.
-- ============================================================

-- ── Locations ───────────────────────────────────────────────────────────────

CREATE TABLE tracking_locations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_ref  TEXT NOT NULL UNIQUE CHECK (location_ref ~ '^WL[0-9]+-[0-9A-HJKMNP-TV-Z]{16}$'),
  company_id    UUID NOT NULL,
  warehouse_id  UUID NOT NULL,
  code          TEXT NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{0,31}$'),
  name          TEXT,
  location_type TEXT NOT NULL DEFAULT 'STORAGE' CHECK (location_type IN ('STORAGE', 'PICKUP_BAY', 'HOLD')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, code)
);
CREATE INDEX idx_tracking_locations_scope ON tracking_locations (company_id, warehouse_id);

-- ── Old stock checks ────────────────────────────────────────────────────────
-- book_quantity is what the ledger showed at that moment. It is a record only:
-- stock is never adjusted from this table.

CREATE TABLE tracking_verifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL,
  warehouse_id      UUID NOT NULL,
  purchase_line_id  TEXT NOT NULL,
  verified_quantity NUMERIC(15,3) NOT NULL CHECK (verified_quantity > 0),
  book_quantity     NUMERIC(15,3) NOT NULL,
  book_as_of        DATE,
  note              TEXT,
  verified_by       UUID NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tracking_verifications_line ON tracking_verifications (purchase_line_id);

-- ── Bundles ─────────────────────────────────────────────────────────────────
-- status stays ACTIVE or VOIDED. lifecycle_status says where the bundle is in
-- its working life. parent_unit_id has no foreign key because a backup restore
-- inserts rows in batches and a part may arrive before its original.

ALTER TABLE tracking_units
  ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'LABELLED' CHECK (lifecycle_status IN (
    'LABELLED', 'IN_STOCK', 'ON_PICKUP', 'READY', 'PICKED_UP',
    'ON_HOLD', 'MISSING', 'LEFT_WAREHOUSE', 'SPLIT')),
  ADD COLUMN current_location_id UUID REFERENCES tracking_locations(id),
  ADD COLUMN status_reason TEXT,
  ADD COLUMN source_type TEXT NOT NULL DEFAULT 'NEW_PURCHASE'
    CHECK (source_type IN ('NEW_PURCHASE', 'VERIFIED_EXISTING', 'SPLIT_PART')),
  ADD COLUMN source_verification_id UUID REFERENCES tracking_verifications(id),
  ADD COLUMN parent_unit_id UUID,
  ADD COLUMN part_no INTEGER CHECK (part_no >= 1),
  ADD CONSTRAINT tracking_units_part_fields CHECK ((source_type = 'SPLIT_PART') = (parent_unit_id IS NOT NULL)
                                                   AND (parent_unit_id IS NULL) = (part_no IS NULL)),
  ADD CONSTRAINT tracking_units_verified_source CHECK (source_type <> 'VERIFIED_EXISTING' OR source_verification_id IS NOT NULL),
  ADD CONSTRAINT tracking_units_placed CHECK (lifecycle_status NOT IN ('IN_STOCK', 'ON_HOLD', 'ON_PICKUP', 'READY') OR current_location_id IS NOT NULL),
  ADD CONSTRAINT tracking_units_not_placed CHECK (lifecycle_status NOT IN ('LABELLED', 'PICKED_UP', 'MISSING', 'LEFT_WAREHOUSE', 'SPLIT') OR current_location_id IS NULL);

-- Split parts keep their original bundle number, so the one-label-per-bundle
-- rule applies to original bundles only.
DROP INDEX uq_tracking_units_active_bundle;
CREATE UNIQUE INDEX uq_tracking_units_active_bundle ON tracking_units (purchase_line_id, bundle_no)
  WHERE status = 'ACTIVE' AND parent_unit_id IS NULL;
CREATE UNIQUE INDEX uq_tracking_units_part ON tracking_units (parent_unit_id, part_no) WHERE parent_unit_id IS NOT NULL;
CREATE INDEX idx_tracking_units_location ON tracking_units (current_location_id) WHERE current_location_id IS NOT NULL;
CREATE INDEX idx_tracking_units_lifecycle ON tracking_units (company_id, warehouse_id, lifecycle_status);

-- ── Pickups ─────────────────────────────────────────────────────────────────

CREATE TABLE tracking_pickups (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_no         TEXT NOT NULL UNIQUE CHECK (pickup_no ~ '^PU[0-9]{4}-[0-9]{4,}$'),
  company_id        UUID NOT NULL,
  warehouse_id      UUID NOT NULL,
  status            TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'READY', 'HANDED_OVER', 'CANCELLED')),
  customer_id       UUID NOT NULL,
  customer_name     TEXT NOT NULL,
  customer_phone    TEXT CHECK (customer_phone ~ '^[0-9]{10,15}$'),
  dispatch_order_id UUID,
  invoice_number    TEXT,
  collector_name    TEXT,
  collector_phone   TEXT CHECK (collector_phone ~ '^[0-9]{10,15}$'),
  vehicle_number    TEXT,
  handed_over_at    TIMESTAMPTZ,
  handed_over_by    UUID,
  cancelled_at      TIMESTAMPTZ,
  cancelled_by      UUID,
  cancel_reason     TEXT,
  created_by        UUID NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'HANDED_OVER' OR (handed_over_at IS NOT NULL AND btrim(COALESCE(collector_name, '')) <> '' AND btrim(COALESCE(vehicle_number, '')) <> '')),
  CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND btrim(COALESCE(cancel_reason, '')) <> ''))
);
CREATE INDEX idx_tracking_pickups_scope ON tracking_pickups (company_id, warehouse_id, created_at DESC);
CREATE INDEX idx_tracking_pickups_sale ON tracking_pickups (dispatch_order_id) WHERE dispatch_order_id IS NOT NULL;

CREATE TABLE tracking_pickup_units (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_id        UUID NOT NULL REFERENCES tracking_pickups(id),
  tracking_unit_id UUID NOT NULL REFERENCES tracking_units(id),
  quantity         NUMERIC(15,3) NOT NULL CHECK (quantity > 0),
  sale_line_id     TEXT,
  mismatch_reason  TEXT,
  added_by         UUID NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at       TIMESTAMPTZ,
  removed_by       UUID,
  remove_reason    TEXT,
  returned_at      TIMESTAMPTZ,
  returned_by      UUID
);
-- A bundle can be on only one live pickup.
CREATE UNIQUE INDEX uq_tracking_pickup_units_live ON tracking_pickup_units (tracking_unit_id)
  WHERE removed_at IS NULL AND returned_at IS NULL;
CREATE INDEX idx_tracking_pickup_units_pickup ON tracking_pickup_units (pickup_id);

CREATE TABLE tracking_pickup_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_id   UUID NOT NULL REFERENCES tracking_pickups(id),
  event_type  TEXT NOT NULL CHECK (event_type IN (
                'PICKUP_CREATED', 'UNIT_ADDED', 'UNIT_REMOVED', 'MARKED_READY', 'WHATSAPP_OPENED',
                'HANDED_OVER', 'SALE_LINKED', 'SALE_UNLINKED', 'CANCELLED', 'UNIT_RETURNED')),
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id    UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tracking_pickup_events_pickup ON tracking_pickup_events (pickup_id, occurred_at);

-- ── GPS ─────────────────────────────────────────────────────────────────────
-- Kept apart from the permanent history so positions can be deleted after 90
-- days while the event itself stays.

CREATE TABLE tracking_event_positions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL UNIQUE REFERENCES tracking_events(id),
  latitude    NUMERIC(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude   NUMERIC(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m  NUMERIC(8,1) CHECK (accuracy_m >= 0),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tracking_event_positions_age ON tracking_event_positions (captured_at);

-- ── Changes to Phase 2 tables ───────────────────────────────────────────────

ALTER TABLE tracking_events DROP CONSTRAINT tracking_events_event_type_check;
ALTER TABLE tracking_events ADD CONSTRAINT tracking_events_event_type_check CHECK (event_type IN (
  'UNIT_CREATED', 'LABEL_PRINT_SENT', 'LABEL_PRINT_CONFIRMED', 'LABEL_PRINT_FAILED', 'SCAN_LOOKUP', 'UNIT_VOIDED',
  'PUT_AWAY', 'MOVED', 'STATUS_CHANGED', 'UNIT_SPLIT', 'ADDED_TO_PICKUP', 'REMOVED_FROM_PICKUP',
  'MARKED_READY', 'PICKED_UP', 'CUSTOMER_RETURN', 'STOCK_VERIFIED'));

ALTER TABLE tracking_feature_flags DROP CONSTRAINT tracking_feature_flags_feature_key_check;
ALTER TABLE tracking_feature_flags ADD CONSTRAINT tracking_feature_flags_feature_key_check
  CHECK (feature_key IN ('qr_tracking', 'gps_capture'));

ALTER TABLE tracking_label_templates
  ADD COLUMN template_kind TEXT NOT NULL DEFAULT 'BUNDLE' CHECK (template_kind IN ('BUNDLE', 'LOCATION'));

ALTER TABLE tracking_print_jobs ADD COLUMN location_id UUID REFERENCES tracking_locations(id);
ALTER TABLE tracking_print_jobs DROP CONSTRAINT tracking_print_jobs_job_type_check;
ALTER TABLE tracking_print_jobs ADD CONSTRAINT tracking_print_jobs_job_type_check
  CHECK (job_type IN ('TEST', 'ORIGINAL', 'REPRINT', 'LOCATION'));

DO $$
DECLARE
  v_name TEXT;
BEGIN
  SELECT conname INTO v_name
    FROM pg_constraint
   WHERE conrelid = 'tracking_print_jobs'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%''TEST''%tracking_unit_id IS NULL%';
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Could not find the print job target rule';
  END IF;
  EXECUTE format('ALTER TABLE tracking_print_jobs DROP CONSTRAINT %I', v_name);
END
$$;

ALTER TABLE tracking_print_jobs ADD CONSTRAINT tracking_print_jobs_target CHECK (
  (job_type IN ('TEST', 'LOCATION')) = (tracking_unit_id IS NULL)
  AND (job_type = 'LOCATION') = (location_id IS NOT NULL));

-- ── Permanent records ───────────────────────────────────────────────────────

CREATE TRIGGER trg_tracking_pickup_events_append_only
  BEFORE UPDATE OR DELETE ON tracking_pickup_events
  FOR EACH ROW
  WHEN (current_setting('warecore.restoring', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION fn_tracking_events_append_only();

CREATE TRIGGER trg_tracking_verifications_append_only
  BEFORE UPDATE OR DELETE ON tracking_verifications
  FOR EACH ROW
  WHEN (current_setting('warecore.restoring', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION fn_tracking_events_append_only();

CREATE OR REPLACE FUNCTION fn_tracking_no_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tracking records cannot be deleted';
END;
$$;

CREATE TRIGGER trg_tracking_locations_no_delete
  BEFORE DELETE ON tracking_locations
  FOR EACH ROW
  WHEN (current_setting('warecore.restoring', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION fn_tracking_no_delete();

CREATE TRIGGER trg_tracking_pickups_no_delete
  BEFORE DELETE ON tracking_pickups
  FOR EACH ROW
  WHEN (current_setting('warecore.restoring', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION fn_tracking_no_delete();

CREATE TRIGGER trg_tracking_pickup_units_no_delete
  BEFORE DELETE ON tracking_pickup_units
  FOR EACH ROW
  WHEN (current_setting('warecore.restoring', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION fn_tracking_no_delete();

-- ── Status rules ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_tracking_status_allowed(p_from TEXT, p_to TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_from, p_to) IN (
    ('LABELLED', 'IN_STOCK'),
    ('IN_STOCK', 'ON_PICKUP'), ('IN_STOCK', 'ON_HOLD'), ('IN_STOCK', 'MISSING'),
    ('IN_STOCK', 'LEFT_WAREHOUSE'), ('IN_STOCK', 'SPLIT'),
    ('ON_PICKUP', 'READY'), ('ON_PICKUP', 'IN_STOCK'), ('ON_PICKUP', 'SPLIT'),
    ('READY', 'PICKED_UP'), ('READY', 'IN_STOCK'),
    ('PICKED_UP', 'IN_STOCK'),
    ('ON_HOLD', 'IN_STOCK'),
    ('MISSING', 'IN_STOCK'),
    ('LEFT_WAREHOUSE', 'IN_STOCK')
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
    ELSE lower(p_status)
  END
$$;

CREATE OR REPLACE FUNCTION fn_tracking_unit_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A tracking unit cannot be deleted. Void it instead';
  END IF;
  IF (NEW.stock_tracking_id, NEW.qr_reference, NEW.qr_version, NEW.company_id, NEW.purchase_line_id,
      NEW.purchase_bill_id, NEW.quantity, NEW.unit, NEW.bundle_no, NEW.bundle_count, NEW.weight_basis,
      NEW.source_type, NEW.source_verification_id, NEW.parent_unit_id, NEW.part_no)
     IS DISTINCT FROM
     (OLD.stock_tracking_id, OLD.qr_reference, OLD.qr_version, OLD.company_id, OLD.purchase_line_id,
      OLD.purchase_bill_id, OLD.quantity, OLD.unit, OLD.bundle_no, OLD.bundle_count, OLD.weight_basis,
      OLD.source_type, OLD.source_verification_id, OLD.parent_unit_id, OLD.part_no) THEN
    RAISE EXCEPTION 'A tracking unit''s identity and weight cannot be changed. Void it and create a new one';
  END IF;
  IF OLD.status = 'VOIDED' AND NEW.status <> 'VOIDED' THEN
    RAISE EXCEPTION 'A voided tracking unit cannot be made active again';
  END IF;
  IF OLD.status = 'VOIDED' AND (NEW.lifecycle_status, NEW.current_location_id) IS DISTINCT FROM (OLD.lifecycle_status, OLD.current_location_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A voided label cannot change status or location';
  END IF;
  IF OLD.status = 'ACTIVE' AND NEW.status = 'VOIDED' AND OLD.lifecycle_status NOT IN ('LABELLED', 'IN_STOCK', 'ON_HOLD', 'MISSING') THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001',
      MESSAGE = format('A bundle cannot be voided while it is %s', fn_tracking_status_words(OLD.lifecycle_status));
  END IF;
  IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status
     AND NOT fn_tracking_status_allowed(OLD.lifecycle_status, NEW.lifecycle_status) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001',
      MESSAGE = format('A bundle that is %s cannot become %s', fn_tracking_status_words(OLD.lifecycle_status), fn_tracking_status_words(NEW.lifecycle_status));
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ── Shared helpers ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_tracking_gps_enabled(p_company_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT enabled FROM tracking_feature_flags
      WHERE company_id = p_company_id AND warehouse_id IS NULL AND feature_key = 'gps_capture'),
    false)
$$;

-- A purchase line counts as new only if it was both saved and dated on or after
-- tracking started. A late-entered old bill goes through physical verification.
CREATE OR REPLACE FUNCTION fn_tracking_line_is_new(p_created TIMESTAMPTZ, p_bill_date DATE, p_company_id UUID, p_warehouse_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    p_created >= x.started
    AND COALESCE(p_bill_date, (p_created AT TIME ZONE 'Asia/Kolkata')::date) >= (x.started AT TIME ZONE 'Asia/Kolkata')::date,
    false)
  FROM (SELECT fn_tracking_start_at(p_company_id, p_warehouse_id) AS started) x
$$;

-- Bad or missing coordinates are ignored: a position must never stop a scan.
CREATE OR REPLACE FUNCTION fn_tracking_record_event(
  p_unit_id UUID, p_event_type TEXT, p_details JSONB, p_actor UUID, p_company_id UUID, p_position JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_event_id UUID;
  v_lat TEXT := p_position ->> 'latitude';
  v_lng TEXT := p_position ->> 'longitude';
  v_acc TEXT := p_position ->> 'accuracy_m';
BEGIN
  INSERT INTO tracking_events (tracking_unit_id, event_type, details, actor_id)
  VALUES (p_unit_id, p_event_type, COALESCE(p_details, '{}'::jsonb), p_actor)
  RETURNING id INTO v_event_id;

  -- Nested so a value is only cast after its format has been checked.
  IF jsonb_typeof(p_position) = 'object' AND fn_tracking_gps_enabled(p_company_id)
     AND v_lat ~ '^-?[0-9]{1,2}(\.[0-9]+)?$' AND v_lng ~ '^-?[0-9]{1,3}(\.[0-9]+)?$' THEN
    IF v_lat::numeric BETWEEN -90 AND 90 AND v_lng::numeric BETWEEN -180 AND 180 THEN
      INSERT INTO tracking_event_positions (event_id, latitude, longitude, accuracy_m)
      VALUES (v_event_id, round(v_lat::numeric, 6), round(v_lng::numeric, 6),
              CASE WHEN v_acc ~ '^[0-9]{1,6}(\.[0-9]+)?$' THEN round(v_acc::numeric, 1) END);
    END IF;
  END IF;
  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION purge_tracking_positions(p_days INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM tracking_event_positions WHERE captured_at < now() - make_interval(days => p_days);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION fn_tracking_lock_active_unit(p_unit_id UUID)
RETURNS tracking_units
LANGUAGE plpgsql AS $$
DECLARE
  v_unit tracking_units;
BEGIN
  SELECT * INTO v_unit FROM tracking_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Tracking unit not found';
  END IF;
  IF v_unit.status <> 'ACTIVE' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This label was voided and cannot be used';
  END IF;
  IF NOT fn_tracking_is_enabled(v_unit.company_id, v_unit.warehouse_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'QR tracking is switched off for this warehouse';
  END IF;
  RETURN v_unit;
END;
$$;

-- FOR SHARE so a location can't be deactivated while a bundle is being placed there.
CREATE OR REPLACE FUNCTION fn_tracking_usable_location(p_location_id UUID, p_company_id UUID, p_warehouse_id UUID)
RETURNS tracking_locations
LANGUAGE plpgsql AS $$
DECLARE
  v_location tracking_locations;
BEGIN
  SELECT * INTO v_location FROM tracking_locations WHERE id = p_location_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Location not found';
  END IF;
  IF v_location.company_id <> p_company_id OR v_location.warehouse_id <> p_warehouse_id THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Location %s is in a different warehouse', v_location.code);
  END IF;
  IF NOT v_location.is_active THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Location %s is not active', v_location.code);
  END IF;
  RETURN v_location;
END;
$$;

CREATE OR REPLACE FUNCTION fn_tracking_lock_pickup(p_pickup_id UUID)
RETURNS tracking_pickups
LANGUAGE plpgsql AS $$
DECLARE
  v_pickup tracking_pickups;
BEGIN
  SELECT * INTO v_pickup FROM tracking_pickups WHERE id = p_pickup_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Pickup not found';
  END IF;
  IF NOT fn_tracking_is_enabled(v_pickup.company_id, v_pickup.warehouse_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'QR tracking is switched off for this warehouse';
  END IF;
  RETURN v_pickup;
END;
$$;

-- Taken after any line or unit lock, always in that order, so nothing can deadlock.
CREATE OR REPLACE FUNCTION fn_tracking_next_ids(p_count INTEGER)
RETURNS TEXT[]
LANGUAGE plpgsql AS $$
DECLARE
  v_prefix TEXT := 'ST' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'MMYY') || '-';
  v_seq    INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('tracking_id_allocation'));
  SELECT COALESCE(MAX(substring(stock_tracking_id FROM 8)::int), 0) INTO v_seq
    FROM tracking_units WHERE stock_tracking_id LIKE v_prefix || '%';
  RETURN ARRAY(SELECT v_prefix || lpad((v_seq + n)::text, 6, '0') FROM generate_series(1, p_count) AS n ORDER BY n);
END;
$$;

-- Checks a list of {"quantity":"1.500","weight_basis":"weighed"} and returns its total.
CREATE OR REPLACE FUNCTION fn_tracking_weights_total(p_rows JSONB)
RETURNS NUMERIC
LANGUAGE plpgsql AS $$
DECLARE
  v_row   JSONB;
  v_text  TEXT;
  v_total NUMERIC := 0;
BEGIN
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_text := v_row ->> 'quantity';
    IF v_text IS NULL OR v_text !~ '^[0-9]+(\.[0-9]{1,3})?$' OR v_text::numeric <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Each weight must be above zero, with up to 3 decimals';
    END IF;
    IF COALESCE(v_row ->> 'weight_basis', '') NOT IN ('weighed', 'estimated') THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Each weight must be marked weighed or estimated';
    END IF;
    v_total := v_total + v_text::numeric;
  END LOOP;
  RETURN v_total;
END;
$$;

-- ── Create units: a bill must now be dated on or after tracking started ─────

CREATE OR REPLACE FUNCTION create_tracking_units(p_purchase_line_id TEXT, p_bundles JSONB, p_actor UUID)
RETURNS SETOF tracking_units
LANGUAGE plpgsql AS $$
DECLARE
  v_line   RECORD;
  v_target NUMERIC;
  v_total  NUMERIC := 0;
  v_count  INT;
  v_prefix TEXT;
  v_seq    INT;
  v_no     INT := 0;
  v_b      JSONB;
  v_text   TEXT;
  v_qty    NUMERIC;
  v_basis  TEXT;
  v_unit   tracking_units;
  v_whole  BOOLEAN := p_bundles IS NULL OR jsonb_typeof(p_bundles) = 'null'
                      OR (jsonb_typeof(p_bundles) = 'array' AND jsonb_array_length(p_bundles) = 0);
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A signed-in user is required';
  END IF;
  IF NOT v_whole AND jsonb_typeof(p_bundles) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Bundles must be a list';
  END IF;

  -- Two people labelling the same line wait here; the second then finds the units.
  PERFORM pg_advisory_xact_lock(hashtext('tracking_line:' || COALESCE(p_purchase_line_id, '')));

  SELECT i.purchase_line_id, i.quantity, i.received_quantity, i.unit, i.item_master_id, i.item_name,
         i.material_type_id, i.material_size_id, i.size_label, i.created_at AS line_created_at,
         b.id AS bill_id, b.bill_number, b.bill_date, b.status AS bill_status, b.company_id, b.warehouse_id,
         im.item_code, im.item_name AS master_item_name
    INTO v_line
    FROM purchase_bill_items i
    JOIN purchase_bills b ON b.id = i.bill_id
    LEFT JOIN item_master im ON im.id = i.item_master_id
   WHERE i.purchase_line_id = p_purchase_line_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Purchase line %s was not found', p_purchase_line_id);
  END IF;
  IF v_line.bill_status <> 'active' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Purchase line %s is not on an active bill', p_purchase_line_id);
  END IF;
  IF v_line.company_id IS NULL OR v_line.warehouse_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'The bill needs a company and a warehouse first';
  END IF;
  IF NOT fn_tracking_is_enabled(v_line.company_id, v_line.warehouse_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'QR tracking is switched off for this warehouse';
  END IF;
  IF NOT fn_tracking_line_is_new(v_line.line_created_at, v_line.bill_date, v_line.company_id, v_line.warehouse_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Purchase line %s was added before QR tracking started here', p_purchase_line_id);
  END IF;
  IF EXISTS (SELECT 1 FROM tracking_units WHERE purchase_line_id = p_purchase_line_id AND status = 'ACTIVE') THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Purchase line %s already has labels', p_purchase_line_id);
  END IF;

  -- The same figure the PURCHASE_IN ledger row posts from.
  v_target := COALESCE(v_line.received_quantity, v_line.quantity);
  v_count  := CASE WHEN v_whole THEN 1 ELSE jsonb_array_length(p_bundles) END;

  IF v_count > 99 THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A purchase line can have at most 99 bundles';
  END IF;

  IF NOT v_whole THEN
    FOR v_b IN SELECT value FROM jsonb_array_elements(p_bundles) LOOP
      v_text := v_b ->> 'quantity';
      IF v_text IS NULL OR v_text !~ '^[0-9]+(\.[0-9]{1,3})?$' OR v_text::numeric <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Each bundle needs a weight above zero, with up to 3 decimals';
      END IF;
      IF COALESCE(v_b ->> 'weight_basis', '') NOT IN ('weighed', 'estimated') THEN
        RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Each bundle weight must be marked weighed or estimated';
      END IF;
      v_total := v_total + v_text::numeric;
    END LOOP;
    IF v_total <> v_target THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001',
        MESSAGE = format('Bundle weights total %s, but the purchase line is %s %s', v_total, v_target, v_line.unit);
    END IF;
  END IF;

  -- Taken after the line lock, always in that order, so two lines can't deadlock.
  PERFORM pg_advisory_xact_lock(hashtext('tracking_id_allocation'));
  v_prefix := 'ST' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'MMYY') || '-';
  SELECT COALESCE(MAX(substring(stock_tracking_id FROM 8)::int), 0) INTO v_seq
    FROM tracking_units WHERE stock_tracking_id LIKE v_prefix || '%';

  WHILE v_no < v_count LOOP
    v_no := v_no + 1;
    IF v_whole THEN
      v_qty := v_target;
      v_basis := 'whole_line';
    ELSE
      v_b := p_bundles -> (v_no - 1);
      v_qty := (v_b ->> 'quantity')::numeric;
      v_basis := v_b ->> 'weight_basis';
    END IF;

    INSERT INTO tracking_units (
      stock_tracking_id, qr_reference, company_id, warehouse_id, purchase_line_id, purchase_bill_id,
      bill_number, receipt_date, item_master_id, item_code, item_name, material_type_id, material_size_id,
      size_label, quantity, unit, bundle_no, bundle_count, weight_basis, created_by
    ) VALUES (
      v_prefix || lpad((v_seq + v_no)::text, 6, '0'), fn_tracking_new_qr_reference(),
      v_line.company_id, v_line.warehouse_id, v_line.purchase_line_id, v_line.bill_id,
      v_line.bill_number, v_line.bill_date, v_line.item_master_id, v_line.item_code,
      COALESCE(v_line.item_name, v_line.master_item_name), v_line.material_type_id, v_line.material_size_id,
      v_line.size_label, v_qty, v_line.unit, v_no, v_count, v_basis, p_actor
    ) RETURNING * INTO v_unit;

    INSERT INTO tracking_unit_origins (tracking_unit_id, purchase_line_id, quantity)
    VALUES (v_unit.id, v_line.purchase_line_id, v_qty);

    INSERT INTO tracking_events (tracking_unit_id, event_type, details, actor_id)
    VALUES (v_unit.id, 'UNIT_CREATED',
            jsonb_build_object('purchase_line_id', v_line.purchase_line_id, 'quantity', v_qty, 'weight_basis', v_basis),
            p_actor);

    RETURN NEXT v_unit;
  END LOOP;
END;
$$;

-- ── Labelling existing stock ────────────────────────────────────────────────
-- Records what was physically weighed beside the book balance. It reads the
-- ledger and never writes to it. A line can be verified in several batches, as
-- old stock is often found in more than one place.

CREATE OR REPLACE FUNCTION create_verified_tracking_units(
  p_purchase_line_id TEXT, p_company_id UUID, p_warehouse_id UUID, p_bundles JSONB, p_note TEXT, p_actor UUID
)
RETURNS SETOF tracking_units
LANGUAGE plpgsql AS $$
DECLARE
  v_line   RECORD;
  v_total  NUMERIC;
  v_count  INT;
  v_prev   INT;
  v_ids    TEXT[];
  v_no     INT := 0;
  v_b      JSONB;
  v_book   NUMERIC;
  v_as_of  DATE;
  v_check  tracking_verifications;
  v_unit   tracking_units;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A signed-in user is required';
  END IF;
  IF jsonb_typeof(p_bundles) <> 'array' OR jsonb_array_length(p_bundles) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Enter the weight of at least one bundle';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('tracking_line:' || COALESCE(p_purchase_line_id, '')));

  SELECT i.purchase_line_id, i.unit, i.item_master_id, i.item_name, i.material_type_id, i.material_size_id,
         i.size_label, i.created_at AS line_created_at, b.id AS bill_id, b.bill_number, b.bill_date,
         b.status AS bill_status, im.item_code, im.item_name AS master_item_name
    INTO v_line
    FROM purchase_bill_items i
    JOIN purchase_bills b ON b.id = i.bill_id
    LEFT JOIN item_master im ON im.id = i.item_master_id
   WHERE i.purchase_line_id = p_purchase_line_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Purchase line %s was not found', p_purchase_line_id);
  END IF;
  IF v_line.bill_status <> 'active' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Purchase line %s is not on an active bill', p_purchase_line_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM warehouses WHERE id = p_warehouse_id AND company_id = p_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'That warehouse does not belong to this company';
  END IF;
  IF NOT fn_tracking_is_enabled(p_company_id, p_warehouse_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'QR tracking is switched off for this warehouse';
  END IF;
  IF fn_tracking_line_is_new(v_line.line_created_at, v_line.bill_date, p_company_id, p_warehouse_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Purchase line %s is a new purchase. Label it from Receive & Label', p_purchase_line_id);
  END IF;

  v_total := fn_tracking_weights_total(p_bundles);
  v_count := jsonb_array_length(p_bundles);
  SELECT COALESCE(MAX(bundle_no), 0) INTO v_prev
    FROM tracking_units WHERE purchase_line_id = p_purchase_line_id AND status = 'ACTIVE' AND parent_unit_id IS NULL;
  IF v_prev + v_count > 99 THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A purchase line can have at most 99 bundles';
  END IF;

  SELECT COALESCE(SUM(quantity), 0), MAX(entry_date) INTO v_book, v_as_of
    FROM stock_ledger
   WHERE purchase_line_id = p_purchase_line_id AND company_id = p_company_id AND warehouse_id = p_warehouse_id;

  INSERT INTO tracking_verifications (company_id, warehouse_id, purchase_line_id, verified_quantity, book_quantity, book_as_of, note, verified_by)
  VALUES (p_company_id, p_warehouse_id, p_purchase_line_id, v_total, v_book, v_as_of, NULLIF(btrim(COALESCE(p_note, '')), ''), p_actor)
  RETURNING * INTO v_check;

  v_ids := fn_tracking_next_ids(v_count);

  WHILE v_no < v_count LOOP
    v_no := v_no + 1;
    v_b := p_bundles -> (v_no - 1);

    INSERT INTO tracking_units (
      stock_tracking_id, qr_reference, company_id, warehouse_id, purchase_line_id, purchase_bill_id,
      bill_number, receipt_date, item_master_id, item_code, item_name, material_type_id, material_size_id,
      size_label, quantity, unit, bundle_no, bundle_count, weight_basis, created_by, source_type, source_verification_id
    ) VALUES (
      v_ids[v_no], fn_tracking_new_qr_reference(),
      p_company_id, p_warehouse_id, v_line.purchase_line_id, v_line.bill_id,
      v_line.bill_number, v_line.bill_date, v_line.item_master_id, v_line.item_code,
      COALESCE(v_line.item_name, v_line.master_item_name), v_line.material_type_id, v_line.material_size_id,
      v_line.size_label, (v_b ->> 'quantity')::numeric, v_line.unit, v_prev + v_no, v_prev + v_count,
      v_b ->> 'weight_basis', p_actor, 'VERIFIED_EXISTING', v_check.id
    ) RETURNING * INTO v_unit;

    INSERT INTO tracking_unit_origins (tracking_unit_id, purchase_line_id, quantity)
    VALUES (v_unit.id, v_line.purchase_line_id, v_unit.quantity);

    PERFORM fn_tracking_record_event(v_unit.id, 'UNIT_CREATED',
      jsonb_build_object('purchase_line_id', v_line.purchase_line_id, 'quantity', v_unit.quantity, 'weight_basis', v_unit.weight_basis),
      p_actor, p_company_id);
    PERFORM fn_tracking_record_event(v_unit.id, 'STOCK_VERIFIED',
      jsonb_build_object('verification_id', v_check.id, 'verified_quantity', v_total, 'book_quantity', v_book, 'book_as_of', v_as_of),
      p_actor, p_company_id);

    RETURN NEXT v_unit;
  END LOOP;
END;
$$;

-- ── Put away and move ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION place_tracking_unit(p_unit_id UUID, p_location_id UUID, p_position JSONB, p_actor UUID)
RETURNS tracking_units
LANGUAGE plpgsql AS $$
DECLARE
  v_unit     tracking_units;
  v_location tracking_locations;
  v_from     UUID;
BEGIN
  v_unit := fn_tracking_lock_active_unit(p_unit_id);
  v_location := fn_tracking_usable_location(p_location_id, v_unit.company_id, v_unit.warehouse_id);
  v_from := v_unit.current_location_id;

  IF v_unit.lifecycle_status NOT IN ('LABELLED', 'IN_STOCK', 'ON_HOLD') THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001',
      MESSAGE = format('A bundle that is %s cannot be moved', fn_tracking_status_words(v_unit.lifecycle_status));
  END IF;
  IF v_from = v_location.id THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('This bundle is already at %s', v_location.code);
  END IF;

  UPDATE tracking_units
     SET current_location_id = v_location.id,
         lifecycle_status = CASE WHEN lifecycle_status = 'LABELLED' THEN 'IN_STOCK' ELSE lifecycle_status END
   WHERE id = p_unit_id
   RETURNING * INTO v_unit;

  PERFORM fn_tracking_record_event(p_unit_id, CASE WHEN v_from IS NULL THEN 'PUT_AWAY' ELSE 'MOVED' END,
    jsonb_build_object('from_location_id', v_from, 'to_location_id', v_location.id, 'to_location', v_location.code),
    p_actor, v_unit.company_id, p_position);

  RETURN v_unit;
END;
$$;

-- ── Hold, missing, left warehouse and customer return ───────────────────────

CREATE OR REPLACE FUNCTION set_tracking_unit_status(
  p_unit_id UUID, p_to TEXT, p_location_id UUID, p_reason TEXT, p_position JSONB, p_actor UUID
)
RETURNS tracking_units
LANGUAGE plpgsql AS $$
DECLARE
  v_unit     tracking_units;
  v_from     TEXT;
  v_reason   TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_location tracking_locations;
  v_target   UUID;
  v_line     tracking_pickup_units;
BEGIN
  v_unit := fn_tracking_lock_active_unit(p_unit_id);
  v_from := v_unit.lifecycle_status;

  IF (v_from, p_to) NOT IN (
    ('IN_STOCK', 'ON_HOLD'), ('IN_STOCK', 'MISSING'), ('IN_STOCK', 'LEFT_WAREHOUSE'),
    ('ON_HOLD', 'IN_STOCK'), ('MISSING', 'IN_STOCK'), ('LEFT_WAREHOUSE', 'IN_STOCK'), ('PICKED_UP', 'IN_STOCK')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001',
      MESSAGE = format('A bundle that is %s cannot become %s here', fn_tracking_status_words(v_from), fn_tracking_status_words(p_to));
  END IF;
  IF v_reason IS NULL AND (p_to IN ('ON_HOLD', 'MISSING', 'LEFT_WAREHOUSE') OR v_from = 'PICKED_UP') THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A reason is required';
  END IF;
  IF p_location_id IS NULL AND v_from IN ('MISSING', 'LEFT_WAREHOUSE', 'PICKED_UP') THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Scan the location this bundle is going to';
  END IF;

  IF p_location_id IS NOT NULL THEN
    v_location := fn_tracking_usable_location(p_location_id, v_unit.company_id, v_unit.warehouse_id);
  END IF;
  v_target := CASE WHEN p_to IN ('MISSING', 'LEFT_WAREHOUSE') THEN NULL
                   ELSE COALESCE(v_location.id, v_unit.current_location_id) END;

  UPDATE tracking_units
     SET lifecycle_status = p_to,
         current_location_id = v_target,
         status_reason = CASE WHEN p_to = 'IN_STOCK' THEN NULL ELSE v_reason END
   WHERE id = p_unit_id
   RETURNING * INTO v_unit;

  IF v_from = 'PICKED_UP' THEN
    UPDATE tracking_pickup_units
       SET returned_at = now(), returned_by = p_actor
     WHERE tracking_unit_id = p_unit_id AND removed_at IS NULL AND returned_at IS NULL
     RETURNING * INTO v_line;
    IF FOUND THEN
      INSERT INTO tracking_pickup_events (pickup_id, event_type, details, actor_id)
      VALUES (v_line.pickup_id, 'UNIT_RETURNED', jsonb_build_object('tracking_unit_id', p_unit_id, 'reason', v_reason), p_actor);
    END IF;
  END IF;

  PERFORM fn_tracking_record_event(p_unit_id, CASE WHEN v_from = 'PICKED_UP' THEN 'CUSTOMER_RETURN' ELSE 'STATUS_CHANGED' END,
    jsonb_build_object('from', v_from, 'to', p_to, 'reason', v_reason, 'to_location_id', v_target),
    p_actor, v_unit.company_id, p_position);

  RETURN v_unit;
END;
$$;

-- ── Split ───────────────────────────────────────────────────────────────────
-- The original stays on record as Split. Each part gets its own label and
-- starts In stock where the original was; the part being taken is then scanned
-- onto the pickup. p_parts = [{"quantity":"1.200","weight_basis":"weighed"}, ...]

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
  v_place  UUID;
  v_line   tracking_pickup_units;
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A reason is required to split a bundle';
  END IF;
  IF jsonb_typeof(p_parts) <> 'array' OR jsonb_array_length(p_parts) NOT BETWEEN 2 AND 20 THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A bundle splits into 2 to 20 parts';
  END IF;

  v_unit := fn_tracking_lock_active_unit(p_unit_id);
  IF v_unit.lifecycle_status NOT IN ('IN_STOCK', 'ON_PICKUP') THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001',
      MESSAGE = format('A bundle that is %s cannot be split', fn_tracking_status_words(v_unit.lifecycle_status));
  END IF;

  v_total := fn_tracking_weights_total(p_parts);
  IF v_total <> v_unit.quantity THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001',
      MESSAGE = format('Part weights total %s, but the bundle is %s %s', v_total, v_unit.quantity, v_unit.unit);
  END IF;

  v_count := jsonb_array_length(p_parts);
  v_place := v_unit.current_location_id;

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

  UPDATE tracking_units
     SET lifecycle_status = 'SPLIT', current_location_id = NULL, status_reason = v_reason
   WHERE id = p_unit_id;

  v_ids := fn_tracking_next_ids(v_count);

  WHILE v_no < v_count LOOP
    v_no := v_no + 1;
    v_b := p_parts -> (v_no - 1);

    INSERT INTO tracking_units (
      stock_tracking_id, qr_reference, company_id, warehouse_id, purchase_line_id, purchase_bill_id,
      bill_number, receipt_date, item_master_id, item_code, item_name, material_type_id, material_size_id,
      size_label, quantity, unit, bundle_no, bundle_count, weight_basis, created_by,
      lifecycle_status, current_location_id, source_type, source_verification_id, parent_unit_id, part_no
    ) VALUES (
      v_ids[v_no], fn_tracking_new_qr_reference(),
      v_unit.company_id, v_unit.warehouse_id, v_unit.purchase_line_id, v_unit.purchase_bill_id,
      v_unit.bill_number, v_unit.receipt_date, v_unit.item_master_id, v_unit.item_code, v_unit.item_name,
      v_unit.material_type_id, v_unit.material_size_id, v_unit.size_label, (v_b ->> 'quantity')::numeric, v_unit.unit,
      v_unit.bundle_no, v_unit.bundle_count, v_b ->> 'weight_basis', p_actor,
      'IN_STOCK', v_place, 'SPLIT_PART', v_unit.source_verification_id, v_unit.id, v_no
    ) RETURNING * INTO v_part;

    INSERT INTO tracking_unit_origins (tracking_unit_id, purchase_line_id, quantity)
    VALUES (v_part.id, v_part.purchase_line_id, v_part.quantity);

    PERFORM fn_tracking_record_event(v_part.id, 'UNIT_CREATED',
      jsonb_build_object('parent_unit_id', v_unit.id, 'parent_tracking_id', v_unit.stock_tracking_id,
                         'part_no', v_no, 'quantity', v_part.quantity, 'weight_basis', v_part.weight_basis),
      p_actor, v_unit.company_id);

    RETURN NEXT v_part;
  END LOOP;

  PERFORM fn_tracking_record_event(p_unit_id, 'UNIT_SPLIT',
    jsonb_build_object('parts', v_count, 'reason', v_reason), p_actor, v_unit.company_id);
END;
$$;

-- ── Pickups ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_tracking_pickup(p_company_id UUID, p_warehouse_id UUID, p_customer_id UUID, p_actor UUID)
RETURNS tracking_pickups
LANGUAGE plpgsql AS $$
DECLARE
  v_name   TEXT;
  v_prefix TEXT := 'PU' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'MMYY') || '-';
  v_seq    INT;
  v_pickup tracking_pickups;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM warehouses WHERE id = p_warehouse_id AND company_id = p_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'That warehouse does not belong to this company';
  END IF;
  IF NOT fn_tracking_is_enabled(p_company_id, p_warehouse_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'QR tracking is switched off for this warehouse';
  END IF;
  SELECT name INTO v_name FROM customers WHERE id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Customer not found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('tracking_pickup_no'));
  SELECT COALESCE(MAX(substring(pickup_no FROM 8)::int), 0) INTO v_seq
    FROM tracking_pickups WHERE pickup_no LIKE v_prefix || '%';

  INSERT INTO tracking_pickups (pickup_no, company_id, warehouse_id, customer_id, customer_name, created_by)
  VALUES (v_prefix || lpad((v_seq + 1)::text, 4, '0'), p_company_id, p_warehouse_id, p_customer_id, v_name, p_actor)
  RETURNING * INTO v_pickup;

  INSERT INTO tracking_pickup_events (pickup_id, event_type, details, actor_id)
  VALUES (v_pickup.id, 'PICKUP_CREATED', jsonb_build_object('customer_id', p_customer_id, 'customer_name', v_name), p_actor);

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
BEGIN
  v_pickup := fn_tracking_lock_pickup(p_pickup_id);
  IF v_pickup.status <> 'OPEN' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Bundles can only be added while a pickup is open';
  END IF;

  v_unit := fn_tracking_lock_active_unit(p_unit_id);
  IF v_unit.company_id <> v_pickup.company_id OR v_unit.warehouse_id <> v_pickup.warehouse_id THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This bundle is in a different warehouse';
  END IF;
  IF v_unit.lifecycle_status <> 'IN_STOCK' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001',
      MESSAGE = format('Bundle %s is %s, so it cannot be added', v_unit.stock_tracking_id, fn_tracking_status_words(v_unit.lifecycle_status));
  END IF;

  IF v_pickup.dispatch_order_id IS NOT NULL THEN
    SELECT d.sale_line_id INTO v_sale
      FROM dispatch_items d
     WHERE d.dispatch_order_id = v_pickup.dispatch_order_id
       AND (d.purchase_line_id = v_unit.purchase_line_id
            OR (d.purchase_line_id IS NULL AND d.item_master_id = v_unit.item_master_id))
     ORDER BY (d.purchase_line_id = v_unit.purchase_line_id) DESC NULLS LAST
     LIMIT 1;
    v_match := FOUND;
    IF NOT v_match AND v_reason IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'WC003',
        MESSAGE = format('Bundle %s does not match the linked sale. Give a reason to add it anyway', v_unit.stock_tracking_id);
    END IF;
  END IF;

  UPDATE tracking_units SET lifecycle_status = 'ON_PICKUP' WHERE id = p_unit_id RETURNING * INTO v_unit;

  INSERT INTO tracking_pickup_units (pickup_id, tracking_unit_id, quantity, sale_line_id, mismatch_reason, added_by)
  VALUES (p_pickup_id, p_unit_id, v_unit.quantity, v_sale, CASE WHEN v_match THEN NULL ELSE v_reason END, p_actor)
  RETURNING * INTO v_line;

  INSERT INTO tracking_pickup_events (pickup_id, event_type, details, actor_id)
  VALUES (p_pickup_id, 'UNIT_ADDED',
          jsonb_build_object('tracking_unit_id', p_unit_id, 'tracking_id', v_unit.stock_tracking_id, 'quantity', v_unit.quantity,
                             'mismatch_reason', CASE WHEN v_match THEN NULL ELSE v_reason END),
          p_actor);
  PERFORM fn_tracking_record_event(p_unit_id, 'ADDED_TO_PICKUP',
    jsonb_build_object('pickup_id', p_pickup_id, 'pickup_no', v_pickup.pickup_no), p_actor, v_unit.company_id);

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

  UPDATE tracking_units SET lifecycle_status = 'IN_STOCK' WHERE id = p_unit_id;

  INSERT INTO tracking_pickup_events (pickup_id, event_type, details, actor_id)
  VALUES (p_pickup_id, 'UNIT_REMOVED', jsonb_build_object('tracking_unit_id', p_unit_id, 'tracking_id', v_unit.stock_tracking_id, 'reason', v_reason), p_actor);
  PERFORM fn_tracking_record_event(p_unit_id, 'REMOVED_FROM_PICKUP',
    jsonb_build_object('pickup_id', p_pickup_id, 'pickup_no', v_pickup.pickup_no, 'reason', v_reason), p_actor, v_unit.company_id);

  -- An emptied ready pickup goes back to open so bundles can be scanned again.
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
  IF v_pickup.status <> 'READY' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Mark the pickup ready before handing it over';
  END IF;

  FOR v_unit IN
    SELECT u.* FROM tracking_units u
      JOIN tracking_pickup_units l ON l.tracking_unit_id = u.id
     WHERE l.pickup_id = p_pickup_id AND l.removed_at IS NULL AND l.returned_at IS NULL
     ORDER BY u.id FOR UPDATE OF u
  LOOP
    v_count := v_count + 1;
    UPDATE tracking_units SET lifecycle_status = 'PICKED_UP', current_location_id = NULL WHERE id = v_unit.id;
    PERFORM fn_tracking_record_event(v_unit.id, 'PICKED_UP',
      jsonb_build_object('pickup_id', p_pickup_id, 'pickup_no', v_pickup.pickup_no, 'collector', v_name, 'vehicle', v_vehicle),
      p_actor, v_unit.company_id, p_position);
  END LOOP;

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
    UPDATE tracking_units SET lifecycle_status = 'IN_STOCK' WHERE id = v_unit.id;
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

  SELECT id, status, company_id, warehouse_id, customer_id, invoice_number INTO v_sale
    FROM dispatch_orders WHERE id = p_dispatch_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Sale not found';
  END IF;
  IF v_sale.status <> 'active' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Sale %s is %s', v_sale.invoice_number, v_sale.status);
  END IF;
  IF v_sale.company_id <> v_pickup.company_id OR v_sale.warehouse_id <> v_pickup.warehouse_id THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This sale belongs to a different company or warehouse';
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
               OR (d.purchase_line_id IS NULL AND d.item_master_id = u.item_master_id))
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

-- Records that WhatsApp was opened. WareCore cannot know whether the message was sent.
CREATE OR REPLACE FUNCTION record_tracking_pickup_share(p_pickup_id UUID, p_phone TEXT, p_actor UUID)
RETURNS tracking_pickups
LANGUAGE plpgsql AS $$
DECLARE
  v_pickup tracking_pickups;
BEGIN
  IF COALESCE(p_phone, '') !~ '^[0-9]{10,15}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Enter a valid WhatsApp number';
  END IF;
  v_pickup := fn_tracking_lock_pickup(p_pickup_id);
  IF v_pickup.status = 'CANCELLED' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A cancelled pickup cannot be shared';
  END IF;

  UPDATE tracking_pickups SET customer_phone = p_phone, updated_at = now() WHERE id = p_pickup_id RETURNING * INTO v_pickup;
  INSERT INTO tracking_pickup_events (pickup_id, event_type, details, actor_id)
  VALUES (p_pickup_id, 'WHATSAPP_OPENED', jsonb_build_object('phone', p_phone), p_actor);

  RETURN v_pickup;
END;
$$;

-- ── Locations ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_tracking_location_active(p_location_id UUID, p_active BOOLEAN)
RETURNS tracking_locations
LANGUAGE plpgsql AS $$
DECLARE
  v_location tracking_locations;
BEGIN
  SELECT * INTO v_location FROM tracking_locations WHERE id = p_location_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Location not found';
  END IF;
  IF NOT p_active AND EXISTS (SELECT 1 FROM tracking_units WHERE current_location_id = p_location_id AND status = 'ACTIVE') THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Location %s still holds bundles. Move them first', v_location.code);
  END IF;
  UPDATE tracking_locations SET is_active = p_active, updated_at = now() WHERE id = p_location_id RETURNING * INTO v_location;
  RETURN v_location;
END;
$$;

CREATE OR REPLACE FUNCTION request_tracking_location_print(p_location_id UUID, p_printer_id UUID, p_template_id UUID, p_actor UUID)
RETURNS tracking_print_jobs
LANGUAGE plpgsql AS $$
DECLARE
  v_location tracking_locations;
  v_printer  tracking_printers;
  v_job      tracking_print_jobs;
BEGIN
  SELECT * INTO v_location FROM tracking_locations WHERE id = p_location_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Location not found';
  END IF;
  SELECT * INTO v_printer FROM tracking_printers WHERE id = p_printer_id;
  IF NOT FOUND OR NOT v_printer.is_active THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Choose an active printer';
  END IF;
  IF v_printer.company_id <> v_location.company_id OR v_printer.warehouse_id <> v_location.warehouse_id THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This printer belongs to a different warehouse';
  END IF;

  INSERT INTO tracking_print_jobs (job_type, location_id, printer_id, template_id, requested_by)
  VALUES ('LOCATION', p_location_id, p_printer_id, p_template_id, p_actor)
  RETURNING * INTO v_job;
  RETURN v_job;
END;
$$;

-- ── Printing: a split original must never be relabelled ─────────────────────

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

-- ── Default location label: 100 x 50 mm at 203 dpi ──────────────────────────

INSERT INTO tracking_label_templates (name, version, width_mm, height_mm, dpi, template_kind, zpl_body)
VALUES ('Standard location label', 1, 100, 50, 203, 'LOCATION', $zpl$^XA
^CI28
^PW{{LABEL_WIDTH}}
^LL{{LABEL_HEIGHT}}
^LH0,0
^FO[[24]],[[40]]^BQN,2,[[10]]^FDQA,{{QR}}^FS
^FO[[320]],[[60]]^A0N,[[96]],[[96]]^FB[[460]],1,0,L^FH\^FD{{CODE}}^FS
^FO[[320]],[[180]]^A0N,[[34]],[[34]]^FB[[460]],2,0,L^FH\^FD{{NAME}}^FS
^FO[[320]],[[290]]^A0N,[[28]],[[28]]^FB[[460]],2,0,L^FH\^FD{{WAREHOUSE}}^FS
^PQ1
^XZ$zpl$);
