-- ============================================================
-- BACKUP SYSTEM - SQL REFERENCE GUIDE
-- ============================================================
-- Useful SQL commands for managing backups directly

-- ============================================================
-- VIEW BACKUP HISTORY
-- ============================================================

-- List all backups (newest first)
SELECT 
  id,
  name,
  timestamp,
  array_length(tables, 1) as table_count,
  total_rows,
  created_by,
  notes
FROM backup_history
ORDER BY timestamp DESC;

-- Get specific backup details
SELECT 
  *
FROM backup_history
WHERE id = 'your-backup-id'
LIMIT 1;

-- Find backups by name
SELECT 
  *
FROM backup_history
WHERE name ILIKE '%Monthly%'
ORDER BY timestamp DESC;

-- Count backups per user
SELECT 
  created_by,
  COUNT(*) as backup_count,
  SUM(total_rows) as total_rows_backed_up,
  MAX(timestamp) as latest_backup
FROM backup_history
GROUP BY created_by
ORDER BY backup_count DESC;

-- ============================================================
-- BACKUP AUDIT TRAIL
-- ============================================================

-- View all backup operations
SELECT 
  backup_id,
  action,
  user_email,
  status,
  created_at,
  error_message
FROM backup_logs
ORDER BY created_at DESC
LIMIT 100;

-- View failed operations
SELECT 
  *
FROM backup_logs
WHERE status = 'failed'
ORDER BY created_at DESC;

-- View operations by user
SELECT 
  user_email,
  action,
  COUNT(*) as count,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failures
FROM backup_logs
GROUP BY user_email, action
ORDER BY count DESC;

-- Restore audit trail (view all restores)
SELECT 
  backup_id,
  user_email,
  tables_involved,
  status,
  created_at
FROM backup_logs
WHERE action = 'restored'
ORDER BY created_at DESC;

-- ============================================================
-- BACKUP STATISTICS
-- ============================================================

-- Backup size analysis
SELECT 
  name,
  timestamp,
  total_rows,
  array_length(tables, 1) as table_count,
  created_by
FROM backup_history
ORDER BY total_rows DESC
LIMIT 20;

-- Backup frequency (last 30 days)
SELECT 
  DATE(timestamp) as backup_date,
  COUNT(*) as daily_backups,
  SUM(total_rows) as total_rows
FROM backup_history
WHERE timestamp >= NOW() - INTERVAL '30 days'
GROUP BY DATE(timestamp)
ORDER BY backup_date DESC;

-- Oldest and newest backups
SELECT 
  'Oldest' as type, name, timestamp
FROM backup_history
ORDER BY timestamp ASC
LIMIT 1
UNION ALL
SELECT 
  'Newest' as type, name, timestamp
FROM backup_history
ORDER BY timestamp DESC
LIMIT 1;

-- Average rows per table in backups
SELECT 
  ROUND(AVG(total_rows)::numeric, 0) as avg_rows_per_backup,
  MAX(total_rows) as max_rows,
  MIN(total_rows) as min_rows
FROM backup_history;

-- ============================================================
-- RETENTION MANAGEMENT
-- ============================================================

-- Find backups older than 30 days
SELECT 
  id,
  name,
  timestamp,
  AGE(NOW(), timestamp) as age,
  created_by
FROM backup_history
WHERE timestamp < NOW() - INTERVAL '30 days'
ORDER BY timestamp DESC;

-- Find backups older than 90 days
SELECT 
  id,
  name,
  timestamp
FROM backup_history
WHERE timestamp < NOW() - INTERVAL '90 days'
ORDER BY timestamp DESC;

-- Find duplicate backups (same day, same table set)
SELECT 
  DATE(timestamp) as backup_date,
  tables,
  COUNT(*) as count,
  STRING_AGG(DISTINCT id, ', ') as backup_ids
FROM backup_history
GROUP BY DATE(timestamp), tables
HAVING COUNT(*) > 1
ORDER BY backup_date DESC;

-- ============================================================
-- CLEANUP OPERATIONS
-- ============================================================

