-- ============================================================
-- Migration 178: QR stock tracking core (Phase 2)
-- ============================================================
-- Adds a physical identity for each purchased bundle, label print records and
-- a per-company / per-warehouse switch.
--
-- This migration only ADDS objects. It alters no existing table and puts no
-- trigger on any purchase, job work, sale, transfer or ledger table, and
-- nothing here writes to stock_ledger. The new tables deliberately have no
-- foreign keys into existing tables, so they can never block a bill edit,
-- cancellation, purge, warehouse merge or backup restore. A unit points at its
-- purchase by the text purchase_line_id, because editing a bill can delete a
-- purchase_bill_items row and insert a replacement.
-- ============================================================

CREATE TABLE tracking_feature_flags (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL,
  warehouse_id      UUID,                 -- NULL = the whole company
  feature_key       TEXT NOT NULL DEFAULT 'qr_tracking' CHECK (feature_key IN ('qr_tracking')),
  enabled           BOOLEAN NOT NULL DEFAULT false,
  tracking_start_at TIMESTAMPTZ,          -- only purchase lines added after this can be labelled
  changed_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_tracking_feature_flags_scope ON tracking_feature_flags
  (company_id, COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid), feature_key);

CREATE TABLE tracking_printers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL,
  warehouse_id    UUID NOT NULL,
  name            TEXT NOT NULL CHECK (btrim(name) <> ''),
  model           TEXT NOT NULL DEFAULT 'Zebra ZPL printer',
  dpi             INTEGER NOT NULL DEFAULT 203 CHECK (dpi IN (203, 300, 600)),
  label_width_mm  NUMERIC(6,2) NOT NULL DEFAULT 100 CHECK (label_width_mm > 0),
  label_height_mm NUMERIC(6,2) NOT NULL DEFAULT 50 CHECK (label_height_mm > 0),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tracking_printers_scope ON tracking_printers (company_id, warehouse_id);

CREATE TABLE tracking_label_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL CHECK (btrim(name) <> ''),
  version    INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  width_mm   NUMERIC(6,2) NOT NULL CHECK (width_mm > 0),
  height_mm  NUMERIC(6,2) NOT NULL CHECK (height_mm > 0),
  dpi        INTEGER NOT NULL CHECK (dpi IN (203, 300, 600)),
  zpl_body   TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

CREATE TABLE tracking_units (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_tracking_id TEXT NOT NULL UNIQUE CHECK (stock_tracking_id ~ '^ST[0-9]{4}-[0-9]{6}$'),
  qr_reference      TEXT NOT NULL UNIQUE CHECK (qr_reference ~ '^WC[0-9]+-[0-9A-HJKMNP-TV-Z]{16}$'),
  qr_version        SMALLINT NOT NULL DEFAULT 1,
  company_id        UUID NOT NULL,
  warehouse_id      UUID NOT NULL,
  purchase_line_id  TEXT NOT NULL,
  purchase_bill_id  UUID NOT NULL,
  bill_number       TEXT,
  receipt_date      DATE,
  item_master_id    UUID,
  item_code         TEXT,
  item_name         TEXT,
  material_type_id  UUID,
  material_size_id  UUID,
  size_label        TEXT,
  quantity          NUMERIC(15,3) NOT NULL CHECK (quantity > 0),
  unit              TEXT NOT NULL,
  bundle_no         INTEGER NOT NULL CHECK (bundle_no >= 1),
  bundle_count      INTEGER NOT NULL CHECK (bundle_count BETWEEN 1 AND 99),
  weight_basis      TEXT NOT NULL CHECK (weight_basis IN ('whole_line', 'weighed', 'estimated')),
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'VOIDED')),
  voided_at         TIMESTAMPTZ,
  voided_by         UUID,
  void_reason       TEXT,
  created_by        UUID NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (bundle_no <= bundle_count),
  CHECK ((status = 'VOIDED') = (voided_at IS NOT NULL)),
  CHECK (status <> 'VOIDED' OR btrim(COALESCE(void_reason, '')) <> '')
);
CREATE UNIQUE INDEX uq_tracking_units_active_bundle ON tracking_units (purchase_line_id, bundle_no) WHERE status = 'ACTIVE';
CREATE INDEX idx_tracking_units_scope ON tracking_units (company_id, warehouse_id, created_at DESC);
CREATE INDEX idx_tracking_units_line ON tracking_units (purchase_line_id);

CREATE TABLE tracking_unit_origins (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_unit_id UUID NOT NULL REFERENCES tracking_units(id),
  purchase_line_id TEXT NOT NULL,
  quantity         NUMERIC(15,3) NOT NULL CHECK (quantity > 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tracking_unit_id, purchase_line_id)
);

CREATE TABLE tracking_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_unit_id UUID NOT NULL REFERENCES tracking_units(id),
  event_type       TEXT NOT NULL CHECK (event_type IN (
                     'UNIT_CREATED', 'LABEL_PRINT_SENT', 'LABEL_PRINT_CONFIRMED',
                     'LABEL_PRINT_FAILED', 'SCAN_LOOKUP', 'UNIT_VOIDED')),
  details          JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id         UUID NOT NULL,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tracking_events_unit ON tracking_events (tracking_unit_id, occurred_at);

