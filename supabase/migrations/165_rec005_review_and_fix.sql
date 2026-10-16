-- ============================================================
-- Migration 165: Review & Fix for negative company stock (REC-005)
-- ============================================================
-- The 4 CRITICAL exceptions open on 2026-10-15 come from three causes:
--
-- * EXC-001146 (DS Steel, CR 0.90 X 120.50, -0.800) — stock moved between
--   the two companies with no transfer recorded. Sri Sai's
--   JW-MTCMYVW8-ISM5 sent DS Steel's coils CR0924-0017/0018 to Arun;
--   DS Steel's 1124-0482 sold Sri Sai's CR1024-0025/0026; DS Steel's
--   0225-0849 then sold 0.800 of CR0924-0018's job work output, which came
--   back into Sri Sai. Same class as migrations 121/133/140/143/155, which
--   each backfilled the missing TRANSFER_OUT/TRANSFER_IN pairs by hand.
-- * EXC-000818 (DS Steel, GA 1 X 164, -1.900) — JW-MUO2DCII-2FSX's 1 X 164
--   lines JW-1802-0007/0008 came back recorded as GA 1 X 150 Output
--   Materials, while sales 0325-1043/1046 sold them as 1 X 164.
-- * EXC-000811 / EXC-001158 (OT Others) — sales booked to SUSPENSE with no
--   purchase line; needs the user to say what was really sold.
--
-- Read-only helpers:
--   fn_rec005_scope_min_balance(company, type, size) — lowest running
--     balance, in REC-005's own order.
--   fn_rec005_intercompany_proposals(type, size) — replays each purchase
--     line's history per company in date order; whenever an outflow (sale /
--     job work dispatch) takes a company's balance on that line below zero
--     while another company holds that line's stock, proposes a transfer of
--     the shortfall at that moment. One pair per consuming row, as 140/155
--     did, but derived from who actually held the stock then — so a coil
--     that went out on one company's job work and came back as output into
--     it is transferred back when the other company later sells it.
--   fn_rec005_output_item_proposals(company, type, size) — Output Materials
--     lines that came back as a different material/size than the job line
--     they came from, where that job line's purchase line is negative here.
--
-- Fixes (one transaction each; refuse with "Nothing was changed." when the
-- data no longer matches; logged to stock_reconcile_fix_log; the exception
-- is marked RESOLVED when its scope no longer goes negative):
--   fn_rec005_fix_intercompany(exception, user)
--   fn_rec005_fix_output_item(exception, output item, user)
-- ============================================================

CREATE OR REPLACE FUNCTION fn_rec005_scope_min_balance(
  p_company_id UUID, p_material_type_id UUID, p_material_size_id UUID
) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT LEAST(COALESCE(MIN(b), 0), 0)
  FROM (
    SELECT SUM(quantity) OVER (ORDER BY entry_date, quantity DESC, created_at ROWS UNBOUNDED PRECEDING) AS b
    FROM stock_ledger
    WHERE company_id = p_company_id AND material_type_id = p_material_type_id
      AND material_size_id IS NOT DISTINCT FROM p_material_size_id
  ) x;
$$;

