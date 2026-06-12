-- ============================================================
-- WareCore WMS - Job Work Items Notes
-- Adds the missing notes column on job_work_items. This field
-- is required by GetJobWorkOrderForEdit and by the
-- edit_job_work_order() function (migration 038), both of
-- which read/write job_work_items.notes — without this column
-- every job work order edit fails with a GraphQL validation
-- error that surfaces as "Job Work order not found".
-- ============================================================

ALTER TABLE job_work_items
  ADD COLUMN IF NOT EXISTS notes TEXT;
