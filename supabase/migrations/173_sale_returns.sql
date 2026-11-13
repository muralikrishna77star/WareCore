-- ============================================================
-- Migration 173: customer returns against a sale (Sales Return)
-- ============================================================
-- Goods a customer sends back are entered as a SALE RETURN against the
-- original sale: one or more of the sale's lines, each for any quantity up
-- to what is still unreturned (partial or full). The returned quantity goes
-- back into the sale's own company/warehouse as a new SALE_RETURN_IN ledger
-- row, tagged with the sale line's purchase line so every line-level report
-- follows it.
--
-- Built so that a return can never post stock twice — the class of bug that
-- hit purchases and job work (trigger chains re-firing, wipe-and-rebuild
-- edits, double-submits, restores re-running posting triggers):
--
--   1. ONE posting path. create_sale_return() writes the header, lines and
--      ledger rows in a single transaction. There is NO insert trigger that
--      posts stock, so nothing else (an edit, a backup restore, a re-fired
--      trigger) can post a return's stock again.
--   2. ONE ledger row per return line, enforced by the database:
--      stock_ledger.sale_return_item_id + a UNIQUE index. A second posting
--      for the same line fails instead of doubling.
--   3. Retry-safe. The caller supplies the return's id; re-sending the same
--      request (double click, network retry) finds the existing return and
--      returns it — it never creates a second one.
--   4. Over-return is impossible. The sale is locked while a return is
--      created, and a line's active returns may never exceed what was sold
--      on that line (checked by a trigger on every return line insert).
--   5. Returns are never edited. A wrong return is cancelled (its ledger
--      rows are removed outright and archived in stock_ledger_deletions,
--      same as every other cancellation since 074) and entered again.
--      Lines of an active return cannot be updated or deleted.
--   6. The sale is frozen while it has an active return: editing it
--      (which wipes and rebuilds its lines), cancelling it or purging it is
--      refused until its returns are cancelled. Otherwise an edit would
--      re-post the full SALE_OUT under new line ids and orphan the return.
--   7. Detection: REC-002 now also flags an active return line whose ledger
--      row is missing or differs from the line, and any ledger row left on
--      a cancelled return. REC-003 covers return rows with no document.
-- ============================================================

-- ── Ledger entry type ────────────────────────────────────────
ALTER TABLE stock_ledger DROP CONSTRAINT IF EXISTS stock_ledger_entry_type_check;
ALTER TABLE stock_ledger ADD CONSTRAINT stock_ledger_entry_type_check CHECK (entry_type = ANY (ARRAY[
  'PURCHASE_IN', 'VENDOR_RETURN_IN', 'SALE_OUT', 'JOB_WORK_OUT', 'JOB_WORK_RETURN_IN',
  'JOB_WORK_CANCEL', 'JOB_WORK_OUTPUT_IN', 'JOB_WORK_TRANSFER_OUT', 'JOB_WORK_TRANSFER_IN',
  'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT',
  'PURCHASE_CANCEL', 'SALE_CANCEL', 'SALE_RETURN_IN'
]));

-- ── Tables ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sale_returns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number     TEXT NOT NULL UNIQUE,
  -- SET NULL only matters for a cancelled return whose sale is later
  -- purged: an active return blocks deleting its sale (trigger below).
  dispatch_order_id UUID REFERENCES dispatch_orders(id) ON DELETE SET NULL,
  invoice_number    TEXT NOT NULL,          -- the sale's invoice no., kept for history
  company_id        UUID NOT NULL REFERENCES companies(id),
  warehouse_id      UUID NOT NULL REFERENCES warehouses(id),
  customer_id       UUID REFERENCES customers(id),
  return_date       DATE NOT NULL,
  reason            TEXT,
  notes             TEXT,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  total_quantity    NUMERIC(15,3) NOT NULL DEFAULT 0,
  total_amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_by        UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at      TIMESTAMPTZ,
  cancelled_notes   TEXT,
  cancelled_by      UUID REFERENCES user_profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sale_returns_dispatch ON sale_returns(dispatch_order_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_date ON sale_returns(return_date);

CREATE TABLE IF NOT EXISTS sale_return_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_return_id       UUID NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  dispatch_item_id     UUID REFERENCES dispatch_items(id) ON DELETE SET NULL,
  -- Snapshot of the sale line (filled from dispatch_items by the trigger
  -- below, never trusted from the caller).
  item_master_id       UUID,
  item_name            TEXT,
  sale_line_id         TEXT,
  purchase_line_id     TEXT,
  sub_purchase_line_id TEXT,
  material_type_id     UUID NOT NULL REFERENCES material_types(id),
  material_size_id     UUID REFERENCES material_sizes(id),
  size_label           TEXT,
  quantity             NUMERIC(15,3) NOT NULL CHECK (quantity > 0),
  unit                 TEXT NOT NULL,
  rate                 NUMERIC(15,2),
  amount               NUMERIC(15,2),
  taxable_value        NUMERIC(15,2),
  total_with_tax       NUMERIC(15,2),
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sale_return_items_line_once UNIQUE (sale_return_id, dispatch_item_id)
);

