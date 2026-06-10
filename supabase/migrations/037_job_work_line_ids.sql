-- ============================================================
-- WareCore WMS - Job Work Line IDs
-- Adds a client-generated Job Line ID (format JW-DDMM-NNNN) to
-- job_work_items, and a matching source_job_line_id on
-- job_work_output_items so each output row can be traced back
-- to the specific input line it was produced from.
-- ============================================================

ALTER TABLE job_work_items
  ADD COLUMN IF NOT EXISTS job_line_id TEXT;

CREATE INDEX IF NOT EXISTS idx_job_work_items_job_line_id ON job_work_items(job_line_id);

ALTER TABLE job_work_output_items
  ADD COLUMN IF NOT EXISTS source_job_line_id TEXT;

CREATE INDEX IF NOT EXISTS idx_job_work_output_items_source_job_line_id ON job_work_output_items(source_job_line_id);