CREATE OR REPLACE FUNCTION fn_rec005_intercompany_proposals(
  p_material_type_id UUID, p_material_size_id UUID
) RETURNS TABLE (
  src_ledger_id UUID, purchase_line_id TEXT, from_company_id UUID, to_company_id UUID,
  quantity NUMERIC, entry_date DATE
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r RECORD;
  d RECORD;
  v_bal JSONB := '{}'::jsonb;      -- "<purchase line>|<company>" -> running balance
  v_key TEXT;
  v_cur NUMERIC;
  v_need NUMERIC;
  v_take NUMERIC;
BEGIN
  FOR r IN
    SELECT sl.id, sl.purchase_line_id AS pl, sl.company_id AS cid, sl.quantity AS qty, sl.entry_date AS d, sl.entry_type
    FROM stock_ledger sl
    WHERE sl.material_type_id = p_material_type_id
      AND sl.material_size_id IS NOT DISTINCT FROM p_material_size_id
      AND sl.purchase_line_id IS NOT NULL
    ORDER BY sl.entry_date, sl.quantity DESC, sl.created_at
  LOOP
    v_key := r.pl || '|' || r.cid::text;
    v_cur := COALESCE((v_bal ->> v_key)::numeric, 0) + r.qty;
    v_bal := jsonb_set(v_bal, ARRAY[v_key], to_jsonb(v_cur));

    IF r.entry_type IN ('SALE_OUT', 'JOB_WORK_OUT') AND v_cur < -0.0005 THEN
      v_need := -v_cur;
      FOR d IN
        SELECT key, value::numeric AS bal FROM jsonb_each_text(v_bal)
        WHERE split_part(key, '|', 1) = r.pl AND key <> v_key AND value::numeric > 0.0005
        ORDER BY value::numeric DESC
      LOOP
        EXIT WHEN v_need <= 0.0005;
        v_take := LEAST(v_need, d.bal);
        src_ledger_id := r.id;
        purchase_line_id := r.pl;
        from_company_id := split_part(d.key, '|', 2)::uuid;
        to_company_id := r.cid;
        quantity := v_take;
        entry_date := r.d;
        RETURN NEXT;
        v_bal := jsonb_set(v_bal, ARRAY[d.key], to_jsonb(d.bal - v_take));
        v_need := v_need - v_take;
      END LOOP;
      v_bal := jsonb_set(v_bal, ARRAY[v_key], to_jsonb(-v_need));
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION fn_rec005_output_item_proposals(
  p_company_id UUID, p_material_type_id UUID, p_material_size_id UUID
) RETURNS TABLE (
  output_item_id UUID, job_work_order_id UUID, order_reference TEXT, source_job_line_id TEXT,
  purchase_line_id TEXT, output_item_code TEXT, output_size_label TEXT, input_item_code TEXT,
  input_size_label TEXT, quantity NUMERIC, received_date DATE
)
LANGUAGE sql STABLE AS $$
  SELECT oi.id, jwo.id, jwo.reference_number, oi.source_job_line_id, jwi.purchase_line_id,
         om.item_code, oi.size_label, im.item_code, jwi.size_label, oi.quantity, oi.received_date
  FROM job_work_output_items oi
  JOIN job_work_orders jwo ON jwo.id = oi.job_work_order_id AND jwo.company_id = p_company_id AND jwo.status <> 'cancelled'
  JOIN job_work_items jwi ON jwi.job_work_order_id = oi.job_work_order_id AND jwi.job_line_id = oi.source_job_line_id
  LEFT JOIN item_master om ON om.id = oi.item_master_id
  LEFT JOIN item_master im ON im.id = jwi.item_master_id
  WHERE jwi.material_type_id = p_material_type_id
    AND jwi.material_size_id IS NOT DISTINCT FROM p_material_size_id
    AND (oi.material_type_id <> jwi.material_type_id OR oi.material_size_id IS DISTINCT FROM jwi.material_size_id)
    AND COALESCE(oi.quantity_consumed, 0) = 0
    AND (
      SELECT COALESCE(SUM(sl.quantity), 0) FROM stock_ledger sl
      WHERE sl.company_id = p_company_id AND sl.material_type_id = p_material_type_id
        AND sl.material_size_id IS NOT DISTINCT FROM p_material_size_id
        AND sl.purchase_line_id = jwi.purchase_line_id
    ) < -0.0005
  ORDER BY jwo.reference_number, oi.source_job_line_id;
$$;

-- Marks every open REC-005 exception for this material/size whose company
-- no longer goes negative as RESOLVED. Returns how many.
CREATE OR REPLACE FUNCTION fn_rec005_resolve_cleared(
  p_material_type_id UUID, p_material_size_id UUID, p_user UUID, p_note TEXT
) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  v_n INT;
BEGIN
  UPDATE reconciliation_exceptions e
  SET status = 'RESOLVED', resolved_at = NOW(), resolved_by = p_user,
      resolution_notes = p_note, updated_at = NOW()
  FROM reconciliation_rules r
  WHERE r.id = e.rule_id AND r.rule_code = 'REC-005'
    AND e.status NOT IN ('RESOLVED', 'IGNORED')
    AND e.material_type_id = p_material_type_id
    AND e.material_size_id IS NOT DISTINCT FROM p_material_size_id
    AND fn_rec005_scope_min_balance(e.company_id, e.material_type_id, e.material_size_id) >= -0.001;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION fn_rec005_fix_intercompany(p_exception_id UUID, p_user UUID)
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  e reconciliation_exceptions%ROWTYPE;
  p RECORD;
  v_before JSONB := '{}'::jsonb;
  v_c RECORD;
  v_after NUMERIC;
  v_from_wh UUID;
  v_count INT := 0;
  v_total NUMERIC := 0;
  v_log JSONB := '[]'::jsonb;
  v_summary TEXT;
  v_resolved INT;
BEGIN
  SELECT * INTO e FROM reconciliation_exceptions WHERE id = p_exception_id FOR UPDATE;
  IF e.id IS NULL OR e.status IN ('RESOLVED', 'IGNORED') THEN
    RAISE EXCEPTION 'Nothing was changed. This exception is no longer open — refresh the page.';
  END IF;

  FOR v_c IN SELECT DISTINCT company_id FROM stock_ledger
             WHERE material_type_id = e.material_type_id AND material_size_id IS NOT DISTINCT FROM e.material_size_id LOOP
    v_before := v_before || jsonb_build_object(v_c.company_id::text,
      fn_rec005_scope_min_balance(v_c.company_id, e.material_type_id, e.material_size_id));
  END LOOP;

  FOR p IN
    SELECT x.*, s.reference_number, s.entry_type AS src_type, s.warehouse_id AS src_wh, s.created_at AS src_created,
           s.material_type_id, s.material_size_id, s.size_label, s.sub_purchase_line_id,
           fc.name AS from_name, tc.name AS to_name
    FROM fn_rec005_intercompany_proposals(e.material_type_id, e.material_size_id) x
    JOIN stock_ledger s ON s.id = x.src_ledger_id
    JOIN companies fc ON fc.id = x.from_company_id
    JOIN companies tc ON tc.id = x.to_company_id
  LOOP
    -- The giving side posts where that company last received this line.
    SELECT warehouse_id INTO v_from_wh FROM stock_ledger
    WHERE company_id = p.from_company_id AND purchase_line_id = p.purchase_line_id AND quantity > 0
    ORDER BY entry_date DESC, created_at DESC LIMIT 1;
    IF v_from_wh IS NULL THEN
      SELECT id INTO v_from_wh FROM warehouses WHERE company_id = p.from_company_id ORDER BY name LIMIT 1;
    END IF;

    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id, material_type_id, material_size_id, size_label,
      quantity, reference_type, reference_number, notes, entry_date, created_at, created_by,
      purchase_line_id, sub_purchase_line_id
    ) VALUES
    ('TRANSFER_OUT', p.from_company_id, v_from_wh, p.material_type_id, p.material_size_id, p.size_label,
     -p.quantity, 'transfer', 'XFER-' || p.reference_number,
     format('Inter-company stock share (%s -> %s) behind %s %s — recorded from Review & Fix [src:%s]',
            p.from_name, p.to_name, p.src_type, p.reference_number, p.src_ledger_id),
     p.entry_date, p.src_created - INTERVAL '1 second', p_user, p.purchase_line_id, p.sub_purchase_line_id),
    ('TRANSFER_IN', p.to_company_id, p.src_wh, p.material_type_id, p.material_size_id, p.size_label,
     p.quantity, 'transfer', 'XFER-' || p.reference_number,
     format('Inter-company stock share (%s -> %s) behind %s %s — recorded from Review & Fix [src:%s]',
            p.from_name, p.to_name, p.src_type, p.reference_number, p.src_ledger_id),
     p.entry_date, p.src_created - INTERVAL '1 second', p_user, p.purchase_line_id, p.sub_purchase_line_id);

    v_count := v_count + 1;
    v_total := v_total + p.quantity;
    v_log := v_log || jsonb_build_object('purchase_line_id', p.purchase_line_id, 'from', p.from_name, 'to', p.to_name,
      'quantity', p.quantity, 'date', p.entry_date, 'behind', p.reference_number, 'src_ledger_id', p.src_ledger_id);
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Nothing was changed. No stock drawn from the other company was found for this item any more — run the scan again.';
  END IF;

  -- No company may end up worse off than it was.
  FOR v_c IN SELECT key, value::numeric AS before_min FROM jsonb_each_text(v_before) LOOP
    v_after := fn_rec005_scope_min_balance(v_c.key::uuid, e.material_type_id, e.material_size_id);
    IF v_after < LEAST(v_c.before_min, 0) - 0.0005 THEN
      RAISE EXCEPTION 'Nothing was changed. These transfers would leave % lower (%) than before (%) — it needs a manual look.',
        (SELECT name FROM companies WHERE id = v_c.key::uuid), v_after, v_c.before_min;
    END IF;
  END LOOP;

  v_summary := format('Recorded %s inter-company transfer(s), %s MT in total, for %s.', v_count, v_total, e.exception_number);
  INSERT INTO stock_reconcile_fix_log (fix_kind, item_id, params, summary, applied_by)
  VALUES ('rec005_intercompany_transfer', NULL,
          jsonb_build_object('exception_id', e.id, 'exception_number', e.exception_number, 'transfers', v_log),
          v_summary, p_user);

  v_resolved := fn_rec005_resolve_cleared(e.material_type_id, e.material_size_id, p_user,
    v_summary || ' (Review & Fix)');
  RETURN v_summary || CASE WHEN v_resolved > 0 THEN ' Stock no longer goes negative — marked resolved.'
                           ELSE ' Stock still goes negative — see the remaining findings.' END;