CREATE INDEX IF NOT EXISTS idx_sale_return_items_return ON sale_return_items(sale_return_id);
CREATE INDEX IF NOT EXISTS idx_sale_return_items_dispatch_item ON sale_return_items(dispatch_item_id);

-- One ledger row per return line, at most — the hard anti-doubling guard.
ALTER TABLE stock_ledger
  ADD COLUMN IF NOT EXISTS sale_return_item_id UUID REFERENCES sale_return_items(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_ledger_sale_return_item
  ON stock_ledger(sale_return_item_id) WHERE sale_return_item_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_sale_returns_business_date ON sale_returns;
CREATE TRIGGER trg_sale_returns_business_date BEFORE INSERT OR UPDATE OF return_date ON sale_returns
  FOR EACH ROW EXECUTE FUNCTION fn_validate_business_date('return_date', 'return date');

DROP TRIGGER IF EXISTS update_sale_returns_updated_at ON sale_returns;
CREATE TRIGGER update_sale_returns_updated_at BEFORE UPDATE ON sale_returns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Quantity already returned on a sale line (active returns only) ──
CREATE OR REPLACE FUNCTION fn_dispatch_item_returned_qty(p_dispatch_item_id UUID, p_exclude_item_id UUID DEFAULT NULL)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(ri.quantity), 0)
  FROM sale_return_items ri
  JOIN sale_returns r ON r.id = ri.sale_return_id
  WHERE ri.dispatch_item_id = p_dispatch_item_id
    AND r.status = 'active'
    AND (p_exclude_item_id IS NULL OR ri.id <> p_exclude_item_id);
$$;

-- ── Return line: validate + snapshot (no stock posting here) ──
-- Lines of a cancelled return carry no stock and count for nothing, so they
-- are let through untouched (a backup restore re-inserts those too).
CREATE OR REPLACE FUNCTION fn_sale_return_item_validate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_return   sale_returns%ROWTYPE;
  v_di       dispatch_items%ROWTYPE;
  v_returned NUMERIC;
