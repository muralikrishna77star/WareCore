-- ============================================================
-- BACKUP HISTORY TABLE
-- ============================================================
CREATE TABLE backup_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  tables TEXT[] NOT NULL,  -- Array of table names that were backed up
  total_rows INTEGER DEFAULT 0,
  backup_path TEXT NOT NULL,  -- Path where backup is stored
  created_by TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ  -- For soft deletes
);

-- Index for fast lookups
CREATE INDEX idx_backup_history_timestamp ON backup_history(timestamp DESC);
CREATE INDEX idx_backup_history_created_by ON backup_history(created_by);

-- RLS Policy: Users can only view their own backups
ALTER TABLE backup_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all backups"
  ON backup_history FOR SELECT
  USING (TRUE);

CREATE POLICY "Users can create backups"
  ON backup_history FOR INSERT
  WITH CHECK (created_by = auth.jwt() ->> 'email' OR current_user = 'authenticated');

-- ============================================================
-- HELPER FUNCTION: Truncate Table
-- ============================================================
CREATE OR REPLACE FUNCTION truncate_table(table_name TEXT)
RETURNS void AS $$
BEGIN
  EXECUTE 'TRUNCATE TABLE ' || quote_ident(table_name) || ' CASCADE';
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- HELPER FUNCTION: Get Point in Time Data
-- ============================================================
CREATE OR REPLACE FUNCTION get_table_at_time(
  table_name TEXT,
  snapshot_time TIMESTAMPTZ
)
RETURNS TABLE (
  data JSONB
) AS $$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT row_to_json(t) as data FROM %I t WHERE t.created_at <= $1',
    table_name
  ) USING snapshot_time;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- BACKUP LOG TABLE (for audit trail)
-- ============================================================
CREATE TABLE backup_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  backup_id UUID REFERENCES backup_history(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('created', 'restored', 'deleted', 'downloaded')),
  user_email TEXT,
  tables_involved TEXT[],
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'partial')),
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for backup logs
CREATE INDEX idx_backup_logs_backup_id ON backup_logs(backup_id);
CREATE INDEX idx_backup_logs_created_at ON backup_logs(created_at DESC);
