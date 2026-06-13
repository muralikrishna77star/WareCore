-- ============================================================
-- WareCore WMS - Trace Job Work Output Items back to Purchase Line
-- When a job work order's input items all come from a single
-- purchase line, tag the resulting JOB_WORK_OUTPUT_IN stock_ledger
-- entries (and job_work_output_items.source_purchase_line_ids) with
-- that purchase line, so the Purchase Line Movements report shows
-- the full conversion chain: Purchase In -> Job Work Out -> Output In.
-- ============================================================

-- ============================================================
-- BEFORE INSERT: populate source_purchase_line_ids from the order's
-- current input items (distinct purchase_line_ids), if not already set.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_job_work_output_item_set_source_lines()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.source_purchase_line_ids IS NULL OR NEW.source_purchase_line_ids = '[]'::jsonb THEN
    SELECT COALESCE(jsonb_agg(DISTINCT purchase_line_id), '[]'::jsonb)
    INTO NEW.source_purchase_line_ids
    FROM job_work_items
    WHERE job_work_order_id = NEW.job_work_order_id AND purchase_line_id IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_job_work_output_item_set_source_lines ON job_work_output_items;
CREATE TRIGGER trg_job_work_output_item_set_source_lines
BEFORE INSERT ON job_work_output_items
FOR EACH ROW EXECUTE FUNCTION fn_job_work_output_item_set_source_lines();

-- ============================================================
-- AFTER INSERT: when creating the JOB_WORK_OUTPUT_IN ledger entry,
-- if the order's input items share exactly one purchase line, carry
-- that purchase_line_id / sub_purchase_line_id onto the entry.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_job_work_output_item_to_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_order job_work_orders%ROWTYPE;
  v_purchase_line_id TEXT;
  v_sub_purchase_line_id TEXT;
  v_line_count INT;
BEGIN
  SELECT * INTO v_order FROM job_work_orders WHERE id = NEW.job_work_order_id;

  SELECT count(DISTINCT purchase_line_id),
         (array_agg(DISTINCT purchase_line_id))[1],
         (array_agg(DISTINCT sub_purchase_line_id))[1]
  INTO v_line_count, v_purchase_line_id, v_sub_purchase_line_id
  FROM job_work_items
  WHERE job_work_order_id = NEW.job_work_order_id AND purchase_line_id IS NOT NULL;

  IF v_line_count <> 1 THEN
    v_purchase_line_id := NULL;
    v_sub_purchase_line_id := NULL;
  END IF;

  -- Only create ledger entry if material_type_id is set
  IF NEW.material_type_id IS NOT NULL THEN
    INSERT INTO stock_ledger (
      entry_type, company_id, warehouse_id,
      material_type_id, material_size_id, size_label,
      quantity,
      reference_type, reference_id, reference_number,
      entry_date, created_by,
      purchase_line_id, sub_purchase_line_id
    ) VALUES (
      'JOB_WORK_OUTPUT_IN',
      v_order.company_id,
      v_order.warehouse_id,
      NEW.material_type_id,
      NEW.material_size_id,
      NEW.size_label,
      NEW.quantity,
      'job_work',
      v_order.id,
      v_order.reference_number,
      CURRENT_DATE,
      v_order.created_by,
      v_purchase_line_id,
      v_sub_purchase_line_id
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Backfill existing JOB_WORK_OUTPUT_IN ledger entries and
-- job_work_output_items.source_purchase_line_ids for orders whose
-- input items share exactly one purchase line (e.g. JW-MQ954D7A-ACNH).
-- ============================================================

WITH single_line_orders AS (
  SELECT job_work_order_id,
         (array_agg(DISTINCT purchase_line_id))[1] AS purchase_line_id,
         (array_agg(DISTINCT sub_purchase_line_id))[1] AS sub_purchase_line_id
  FROM job_work_items
  WHERE purchase_line_id IS NOT NULL
  GROUP BY job_work_order_id
  HAVING count(DISTINCT purchase_line_id) = 1
)
UPDATE stock_ledger sl
SET purchase_line_id = slo.purchase_line_id,
    sub_purchase_line_id = slo.sub_purchase_line_id
FROM single_line_orders slo
WHERE sl.entry_type = 'JOB_WORK_OUTPUT_IN'
  AND sl.reference_type = 'job_work'
  AND sl.reference_id = slo.job_work_order_id
  AND sl.purchase_line_id IS NULL;

WITH single_line_orders AS (
  SELECT job_work_order_id,
         (array_agg(DISTINCT purchase_line_id))[1] AS purchase_line_id
  FROM job_work_items
  WHERE purchase_line_id IS NOT NULL
  GROUP BY job_work_order_id
  HAVING count(DISTINCT purchase_line_id) = 1
)
UPDATE job_work_output_items oi
SET source_purchase_line_ids = to_jsonb(ARRAY[slo.purchase_line_id])
FROM single_line_orders slo
WHERE oi.job_work_order_id = slo.job_work_order_id
  AND oi.source_purchase_line_ids = '[]'::jsonb;