BEGIN
  SELECT * INTO v_return FROM sale_returns WHERE id = NEW.sale_return_id;
  IF NOT FOUND OR v_return.status <> 'active' THEN
    RETURN NEW;
  END IF;

  IF NEW.dispatch_item_id IS NULL THEN
    RAISE EXCEPTION 'Every returned line must point at a line of the original sale.';
  END IF;

  -- Lock the sale line so two returns can't both see the same "unreturned"
  -- quantity.
  SELECT * INTO v_di FROM dispatch_items WHERE id = NEW.dispatch_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The sale line being returned no longer exists — reload the sale and try again.';
  END IF;
  IF v_di.dispatch_order_id IS DISTINCT FROM v_return.dispatch_order_id THEN
    RAISE EXCEPTION 'A returned line belongs to a different sale than this return.';
  END IF;

  v_returned := fn_dispatch_item_returned_qty(NEW.dispatch_item_id, NEW.id);
  IF v_returned + NEW.quantity > v_di.quantity + 0.0005 THEN
    RAISE EXCEPTION 'Cannot return % of % (line %): % was sold and % is already returned, so at most % can still come back.',
      round(NEW.quantity, 3), COALESCE(v_di.item_name, 'item'), COALESCE(v_di.sale_line_id, '—'),
      round(v_di.quantity, 3), round(v_returned, 3), round(GREATEST(v_di.quantity - v_returned, 0), 3);
  END IF;

  -- Everything but quantity/notes comes from the sale line itself.
  NEW.item_master_id       := v_di.item_master_id;
  NEW.item_name            := v_di.item_name;
  NEW.sale_line_id         := v_di.sale_line_id;
  NEW.purchase_line_id     := v_di.purchase_line_id;
  NEW.sub_purchase_line_id := v_di.sub_purchase_line_id;
  NEW.material_type_id     := v_di.material_type_id;
  NEW.material_size_id     := v_di.material_size_id;
  NEW.size_label           := v_di.size_label;
  NEW.unit                 := v_di.unit;
  NEW.rate                 := v_di.rate;
  NEW.amount := CASE
    WHEN v_di.amount IS NOT NULL AND v_di.quantity > 0 THEN round(v_di.amount * NEW.quantity / v_di.quantity, 2)
    WHEN v_di.rate IS NOT NULL THEN round(v_di.rate * NEW.quantity, 2)
  END;
  NEW.taxable_value := CASE WHEN v_di.taxable_value IS NOT NULL AND v_di.quantity > 0
    THEN round(v_di.taxable_value * NEW.quantity / v_di.quantity, 2) END;
  NEW.total_with_tax := CASE WHEN v_di.total_with_tax IS NOT NULL AND v_di.quantity > 0
    THEN round(v_di.total_with_tax * NEW.quantity / v_di.quantity, 2) END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_return_item_validate ON sale_return_items;
CREATE TRIGGER trg_sale_return_item_validate BEFORE INSERT ON sale_return_items
  FOR EACH ROW EXECUTE FUNCTION fn_sale_return_item_validate();

-- ── Return lines are immutable while the return is active ────
CREATE OR REPLACE FUNCTION fn_sale_return_item_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM sale_returns WHERE id = OLD.sale_return_id;
  IF v_status = 'active' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Lines of an active sales return cannot be removed — cancel the return and enter it again.';
    ELSIF NEW.quantity IS DISTINCT FROM OLD.quantity
       OR NEW.unit IS DISTINCT FROM OLD.unit
       OR NEW.dispatch_item_id IS DISTINCT FROM OLD.dispatch_item_id
       OR NEW.sale_return_id IS DISTINCT FROM OLD.sale_return_id
       OR NEW.material_type_id IS DISTINCT FROM OLD.material_type_id
       OR NEW.material_size_id IS DISTINCT FROM OLD.material_size_id
       OR NEW.purchase_line_id IS DISTINCT FROM OLD.purchase_line_id
       OR NEW.sub_purchase_line_id IS DISTINCT FROM OLD.sub_purchase_line_id THEN
      RAISE EXCEPTION 'Lines of an active sales return cannot be changed — cancel the return and enter it again.';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_return_item_lock ON sale_return_items;
CREATE TRIGGER trg_sale_return_item_lock BEFORE UPDATE OR DELETE ON sale_return_items
  FOR EACH ROW EXECUTE FUNCTION fn_sale_return_item_lock();

-- ── Return header: no reactivation, no moving an active return ──
CREATE OR REPLACE FUNCTION fn_sale_return_header_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'active' THEN
      RAISE EXCEPTION 'An active sales return cannot be deleted — cancel it instead.';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled sales return cannot be re-activated — enter a new return.';
  END IF;

  IF OLD.status = 'active' AND (
       NEW.dispatch_order_id IS DISTINCT FROM OLD.dispatch_order_id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
    OR NEW.return_date IS DISTINCT FROM OLD.return_date) THEN
    RAISE EXCEPTION 'The sale, warehouse or date of an active sales return cannot be changed — cancel the return and enter it again.';
  END IF;

  IF OLD.status = 'active' AND NEW.status = 'cancelled' AND EXISTS (
       SELECT 1 FROM stock_ledger sl
       JOIN sale_return_items ri ON ri.id = sl.sale_return_item_id
       WHERE ri.sale_return_id = NEW.id) THEN
    RAISE EXCEPTION 'Use cancel_sale_return() to cancel a sales return, so its stock is reversed.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_return_header_lock ON sale_returns;
CREATE TRIGGER trg_sale_return_header_lock BEFORE UPDATE OR DELETE ON sale_returns
  FOR EACH ROW EXECUTE FUNCTION fn_sale_return_header_lock();

