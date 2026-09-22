-- ============================================================
-- WareCore WMS - Tag processed-output ledger rows with their purchase line
--
-- fn_job_work_output_item_to_ledger() stamped purchase_line_id on its
-- JOB_WORK_OUTPUT_IN / JOB_WORK_CANCEL rows only when the WHOLE order had
-- exactly one distinct purchase line. On a multi-line order it gave up and
-- left the row untagged, even though job_work_output_items.source_job_line_id
-- names the exact input line the output came from.
--
-- Effect: Purchase Line Movements (which selects by purchase_line_id) never
-- saw the material come back, so the line's new "Balance at Vendor" column
-- showed it sitting with the vendor forever. 56 rows as of 2026-09-22
-- (51 JOB_WORK_OUTPUT_IN + 5 JOB_WORK_CANCEL). Same class of gap as
-- migration 118/150 for plain JOB_WORK_OUT.
--
-- 1. Derive the line from the output row's OWN source job line, falling back
--    to the single-line rule only when it has none (older rows predating
--    source_job_line_id).
-- 2. Backfill the existing untagged rows the same way.
--
-- Label-only: no quantity, date, company or warehouse changes, so item-level
-- stock and vendor balances are untouched. Generic joins, no hardcoded ids —
-- a no-op on a fresh database.
-- ============================================================