-- DELETE backups older than 30 days
-- ⚠️ WARNING: This cannot be undone!
DELETE FROM backup_history
WHERE timestamp < NOW() - INTERVAL '30 days';

-- DELETE backups older than 90 days
-- ⚠️ WARNING: This cannot be undone!
DELETE FROM backup_history
WHERE timestamp < NOW() - INTERVAL '90 days';

-- DELETE a specific backup
-- ⚠️ WARNING: This cannot be undone!
DELETE FROM backup_history
WHERE id = 'your-backup-id';

-- DELETE all failed restores (keep successful ones)
DELETE FROM backup_logs
WHERE action = 'restored' 
AND status = 'failed'
AND created_at < NOW() - INTERVAL '90 days';

-- ============================================================
-- DATA VALIDATION
-- ============================================================

-- Check for missing backups (no backup in last 24 hours)
SELECT 
  CASE 
    WHEN MAX(timestamp) IS NULL THEN 'No backups exist'
    WHEN MAX(timestamp) < NOW() - INTERVAL '24 hours' THEN 'No backup in last 24 hours'
    ELSE 'Recent backup exists'
  END as backup_status,
  MAX(timestamp) as latest_backup,
  AGE(NOW(), MAX(timestamp)) as time_since_backup
FROM backup_history;

-- Verify backup metadata consistency
SELECT 
  name,
  array_length(tables, 1) as declared_table_count,
  total_rows,
  timestamp,
  CASE 
    WHEN total_rows = 0 THEN 'Empty backup'
    WHEN total_rows < 0 THEN 'Invalid row count'
    ELSE 'Valid'
  END as status
FROM backup_history
ORDER BY timestamp DESC;

-- Check latest backup for all tables
SELECT 
  unnest(tables) as table_name,
  MAX(timestamp) as last_backed_up
FROM backup_history
WHERE timestamp >= NOW() - INTERVAL '7 days'
GROUP BY table_name
ORDER BY last_backed_up DESC;

-- ============================================================
-- RESTORE VERIFICATION
-- ============================================================

-- View all restore operations with details
SELECT 
  bl.backup_id,
  bh.name as backup_name,
  bh.timestamp as backup_created,
  bl.user_email,
  bl.tables_involved,
  bl.status,
  bl.error_message,
  bl.created_at as restored_at
FROM backup_logs bl
LEFT JOIN backup_history bh ON bl.backup_id = bh.id
WHERE bl.action = 'restored'
ORDER BY bl.created_at DESC;

-- Find successful restores
SELECT 
  bh.name,
  bl.user_email,
  bl.tables_involved,
  bl.created_at as restored_at,
  AGE(NOW(), bl.created_at) as time_since_restore
FROM backup_logs bl
LEFT JOIN backup_history bh ON bl.backup_id = bh.id
WHERE bl.action = 'restored' AND bl.status = 'success'
ORDER BY bl.created_at DESC;

-- Count restores per backup
SELECT 
  bh.name,
  bh.timestamp,
  COUNT(*) as restore_count,
  SUM(CASE WHEN bl.status = 'success' THEN 1 ELSE 0 END) as successful_restores
FROM backup_logs bl
LEFT JOIN backup_history bh ON bl.backup_id = bh.id
WHERE bl.action = 'restored'
GROUP BY bh.id, bh.name, bh.timestamp
ORDER BY restore_count DESC;

-- ============================================================
-- POINT-IN-TIME RECOVERY QUERIES
-- ============================================================

-- Find records created/updated on a specific date
SELECT 
  'companies' as table_name,
  COUNT(*) as record_count,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM companies
WHERE DATE(created_at) = '2024-01-15'
UNION ALL
SELECT 
  'purchase_bills' as table_name,
  COUNT(*) as record_count,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM purchase_bills
WHERE DATE(created_at) = '2024-01-15';

-- Count records as of a specific timestamp
SELECT 
  'companies' as table_name,
  COUNT(*) as record_count
FROM companies
WHERE created_at <= '2024-01-15T10:30:00Z'
UNION ALL
SELECT 
  'warehouses' as table_name,
  COUNT(*) as record_count