-- ── The sale is frozen while it has an active return ─────────
CREATE OR REPLACE FUNCTION fn_active_sale_return_numbers(p_dispatch_order_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT string_agg(return_number, ', ' ORDER BY return_number)
  FROM sale_returns
  WHERE dispatch_order_id = p_dispatch_order_id AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION fn_dispatch_item_return_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_numbers TEXT;
  v_returned NUMERIC;
BEGIN
  v_returned := fn_dispatch_item_returned_qty(OLD.id);
  IF v_returned = 0 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.dispatch_order_id = OLD.dispatch_order_id
     AND NEW.material_type_id = OLD.material_type_id
     AND NEW.material_size_id IS NOT DISTINCT FROM OLD.material_size_id
     AND NEW.unit = OLD.unit
     AND NEW.purchase_line_id IS NOT DISTINCT FROM OLD.purchase_line_id
     AND NEW.sub_purchase_line_id IS NOT DISTINCT FROM OLD.sub_purchase_line_id
     AND NEW.quantity + 0.0005 >= v_returned THEN
    RETURN NEW;
  END IF;

  v_numbers := fn_active_sale_return_numbers(OLD.dispatch_order_id);
  RAISE EXCEPTION 'This sale has customer return(s) % against it. Cancel the return(s) first, then edit or cancel the sale, and enter the return again.',
    COALESCE(v_numbers, '');
END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_item_return_guard ON dispatch_items;
CREATE TRIGGER trg_dispatch_item_return_guard BEFORE UPDATE OR DELETE ON dispatch_items
  FOR EACH ROW EXECUTE FUNCTION fn_dispatch_item_return_guard();

CREATE OR REPLACE FUNCTION fn_dispatch_order_return_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_numbers TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = OLD.status
     AND NEW.company_id = OLD.company_id
     AND NEW.warehouse_id = OLD.warehouse_id
     AND NEW.dispatch_date = OLD.dispatch_date THEN
    RETURN NEW;
  END IF;

  v_numbers := fn_active_sale_return_numbers(OLD.id);
  IF v_numbers IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  RAISE EXCEPTION 'This sale has customer return(s) % against it. Cancel the return(s) first, then edit or cancel the sale, and enter the return again.',
    v_numbers;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_order_return_guard ON dispatch_orders;
CREATE TRIGGER trg_dispatch_order_return_guard BEFORE UPDATE OR DELETE ON dispatch_orders
  FOR EACH ROW EXECUTE FUNCTION fn_dispatch_order_return_guard();

-- ── Create a return (the ONLY path that posts return stock) ──
-- p_items: [{ "dispatch_item_id": uuid, "quantity": number, "notes": text? }, ...]
-- quantity is in the sale line's own unit.
CREATE OR REPLACE FUNCTION create_sale_return(
  p_id                UUID,
  p_dispatch_order_id UUID,
  p_return_date       DATE,
  p_reason            TEXT,
  p_notes             TEXT,
  p_items             JSONB,
  p_user_id           UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing   sale_returns%ROWTYPE;
  v_order      dispatch_orders%ROWTYPE;
  v_item       JSONB;
  v_qty        NUMERIC;
  v_seq        INTEGER;
  v_number     TEXT;
  v_line       sale_return_items%ROWTYPE;
  v_mat_unit   TEXT;
  v_lines      INTEGER := 0;
  v_posted     INTEGER;
BEGIN
  IF p_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'A return id is required');
  END IF;

  -- Retry of a request that already went through: hand back the same return.
  SELECT * INTO v_existing FROM sale_returns WHERE id = p_id;
  IF FOUND THEN
    IF v_existing.dispatch_order_id IS DISTINCT FROM p_dispatch_order_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'This return id is already used by another sale');
    END IF;
    RETURN jsonb_build_object('success', true, 'id', v_existing.id,
      'return_number', v_existing.return_number, 'already_saved', true);
  END IF;

  -- Lock the sale: concurrent returns against it are taken one at a time.
  SELECT * INTO v_order FROM dispatch_orders WHERE id = p_dispatch_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sale not found');
  END IF;
  IF v_order.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Returns can only be entered against an active sale');
  END IF;
  IF p_return_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Return date is required');
  END IF;
  IF p_return_date < v_order.dispatch_date THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('The return date (%s) is before the sale date (%s)',
        to_char(p_return_date, 'DD-Mon-YYYY'), to_char(v_order.dispatch_date, 'DD-Mon-YYYY')));
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter a return quantity on at least one line');
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_items) e)
     <> (SELECT count(DISTINCT e->>'dispatch_item_id') FROM jsonb_array_elements(p_items) e) THEN
    RETURN jsonb_build_object('success', false, 'error', 'The same sale line appears twice in this return');
  END IF;

  -- Return number SR-MMYY-NNNN, NNNN global (same scheme as sale/purchase ids).
  PERFORM pg_advisory_xact_lock(hashtext('warecore.sale_return_number'));
  SELECT COALESCE(MAX(substring(return_number FROM '-(\d+)$')::INTEGER), 0) + 1 INTO v_seq
  FROM sale_returns WHERE return_number ~ '^SR-\d{4}-\d+$';
  v_number := 'SR-' || to_char(p_return_date, 'MMYY') || '-' || lpad(v_seq::text, 4, '0');

  INSERT INTO sale_returns (
    id, return_number, dispatch_order_id, invoice_number,
    company_id, warehouse_id, customer_id,
    return_date, reason, notes, status, created_by
  ) VALUES (
    p_id, v_number, v_order.id, v_order.invoice_number,
    v_order.company_id, v_order.warehouse_id, v_order.customer_id,
    p_return_date, NULLIF(btrim(p_reason), ''), NULLIF(btrim(p_notes), ''), 'active', p_user_id
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := NULLIF(v_item->>'quantity', '')::NUMERIC;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Every returned line needs a quantity greater than zero.';
    END IF;

    -- Validated and filled from the sale line by trg_sale_return_item_validate.
    INSERT INTO sale_return_items (sale_return_id, dispatch_item_id, material_type_id, quantity, unit, notes)
    SELECT p_id, di.id, di.material_type_id, v_qty, di.unit, NULLIF(btrim(v_item->>'notes'), '')
    FROM dispatch_items di
    WHERE di.id = NULLIF(v_item->>'dispatch_item_id', '')::UUID
      AND di.dispatch_order_id = v_order.id
    RETURNING * INTO v_line;

    IF v_line.id IS NULL THEN
      RAISE EXCEPTION 'A returned line is not part of sale % — reload the sale and try again.', v_order.invoice_number;
    END IF;

    SELECT unit INTO v_mat_unit FROM material_types WHERE id = v_line.material_type_id;

    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id, material_type_id, material_size_id,
      size_label, quantity, reference_type, reference_id, reference_number,
      notes, entry_date, created_by, purchase_line_id, sub_purchase_line_id,
      sale_return_item_id
    ) VALUES (
      'SALE_RETURN_IN', v_order.company_id, v_order.warehouse_id,
      v_line.material_type_id, v_line.material_size_id, v_line.size_label,
      fn_convert_quantity(v_line.quantity, v_line.unit, v_mat_unit),
      'sale_return', p_id, v_number,
      'Customer return of sale ' || v_order.invoice_number,
      p_return_date, p_user_id, v_line.purchase_line_id, v_line.sub_purchase_line_id,
      v_line.id
    );

    v_lines := v_lines + 1;
    v_line := NULL;
  END LOOP;

  UPDATE sale_returns r SET
    total_quantity = t.qty,
    total_amount   = t.amount
  FROM (SELECT COALESCE(SUM(quantity), 0) AS qty, COALESCE(SUM(amount), 0) AS amount
        FROM sale_return_items WHERE sale_return_id = p_id) t
  WHERE r.id = p_id;

  -- Self-check: exactly one ledger row per line, nothing more.
  SELECT count(*) INTO v_posted FROM stock_ledger
  WHERE reference_type = 'sale_return' AND reference_id = p_id;
  IF v_posted <> v_lines THEN
    RAISE EXCEPTION 'Sales return % would post % ledger row(s) for % line(s) — nothing was saved.', v_number, v_posted, v_lines;
  END IF;

  RETURN jsonb_build_object('success', true, 'id', p_id, 'return_number', v_number, 'already_saved', false);