CREATE TABLE tracking_print_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type         TEXT NOT NULL CHECK (job_type IN ('TEST', 'ORIGINAL', 'REPRINT')),
  tracking_unit_id UUID REFERENCES tracking_units(id),
  printer_id       UUID NOT NULL REFERENCES tracking_printers(id),
  template_id      UUID NOT NULL REFERENCES tracking_label_templates(id),
  copies           INTEGER NOT NULL DEFAULT 1 CHECK (copies = 1),
  status           TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'sent', 'confirmed', 'failed')),
  reason           TEXT,
  requested_by     UUID NOT NULL,
  confirmed_by     UUID,
  confirmed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((job_type = 'TEST') = (tracking_unit_id IS NULL)),
  CHECK (job_type <> 'REPRINT' OR btrim(COALESCE(reason, '')) <> '')
);
CREATE INDEX idx_tracking_print_jobs_unit ON tracking_print_jobs (tracking_unit_id, created_at);

-- ── Permanent records ───────────────────────────────────────────────────────
-- A backup restore sets warecore.restoring, and its TRUNCATE fires no row
-- trigger, so a restore can still put these rows back exactly.

CREATE OR REPLACE FUNCTION fn_tracking_events_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tracking history is permanent and cannot be changed or deleted';
END;
$$;

