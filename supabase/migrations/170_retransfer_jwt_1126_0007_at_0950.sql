-- ============================================================
-- Migration 170: reverse JWT-1126-0007 and re-enter it at 0.950
-- ============================================================
-- User confirmed 2026-11-04 that challan 2025-26/SS/DC/016 moved 0.950, not
-- 1.350, from Arun Engineering to D A Industries on 26-May-2025 (CR0425-0015).
-- Migration 169 put the received line back to 1.350 so it could be reversed.
-- Same two calls as the Reverse Transfer and Transfer to Another Vendor
-- screens, in one transaction: JW-MVZ3VU8Y-9B56 becomes Transfer Reversed, and
-- a new order holds 0.950 at D A Industries, leaving 0.400 at Arun Engineering.
-- Its numbers follow the Transfer screen's rules (next JWT-MMYY-NNNN for
-- this month, next JW-DDMM-NNNN for the transfer date). No-op unless the
-- transfer is still unreversed at 1.350 with the received line at 1.350.
-- ============================================================

DO $$
DECLARE
  v_transfer     CONSTANT uuid := 'cdf8b958-0d65-4da3-b91d-611a4dcca726';
  v_item         CONSTANT uuid := '9bfe0efd-6106-423c-b3ed-3616339a573c';
  v_from_order   CONSTANT uuid := '5e63d153-69eb-4044-84e2-fe674a89a951';
  v_from_line    CONSTANT uuid := '86edb075-22d9-4e8f-aaff-b849fc0bbcf0';
  v_to_vendor    CONSTANT uuid := 'a05f4fe4-6c16-4313-96ad-cb173aa75c46';
  v_user         CONSTANT uuid := 'eaebd2d7-07cf-486b-bf30-02aa3239fb1d';  -- entered the original transfer
  v_number       text;
  v_job_line     text;
  v_result       jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM job_work_transfer_items ti
    JOIN job_work_items ji ON ji.id = ti.to_job_work_item_id
    WHERE ti.id = v_item AND ti.reversed_at IS NULL
      AND ti.quantity_transferred = 1.350 AND ji.quantity_sent = 1.350
  ) THEN
    RAISE NOTICE 'Migration 170: JWT-1126-0007 already reversed or changed — skipped';
    RETURN;
  END IF;

  SELECT 'JWT-1126-' || lpad((COALESCE(max(substring(transfer_number from 10)::int), 0) + 1)::text, 4, '0')
  INTO v_number
  FROM job_work_transfers WHERE transfer_number ~ '^JWT-1126-[0-9]+$';

  v_result := reverse_job_work_transfer_items(
    v_transfer, ARRAY[v_item],
    'Wrong quantity: challan 2025-26/SS/DC/016 moved 0.950, not 1.350. Re-entered as ' || v_number || '.',
    v_user);
  IF NOT COALESCE((v_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'Migration 170: reversal refused: %', v_result->>'error';
  END IF;

  SELECT 'JW-2605-' || lpad((COALESCE(max(substring(job_line_id from 9)::int), 0) + 1)::text, 4, '0')
  INTO v_job_line
  FROM job_work_items WHERE job_line_id ~ '^JW-2605-[0-9]+$';

  v_result := create_job_work_transfer(
    v_from_order, v_to_vendor, '2025-05-26'::date, 'JW-MW1TZUEV-AELH', v_number, NULL,
    '2025-26/SS/DC/016',
    jsonb_build_array(jsonb_build_object(
      'source_item_id', v_from_line, 'job_line_id', v_job_line, 'quantity', 0.950)),
    v_user);
  IF NOT COALESCE((v_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'Migration 170: new transfer refused: %', v_result->>'error';
  END IF;
END $$;
