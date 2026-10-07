-- ============================================================
-- Migration 154: give item HR00206 "HR 2.30 X 325" its size
-- ============================================================
-- HR00206 was created on 2026-09-18 with no material_size_id. Its two
-- purchase lines (HR0125-0032 2.680 / HR0125-0033 2.700, bill 0125-0429,
-- 31-Jan-2025) carry size "2.30 X 325" (012b7224…), so their PURCHASE_IN
-- rows have that size — but job work order JW-MU6VHLCZ-HG9W (DC
-- 2024-25/SS/DC/0186), entered the same day, copied the item's empty size
-- onto its 2 job_work_items and their 2 JOB_WORK_OUT ledger rows.
--
-- The Item Stock Ledger report selects rows by the item's material type +
-- size, so for HR00206 it searched for size IS NULL: it showed the two
-- JOB_WORK_OUT rows (-5.380) and none of the purchases.
--
-- Fix: set the item's size, and the same size on the 2 job work lines and
-- their 2 JOB_WORK_OUT rows. These are the only HR stock_ledger rows with a
-- NULL size system-wide, and HR00206 is the only item whose own size is
-- NULL while its purchase lines have one. Quantities are not touched.
-- Applied to production 2026-09-30.
-- ============================================================

DO $$
DECLARE
  v_item  CONSTANT uuid := '34a86128-de17-4de4-93a6-c5626f8aab10';  -- HR00206
  v_type  CONSTANT uuid := '6de431ca-dbeb-4ed8-b084-67ecfa03f1d9';  -- HR
  v_size  CONSTANT uuid := '012b7224-bb59-431c-b24b-c4f46aa8afb5';  -- 2.30 X 325
  v_order CONSTANT uuid := '1d18716b-3536-49bb-8547-a326ec999801';  -- JW-MU6VHLCZ-HG9W
  n int;
BEGIN
  -- Production-only repair: a no-op on a fresh database (desktop build,
  -- test harness), where none of these rows exist.
  IF NOT EXISTS (SELECT 1 FROM item_master WHERE id = v_item) THEN
    RETURN;
  END IF;

  UPDATE item_master
  SET material_size_id = v_size
  WHERE id = v_item AND material_type_id = v_type AND material_size_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'item_master: expected 1 row, got %', n; END IF;

  UPDATE job_work_items
  SET material_size_id = v_size
  WHERE job_work_order_id = v_order
    AND item_master_id = v_item
    AND purchase_line_id IN ('HR0125-0032', 'HR0125-0033')
    AND material_size_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 2 THEN RAISE EXCEPTION 'job_work_items: expected 2 rows, got %', n; END IF;

  UPDATE stock_ledger
  SET material_size_id = v_size
  WHERE entry_type = 'JOB_WORK_OUT'
    AND reference_id = v_order
    AND material_type_id = v_type
    AND purchase_line_id IN ('HR0125-0032', 'HR0125-0033')
    AND material_size_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 2 THEN RAISE EXCEPTION 'stock_ledger: expected 2 rows, got %', n; END IF;
END $$;
