-- ============================================================
-- Migration 163: Item-by-Item Reconciliation — fix the causes behind the
-- 2026-10-13 mismatches, and let Review & Fix repair the data patterns
-- from the website
-- ============================================================
-- Mismatches reported 2026-10-13 and their causes:
--
-- GA00178 (GA 1 X 150, vendor 5.340 vs job work 1.150) and GA00182
-- (GA 1 X 164, vendor -1.868 vs 2.322): a bug in vw_job_work_vendor_movements
-- (142). JW-MUO2DCII-2FSX returned six GA 1 X 150 Output Materials lines —
-- four from its 1 X 150 job lines, two (1.000 + 1.000) from its 1 X 164
-- job lines JW-1802-0007/0008 (a genuine cross-item output). The view
-- decided "cross-item" by asking whether ANY output line of the order with
-- the row's material came from a different-material job line, so all seven
-- 1 X 150 output rows were charged to 1 X 164: GA00178 never got its 4.190
-- returned, GA00182 got 6.190 it never had. Each OUTPUT_IN / CANCEL row
-- already carries its own source job line's purchase line (the output
-- trigger tags it via fn_job_work_output_purchase_line, 151), so the view
-- now matches the output line whose source job line has that purchase line,
-- and only falls back to the old any-line guess for untagged rows. A
-- system-wide before/after comparison changes exactly these two balances,
-- both to the job work figure.
--
-- HR00206 (vendor 0.120 vs 0.000): item_master.size_label was NULL (and on
-- HR00205) since its size was linked in 154, and the reconciliation looks
-- vendor-held stock up by size label. The ledger's 0.120 is right (0.120
-- still at Arun Engineering on JW-3001-0009). Size labels are filled from
-- material_sizes here; the report now also falls back to material_sizes.
--
-- GA00192 (vendor dipped to -3.070): two Output Materials lines on
-- JW-MUO1M7CX-2ZEZ (1.960 + 1.110) were dated 14-Feb-2024, a year before the
-- order was even sent (12-Feb-2025) — the third output on the same order is
-- 14-Feb-2025. Fixed from Review & Fix (fn_reconcile_fix_output_received_date
-- below), and a new guard rejects any received date before the job work's
-- dispatch date.
--
-- GI00132 (warehouse dipped to -4.170): the vendor-direct-sale virtual
-- returns re-posted by 159 got a 10-Oct-2026 created_at while their sales
-- kept theirs, so on the same business date the sale sorted first. Same for
-- one older pair (JW-MSMU64R4-JKI7 / 0724-0170, harmless order). Fixed from
-- Review & Fix (fn_reconcile_fix_align_pair_timestamp below).
--
-- OT00007 / OTH00002 (warehouse -1.698): five sales booked to SUSPENSE with
-- no stock behind them (notes name the real material). A business decision,
-- not changed here. OTH00002 only showed it because it shares OT00007's
-- material + size — the report now attributes rows per item (162).
--
-- Every website fix runs in one transaction, re-checks its preconditions,
-- and is recorded in stock_reconcile_fix_log.
-- ============================================================

-- 1. Vendor movements: match a cross-item output by its own source line.
CREATE OR REPLACE VIEW vw_job_work_vendor_movements AS
SELECT
  sl.id,
  sl.company_id,
  sl.warehouse_id,
  jwo.vendor_id,
  sl.reference_id AS job_work_order_id,
  sl.entry_type,
  sl.quantity,
  sl.entry_date,
  sl.created_at,
  sl.material_type_id AS own_material_type_id,
  sl.material_size_id AS own_material_size_id,
  sl.size_label       AS own_size_label,
  COALESCE(src.material_type_id, sl.material_type_id) AS material_type_id,
  COALESCE(src.material_size_id, sl.material_size_id) AS material_size_id,
  COALESCE(src.size_label,       sl.size_label)       AS size_label,
  (src.material_type_id IS NOT NULL) AS is_cross_item_output,
  src.output_item_id,
  CASE WHEN sl.entry_type IN ('JOB_WORK_TRANSFER_IN', 'JOB_WORK_TRANSFER_OUT') THEN sl.quantity ELSE -sl.quantity END AS vendor_delta