FROM warehouses
WHERE created_at <= '2024-01-15T10:30:00Z';

-- Compare record counts across time periods
SELECT 
  DATE_TRUNC('day', created_at)::DATE as date,
  'companies' as table_name,
  COUNT(*) as records
FROM companies
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY date DESC;

-- ============================================================
-- TROUBLESHOOTING
-- ============================================================

-- Check for tables not in any backup
WITH all_tables AS (
  SELECT table_name FROM (
    VALUES ('companies'), ('warehouses'), ('suppliers'), ('customers'),
           ('material_types'), ('material_sizes'), ('user_profiles'),
           ('purchase_bills'), ('purchase_bill_items'), ('stock_ledger'),
           ('transfers'), ('transfer_items'), ('job_work_orders'),
           ('job_work_items'), ('dispatch_orders'), ('dispatch_items')
  ) AS t(table_name)
),
backed_up AS (
  SELECT DISTINCT unnest(tables) as table_name
  FROM backup_history
)
SELECT 
  at.table_name,
  'Never backed up' as status
FROM all_tables at
LEFT JOIN backed_up b ON at.table_name = b.table_name
WHERE b.table_name IS NULL;

-- Check backup creation timestamps for anomalies
SELECT 
  name,
  timestamp,
  LAG(timestamp) OVER (ORDER BY timestamp) as previous_backup,
  EXTRACT(EPOCH FROM (timestamp - LAG(timestamp) OVER (ORDER BY timestamp))) / 3600 as hours_since_last
FROM backup_history
ORDER BY timestamp DESC
LIMIT 20;

-- List tables with no recent updates (candidates for less frequent backup)
SELECT 
  table_name,
  MAX(updated_at) as last_update,
  AGE(NOW(), MAX(updated_at)) as time_since_update
FROM information_schema.columns
WHERE table_schema = 'public'
GROUP BY table_name
ORDER BY last_update ASC;

-- ============================================================
-- BACKUP HEALTH CHECK
-- ============================================================

-- Generate backup health report
SELECT 
  CASE 
    WHEN COUNT(*) = 0 THEN 'CRITICAL: No backups'
    WHEN MAX(timestamp) < NOW() - INTERVAL '24 hours' THEN 'WARNING: No recent backup'
    ELSE 'OK'
  END as status,
  COUNT(*) as total_backups,
  MAX(timestamp) as latest_backup,
  AVG(total_rows) as avg_rows,
  SUM(total_rows) as total_rows_backed_up
FROM backup_history
WHERE timestamp >= NOW() - INTERVAL '30 days';

-- ============================================================
-- MIGRATION/EXPORT HELPERS
-- ============================================================

-- Get all backups with full metadata for export
SELECT 
  id,
  name,
  timestamp,
  tables,
  total_rows,
  backup_path,
  created_by,
  notes,
  created_at
FROM backup_history
ORDER BY timestamp DESC;

-- Generate CSV export of backup history
-- (Use your CSV export function from the backup service)
SELECT 
  id,
  name,
  timestamp::TEXT,
  array_to_string(tables, '|'),
  total_rows::TEXT,
  created_by,
  notes
FROM backup_history
ORDER BY timestamp DESC;

-- ============================================================
-- NOTES
-- ============================================================
-- 
-- Best Practices:
-- 1. Run health checks weekly
-- 2. Archive backups older than 1 year
-- 3. Test restore procedures quarterly
-- 4. Monitor backup sizes for trends
-- 5. Review audit logs monthly
-- 6. Keep backup retention policy documented
--
-- Performance Tips:
-- 1. Create backups during low-traffic periods
-- 2. Use point-in-time queries on indexed created_at field
-- 3. Batch delete old backups rather than all at once
-- 4. Monitor disk space for backup storage
--
-- Security:
-- 1. Restrict backup access to authorized users
-- 2. Encrypt backups at rest and in transit
-- 3. Audit all backup operations
-- 4. Document backup procedures
-- 5. Test disaster recovery procedures
