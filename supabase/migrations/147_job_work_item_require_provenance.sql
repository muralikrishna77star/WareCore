-- Migration 147: close the null-purchase-line hole in migration 117's
-- Job Work purchase-date guard.
--
-- fn_job_work_item_validate_purchase_date() returns early when
-- NEW.purchase_line_id IS NULL — there is no bill date to compare against,
-- so the date check simply cannot run. That early return is correct in
-- itself, but it means a line with no purchase line skips the guard
-- entirely, and a physically impossible date sails through.
--
-- That is exactly what happened to JW-MU6VHLCZ-HG9W on 2026-09-18: 3.480 MT
-- of GA 1.40 X 100 dispatched on 2025-01-30, with no purchase line attached.
-- GA 1.40 X 100 has only ever been invoiced once, 0.600 MT on 2025-01-31,
-- so both the quantity and the date were impossible — but with no purchase
-- line to anchor it, nothing checked.
--
-- A job work input line should always be traceable to where its material
-- came from: either a purchase line, or an upstream job work output it was
-- produced from (migration 138's output-transfer path). Scanned before
-- activating: 1 of 1027 job_work_items rows has neither, and it is the
-- JW-MU6VHLCZ-HG9W row above.
--
-- To avoid breaking that one row before it is dealt with, the check fires
-- only on INSERT and on an UPDATE that actually changes purchase_line_id.
-- edit_job_work_order() (migration 114) always includes purchase_line_id in
-- its per-line UPDATE SET even when unchanged, so an unrelated edit to the
-- existing bad row stays possible; it just cannot be re-pointed at NULL.

CREATE OR REPLACE FUNCTION fn_job_work_item_validate_purchase_date()
RETURNS TRIGGER AS $$
DECLARE
  v_bill_date DATE;
  v_order_date DATE;
BEGIN
  IF NEW.purchase_line_id IS NULL THEN
    -- No purchase line means the date check below cannot run at all, so
    -- require the other legitimate provenance instead of letting the row
    -- through unchecked. Only on INSERT or a genuine re-pointing, so
    -- pre-existing rows stay editable (see header).
    IF NEW.source_job_work_output_item_id IS NULL
       AND (TG_OP = 'INSERT' OR NEW.purchase_line_id IS DISTINCT FROM OLD.purchase_line_id) THEN
      RAISE EXCEPTION 'Job Work line % has no Purchase Line ID — pick the purchase line this material came from, otherwise its dispatch date cannot be checked against when the material was invoiced.',
        COALESCE(NEW.job_line_id, NEW.item_name, '(unnamed)');
    END IF;
    RETURN NEW;
  END IF;

  SELECT pb.bill_date INTO v_bill_date
  FROM purchase_bill_items pbi
  JOIN purchase_bills pb ON pb.id = pbi.bill_id
  WHERE pbi.purchase_line_id = NEW.purchase_line_id
  LIMIT 1;

  -- Purchase line not found is a separate data-integrity question this
  -- check isn't responsible for — don't block on it.
  IF v_bill_date IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT dispatch_date INTO v_order_date FROM job_work_orders WHERE id = NEW.job_work_order_id;

  IF v_order_date IS NOT NULL AND v_order_date < v_bill_date THEN
    RAISE EXCEPTION 'Job Work dispatch date (%) is before purchase line % was invoiced (%) — the material did not exist yet.', v_order_date, NEW.purchase_line_id, v_bill_date;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