FROM stock_ledger sl
JOIN job_work_orders jwo ON jwo.id = sl.reference_id AND sl.reference_type = 'job_work'
LEFT JOIN LATERAL (
  SELECT jwi.material_type_id, jwi.material_size_id, jwi.size_label, oi.id AS output_item_id
  FROM job_work_output_items oi
  JOIN job_work_items jwi
    ON jwi.job_work_order_id = oi.job_work_order_id
   AND jwi.job_line_id = oi.source_job_line_id
  WHERE sl.entry_type IN ('JOB_WORK_OUTPUT_IN', 'JOB_WORK_CANCEL')
    AND oi.job_work_order_id = sl.reference_id
    AND oi.source_job_line_id IS NOT NULL
    AND oi.material_type_id = sl.material_type_id
    AND oi.material_size_id IS NOT DISTINCT FROM sl.material_size_id
    AND (jwi.material_type_id <> sl.material_type_id OR jwi.material_size_id IS DISTINCT FROM sl.material_size_id)
    -- 163: the row's purchase line is its own source job line's, so only
    -- that line's output can make it cross-item.
    AND (sl.purchase_line_id IS NULL OR jwi.purchase_line_id IS NOT DISTINCT FROM sl.purchase_line_id)
  ORDER BY (oi.quantity = ABS(sl.quantity)) DESC, oi.created_at
  LIMIT 1
) src ON TRUE
WHERE sl.entry_type IN ('JOB_WORK_OUT', 'JOB_WORK_RETURN_IN', 'JOB_WORK_TRANSFER_OUT', 'JOB_WORK_TRANSFER_IN')
   OR (
     sl.entry_type = 'JOB_WORK_OUTPUT_IN'
     AND (
       src.material_type_id IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM job_work_items jwi
         WHERE jwi.job_work_order_id = sl.reference_id
           AND jwi.material_type_id = sl.material_type_id
           AND jwi.material_size_id IS NOT DISTINCT FROM sl.material_size_id
       )
     )
   )
   OR (
     sl.entry_type = 'JOB_WORK_CANCEL'
     AND (
       src.material_type_id IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM stock_ledger o
         WHERE o.reference_type = 'job_work' AND o.reference_id = sl.reference_id
           AND o.entry_type IN ('JOB_WORK_OUT', 'JOB_WORK_RETURN_IN', 'JOB_WORK_TRANSFER_IN')
           AND o.material_type_id = sl.material_type_id
           AND o.material_size_id IS NOT DISTINCT FROM sl.material_size_id
       )
     )
   );

COMMENT ON VIEW vw_job_work_vendor_movements IS
  'Row-level canonical "does this stock_ledger row move stock to/from a job-work vendor, and against which item" (142, 163). vendor_delta already carries the sign convention (090); material_type_id/material_size_id/size_label are the EFFECTIVE scope — for a cross-item Output Materials line they are the consumed input line''s (matched through the row''s own purchase line since 163), own_* are what the row is posted under. Every vendor-held-stock figure (vw_current_vendor_stock, fn_vendor_balance_as_of, REC-009, REC-018, the Item Stock Ledger report) derives from this view.';

-- 2. Items whose size was linked without its label.
UPDATE item_master im
SET size_label = ms.size_label
FROM material_sizes ms
WHERE ms.id = im.material_size_id
  AND im.size_label IS NULL;

-- 3. A job work return / output can't come back before it was sent.
CREATE OR REPLACE FUNCTION fn_validate_job_work_received_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_dispatch DATE;
  v_ref TEXT;
BEGIN
  IF NEW.received_date IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.received_date IS NOT DISTINCT FROM OLD.received_date) THEN
    RETURN NEW;
  END IF;
  SELECT dispatch_date, reference_number INTO v_dispatch, v_ref
  FROM job_work_orders WHERE id = NEW.job_work_order_id;
  IF v_dispatch IS NOT NULL AND NEW.received_date < v_dispatch THEN
    RAISE EXCEPTION 'The received date % is before job work % was sent to the vendor on % — please check the date (often the year).',
      to_char(NEW.received_date, 'DD-Mon-YYYY'), v_ref, to_char(v_dispatch, 'DD-Mon-YYYY');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_work_items_received_after_dispatch ON job_work_items;
CREATE TRIGGER trg_job_work_items_received_after_dispatch BEFORE INSERT OR UPDATE OF received_date ON job_work_items
  FOR EACH ROW EXECUTE FUNCTION fn_validate_job_work_received_date();

DROP TRIGGER IF EXISTS trg_job_work_output_items_received_after_dispatch ON job_work_output_items;
CREATE TRIGGER trg_job_work_output_items_received_after_dispatch BEFORE INSERT OR UPDATE OF received_date ON job_work_output_items
  FOR EACH ROW EXECUTE FUNCTION fn_validate_job_work_received_date();