CREATE TRIGGER trg_tracking_events_append_only
  BEFORE UPDATE OR DELETE ON tracking_events
  FOR EACH ROW
  WHEN (current_setting('warecore.restoring', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION fn_tracking_events_append_only();

CREATE OR REPLACE FUNCTION fn_tracking_unit_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A tracking unit cannot be deleted. Void it instead';
  END IF;
  IF (NEW.stock_tracking_id, NEW.qr_reference, NEW.qr_version, NEW.company_id, NEW.purchase_line_id,
      NEW.purchase_bill_id, NEW.quantity, NEW.unit, NEW.bundle_no, NEW.bundle_count, NEW.weight_basis)
     IS DISTINCT FROM
     (OLD.stock_tracking_id, OLD.qr_reference, OLD.qr_version, OLD.company_id, OLD.purchase_line_id,
      OLD.purchase_bill_id, OLD.quantity, OLD.unit, OLD.bundle_no, OLD.bundle_count, OLD.weight_basis) THEN
    RAISE EXCEPTION 'A tracking unit''s identity and weight cannot be changed. Void it and create a new one';
  END IF;
  IF OLD.status = 'VOIDED' AND NEW.status <> 'VOIDED' THEN
    RAISE EXCEPTION 'A voided tracking unit cannot be made active again';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tracking_unit_guard
  BEFORE UPDATE OR DELETE ON tracking_units
  FOR EACH ROW
  WHEN (current_setting('warecore.restoring', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION fn_tracking_unit_guard();

-- ── Switch ──────────────────────────────────────────────────────────────────
-- A warehouse row overrides its company row. No row means off.

CREATE OR REPLACE FUNCTION fn_tracking_is_enabled(p_company_id UUID, p_warehouse_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT enabled FROM tracking_feature_flags
      WHERE company_id = p_company_id AND warehouse_id = p_warehouse_id AND feature_key = 'qr_tracking'),
    (SELECT enabled FROM tracking_feature_flags
      WHERE company_id = p_company_id AND warehouse_id IS NULL AND feature_key = 'qr_tracking'),
    false)
$$;

CREATE OR REPLACE FUNCTION fn_tracking_start_at(p_company_id UUID, p_warehouse_id UUID)
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT tracking_start_at FROM tracking_feature_flags
      WHERE company_id = p_company_id AND warehouse_id = p_warehouse_id AND feature_key = 'qr_tracking'),
    (SELECT tracking_start_at FROM tracking_feature_flags
      WHERE company_id = p_company_id AND warehouse_id IS NULL AND feature_key = 'qr_tracking'))
$$;

-- ── Identifiers ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_tracking_new_qr_reference()
RETURNS TEXT LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  -- Crockford base 32: no I, L, O or U, so a typed code can't be misread.
  v_alphabet CONSTANT TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  -- Bytes 6 and 8 of a v4 UUID carry fixed version bits, so they are skipped.
  v_a BYTEA := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  v_b BYTEA := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  v_out TEXT := 'WC1-';
  v_i INT;
BEGIN
  FOREACH v_i IN ARRAY ARRAY[0, 1, 2, 3, 4, 5, 10, 11] LOOP
    v_out := v_out || substr(v_alphabet, (get_byte(v_a, v_i) % 32) + 1, 1)
                   || substr(v_alphabet, (get_byte(v_b, v_i) % 32) + 1, 1);
  END LOOP;
  RETURN v_out;
END;
$$;

-- ── Create units ────────────────────────────────────────────────────────────
-- All or nothing. p_bundles NULL or [] = one unit for the whole line, otherwise
-- [{"quantity":"3.333","weight_basis":"estimated"}, ...]. Reads purchase data
-- and writes to tracking tables only.

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
  IF v_line.line_created_at < COALESCE(fn_tracking_start_at(v_line.company_id, v_line.warehouse_id), 'infinity'::timestamptz) THEN
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

-- ── Void ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION void_tracking_unit(p_unit_id UUID, p_reason TEXT, p_actor UUID)
RETURNS tracking_units
LANGUAGE plpgsql AS $$
DECLARE
  v_unit tracking_units;
BEGIN
  IF btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A reason is required to void a label';
  END IF;
  SELECT * INTO v_unit FROM tracking_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Tracking unit not found';
  END IF;
  IF v_unit.status = 'VOIDED' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This label is already voided';
  END IF;

  UPDATE tracking_units
     SET status = 'VOIDED', voided_at = now(), voided_by = p_actor, void_reason = btrim(p_reason)
   WHERE id = p_unit_id
   RETURNING * INTO v_unit;

  INSERT INTO tracking_events (tracking_unit_id, event_type, details, actor_id)
  VALUES (p_unit_id, 'UNIT_VOIDED', jsonb_build_object('reason', btrim(p_reason)), p_actor);

  RETURN v_unit;
END;
$$;

-- ── Print records ───────────────────────────────────────────────────────────
-- Printing only ever writes tracking_print_jobs and tracking_events.

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

CREATE OR REPLACE FUNCTION set_tracking_print_status(p_job_id UUID, p_status TEXT, p_actor UUID)
RETURNS tracking_print_jobs
LANGUAGE plpgsql AS $$
DECLARE
  v_job tracking_print_jobs;
BEGIN
  SELECT * INTO v_job FROM tracking_print_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Print job not found';
  END IF;
  IF NOT (
    (v_job.status = 'requested' AND p_status IN ('sent', 'confirmed', 'failed')) OR
    (v_job.status = 'sent' AND p_status IN ('confirmed', 'failed'))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('A %s print job cannot be marked %s', v_job.status, p_status);
  END IF;

  UPDATE tracking_print_jobs
     SET status = p_status,
         confirmed_by = CASE WHEN p_status = 'confirmed' THEN p_actor ELSE confirmed_by END,
         confirmed_at = CASE WHEN p_status = 'confirmed' THEN now() ELSE confirmed_at END,
         updated_at = now()
   WHERE id = p_job_id
   RETURNING * INTO v_job;

  IF v_job.tracking_unit_id IS NOT NULL THEN
    INSERT INTO tracking_events (tracking_unit_id, event_type, details, actor_id)
    VALUES (v_job.tracking_unit_id,
            CASE p_status WHEN 'sent' THEN 'LABEL_PRINT_SENT' WHEN 'confirmed' THEN 'LABEL_PRINT_CONFIRMED' ELSE 'LABEL_PRINT_FAILED' END,
            jsonb_build_object('print_job_id', v_job.id, 'job_type', v_job.job_type, 'reason', v_job.reason),
            p_actor);
  END IF;

  RETURN v_job;
END;
$$;

-- ── Default label: 100 x 50 mm at 203 dpi ───────────────────────────────────
-- [[n]] is a size in dots at this template's dpi, scaled for the printer.
-- {{NAME}} is a label field, escaped when the label is built.

INSERT INTO tracking_label_templates (name, version, width_mm, height_mm, dpi, zpl_body)
VALUES ('Standard bundle label', 1, 100, 50, 203, $zpl$^XA
^CI28
^PW{{LABEL_WIDTH}}
^LL{{LABEL_HEIGHT}}
^LH0,0
^FO[[24]],[[16]]^BQN,2,[[8]]^FDQA,{{QR}}^FS
^FO[[250]],[[24]]^A0N,[[38]],[[38]]^FB[[530]],1,0,L^FH\^FD{{ITEM_CODE}}^FS
^FO[[250]],[[68]]^A0N,[[26]],[[26]]^FB[[530]],2,0,L^FH\^FD{{ITEM_NAME}}^FS
^FO[[250]],[[128]]^A0N,[[26]],[[26]]^FB[[530]],1,0,L^FH\^FD{{SIZE}}^FS
^FO[[250]],[[162]]^A0N,[[48]],[[48]]^FB[[530]],1,0,L^FH\^FD{{WEIGHT}}^FS
^FO[[250]],[[216]]^A0N,[[26]],[[26]]^FB[[530]],1,0,L^FH\^FD{{BUNDLE}}^FS
^FO[[250]],[[248]]^A0N,[[26]],[[26]]^FB[[530]],1,0,L^FH\^FD{{LINE_AND_DATE}}^FS
^FO[[30]],[[296]]^BY[[2]],3,[[64]]^BCN,[[64]],N,N,N^FD{{TRACKING_ID}}^FS
^FO[[420]],[[306]]^A0N,[[36]],[[36]]^FB[[370]],1,0,L^FH\^FD{{TRACKING_ID}}^FS
^PQ1
^XZ$zpl$);
