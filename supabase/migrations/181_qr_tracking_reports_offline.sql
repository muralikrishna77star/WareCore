-- ============================================================
-- Migration 181: QR stock tracking, Phase 5 (offline scanning, stock counts)
-- ============================================================
-- Lets the yard keep scanning without a signal. Each scan made on the Offline
-- Scan screen carries an id made on the phone and the time it was scanned.
-- When it reaches the server it goes through the same database rules as an
-- online scan, and is either applied or refused with the reason. A scan sent
-- twice finds its first record and is never applied again.
--
-- Also adds location stock counts: scan a location and every bundle on it.
-- A submitted count lists the differences and changes nothing by itself; a
-- manager decides what to do with each one.
--
-- The dashboard and reports add no tables. They only read.
--
-- Every change here is inside the tracking_ tables. No purchase, job work,
-- sale, transfer or ledger table is altered or written to, and no trigger is
-- added to any of them. New tables hold no foreign keys into existing tables.
-- ============================================================

-- ── Offline actions ─────────────────────────────────────────────────────────

CREATE TABLE tracking_offline_actions (
  id               UUID PRIMARY KEY,      -- made on the phone, so a resend finds this row
  device_id        TEXT NOT NULL CHECK (device_id ~ '^[A-Za-z0-9-]{8,64}$'),
  actor_id         UUID NOT NULL,
  company_id       UUID NOT NULL,
  warehouse_id     UUID NOT NULL,
  action           TEXT NOT NULL CHECK (action IN (
                     'PLACE', 'ADD_TO_PICKUP', 'ADD_TO_DISPATCH', 'COUNT_START', 'COUNT_SCAN', 'COUNT_SUBMIT')),
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- what the phone sent, kept as the record
  scanned_at       TIMESTAMPTZ NOT NULL,                 -- the phone's clock when it was scanned
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),   -- when it reached the server
  outcome          TEXT NOT NULL CHECK (outcome IN ('APPLIED', 'REFUSED')),
  refusal_reason   TEXT,
  tracking_unit_id UUID,                                  -- the bundle it was about, when known
  reviewed_by      UUID,
  reviewed_at      TIMESTAMPTZ,
  review_note      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((outcome = 'REFUSED') = (refusal_reason IS NOT NULL)),
  CHECK (outcome = 'REFUSED' OR reviewed_at IS NULL),
  CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL))
);
CREATE INDEX idx_tracking_offline_actions_problems ON tracking_offline_actions (company_id, warehouse_id, received_at)
  WHERE outcome = 'REFUSED';
CREATE INDEX idx_tracking_offline_actions_actor ON tracking_offline_actions (actor_id, received_at);

