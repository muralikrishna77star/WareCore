-- ============================================================
-- WareCore WMS - Fix backfilled transfer ledger row timestamps/notes
--
-- Migration 063 backfilled 2 stock_ledger rows that went missing during
-- the migration-062 job-work-transfer regression (see migration 063's
-- header comment). Both rows correctly used a historical entry_date, but
-- created_at defaulted to NOW() (the day the fix was applied), which:
--   - made them sort as the most recent stock movements on the dashboard
--     ("Recent Movements" orders by created_at desc), misrepresenting a
--     2024/2026-07-20 event as happening today, and
--   - carried a "(backfilled, missing since original transfer)" note
--     that made them visibly stand out from every other transfer entry.
--
-- These rows represent real historical transactions, not a correction
-- made today — per explicit instruction, they should be indistinguishable
-- from an entry the trigger had posted at the time. Reset created_at to
-- sit immediately next to their paired TRANSFER_IN/OUT entry (same gap
-- pattern the trigger itself produces between the two inserts in a single
-- transfer) and drop the backfill annotation from the notes.
-- ============================================================

-- JWT-0726-0017: TRANSFER_IN on JW-MRQC6HY0-TSUN — align just before its
-- paired TRANSFER_OUT (JW-MRKJHEXQ-RP3D, created_at 2026-07-18 12:21:57.558371).
UPDATE stock_ledger
SET created_at = '2026-07-18 12:21:56.058371+00',
    notes = 'Vendor transfer — received'
WHERE id = '8a910f3f-e936-4fab-a51e-6b0a34e4a009';

-- JWT-0726-0018: TRANSFER_OUT on JW-MQGKK6Q0-NI2X — align just after its
-- paired TRANSFER_IN (JW-MRSTPTAS-8O78, created_at 2026-07-20 06:08:24.494325).
UPDATE stock_ledger
SET created_at = '2026-07-20 06:08:25.894325+00',
    notes = 'Vendor transfer — sent to new vendor'
WHERE id = '65587060-db7c-4963-adaf-f218525dbe70';
