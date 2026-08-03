-- ============================================================
-- WareCore WMS - Backfill missing 2024 stock_ledger entries found by
-- Stock Reconciliation's per-order/per-bill consistency check
-- (each source record's own total_quantity compared against the sum of
-- its own PURCHASE_IN/SALE_OUT ledger rows — a stronger check than the
-- aggregate category totals, since it catches gaps that net out by
-- coincidence in the aggregate).
--
-- Three records had no matching ledger row at all:
--
-- 1. Dispatch 0424-0123 (active, vendor-direct sale, HR Coil 190, 7.510 MT):
--    has a JOB_WORK_OUT (-10.300, 2024-04-01) and the vendor-direct-sale's
--    virtual JOB_WORK_RETURN_IN (+7.510, 2024-04-11), but its paired
--    SALE_OUT was never posted — leaving warehouse stock overstated by
--    7.510 (the "return" was never matched by a "sale").
--
-- 2. Dispatch 0424-0001 (cancelled, CR 0.80X1485, 4.990 MT): has a
--    SALE_CANCEL (+4.990, 2024-04-04) reversing a SALE_OUT that was never
--    posted in the first place — leaving stock overstated by 4.990 (a
--    cancellation with nothing to cancel).
--
-- 3. Purchase bill 0724-0272 (active, CR 1.60X1250, 3.710 MT): has line
--    items and an amount, but never posted a PURCHASE_IN at all — leaving
--    stock understated by 3.710.
--
-- All three inserts restore the missing leg dated to the source record's
-- own date, matching what the normal insert path would have produced.
-- ============================================================

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  notes, entry_date, purchase_line_id, sub_purchase_line_id
) VALUES
  (
    'SALE_OUT',
    '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2',
    '6de431ca-dbeb-4ed8-b084-67ecfa03f1d9', '01944eb5-a660-406a-8b5b-b9c6609bf9dc', '190',
    -7.510,
    'dispatch', 'aeec9ce2-9393-4825-8cb0-1c6248912b84', '0424-0123',
    'Backfilled missing SALE_OUT — vendor-direct-sale return had no paired sale (migration 073)',
    '2024-04-11',
    'HR0324-0001', NULL
  ),
  (
    'SALE_OUT',
    '426a22ba-edb6-4947-b637-1ad4aab640b9', 'b33b8351-5cdc-4c4d-8e1b-895c7c26d930',
    'd2e3f40f-8076-46fa-a3cc-f52a661972d7', '3656d683-bfa6-4456-bcb0-f3169284e521', '0.80X1485',
    -4.990,
    'dispatch', '1f9443df-284b-4002-a4ce-b3dd6c2dcfd7', '0424-0001',
    'Backfilled missing original SALE_OUT — order had a SALE_CANCEL with nothing to cancel (migration 073)',
    '2024-04-04',
    'CR0324-0009', NULL
  ),
  (
    'PURCHASE_IN',
    '426a22ba-edb6-4947-b637-1ad4aab640b9', '9a5e389e-ba6c-4c1b-b79a-0242f5e43ce2',
    'd2e3f40f-8076-46fa-a3cc-f52a661972d7', 'b40b79d7-bd7f-4b16-8bbc-4f033db280f9', '1.60X1250',
    3.710,
    'purchase_bill', '02eb2124-5d70-4f66-a4a8-8b3e55886a17', '0724-0272',
    'Backfilled missing PURCHASE_IN — bill had line items/amount but never posted to the ledger (migration 073)',
    '2024-07-12',
    'CR0724-0053', NULL
  );
