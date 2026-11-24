-- ============================================================
-- Migration 182: run each customer database on India time
-- ============================================================
-- Databases started on UTC (GMT). Everything the database works out as
-- "today" used the UTC date, so between midnight and 5:30 am IST it was
-- still yesterday:
--   * date defaults: dispatch_orders.dispatch_date, financial_entries.entry_date,
--     job_work_orders.dispatch_date, job_work_transfers.transfer_date,
--     stock_ledger.entry_date, transfers.transfer_date (CURRENT_DATE);
--     reconciliation_runs.run_number (RUN-<date>-NNNNN from now());
--   * fallback dates in edit_job_work_order, fn_bill_item_deleted,
--     fn_job_work_item_to_ledger, fn_job_work_order_refresh_status and
--     reconcile_purchase_stock;
--   * fn_reconcile_fix_output_received_date refused today's date as "in the
--     future", and fn_validate_business_date's upper limit (today + 366).
--
-- Stored data does not change. Every timestamp column is timestamptz (an
-- exact instant), so it means the same moment whatever the zone is; only
-- its text form changes from ...+00 to ...+05:30. No column is
-- "timestamp without time zone". Dates (bill date etc.) are plain dates.
--
-- ALTER DATABASE applies to new connections. Connections already open
-- (including Neon's pooled ones) keep UTC until they reconnect.
-- To undo: ALTER DATABASE <name> RESET timezone;
-- ============================================================

DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Asia/Kolkata');
END
$$;

-- This connection too, so anything later in the same run uses India time.
SET timezone TO 'Asia/Kolkata';