-- ── 1. Which purchase line an output line belongs to ────────────────────
CREATE OR REPLACE FUNCTION fn_job_work_output_purchase_line(
  p_order_id UUID,
  p_source_job_line_id TEXT,
  OUT o_purchase_line_id TEXT,
  OUT o_sub_purchase_line_id TEXT
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_line_count INT;
BEGIN
  -- The output line says which input line it was produced from: exact, and
  -- the only thing that works on a multi-line order.
  IF p_source_job_line_id IS NOT NULL THEN
    SELECT ji.purchase_line_id, ji.sub_purchase_line_id
    INTO o_purchase_line_id, o_sub_purchase_line_id
    FROM job_work_items ji
    WHERE ji.job_work_order_id = p_order_id
      AND ji.job_line_id = p_source_job_line_id
    LIMIT 1;

    IF o_purchase_line_id IS NOT NULL OR o_sub_purchase_line_id IS NOT NULL THEN
      RETURN;
    END IF;
  END IF;

  -- No source line recorded: only safe when the order leaves no choice.
  SELECT count(DISTINCT purchase_line_id),
         (array_agg(DISTINCT purchase_line_id))[1],
         (array_agg(DISTINCT sub_purchase_line_id))[1]
  INTO v_line_count, o_purchase_line_id, o_sub_purchase_line_id
  FROM job_work_items
  WHERE job_work_order_id = p_order_id AND purchase_line_id IS NOT NULL;

  IF v_line_count <> 1 THEN
    o_purchase_line_id := NULL;
    o_sub_purchase_line_id := NULL;
  END IF;
END;
$$;

-- ── 2. Post output rows with that line ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_job_work_output_item_to_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_order job_work_orders%ROWTYPE;
  v_purchase_line_id TEXT;
  v_sub_purchase_line_id TEXT;
  v_old_purchase_line_id TEXT;
  v_old_sub_purchase_line_id TEXT;
  v_target_unit TEXT;
  v_old_unit TEXT;
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = NEW.job_work_order_id;

  -- NEW: nothing ledger-relevant changed — same row, resaved. Without this,
  -- every Edit Order save re-posts a no-op JOB_WORK_CANCEL + JOB_WORK_OUTPUT_IN
  -- pair for every existing output line, whether or not that line was
  -- touched. See migration 136.
  IF TG_OP = 'UPDATE'
     AND NEW.material_type_id IS NOT DISTINCT FROM OLD.material_type_id
     AND NEW.material_size_id IS NOT DISTINCT FROM OLD.material_size_id
     AND NEW.size_label       IS NOT DISTINCT FROM OLD.size_label
     AND NEW.quantity         IS NOT DISTINCT FROM OLD.quantity
     AND NEW.unit             IS NOT DISTINCT FROM OLD.unit
     AND NEW.received_date    IS NOT DISTINCT FROM OLD.received_date
  THEN
    RETURN NEW;
  END IF;

  SELECT o_purchase_line_id, o_sub_purchase_line_id
  INTO v_purchase_line_id, v_sub_purchase_line_id
  FROM fn_job_work_output_purchase_line(NEW.job_work_order_id, NEW.source_job_line_id);

  -- On UPDATE, reverse whatever the OLD row posted before reposting for NEW.
  -- The reversal is tagged from the OLD row's own source line, so a line
  -- change re-points both postings instead of cancelling the wrong line.
  IF TG_OP = 'UPDATE' AND OLD.material_type_id IS NOT NULL THEN
    SELECT o_purchase_line_id, o_sub_purchase_line_id
    INTO v_old_purchase_line_id, v_old_sub_purchase_line_id
    FROM fn_job_work_output_purchase_line(OLD.job_work_order_id, OLD.source_job_line_id);

    SELECT unit INTO v_old_unit FROM material_types WHERE id = OLD.material_type_id;
    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id, material_type_id, material_size_id, size_label,
      quantity, reference_type, reference_id, reference_number,
      notes, entry_date, created_by, purchase_line_id, sub_purchase_line_id
    ) VALUES (
      'JOB_WORK_CANCEL', v_order.company_id, v_order.warehouse_id,
      OLD.material_type_id, OLD.material_size_id, OLD.size_label,
      -fn_convert_quantity(OLD.quantity, OLD.unit, v_old_unit),
      'job_work', v_order.id, v_order.reference_number,
      'Output line corrected via Edit Order',
      COALESCE(OLD.received_date, v_order.dispatch_date), v_order.created_by,
      v_old_purchase_line_id, v_old_sub_purchase_line_id
    );
  END IF;

  IF NEW.material_type_id IS NOT NULL THEN
    SELECT unit INTO v_target_unit FROM material_types WHERE id = NEW.material_type_id;
    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id,
      material_type_id, material_size_id, size_label,
      quantity,
      reference_type, reference_id, reference_number,
      entry_date, created_by,
      purchase_line_id, sub_purchase_line_id
    ) VALUES (
      'JOB_WORK_OUTPUT_IN', v_order.company_id, v_order.warehouse_id,
      NEW.material_type_id, NEW.material_size_id, NEW.size_label,
      fn_convert_quantity(NEW.quantity, NEW.unit, v_target_unit),
      'job_work', v_order.id, v_order.reference_number,
      COALESCE(NEW.received_date, v_order.dispatch_date), v_order.created_by,
      v_purchase_line_id, v_sub_purchase_line_id
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 3. Backfill the rows posted before the fix ──────────────────────────
-- One order can hold several identically-shaped output rows produced from
-- different lines (e.g. two 1.210 coils of one size on JW-MTY3K2KE-N29A).
-- Rank both sides the same way and pair them off, so each ledger row takes
-- exactly one source line instead of being skipped as ambiguous. Rows whose
-- quantity matches no output item (a correction that changed the quantity,
-- or a unit-converted posting) match nothing and stay untagged.
WITH untagged AS (
  SELECT sl.id, sl.reference_id, sl.material_type_id, sl.material_size_id, ABS(sl.quantity) AS quantity,
         ROW_NUMBER() OVER (
           PARTITION BY sl.reference_id, sl.material_type_id, sl.material_size_id, ABS(sl.quantity)
           ORDER BY sl.created_at, sl.id
         ) AS rn
  FROM stock_ledger sl
  WHERE sl.entry_type IN ('JOB_WORK_OUTPUT_IN', 'JOB_WORK_CANCEL')
    AND sl.reference_type = 'job_work'
    AND sl.purchase_line_id IS NULL
    AND sl.sub_purchase_line_id IS NULL
),
output_lines AS (
  SELECT oi.job_work_order_id, oi.material_type_id, oi.material_size_id, oi.quantity,
         ji.purchase_line_id, ji.sub_purchase_line_id,
         ROW_NUMBER() OVER (
           PARTITION BY oi.job_work_order_id, oi.material_type_id, oi.material_size_id, oi.quantity
           ORDER BY oi.created_at, oi.id
         ) AS rn
  FROM job_work_output_items oi
  JOIN job_work_items ji
    ON ji.job_work_order_id = oi.job_work_order_id
   AND ji.job_line_id = oi.source_job_line_id
  WHERE ji.purchase_line_id IS NOT NULL
)
UPDATE stock_ledger sl
SET purchase_line_id = o.purchase_line_id,
    sub_purchase_line_id = o.sub_purchase_line_id
FROM untagged u
JOIN output_lines o
  ON o.job_work_order_id = u.reference_id
 AND o.material_type_id = u.material_type_id
 AND o.material_size_id IS NOT DISTINCT FROM u.material_size_id
 AND o.quantity = u.quantity
 AND o.rn = u.rn
WHERE sl.id = u.id;

-- Second pass: an Edit Order correction leaves a JOB_WORK_CANCEL and a
-- re-posted JOB_WORK_OUTPUT_IN behind, whose quantities no longer line up
-- one-to-one with the order's current output lines — the pass above tags
-- only the first row of each shape, which can be the superseded posting.
-- Wherever every output line of that order + material + size belongs to the
-- same purchase line, there is no choice to make, so tag the rest too and
-- the line shows the whole correction trail instead of one stale row.
UPDATE stock_ledger sl
SET purchase_line_id = src.purchase_line_id,
    sub_purchase_line_id = src.sub_purchase_line_id
FROM (
  SELECT oi.job_work_order_id, oi.material_type_id, oi.material_size_id,
         (array_agg(DISTINCT ji.purchase_line_id))[1] AS purchase_line_id,
         (array_agg(DISTINCT ji.sub_purchase_line_id))[1] AS sub_purchase_line_id
  FROM job_work_output_items oi
  JOIN job_work_items ji
    ON ji.job_work_order_id = oi.job_work_order_id
   AND ji.job_line_id = oi.source_job_line_id
  WHERE ji.purchase_line_id IS NOT NULL
  GROUP BY oi.job_work_order_id, oi.material_type_id, oi.material_size_id
  HAVING COUNT(DISTINCT ji.purchase_line_id) = 1
) src
WHERE sl.entry_type IN ('JOB_WORK_OUTPUT_IN', 'JOB_WORK_CANCEL')
  AND sl.reference_type = 'job_work'
  AND sl.purchase_line_id IS NULL
  AND sl.sub_purchase_line_id IS NULL
  AND sl.reference_id = src.job_work_order_id
  AND sl.material_type_id = src.material_type_id
  AND sl.material_size_id IS NOT DISTINCT FROM src.material_size_id;