END;
$$;

-- ── Cancel a return: remove its stock outright (archived) ────
CREATE OR REPLACE FUNCTION cancel_sale_return(p_id UUID, p_notes TEXT DEFAULT NULL, p_user_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_return sale_returns%ROWTYPE;
BEGIN
  SELECT * INTO v_return FROM sale_returns WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sales return not found');
  END IF;
  IF v_return.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This sales return is already cancelled');
  END IF;

  INSERT INTO stock_ledger_deletions (stock_ledger_id, ledger_row, deleted_by)
  SELECT sl.id, to_jsonb(sl), p_user_id FROM stock_ledger sl
  WHERE sl.reference_type = 'sale_return' AND sl.reference_id = p_id;

  DELETE FROM stock_ledger WHERE reference_type = 'sale_return' AND reference_id = p_id;

  UPDATE sale_returns SET
    status          = 'cancelled',
    cancelled_at    = NOW(),
    cancelled_notes = NULLIF(btrim(p_notes), ''),
    cancelled_by    = p_user_id
  WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── Item Ledger: attribute return rows to the returned item ──
CREATE OR REPLACE FUNCTION public.fn_item_attributed_ledger_rows(p_item_id uuid)
 RETURNS TABLE(ledger_id uuid, shared boolean)
 LANGUAGE sql
 STABLE
AS $function$
  WITH item AS (
    SELECT material_type_id, material_size_id FROM item_master WHERE id = p_item_id
  ), grp AS (
    SELECT im.id FROM item_master im, item
    WHERE im.is_active
      AND im.material_type_id = item.material_type_id
      AND im.material_size_id IS NOT DISTINCT FROM item.material_size_id
  ), candidate AS (
    -- this combination's own rows
    SELECT sl.* FROM stock_ledger sl, item
    WHERE sl.material_type_id = item.material_type_id
      AND sl.material_size_id IS NOT DISTINCT FROM item.material_size_id
    UNION
    -- vendor-only rows whose effective scope is this combination
    SELECT sl.* FROM vw_job_work_vendor_movements v
    JOIN stock_ledger sl ON sl.id = v.id, item
    WHERE v.is_cross_item_output
      AND v.material_type_id = item.material_type_id
      AND v.material_size_id IS NOT DISTINCT FROM item.material_size_id
  ), attributed AS (
    SELECT c.id,
      COALESCE(
        (SELECT p.item_master_id FROM purchase_bill_items p
          WHERE p.purchase_line_id = COALESCE(c.sub_purchase_line_id, c.purchase_line_id)
            AND p.item_master_id IN (SELECT id FROM grp)
          LIMIT 1),
        (SELECT d.item_master_id FROM (
            SELECT di.item_master_id FROM dispatch_items di
             WHERE c.reference_type = 'dispatch' AND di.dispatch_order_id = c.reference_id
               AND di.material_type_id = c.material_type_id AND di.material_size_id IS NOT DISTINCT FROM c.material_size_id
            UNION ALL
            SELECT ri.item_master_id FROM sale_return_items ri
             WHERE c.reference_type = 'sale_return' AND ri.id = c.sale_return_item_id
            UNION ALL
            SELECT ti.item_master_id FROM transfer_items ti
             WHERE c.reference_type = 'transfer' AND ti.transfer_id = c.reference_id
               AND ti.material_type_id = c.material_type_id AND ti.material_size_id IS NOT DISTINCT FROM c.material_size_id
            UNION ALL
            SELECT oi.item_master_id FROM job_work_output_items oi
             WHERE c.reference_type = 'job_work' AND oi.job_work_order_id = c.reference_id
               AND c.entry_type IN ('JOB_WORK_OUTPUT_IN', 'JOB_WORK_CANCEL')
               AND oi.material_type_id = c.material_type_id AND oi.material_size_id IS NOT DISTINCT FROM c.material_size_id
          ) d
          WHERE d.item_master_id IN (SELECT id FROM grp)
          LIMIT 1)
      ) AS item_id
    FROM candidate c
  )
  SELECT id, item_id IS NULL
  FROM attributed
  WHERE item_id = p_item_id OR item_id IS NULL;
$function$;

-- ── REC-002: return lines vs their ledger rows ───────────────
CREATE OR REPLACE FUNCTION public.fn_reconcile_rec_002(p_company_id uuid, p_from_date date, p_to_date date)
 RETURNS SETOF reconciliation_candidate
 LANGUAGE sql
 STABLE
AS $function$
  WITH missing_purchase AS (
    SELECT pbi.id, pb.company_id, pb.warehouse_id, pbi.material_type_id, pbi.material_size_id,
           pbi.purchase_line_id, pb.id AS bill_id, pb.bill_number, pbi.quantity
    FROM purchase_bill_items pbi
    JOIN purchase_bills pb ON pb.id = pbi.bill_id
    WHERE pb.status = 'active'
      AND (p_company_id IS NULL OR pb.company_id = p_company_id)
      AND pb.bill_date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (
        SELECT 1 FROM stock_ledger sl
        WHERE sl.purchase_line_id = pbi.purchase_line_id AND sl.entry_type = 'PURCHASE_IN'
      )
  ),
  missing_dispatch AS (
    SELECT do2.id AS order_id, do2.company_id, do2.warehouse_id, do2.invoice_number,
           SUM(di.quantity) AS total_dispatched,
           COALESCE((SELECT SUM(-sl.quantity) FROM stock_ledger sl
                     WHERE sl.reference_type = 'dispatch' AND sl.reference_id = do2.id AND sl.entry_type = 'SALE_OUT'), 0) AS total_posted
    FROM dispatch_orders do2
    JOIN dispatch_items di ON di.dispatch_order_id = do2.id
    WHERE do2.status = 'active'
      AND (p_company_id IS NULL OR do2.company_id = p_company_id)
      AND do2.dispatch_date BETWEEN p_from_date AND p_to_date
    GROUP BY do2.id, do2.company_id, do2.warehouse_id, do2.invoice_number
    HAVING SUM(di.quantity) - COALESCE((SELECT SUM(-sl.quantity) FROM stock_ledger sl
             WHERE sl.reference_type = 'dispatch' AND sl.reference_id = do2.id AND sl.entry_type = 'SALE_OUT'), 0) > 0.001
  ),
  sale_return_mismatch AS (
    SELECT ri.id AS item_id, r.id AS return_id, r.return_number, r.status, r.company_id, r.warehouse_id,
           ri.material_type_id, ri.material_size_id, ri.purchase_line_id,
           CASE WHEN r.status = 'active' THEN fn_convert_quantity(ri.quantity, ri.unit, mt.unit) ELSE 0 END AS expected,
           COALESCE((SELECT SUM(sl.quantity) FROM stock_ledger sl WHERE sl.sale_return_item_id = ri.id), 0) AS posted
    FROM sale_return_items ri
    JOIN sale_returns r ON r.id = ri.sale_return_id
    LEFT JOIN material_types mt ON mt.id = ri.material_type_id
    WHERE (p_company_id IS NULL OR r.company_id = p_company_id)
      AND r.return_date BETWEEN p_from_date AND p_to_date
  )
  SELECT
    'REC-002|purchase|' || purchase_line_id AS fingerprint,
    'HIGH' AS severity, company_id, warehouse_id, material_type_id, material_size_id, purchase_line_id,
    'purchase_bill' AS source_document_type, bill_id AS source_document_id, purchase_line_id AS source_line_id,
    bill_number AS reference_number,
    quantity AS expected_value, 0::numeric AS actual_value, quantity AS difference,
    format('Active purchase line %s has no PURCHASE_IN ledger row', purchase_line_id) AS summary,
    'This line is on an active (non-draft, non-cancelled) purchase bill but never posted to stock_ledger.' AS explanation,
    'Possible trigger failure, or the line was inserted through a path that bypassed fn_bill_item_to_ledger().' AS suspected_cause,
    jsonb_build_object('confidence', 'HIGH_PROBABILITY') AS evidence
  FROM missing_purchase
  UNION ALL
  SELECT
    'REC-002|dispatch|' || order_id::text AS fingerprint,
    'HIGH' AS severity, company_id, warehouse_id, NULL::uuid, NULL::uuid, NULL::text,
    'dispatch' AS source_document_type, order_id AS source_document_id, NULL::text,
    invoice_number AS reference_number,
    total_dispatched AS expected_value, total_posted AS actual_value, (total_dispatched - total_posted) AS difference,
    format('Active dispatch %s: dispatched %s but only %s posted to the ledger', invoice_number, total_dispatched, total_posted) AS summary,
    'Order-level check (dispatch has no stable per-line ledger key) — total dispatched quantity exceeds total |SALE_OUT| posted for this order.' AS explanation,
    'Possible trigger failure, edit that removed ledger rows without reposting, or a still-draft order miscounted as active.' AS suspected_cause,
    jsonb_build_object('confidence', 'REVIEW_REQUIRED', 'granularity', 'order-level') AS evidence
  FROM missing_dispatch
  UNION ALL
  SELECT
    'REC-002|sale_return|' || item_id::text AS fingerprint,
    'HIGH' AS severity, company_id, warehouse_id, material_type_id, material_size_id, purchase_line_id,
    'sale_return' AS source_document_type, return_id AS source_document_id, purchase_line_id AS source_line_id,
    return_number AS reference_number,
    expected AS expected_value, posted AS actual_value, (expected - posted) AS difference,
    CASE WHEN status = 'active'
      THEN format('Sales return %s: a line returns %s but %s is posted to the ledger', return_number, round(expected, 3), round(posted, 3))
      ELSE format('Cancelled sales return %s still has %s in the ledger', return_number, round(posted, 3))
    END AS summary,
    'Each line of an active sales return must have exactly one SALE_RETURN_IN row for its quantity; a cancelled return must have none.' AS explanation,
    'Ledger rows changed or removed outside create_sale_return()/cancel_sale_return().' AS suspected_cause,
    jsonb_build_object('confidence', 'CONFIRMED', 'sale_return_item_id', item_id) AS evidence
  FROM sale_return_mismatch
  WHERE abs(expected - posted) > 0.0005;
$function$;

-- ── REC-003: return rows with no return document ─────────────
CREATE OR REPLACE FUNCTION public.fn_reconcile_rec_003(p_company_id uuid, p_from_date date, p_to_date date)
 RETURNS SETOF reconciliation_candidate
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    'REC-003|' || sl.id::text AS fingerprint,
    'MEDIUM' AS severity, sl.company_id, sl.warehouse_id, sl.material_type_id, sl.material_size_id, sl.purchase_line_id,
    sl.reference_type AS source_document_type, sl.reference_id AS source_document_id, sl.purchase_line_id AS source_line_id,
    sl.reference_number,
    NULL::numeric, sl.quantity, sl.quantity,
    format('%s row references a %s that no longer exists (live or archived)', sl.entry_type, sl.reference_type) AS summary,
    'reference_id resolves to nothing in either the live source table or its cancellation/archive table.' AS explanation,
    'Source document was hard-deleted without cleaning up its ledger trace, or reference_id was corrupted/mistyped.' AS suspected_cause,
    jsonb_build_object('confidence', 'HIGH_PROBABILITY', 'ledger_id', sl.id) AS evidence
  FROM stock_ledger sl
  WHERE (p_company_id IS NULL OR sl.company_id = p_company_id)
    AND sl.entry_date BETWEEN p_from_date AND p_to_date
    AND sl.reference_id IS NOT NULL
    AND (
      (sl.reference_type = 'purchase_bill' AND NOT EXISTS (SELECT 1 FROM purchase_bills b WHERE b.id = sl.reference_id)
        AND NOT EXISTS (SELECT 1 FROM purchase_cancellations pc WHERE pc.original_bill_id = sl.reference_id))
      OR (sl.reference_type = 'dispatch' AND NOT EXISTS (SELECT 1 FROM dispatch_orders d WHERE d.id = sl.reference_id)
        AND NOT EXISTS (SELECT 1 FROM dispatch_cancellations dc WHERE dc.original_order_id = sl.reference_id))
      OR (sl.reference_type = 'job_work' AND NOT EXISTS (SELECT 1 FROM job_work_orders j WHERE j.id = sl.reference_id)
        AND NOT EXISTS (SELECT 1 FROM job_work_cancellations jc WHERE jc.original_order_id = sl.reference_id))
      OR (sl.reference_type = 'transfer' AND NOT EXISTS (SELECT 1 FROM transfers t WHERE t.id = sl.reference_id))
      OR (sl.reference_type = 'sale_return' AND NOT EXISTS (SELECT 1 FROM sale_returns r WHERE r.id = sl.reference_id))
    );
$function$;