END;
$$;

CREATE OR REPLACE FUNCTION fn_rec005_fix_output_item(p_exception_id UUID, p_output_item_id UUID, p_user UUID)
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  e reconciliation_exceptions%ROWTYPE;
  p RECORD;
  oi job_work_output_items%ROWTYPE;
  jwi job_work_items%ROWTYPE;
  v_old_min NUMERIC;
  v_new_min NUMERIC;
  v_summary TEXT;
  v_resolved INT;
BEGIN
  SELECT * INTO e FROM reconciliation_exceptions WHERE id = p_exception_id FOR UPDATE;
  IF e.id IS NULL OR e.status IN ('RESOLVED', 'IGNORED') THEN
    RAISE EXCEPTION 'Nothing was changed. This exception is no longer open — refresh the page.';
  END IF;
  SELECT * INTO p FROM fn_rec005_output_item_proposals(e.company_id, e.material_type_id, e.material_size_id) x
  WHERE x.output_item_id = p_output_item_id;
  IF p.output_item_id IS NULL THEN
    RAISE EXCEPTION 'Nothing was changed. That output line no longer differs from its job line, or this item is no longer short — run the scan again.';
  END IF;

  SELECT * INTO oi FROM job_work_output_items WHERE id = p_output_item_id FOR UPDATE;
  SELECT * INTO jwi FROM job_work_items WHERE job_work_order_id = oi.job_work_order_id AND job_line_id = oi.source_job_line_id;
  v_old_min := fn_rec005_scope_min_balance(e.company_id, oi.material_type_id, oi.material_size_id);

  -- Same change Edit Order makes; the output trigger reverses the old
  -- posting and posts it again under the job line's own item.
  UPDATE job_work_output_items SET
    item_master_id = jwi.item_master_id,
    item_name = jwi.item_name,
    material_type_id = jwi.material_type_id,
    material_size_id = jwi.material_size_id,
    size_label = jwi.size_label,
    updated_at = NOW()
  WHERE id = oi.id;

  v_new_min := fn_rec005_scope_min_balance(e.company_id, oi.material_type_id, oi.material_size_id);
  IF v_new_min < LEAST(v_old_min, 0) - 0.0005 THEN
    RAISE EXCEPTION 'Nothing was changed. % (%) has been sold or used since this output came back, so taking % MT off it would leave it negative. Correct the sales of % instead.',
      COALESCE(p.output_item_code, 'The output item'), oi.size_label, oi.quantity, COALESCE(p.input_item_code, 'this item');
  END IF;

  v_summary := format('%s output from job line %s (%s MT, received %s) changed from %s %s to %s %s, the job line''s own item.',
    p.order_reference, p.source_job_line_id, oi.quantity, to_char(oi.received_date, 'DD-Mon-YYYY'),
    COALESCE(p.output_item_code, ''), oi.size_label, COALESCE(p.input_item_code, ''), jwi.size_label);
  INSERT INTO stock_reconcile_fix_log (fix_kind, item_id, params, summary, applied_by)
  VALUES ('rec005_output_item', jwi.item_master_id,
          jsonb_build_object('exception_id', e.id, 'exception_number', e.exception_number, 'output_item_id', oi.id,
                             'from_item_master_id', oi.item_master_id, 'from_material_size_id', oi.material_size_id,
                             'to_item_master_id', jwi.item_master_id, 'to_material_size_id', jwi.material_size_id),
          v_summary, p_user);

  v_resolved := fn_rec005_resolve_cleared(e.material_type_id, e.material_size_id, p_user, v_summary || ' (Review & Fix)');
  RETURN v_summary || CASE WHEN v_resolved > 0 THEN ' Stock no longer goes negative — marked resolved.'
                           ELSE ' Stock still goes negative — see the remaining findings.' END;
END;
$$;
