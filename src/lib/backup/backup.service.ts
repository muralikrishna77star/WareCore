// Backup service — uses Hasura run_sql API (no Supabase client needed)

import { hasuraRunSql } from '@/lib/hasura/server'
import { BACKUP_TABLES } from './tables'

export const TABLES = BACKUP_TABLES

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

/**
 * One table's rows for a backup. Unlike getAllTableData() this throws on a
 * failed read, so a backup stops with an error rather than quietly saving
 * that table as empty.
 */
export async function readTableForBackup(table: string): Promise<BackupRow[]> {
  const { result } = await runSQL(`SELECT * FROM ${table}`)
  return toObjects<BackupRow>(result)
}

export function buildBackupMetadata(
  tables: string[],
  totalRows: number,
  backupName?: string
): BackupMetadata {
  const timestamp = new Date().toISOString()
  const formattedDate = timestamp.replace(/[:.]/g, '-')
  const filename = `backup_${backupName ? esc(backupName) : formattedDate}.json`

  return {
    id: crypto.randomUUID(),
    name: backupName || `Backup ${timestamp}`,
    timestamp,
    tables,
    totalRows,
    backupPath: `backups/${filename}`,
    createdBy: 'system',
  }
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
// array, so toBackupMetadata() splits it into the real string[] callers expect.
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
    tables: (r.tables ?? '').replace(/^\{|\}$/g, '').split(',').filter(Boolean),
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

// Columns pointing at another row of the same table, which may not have been
// restored yet.
const LATER_ROW_COLUMNS: Record<string, string[]> = {
  job_work_items: ['source_job_work_item_id'],
  purchase_import_batches: ['duplicate_of_batch_id'],
}

function pointsAtLaterRow(table: string, row: BackupRow): boolean {
  return (LATER_ROW_COLUMNS[table] ?? []).some((column) => {
    const value = row[column]
    return value !== null && value !== undefined && value !== 'NULL'
  })
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

  // When the backup brings its own stock_ledger, the document tables must NOT
  // post stock as they're re-inserted — the ledger rows come from the backup.
  // Inserting a sale/purchase/job work/transfer line fires its ledger-posting
  // trigger, which (before migration 174) posted every movement a second time
  // on top of the restored ledger. Those triggers now stay silent while the
  // transaction-local 'warecore.restoring' setting is on; it's set in the same
  // statement batch as each INSERT, so it never leaks to other requests. A
  // restore WITHOUT the ledger leaves the triggers on, so the restored
  // documents still get their stock.
  const ledgerFromBackup = tablesToRestore.includes('stock_ledger') && (backupData.stock_ledger?.length ?? 0) > 0
  const insertSQL = (table: string, rows: BackupRow[]) =>
    (ledgerFromBackup ? "SELECT set_config('warecore.restoring', 'on', true);\n" : '') + rowsToInsertSQL(table, rows)

  let restoredCount = 0
  const tableResults: Record<string, RestoreTableResult> = {}
  const tablesWithRows = tablesToRestore.filter((table) => backupData[table]?.length)
  for (const table of tablesWithRows) {
    tableResults[table] = { attempted: backupData[table].length, restored: 0, failed: 0, sampleErrors: [] }
  }

  // Everything is emptied in ONE statement, before anything is inserted.
  // Truncating table by table between inserts is unsafe: CASCADE also empties
  // every table that references the one being truncated, including any that
  // had already been restored.
  if (options.truncateFirst && tablesWithRows.length) {
    try {
      await runSQL(`TRUNCATE TABLE ${tablesWithRows.join(', ')} CASCADE`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Restore: error truncating tables:', err)
      for (const table of tablesWithRows) {
        tableResults[table].failed = tableResults[table].attempted
        tableResults[table].sampleErrors.push(message)
      }
      return { success: false, message: `Restore stopped before any data changed: ${message}`, restored: 0, tableResults }
    }
  }

  // Rows that can't go in yet because the row they point at comes later.
  // They're retried once every table has had its turn.
  let waiting: { table: string; row: BackupRow; error?: string }[] = []

  for (const table of tablesWithRows) {
    const result = tableResults[table]
    const ready: BackupRow[] = []
    for (const row of backupData[table]) {
      if (pointsAtLaterRow(table, row)) waiting.push({ table, row })
      else ready.push(row)
    }

    const batchSize = 500
    for (let i = 0; i < ready.length; i += batchSize) {
      const batch = ready.slice(i, i + batchSize)
      try {
        await runSQL(insertSQL(table, batch))
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
            await runSQL(insertSQL(table, [row]))
            result.restored += 1
            restoredCount += 1
          } catch (rowErr) {
            waiting.push({ table, row, error: rowErr instanceof Error ? rowErr.message : String(rowErr) })
          }
        }
      }
    }
  }

  // Each pass can unblock the next (a line sourced from another line that was
  // itself waiting), so keep going until a full pass makes no progress.
  // Whatever is left then is a row that really can't be restored.
  while (waiting.length) {
    const stillWaiting: typeof waiting = []
    for (const item of waiting) {
      try {
        await runSQL(insertSQL(item.table, [item.row]))
        tableResults[item.table].restored += 1
        restoredCount += 1
      } catch (rowErr) {
        stillWaiting.push({ ...item, error: rowErr instanceof Error ? rowErr.message : String(rowErr) })
      }
    }
    const noProgress = stillWaiting.length === waiting.length
    waiting = stillWaiting
    if (noProgress) break
  }

  for (const { table, error } of waiting) {
    const result = tableResults[table]
    result.failed += 1
    if (error && result.sampleErrors.length < 5) result.sampleErrors.push(error)
  }
  for (const table of tablesWithRows) {
    const result = tableResults[table]
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
