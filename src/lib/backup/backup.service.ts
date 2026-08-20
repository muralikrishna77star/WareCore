// Backup service — uses Hasura run_sql API (no Supabase client needed)

import { hasuraRunSql } from '@/lib/hasura/server'

// Every table that actually exists in the schema, in FK-dependency order (a
// parent table always appears before anything that references it — verified
// against a full information_schema foreign-key graph, not hand-guessed).
// This list had drifted badly out of date: it still listed 'item_groups'
// (dropped by migration 022, silently producing an empty backup section for
// years) and never picked up job_work_output_items, job_work_transfers +
// their cancellation tables, purchase/dispatch cancellations, purchase
// import, the Data Integrity module (reconciliation_*/repair_*), custom
// roles, financial_entries, or the AI Copilot conversation history — a
// "full backup" was silently missing roughly half the schema's tables.
// schema_migrations is deliberately excluded: it's migration-runner
// bookkeeping, not business data, and restoring rows into it on a desktop
// install could desync it from which migrations that install has actually
// run.
export const TABLES = [
  'companies',
  'warehouses',
  'user_profiles',
  'custom_roles',
  'role_permissions',
  'suppliers',
  'customers',
  'material_types',
  'material_sizes',
  'item_master',
  'tax_rates',
  'ai_conversations',
  'ai_messages',
  'backup_history',
  'backup_logs',
  'job_work_orders',
  'job_work_items',
  'job_work_output_items',
  'job_work_cancellations',
  'job_work_cancellation_items',
  'job_work_cancellation_output_items',
  'job_work_transfers',
  'job_work_transfer_items',
  'job_work_transfer_cancellations',
  'job_work_transfer_cancellation_items',
  'dispatch_orders',
  'dispatch_items',
  'dispatch_cancellations',
  'dispatch_cancellation_items',
  'purchase_bills',
  'purchase_bill_items',
  'purchase_cancellations',
  'purchase_cancellation_items',
  'purchase_import_batches',
  'purchase_import_rows',
  'financial_entries',
  'transfers',
  'transfer_items',
  'stock_ledger',
  'reconciliation_rules',
  'reconciliation_runs',
  'reconciliation_exceptions',
  'reconciliation_exception_rows',
  'reconciliation_settings',
  'repair_batches',
  'repair_audit_rows',
]

export interface BackupMetadata {
  id: string
  name: string
  timestamp: string
  tables: string[]
  totalRows: number
  backupPath: string
  createdBy: string
  notes?: string
}

// A backed-up row's column values: run_sql (web/Hasura) always returns text,
// but the LOCAL_MODE executor and previously-restored JSON files can carry
// real JSON types (numbers, booleans, null, nested arrays) — restoreFromBackup
// below branches on all of these when re-serializing to SQL literals.
export type BackupRowValue = string | number | boolean | null | BackupRowValue[]
export type BackupRow = Record<string, BackupRowValue>

export interface BackupData {
  [table: string]: BackupRow[]
}

// Picks a safe restore order for whatever tables should be restored:
// TABLES' own FK-dependency order, filtered down to just the ones wanted —
// never the order of the backup file's own keys, and never the order a
// caller-supplied `tables` array happens to list them in. `subset`, when
// given, is purely a filter (which tables to include) — restoreFromBackup
// takes it as `options.tables` and must NOT use its array order directly,
// since that's exactly the bug this function exists to route around:
// - A JSON object's key order should already match TABLES (see
//   createBackup/getAllTableData, which build it in that order), but that
//   assumption silently breaks the moment it doesn't hold (an older backup
//   file, a hand-edited one, a future TABLES reordering).
// - BackupManager's restore UI lets an admin pick a subset of tables via
//   checkboxes and sends them in click order — no relation to dependency
//   order at all.
// Either way, restoring FK-dependent tables out of order makes every one
// of their row inserts fail at once, with no obvious cause from the
// resulting error. Unrecognized names (e.g. a table since renamed or
// removed) are appended at the end rather than dropped, so nothing
// silently vanishes even though their relative order isn't guaranteed safe.
export function restoreOrderFor(data: BackupData, subset?: string[]): string[] {
  const present = new Set(Object.keys(data))
  const wanted = subset ? new Set(subset) : present
  const known = TABLES.filter((t) => present.has(t) && wanted.has(t))
  const unknown = Object.keys(data).filter((t) => wanted.has(t) && !TABLES.includes(t))
  return [...known, ...unknown]
}

export interface RestoreOptions {
  timestamp?: string
  tables?: string[]
  truncateFirst?: boolean
}

// ─── Hasura run_sql helper ─────────────────────────────────────────────────
// Delegates to hasuraRunSql, which already branches on LOCAL_MODE — keeps
// this file from bypassing the desktop/web transport split.