-- Permanent. Only the review of a refused scan can be filled in, once. The
-- warehouse can change only when a warehouse merge moves its records.
CREATE OR REPLACE FUNCTION fn_tracking_offline_action_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Tracking records cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['reviewed_by', 'reviewed_at', 'review_note', 'warehouse_id'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['reviewed_by', 'reviewed_at', 'review_note', 'warehouse_id'])
     OR (OLD.reviewed_at IS NOT NULL
         AND (NEW.reviewed_by, NEW.reviewed_at, NEW.review_note) IS DISTINCT FROM (OLD.reviewed_by, OLD.reviewed_at, OLD.review_note)) THEN
    RAISE EXCEPTION 'An offline scan record is permanent. Only its review can be added, once';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tracking_offline_actions_guard
  BEFORE UPDATE OR DELETE ON tracking_offline_actions
  FOR EACH ROW
  WHEN (current_setting('warecore.restoring', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION fn_tracking_offline_action_guard();

-- ── History links ───────────────────────────────────────────────────────────
-- No foreign key, so a backup restore can load these tables in any order.

ALTER TABLE tracking_events ADD COLUMN offline_action_id UUID;
ALTER TABLE tracking_pickup_events ADD COLUMN offline_action_id UUID;
CREATE INDEX idx_tracking_events_offline ON tracking_events (offline_action_id) WHERE offline_action_id IS NOT NULL;

ALTER TABLE tracking_events DROP CONSTRAINT tracking_events_event_type_check;
ALTER TABLE tracking_events ADD CONSTRAINT tracking_events_event_type_check CHECK (event_type IN (
  'UNIT_CREATED', 'LABEL_PRINT_SENT', 'LABEL_PRINT_CONFIRMED', 'LABEL_PRINT_FAILED', 'SCAN_LOOKUP', 'UNIT_VOIDED',
  'PUT_AWAY', 'MOVED', 'STATUS_CHANGED', 'UNIT_SPLIT', 'ADDED_TO_PICKUP', 'REMOVED_FROM_PICKUP',
  'MARKED_READY', 'PICKED_UP', 'CUSTOMER_RETURN', 'STOCK_VERIFIED',
  'ADDED_TO_DISPATCH', 'REMOVED_FROM_DISPATCH', 'SENT_TO_VENDOR', 'RETURNED_FROM_VENDOR', 'VENDOR_CHANGED', 'PROCESSED',
  'COUNTED'));

-- While an offline scan is being applied, every history row it writes is
-- linked to it and dated at the scan time. Never earlier than the bundle's or
-- pickup's latest history row, so the history always reads in order.
CREATE OR REPLACE FUNCTION fn_tracking_offline_event_stamp()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_action TEXT := current_setting('warecore.tracking_offline_action', true);
  v_at     TEXT := current_setting('warecore.tracking_scanned_at', true);
  v_last   TIMESTAMPTZ;
BEGIN
  IF COALESCE(v_action, '') = '' OR COALESCE(v_at, '') = '' THEN
    RETURN NEW;
  END IF;
  NEW.offline_action_id := v_action::uuid;
  IF TG_TABLE_NAME = 'tracking_events' THEN
    SELECT max(occurred_at) INTO v_last FROM tracking_events WHERE tracking_unit_id = NEW.tracking_unit_id;
  ELSE
    SELECT max(occurred_at) INTO v_last FROM tracking_pickup_events WHERE pickup_id = NEW.pickup_id;
  END IF;
  NEW.occurred_at := GREATEST(v_at::timestamptz, v_last);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tracking_events_offline_stamp
  BEFORE INSERT ON tracking_events
  FOR EACH ROW
  WHEN (current_setting('warecore.restoring', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION fn_tracking_offline_event_stamp();

CREATE TRIGGER trg_tracking_pickup_events_offline_stamp
  BEFORE INSERT ON tracking_pickup_events
  FOR EACH ROW
  WHEN (current_setting('warecore.restoring', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION fn_tracking_offline_event_stamp();

-- ── Stock counts ────────────────────────────────────────────────────────────

CREATE TABLE tracking_stock_counts (
  id            UUID PRIMARY KEY,         -- made on the phone, so a count can start offline
  count_no      TEXT NOT NULL UNIQUE CHECK (count_no ~ '^SC[0-9]{4}-[0-9]{4,}$'),
  company_id    UUID NOT NULL,
  warehouse_id  UUID NOT NULL,
  location_id   UUID NOT NULL REFERENCES tracking_locations(id),
  status        TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SUBMITTED', 'CLOSED', 'CANCELLED')),
  started_by    UUID NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL,
  submitted_by  UUID,
  submitted_at  TIMESTAMPTZ,
  closed_by     UUID,
  closed_at     TIMESTAMPTZ,
  cancel_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((submitted_at IS NULL) = (submitted_by IS NULL)),
  CHECK ((closed_at IS NULL) = (closed_by IS NULL)),
  CHECK (status <> 'CANCELLED' OR btrim(COALESCE(cancel_reason, '')) <> '')
);
CREATE UNIQUE INDEX uq_tracking_stock_counts_open ON tracking_stock_counts (location_id) WHERE status = 'OPEN';
CREATE INDEX idx_tracking_stock_counts_scope ON tracking_stock_counts (company_id, warehouse_id, status);

CREATE TABLE tracking_stock_count_lines (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id               UUID NOT NULL REFERENCES tracking_stock_counts(id),
  scanned_code           TEXT,             -- NULL for a bundle that was expected but not scanned
  tracking_unit_id       UUID REFERENCES tracking_units(id),
  scanned_at             TIMESTAMPTZ,
  scanned_by             UUID,
  outcome                TEXT CHECK (outcome IN ('FOUND', 'NOT_FOUND', 'FOUND_ELSEWHERE', 'WRONG_STATUS', 'UNKNOWN_LABEL')),
  status_at_submit       TEXT,
  expected_location_code TEXT,
  decision               TEXT CHECK (decision IN ('MARKED_MISSING', 'MOVED_HERE', 'IGNORED')),
  decided_by             UUID,
  decided_at             TIMESTAMPTZ,
  decision_note          TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (scanned_code IS NOT NULL OR tracking_unit_id IS NOT NULL),
  CHECK ((scanned_code IS NULL) = (scanned_at IS NULL)),
  CHECK ((decision IS NULL) = (decided_at IS NULL) AND (decided_at IS NULL) = (decided_by IS NULL)),
  CHECK (decision IS NULL OR outcome IN ('NOT_FOUND', 'FOUND_ELSEWHERE', 'WRONG_STATUS', 'UNKNOWN_LABEL'))
);
CREATE UNIQUE INDEX uq_tracking_stock_count_lines_unit ON tracking_stock_count_lines (count_id, tracking_unit_id)
  WHERE tracking_unit_id IS NOT NULL;
CREATE UNIQUE INDEX uq_tracking_stock_count_lines_code ON tracking_stock_count_lines (count_id, scanned_code)
  WHERE tracking_unit_id IS NULL;
CREATE INDEX idx_tracking_stock_count_lines_unit ON tracking_stock_count_lines (tracking_unit_id) WHERE tracking_unit_id IS NOT NULL;

CREATE TRIGGER trg_tracking_stock_counts_no_delete
  BEFORE DELETE ON tracking_stock_counts
  FOR EACH ROW
  WHEN (current_setting('warecore.restoring', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION fn_tracking_no_delete();

-- A line's decision is made once and never edited, and a line is never deleted.
CREATE OR REPLACE FUNCTION fn_tracking_count_line_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Tracking records cannot be deleted';
  END IF;
  IF OLD.decision IS NOT NULL THEN
    RAISE EXCEPTION 'A stock count decision is permanent and cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tracking_stock_count_lines_guard
  BEFORE UPDATE OR DELETE ON tracking_stock_count_lines
  FOR EACH ROW
  WHEN (current_setting('warecore.restoring', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION fn_tracking_count_line_guard();

-- ── Stock count steps ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_tracking_next_count_no()
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  v_prefix TEXT := 'SC' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'MMYY') || '-';
  v_seq    INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('tracking_count_numbers'));
  SELECT COALESCE(MAX(substring(count_no FROM 8)::int), 0) INTO v_seq
    FROM tracking_stock_counts WHERE count_no LIKE v_prefix || '%';
  RETURN v_prefix || lpad((v_seq + 1)::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION fn_tracking_lock_count(p_count_id UUID)
RETURNS tracking_stock_counts
LANGUAGE plpgsql AS $$
DECLARE
  v_count tracking_stock_counts;
BEGIN
  SELECT * INTO v_count FROM tracking_stock_counts WHERE id = p_count_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Stock count not found';
  END IF;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION start_tracking_stock_count(
  p_count_id UUID, p_company_id UUID, p_warehouse_id UUID, p_location_id UUID, p_started_at TIMESTAMPTZ, p_actor UUID
)
RETURNS tracking_stock_counts
LANGUAGE plpgsql AS $$
DECLARE
  v_location tracking_locations;
  v_other    TEXT;
  v_count    tracking_stock_counts;
BEGIN
  IF NOT fn_tracking_is_enabled(p_company_id, p_warehouse_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'QR tracking is switched off for this warehouse';
  END IF;
  v_location := fn_tracking_usable_location(p_location_id, p_company_id, p_warehouse_id);
  IF EXISTS (SELECT 1 FROM tracking_stock_counts WHERE id = p_count_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This stock count was already started';
  END IF;
  SELECT count_no INTO v_other FROM tracking_stock_counts WHERE location_id = v_location.id AND status = 'OPEN';
  IF FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Stock count %s is already open on %s', v_other, v_location.code);
  END IF;

  INSERT INTO tracking_stock_counts (id, count_no, company_id, warehouse_id, location_id, started_by, started_at)
  VALUES (p_count_id, fn_tracking_next_count_no(), p_company_id, p_warehouse_id, v_location.id, p_actor, LEAST(p_started_at, now()))
  RETURNING * INTO v_count;
  RETURN v_count;
END;
$$;

-- p_unit_id is NULL when the code is not a label this person can see in this
-- warehouse. Scanning the same bundle twice on one count is one line.
CREATE OR REPLACE FUNCTION scan_tracking_stock_count(
  p_count_id UUID, p_code TEXT, p_unit_id UUID, p_scanned_at TIMESTAMPTZ, p_actor UUID
)
RETURNS tracking_stock_counts
LANGUAGE plpgsql AS $$
DECLARE
  v_count    tracking_stock_counts;
  v_location tracking_locations;
  v_code     TEXT := upper(NULLIF(btrim(COALESCE(p_code, '')), ''));
BEGIN
  v_count := fn_tracking_lock_count(p_count_id);
  IF v_count.status <> 'OPEN' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Stock count %s is no longer open', v_count.count_no);
  END IF;
  IF v_code IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Scan a label';
  END IF;

  IF p_unit_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM tracking_stock_count_lines WHERE count_id = p_count_id AND tracking_unit_id = p_unit_id) THEN
      RETURN v_count;
    END IF;
    INSERT INTO tracking_stock_count_lines (count_id, scanned_code, tracking_unit_id, scanned_at, scanned_by)
    VALUES (p_count_id, v_code, p_unit_id, LEAST(p_scanned_at, now()), p_actor);
    SELECT * INTO v_location FROM tracking_locations WHERE id = v_count.location_id;
    PERFORM fn_tracking_record_event(p_unit_id, 'COUNTED',
      jsonb_build_object('count_id', v_count.id, 'count_no', v_count.count_no, 'location', v_location.code),
      p_actor, v_count.company_id);
  ELSE
    IF EXISTS (SELECT 1 FROM tracking_stock_count_lines WHERE count_id = p_count_id AND tracking_unit_id IS NULL AND scanned_code = v_code) THEN
      RETURN v_count;
    END IF;
    INSERT INTO tracking_stock_count_lines (count_id, scanned_code, scanned_at, scanned_by)
    VALUES (p_count_id, v_code, LEAST(p_scanned_at, now()), p_actor);
  END IF;

  UPDATE tracking_stock_counts SET updated_at = now() WHERE id = p_count_id RETURNING * INTO v_count;
  RETURN v_count;
END;
$$;

-- Gives every line its outcome and adds a line for each bundle tracking has
-- on the location that was not scanned. Changes no bundle. A count with no
-- differences closes at once.
CREATE OR REPLACE FUNCTION submit_tracking_stock_count(p_count_id UUID, p_submitted_at TIMESTAMPTZ, p_actor UUID)
RETURNS tracking_stock_counts
LANGUAGE plpgsql AS $$
DECLARE
  v_count tracking_stock_counts;
BEGIN
  v_count := fn_tracking_lock_count(p_count_id);
  IF v_count.status <> 'OPEN' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Stock count %s was already submitted', v_count.count_no);
  END IF;

  -- Lock the bundles on this location and the ones scanned, so no move lands half way through.
  PERFORM 1 FROM tracking_units
    WHERE current_location_id = v_count.location_id
       OR id IN (SELECT tracking_unit_id FROM tracking_stock_count_lines WHERE count_id = p_count_id)
    ORDER BY id FOR UPDATE;

  UPDATE tracking_stock_count_lines l
     SET status_at_submit = CASE WHEN u.status = 'VOIDED' THEN 'VOIDED' ELSE u.lifecycle_status END,
         expected_location_code = loc.code,
         outcome = CASE
           WHEN u.status = 'VOIDED' OR u.company_id <> v_count.company_id OR u.warehouse_id <> v_count.warehouse_id THEN 'UNKNOWN_LABEL'
           WHEN u.current_location_id = v_count.location_id THEN 'FOUND'
           WHEN u.lifecycle_status IN ('LABELLED', 'IN_STOCK', 'ON_HOLD', 'MISSING', 'LEFT_WAREHOUSE') THEN 'FOUND_ELSEWHERE'
           ELSE 'WRONG_STATUS'
         END
    FROM tracking_units u
    LEFT JOIN tracking_locations loc ON loc.id = u.current_location_id
   WHERE l.count_id = p_count_id AND u.id = l.tracking_unit_id;

  UPDATE tracking_stock_count_lines SET outcome = 'UNKNOWN_LABEL'
   WHERE count_id = p_count_id AND tracking_unit_id IS NULL;

  INSERT INTO tracking_stock_count_lines (count_id, tracking_unit_id, outcome, status_at_submit, expected_location_code)
  SELECT p_count_id, u.id, 'NOT_FOUND', u.lifecycle_status, loc.code
    FROM tracking_units u JOIN tracking_locations loc ON loc.id = u.current_location_id
   WHERE u.current_location_id = v_count.location_id AND u.status = 'ACTIVE'
     AND NOT EXISTS (SELECT 1 FROM tracking_stock_count_lines l WHERE l.count_id = p_count_id AND l.tracking_unit_id = u.id);

  UPDATE tracking_stock_counts
     SET status = CASE WHEN EXISTS (SELECT 1 FROM tracking_stock_count_lines WHERE count_id = p_count_id AND outcome <> 'FOUND')
                       THEN 'SUBMITTED' ELSE 'CLOSED' END,
         submitted_by = p_actor, submitted_at = LEAST(p_submitted_at, now()),
         closed_by = CASE WHEN EXISTS (SELECT 1 FROM tracking_stock_count_lines WHERE count_id = p_count_id AND outcome <> 'FOUND')
                          THEN NULL ELSE p_actor END,
         closed_at = CASE WHEN EXISTS (SELECT 1 FROM tracking_stock_count_lines WHERE count_id = p_count_id AND outcome <> 'FOUND')
                          THEN NULL ELSE now() END,
         updated_at = now()
   WHERE id = p_count_id
   RETURNING * INTO v_count;
  RETURN v_count;
END;
$$;

-- A manager's decision on one difference. The bundle must still be where the
-- count found it; if it has changed since, the decision is refused.
CREATE OR REPLACE FUNCTION decide_tracking_count_line(p_line_id UUID, p_decision TEXT, p_note TEXT, p_actor UUID)
RETURNS tracking_stock_counts
LANGUAGE plpgsql AS $$
DECLARE
  v_line     tracking_stock_count_lines;
  v_count    tracking_stock_counts;
  v_unit     tracking_units;
  v_location tracking_locations;
  v_note     TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_reason   TEXT;
BEGIN
  SELECT count_id INTO v_line.count_id FROM tracking_stock_count_lines WHERE id = p_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Stock count line not found';
  END IF;
  v_count := fn_tracking_lock_count(v_line.count_id);
  SELECT * INTO v_line FROM tracking_stock_count_lines WHERE id = p_line_id FOR UPDATE;
  IF v_count.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = format('Stock count %s is not waiting for decisions', v_count.count_no);
  END IF;
  IF v_line.decision IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This difference was already decided';
  END IF;
  IF v_line.outcome = 'FOUND' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This bundle was found where expected, so there is nothing to decide';
  END IF;
  SELECT * INTO v_location FROM tracking_locations WHERE id = v_count.location_id;
  v_reason := format('Stock count %s', v_count.count_no) || COALESCE(': ' || v_note, '');

  IF p_decision = 'MARKED_MISSING' THEN
    IF v_line.outcome <> 'NOT_FOUND' THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Only a bundle that was not found can be marked missing';
    END IF;
    v_unit := fn_tracking_lock_active_unit(v_line.tracking_unit_id);
    IF v_unit.current_location_id IS DISTINCT FROM v_count.location_id OR v_unit.lifecycle_status <> 'IN_STOCK' THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001',
        MESSAGE = format('Bundle %s has changed since the count, so it was not marked missing', v_unit.stock_tracking_id);
    END IF;
    PERFORM set_tracking_unit_status(v_unit.id, 'MISSING', NULL, 'Not found on ' || v_reason, NULL, p_actor);
  ELSIF p_decision = 'MOVED_HERE' THEN
    IF v_line.outcome <> 'FOUND_ELSEWHERE' THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Only a bundle found away from its recorded place can be moved here';
    END IF;
    v_unit := fn_tracking_lock_active_unit(v_line.tracking_unit_id);
    IF v_unit.lifecycle_status IS DISTINCT FROM v_line.status_at_submit THEN
      RAISE EXCEPTION USING ERRCODE = 'WC001',
        MESSAGE = format('Bundle %s has changed since the count, so it was not moved', v_unit.stock_tracking_id);
    END IF;
    IF v_unit.lifecycle_status IN ('MISSING', 'LEFT_WAREHOUSE') THEN
      PERFORM set_tracking_unit_status(v_unit.id, 'IN_STOCK', v_location.id, 'Found on ' || v_reason, NULL, p_actor);
    ELSE
      PERFORM place_tracking_unit(v_unit.id, v_location.id, NULL, p_actor);
    END IF;
  ELSIF p_decision <> 'IGNORED' OR p_decision IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Choose what to do with this difference';
  END IF;

  UPDATE tracking_stock_count_lines
     SET decision = p_decision, decided_by = p_actor, decided_at = now(), decision_note = v_note
   WHERE id = p_line_id;

  UPDATE tracking_stock_counts
     SET status = 'CLOSED', closed_by = p_actor, closed_at = now(), updated_at = now()
   WHERE id = v_count.id
     AND NOT EXISTS (SELECT 1 FROM tracking_stock_count_lines
                      WHERE count_id = v_count.id AND outcome <> 'FOUND' AND decision IS NULL);
  UPDATE tracking_stock_counts SET updated_at = now() WHERE id = v_count.id RETURNING * INTO v_count;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION cancel_tracking_stock_count(p_count_id UUID, p_reason TEXT, p_actor UUID)
RETURNS tracking_stock_counts
LANGUAGE plpgsql AS $$
DECLARE
  v_count  tracking_stock_counts;
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  v_count := fn_tracking_lock_count(p_count_id);
  IF v_count.status <> 'OPEN' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Only an open stock count can be cancelled';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'A reason is required';
  END IF;
  UPDATE tracking_stock_counts
     SET status = 'CANCELLED', cancel_reason = v_reason, closed_by = p_actor, closed_at = now(), updated_at = now()
   WHERE id = p_count_id
   RETURNING * INTO v_count;
  RETURN v_count;
END;
$$;

-- ── Applying an offline scan ────────────────────────────────────────────────

-- Refuses a scan when someone else changed the bundle after it was scanned.
-- The same phone's own earlier scans, and history that changes nothing
-- (labelling, printing, look-ups, counts), do not count.
CREATE OR REPLACE FUNCTION fn_tracking_offline_conflict(p_unit_id UUID, p_scanned_at TIMESTAMPTZ, p_device TEXT, p_actor UUID)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_event TEXT;
  v_when  TIMESTAMPTZ;
  v_id    TEXT;
BEGIN
  SELECT e.event_type, e.occurred_at INTO v_event, v_when
    FROM tracking_events e
    LEFT JOIN tracking_offline_actions a ON a.id = e.offline_action_id
   WHERE e.tracking_unit_id = p_unit_id
     AND e.occurred_at > p_scanned_at
     AND e.event_type NOT IN ('UNIT_CREATED', 'LABEL_PRINT_SENT', 'LABEL_PRINT_CONFIRMED', 'LABEL_PRINT_FAILED', 'SCAN_LOOKUP', 'COUNTED')
     AND NOT (a.id IS NOT NULL AND a.device_id = p_device AND a.actor_id = p_actor)
   ORDER BY e.occurred_at
   LIMIT 1;
  IF FOUND THEN
    SELECT stock_tracking_id INTO v_id FROM tracking_units WHERE id = p_unit_id;
    RAISE EXCEPTION USING ERRCODE = 'WC001',
      MESSAGE = format('Bundle %s was changed (%s) at %s, after this scan at %s',
        v_id, lower(replace(v_event, '_', ' ')),
        to_char(v_when AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI'),
        to_char(p_scanned_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI'));
  END IF;
END;
$$;

-- Applies one scan from the Offline Scan screen, or records why it was
-- refused, in one transaction. p_target holds the ids the server resolved
-- from the scanned codes; p_refusal is set when the server refused the scan
-- before it reached the database rules (permission, unknown label). A second
-- call with the same id returns the first record and changes nothing.
CREATE OR REPLACE FUNCTION apply_tracking_offline_action(
  p_id UUID, p_device TEXT, p_actor UUID, p_company_id UUID, p_warehouse_id UUID, p_action TEXT,
  p_payload JSONB, p_target JSONB, p_scanned_at TIMESTAMPTZ, p_refusal TEXT
)
RETURNS tracking_offline_actions
LANGUAGE plpgsql AS $$
DECLARE
  v_row     tracking_offline_actions;
  v_refusal TEXT := NULLIF(btrim(COALESCE(p_refusal, '')), '');
  v_unit    UUID := NULLIF(p_target ->> 'unit_id', '')::uuid;
  v_status  TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('tracking_offline_action'), hashtext(p_id::text));
  SELECT * INTO v_row FROM tracking_offline_actions WHERE id = p_id;
  IF FOUND THEN
    RETURN v_row;
  END IF;

  IF v_refusal IS NULL AND p_scanned_at > now() + interval '10 minutes' THEN
    v_refusal := 'The phone clock is more than 10 minutes ahead of the server. Correct the phone time and scan again';
  END IF;

  IF v_refusal IS NULL THEN
    BEGIN
      PERFORM set_config('warecore.tracking_offline_action', p_id::text, true);
      PERFORM set_config('warecore.tracking_scanned_at', p_scanned_at::text, true);
      CASE p_action
        WHEN 'PLACE' THEN
          PERFORM fn_tracking_offline_conflict(v_unit, p_scanned_at, p_device, p_actor);
          SELECT lifecycle_status INTO v_status FROM tracking_units WHERE id = v_unit;
          IF v_status = 'AT_VENDOR' THEN
            PERFORM return_tracking_unit_from_vendor(v_unit, (p_target ->> 'location_id')::uuid, 'Scanned back at the yard', p_target -> 'position', p_actor);
          ELSE
            PERFORM place_tracking_unit(v_unit, (p_target ->> 'location_id')::uuid, p_target -> 'position', p_actor);
          END IF;
        WHEN 'ADD_TO_PICKUP' THEN
          PERFORM fn_tracking_offline_conflict(v_unit, p_scanned_at, p_device, p_actor);
          PERFORM add_tracking_pickup_unit((p_target ->> 'pickup_id')::uuid, v_unit, NULL, p_actor);
        WHEN 'ADD_TO_DISPATCH' THEN
          PERFORM fn_tracking_offline_conflict(v_unit, p_scanned_at, p_device, p_actor);
          PERFORM add_tracking_dispatch_unit((p_target ->> 'dispatch_id')::uuid, v_unit, p_actor);
        WHEN 'COUNT_START' THEN
          PERFORM start_tracking_stock_count((p_target ->> 'count_id')::uuid, p_company_id, p_warehouse_id,
                                             (p_target ->> 'location_id')::uuid, p_scanned_at, p_actor);
        WHEN 'COUNT_SCAN' THEN
          PERFORM scan_tracking_stock_count((p_target ->> 'count_id')::uuid, p_target ->> 'code', v_unit, p_scanned_at, p_actor);
        WHEN 'COUNT_SUBMIT' THEN
          PERFORM submit_tracking_stock_count((p_target ->> 'count_id')::uuid, p_scanned_at, p_actor);
        ELSE
          RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This step cannot be done offline';
      END CASE;
    EXCEPTION WHEN OTHERS THEN
      -- Everything the step wrote is undone with this block; only the refusal is kept.
      v_refusal := CASE WHEN SQLSTATE LIKE 'WC%' THEN SQLERRM
                        ELSE 'The server could not apply this scan: ' || SQLERRM END;
    END;
    PERFORM set_config('warecore.tracking_offline_action', '', true);
    PERFORM set_config('warecore.tracking_scanned_at', '', true);
  END IF;

  INSERT INTO tracking_offline_actions (
    id, device_id, actor_id, company_id, warehouse_id, action, payload, scanned_at,
    outcome, refusal_reason, tracking_unit_id)
  VALUES (
    p_id, p_device, p_actor, p_company_id, p_warehouse_id, p_action, COALESCE(p_payload, '{}'::jsonb), p_scanned_at,
    CASE WHEN v_refusal IS NULL THEN 'APPLIED' ELSE 'REFUSED' END, v_refusal, v_unit)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION review_tracking_offline_action(p_id UUID, p_note TEXT, p_actor UUID)
RETURNS tracking_offline_actions
LANGUAGE plpgsql AS $$
DECLARE
  v_row tracking_offline_actions;
BEGIN
  SELECT * INTO v_row FROM tracking_offline_actions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Offline scan not found';
  END IF;
  IF v_row.outcome <> 'REFUSED' THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'Only a refused scan needs a review';
  END IF;
  IF v_row.reviewed_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'WC001', MESSAGE = 'This scan was already reviewed';
  END IF;
  UPDATE tracking_offline_actions
     SET reviewed_by = p_actor, reviewed_at = now(), review_note = NULLIF(btrim(COALESCE(p_note, '')), '')
   WHERE id = p_id
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