-- 4. What Review & Fix changed, by whom.
CREATE TABLE IF NOT EXISTS stock_reconcile_fix_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fix_kind TEXT NOT NULL,
  item_id UUID,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT NOT NULL,
  applied_by UUID,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE stock_reconcile_fix_log IS
  'One row per fix applied from Data Integrity → Stock Reconciliation → Review & Fix (163).';

-- 5a. Two legs of one movement recorded at different moments: a vendor
-- direct sale (SALE_OUT + its virtual JOB_WORK_RETURN_IN) or a vendor-to-
-- vendor transfer (JOB_WORK_TRANSFER_OUT + JOB_WORK_TRANSFER_IN). The app
-- posts both legs together; when a repair re-posted one later, the running
-- balance sorts the legs apart and shows a false dip. Gives the later leg
-- the earlier leg's timestamp. Quantities and dates are not touched.
CREATE OR REPLACE FUNCTION fn_reconcile_fix_align_pair_timestamp(
  p_ledger_id UUID, p_partner_id UUID, p_item_id UUID, p_user UUID
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  a stock_ledger%ROWTYPE;
  b stock_ledger%ROWTYPE;
  v_types TEXT;
  v_earlier TIMESTAMPTZ;
  v_summary TEXT;
BEGIN
  SELECT * INTO a FROM stock_ledger WHERE id = p_ledger_id FOR UPDATE;
  SELECT * INTO b FROM stock_ledger WHERE id = p_partner_id FOR UPDATE;
  IF a.id IS NULL OR b.id IS NULL THEN
    RAISE EXCEPTION 'Nothing was changed. One of the two ledger rows no longer exists — run the reconciliation again.';
  END IF;
  v_types := LEAST(a.entry_type, b.entry_type) || '+' || GREATEST(a.entry_type, b.entry_type);
  IF v_types NOT IN ('JOB_WORK_RETURN_IN+SALE_OUT', 'JOB_WORK_TRANSFER_IN+JOB_WORK_TRANSFER_OUT') THEN
    RAISE EXCEPTION 'Nothing was changed. These rows are not the two legs of a vendor direct sale or a vendor transfer.';
  END IF;
  IF a.entry_date <> b.entry_date OR a.quantity <> -b.quantity
     OR a.material_type_id <> b.material_type_id OR a.material_size_id IS DISTINCT FROM b.material_size_id THEN
    RAISE EXCEPTION 'Nothing was changed. The two rows differ in date, quantity or material, so they are not one movement.';
  END IF;
  IF v_types = 'JOB_WORK_RETURN_IN+SALE_OUT'
     AND COALESCE(CASE WHEN a.entry_type = 'JOB_WORK_RETURN_IN' THEN a.notes ELSE b.notes END, '') <> 'Vendor direct sale — virtual return' THEN
    RAISE EXCEPTION 'Nothing was changed. The return row is a real return from the vendor, not a vendor direct sale.';
  END IF;
  IF a.created_at = b.created_at THEN
    RETURN 'Already aligned — nothing to change.';
  END IF;

  v_earlier := LEAST(a.created_at, b.created_at);
  UPDATE stock_ledger SET created_at = v_earlier WHERE id IN (a.id, b.id) AND created_at <> v_earlier;

  v_summary := format('%s %s and %s %s (%s, %s) now share one timestamp, %s.',
    a.entry_type, a.reference_number, b.entry_type, b.reference_number,
    to_char(a.entry_date, 'DD-Mon-YYYY'), abs(a.quantity), to_char(v_earlier AT TIME ZONE 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI'));
  INSERT INTO stock_reconcile_fix_log (fix_kind, item_id, params, summary, applied_by)
  VALUES ('align_pair_timestamp', p_item_id,
          jsonb_build_object('ledger_ids', jsonb_build_array(a.id, b.id),
                             'created_at_before', jsonb_build_object(a.id::text, a.created_at, b.id::text, b.created_at)),
          v_summary, p_user);
  RETURN v_summary;
END;
$$;

-- 5b. An Output Materials line dated before its job work was sent. Moves
-- the line to the corrected date through the normal output trigger (which
-- posts a CANCEL at the old date and a fresh OUTPUT_IN at the new one), then
-- removes the stale OUTPUT_IN and that CANCEL, so the ledger keeps a single
-- row on the right date — the history no longer dips at the old date.
CREATE OR REPLACE FUNCTION fn_reconcile_fix_output_received_date(
  p_output_item_id UUID, p_new_date DATE, p_item_id UUID, p_user UUID
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  oi job_work_output_items%ROWTYPE;
  v_order job_work_orders%ROWTYPE;
  v_old_date DATE;
  v_new stock_ledger%ROWTYPE;
  v_stale UUID;
  v_cancel UUID;
  v_summary TEXT;
BEGIN
  SELECT * INTO oi FROM job_work_output_items WHERE id = p_output_item_id FOR UPDATE;
  IF oi.id IS NULL THEN
    RAISE EXCEPTION 'Nothing was changed. That output line no longer exists — run the reconciliation again.';
  END IF;
  SELECT * INTO v_order FROM job_work_orders WHERE id = oi.job_work_order_id;
  v_old_date := COALESCE(oi.received_date, v_order.dispatch_date);
  IF v_old_date >= v_order.dispatch_date THEN
    RAISE EXCEPTION 'Nothing was changed. This output line is already dated on or after the job work was sent (%). Use Edit Order to change it.',
      to_char(v_order.dispatch_date, 'DD-Mon-YYYY');
  END IF;
  IF p_new_date IS NULL OR p_new_date < v_order.dispatch_date OR p_new_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Nothing was changed. The new date must be between % (when % was sent) and today.',
      to_char(v_order.dispatch_date, 'DD-Mon-YYYY'), v_order.reference_number;
  END IF;

  UPDATE job_work_output_items SET received_date = p_new_date, updated_at = now() WHERE id = oi.id;

  -- The OUTPUT_IN the trigger just posted for the new date …
  SELECT * INTO v_new FROM stock_ledger
  WHERE reference_type = 'job_work' AND reference_id = oi.job_work_order_id
    AND entry_type = 'JOB_WORK_OUTPUT_IN' AND entry_date = p_new_date AND created_at = now()
    AND material_type_id = oi.material_type_id AND material_size_id IS NOT DISTINCT FROM oi.material_size_id
  ORDER BY id LIMIT 1;
  -- … the CANCEL it posted at the old date …
  SELECT id INTO v_cancel FROM stock_ledger
  WHERE reference_type = 'job_work' AND reference_id = oi.job_work_order_id
    AND entry_type = 'JOB_WORK_CANCEL' AND entry_date = v_old_date AND created_at = now()
    AND material_type_id = oi.material_type_id AND material_size_id IS NOT DISTINCT FROM oi.material_size_id
    AND quantity = -v_new.quantity
  ORDER BY id LIMIT 1;
  -- … and the original OUTPUT_IN at the old date that it reverses.
  SELECT id INTO v_stale FROM stock_ledger
  WHERE reference_type = 'job_work' AND reference_id = oi.job_work_order_id
    AND entry_type = 'JOB_WORK_OUTPUT_IN' AND entry_date = v_old_date AND created_at < now()
    AND material_type_id = oi.material_type_id AND material_size_id IS NOT DISTINCT FROM oi.material_size_id
    AND quantity = v_new.quantity
    AND purchase_line_id IS NOT DISTINCT FROM v_new.purchase_line_id
  ORDER BY created_at DESC LIMIT 1;
  IF v_new.id IS NULL OR v_cancel IS NULL OR v_stale IS NULL THEN
    RAISE EXCEPTION 'Nothing was changed. The ledger rows for this output line don''t match it as expected — it needs a manual look.';
  END IF;
  DELETE FROM stock_ledger WHERE id IN (v_stale, v_cancel);

  v_summary := format('Output %s %s on %s moved from %s to %s.',
    oi.size_label, v_new.quantity, v_order.reference_number,
    to_char(v_old_date, 'DD-Mon-YYYY'), to_char(p_new_date, 'DD-Mon-YYYY'));
  INSERT INTO stock_reconcile_fix_log (fix_kind, item_id, params, summary, applied_by)
  VALUES ('output_received_date', p_item_id,
          jsonb_build_object('output_item_id', oi.id, 'job_work_order_id', oi.job_work_order_id,
                             'old_date', v_old_date, 'new_date', p_new_date,
                             'removed_ledger_ids', jsonb_build_array(v_stale, v_cancel), 'kept_ledger_id', v_new.id),
          v_summary, p_user);
  RETURN v_summary;
END;
$$;