async function runSQL(sql: string): Promise<{ result: string[][] }> {
  return hasuraRunSql(sql)
}

/**
 * Convert Hasura result rows (array-of-arrays with header row) to objects.
 * Every cell is really a raw SQL-text string at this point; callers assert
 * the row shape they expect via T (e.g. a specific backup_history row).
 */
function toObjects<T = Record<string, string>>(result: string[][]): T[] {
  if (!result || result.length < 2) return []
  const headers = result[0]
  return result.slice(1).map(row =>
    Object.fromEntries(headers.map((h, i) => [h, row[i]])) as T
  )
}

/** Escape single quotes for SQL string literals */
function esc(value: string): string {
  return value.replace(/'/g, "''")
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function getAllTableData(
  tables: string[] = TABLES,
  beforeTimestamp?: string
): Promise<BackupData> {
  const backupData: BackupData = {}

  for (const table of tables) {
    try {
      let sql = `SELECT * FROM ${table}`
      if (beforeTimestamp) {
        sql += ` WHERE created_at <= '${esc(beforeTimestamp)}'`
      }
      const { result } = await runSQL(sql)
      backupData[table] = toObjects(result)
    } catch (err) {
      console.error(`Backup: error fetching ${table}:`, err)
      backupData[table] = []
    }
  }

  return backupData
}

export async function createBackup(
  tables: string[] = TABLES,
  backupName?: string
): Promise<{ filename: string; metadata: BackupMetadata; backupData: BackupData }> {
  const timestamp = new Date().toISOString()
  const formattedDate = timestamp.replace(/[:.]/g, '-')
  const filename = `backup_${backupName ? esc(backupName) : formattedDate}.json`

  const backupData = await getAllTableData(tables)
  const totalRows = Object.values(backupData).reduce((sum, rows) => sum + rows.length, 0)

  const metadata: BackupMetadata = {
    id: crypto.randomUUID(),
    name: backupName || `Backup ${timestamp}`,
    timestamp,
    tables: Object.keys(backupData),
    totalRows,
    backupPath: `backups/${filename}`,
    createdBy: 'system',
  }

  return { filename, metadata, backupData }
}

export async function saveBackupMetadata(metadata: BackupMetadata): Promise<void> {
  const tablesArray = `ARRAY[${metadata.tables.map(t => `'${esc(t)}'`).join(', ')}]::TEXT[]`
  const sql = `
    INSERT INTO backup_history (id, name, timestamp, tables, total_rows, backup_path, created_by, notes)
    VALUES (
      '${esc(metadata.id)}',
      '${esc(metadata.name)}',
      '${esc(metadata.timestamp)}',
      ${tablesArray},
      ${metadata.totalRows},
      '${esc(metadata.backupPath)}',
      '${esc(metadata.createdBy)}',
      ${metadata.notes ? `'${esc(metadata.notes)}'` : 'NULL'}
    )
  `
  await runSQL(sql)
}

// Raw backup_history columns as they come back from run_sql — `tables` is a
// Postgres TEXT[] rendered as its text literal (e.g. "{a,b}"), not a JSON
// array; BackupMetadata.tables expects a real string[], so it's asserted
// below same as the pre-existing (previously untyped) behavior.
interface BackupHistoryRow {
  id: string
  name: string
  timestamp: string
  tables: string
  total_rows: string
  backup_path: string
  created_by: string
  notes: string | null
}

function toBackupMetadata(r: BackupHistoryRow): BackupMetadata {
  return {
    id: r.id,
    name: r.name,
    timestamp: r.timestamp,
    tables: (r.tables as unknown as string[]) ?? [],
    totalRows: Number(r.total_rows ?? 0),
    backupPath: r.backup_path,
    createdBy: r.created_by,
    notes: r.notes ?? undefined,
  }
}

export async function listBackups(): Promise<BackupMetadata[]> {
  const { result } = await runSQL(
    `SELECT id, name, timestamp, tables, total_rows, backup_path, created_by, notes
     FROM backup_history
     WHERE deleted_at IS NULL
     ORDER BY timestamp DESC`
  )
  return toObjects<BackupHistoryRow>(result).map(toBackupMetadata)
}

export async function getBackup(backupId: string): Promise<BackupMetadata | null> {
  const { result } = await runSQL(
    `SELECT id, name, timestamp, tables, total_rows, backup_path, created_by, notes
     FROM backup_history WHERE id = '${esc(backupId)}' LIMIT 1`
  )
  const rows = toObjects<BackupHistoryRow>(result)
  if (!rows.length) return null
  return toBackupMetadata(rows[0])
}

export async function deleteBackup(backupId: string): Promise<void> {
  await runSQL(
    `UPDATE backup_history SET deleted_at = NOW() WHERE id = '${esc(backupId)}'`
  )
}

function rowsToInsertSQL(table: string, rows: BackupRow[]): string {
  const cols = Object.keys(rows[0]).map(c => `"${c}"`).join(', ')
  const vals = rows.map(row =>
    '(' + Object.values(row).map(v => {
      // Hasura's run_sql endpoint (used for backups taken from the
      // online/web deployment) returns SQL NULL as the literal string
      // "NULL", not JSON null — the local desktop executor returns a
      // real null for the same case. Treat both the same on restore.
      if (v === null || v === undefined || v === 'NULL') return 'NULL'
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
      if (typeof v === 'number') return v
      if (Array.isArray(v)) return `ARRAY[${v.map(x => `'${esc(String(x))}'`).join(', ')}]`
      return `'${esc(String(v))}'`
    }).join(', ') + ')'
  ).join(', ')
  return `INSERT INTO ${table} (${cols}) VALUES ${vals} ON CONFLICT DO NOTHING`
}

export interface RestoreTableResult {
  attempted: number
  restored: number
  failed: number
  sampleErrors: string[]
}

export interface RestoreResult {
  success: boolean
  message: string
  restored: number
  tableResults: Record<string, RestoreTableResult>
}

export async function restoreFromBackup(
  backupData: BackupData,
  options: RestoreOptions = {}
): Promise<RestoreResult> {
  // options.tables (when given) selects WHICH tables to restore — never
  // dictates the order they're restored in. See restoreOrderFor()'s comment.
  const tablesToRestore = restoreOrderFor(backupData, options.tables)
  let restoredCount = 0
  const tableResults: Record<string, RestoreTableResult> = {}

  for (const table of tablesToRestore) {
    const data = backupData[table]
    if (!data?.length) continue

    const result: RestoreTableResult = { attempted: data.length, restored: 0, failed: 0, sampleErrors: [] }
    tableResults[table] = result

    if (options.truncateFirst) {
      try {
        await runSQL(`TRUNCATE TABLE ${table} CASCADE`)
      } catch (err) {
        result.failed = data.length
        result.sampleErrors.push(err instanceof Error ? err.message : String(err))
        console.error(`Restore: error truncating ${table}:`, err)
        continue
      }
    }

    const batchSize = 500
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize)
      try {
        await runSQL(rowsToInsertSQL(table, batch))
        result.restored += batch.length
        restoredCount += batch.length
      } catch {
        // One bad row (a stale/orphaned FK reference, a constraint the
        // source data no longer satisfies) makes Postgres reject the WHOLE
        // multi-row INSERT — silently dropping up to `batchSize`
        // otherwise-good rows along with it. Fall back to inserting this
        // batch one row at a time so only the actually-bad row(s) are
        // lost. Found via a desktop restore where a handful of orphaned
        // material_type_id references in stock_ledger/dispatch_items/
        // job_work_items silently zeroed out every row in every batch that
        // happened to contain one — thousands of otherwise-good rows gone,
        // with only a single swallowed console.error to show for it.
        for (const row of batch) {
          try {
            await runSQL(rowsToInsertSQL(table, [row]))
            result.restored += 1
            restoredCount += 1
          } catch (rowErr) {
            result.failed += 1
            if (result.sampleErrors.length < 5) {
              result.sampleErrors.push(rowErr instanceof Error ? rowErr.message : String(rowErr))
            }
          }
        }
      }
    }

    if (result.failed > 0) {
      console.error(`Restore: ${table} — ${result.restored}/${result.attempted} restored, ${result.failed} row(s) failed:`, result.sampleErrors)
    }
  }

  const totalFailed = Object.values(tableResults).reduce((sum, r) => sum + r.failed, 0)
  const message = totalFailed > 0
    ? `Restored ${restoredCount} record(s); ${totalFailed} row(s) across ${Object.values(tableResults).filter(r => r.failed > 0).length} table(s) failed — see tableResults for details`
    : `Restored ${restoredCount} record(s)`

  return { success: restoredCount > 0, message, restored: restoredCount, tableResults }
}

export async function getPointInTimeBackup(
  timestamp: string,
  tables: string[] = TABLES
): Promise<BackupData> {
  return getAllTableData(tables, timestamp)
}

export function dataToCSV(data: BackupRow[], tableName: string): string {
  if (!data.length) return `"Table: ${tableName}"\n"No data found"`
  const headers = Object.keys(data[0])
  return [
    headers.map(h => `"${h}"`).join(','),
    ...data.map(row =>
      headers.map(h => {
        const v = row[h]
        if (v === null || v === undefined) return ''
        if (typeof v === 'string') return `"${v.replace(/"/g, '""')}"`
        if (typeof v === 'object') return `"${JSON.stringify(v).replace(/"/g, '""')}"`
        return v.toString()
      }).join(',')
    ),
  ].join('\n')
}
