// Backup service — uses Hasura run_sql API (no Supabase client needed)

import { hasuraRunSql } from '@/lib/hasura/server'

const TABLES = [
  'companies',
  'warehouses',
  'suppliers',
  'customers',
  'material_types',
  'material_sizes',
  'item_groups',
  'item_master',
  'user_profiles',
  'tax_rates',
  'purchase_bills',
  'purchase_bill_items',
  'stock_ledger',
  'transfers',
  'transfer_items',
  'job_work_orders',
  'job_work_items',
  'dispatch_orders',
  'dispatch_items',
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

export interface BackupData {
  [table: string]: any[]
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

/** Convert Hasura result rows (array-of-arrays with header row) to objects */
function toObjects(result: string[][]): Record<string, any>[] {
  if (!result || result.length < 2) return []
  const headers = result[0]
  return result.slice(1).map(row =>
    Object.fromEntries(headers.map((h, i) => [h, row[i]]))
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

export async function listBackups(): Promise<BackupMetadata[]> {
  const { result } = await runSQL(
    `SELECT id, name, timestamp, tables, total_rows, backup_path, created_by, notes
     FROM backup_history
     WHERE deleted_at IS NULL
     ORDER BY timestamp DESC`
  )
  return toObjects(result).map(r => ({
    id: r.id,
    name: r.name,
    timestamp: r.timestamp,
    tables: r.tables ?? [],
    totalRows: Number(r.total_rows ?? 0),
    backupPath: r.backup_path,
    createdBy: r.created_by,
    notes: r.notes ?? undefined,
  }))
}

export async function getBackup(backupId: string): Promise<BackupMetadata | null> {
  const { result } = await runSQL(
    `SELECT id, name, timestamp, tables, total_rows, backup_path, created_by, notes
     FROM backup_history WHERE id = '${esc(backupId)}' LIMIT 1`
  )
  const rows = toObjects(result)
  if (!rows.length) return null
  const r = rows[0]
  return {
    id: r.id,
    name: r.name,
    timestamp: r.timestamp,
    tables: r.tables ?? [],
    totalRows: Number(r.total_rows ?? 0),
    backupPath: r.backup_path,
    createdBy: r.created_by,
    notes: r.notes ?? undefined,
  }
}

export async function deleteBackup(backupId: string): Promise<void> {
  await runSQL(
    `UPDATE backup_history SET deleted_at = NOW() WHERE id = '${esc(backupId)}'`
  )
}

export async function restoreFromBackup(
  backupData: BackupData,
  options: RestoreOptions = {}
): Promise<{ success: boolean; message: string; restored: number }> {
  const tablesToRestore = options.tables || Object.keys(backupData)
  let restoredCount = 0

  for (const table of tablesToRestore) {
    const data = backupData[table]
    if (!data?.length) continue

    try {
      if (options.truncateFirst) {
        await runSQL(`TRUNCATE TABLE ${table} CASCADE`)
      }

      const batchSize = 500
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize)
        const cols = Object.keys(batch[0]).map(c => `"${c}"`).join(', ')
        const vals = batch.map(row =>
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
        await runSQL(
          `INSERT INTO ${table} (${cols}) VALUES ${vals} ON CONFLICT DO NOTHING`
        )
        restoredCount += batch.length
      }
    } catch (err) {
      console.error(`Restore: error processing ${table}:`, err)
    }
  }

  return { success: restoredCount > 0, message: `Restored ${restoredCount} records`, restored: restoredCount }
}

export async function getPointInTimeBackup(
  timestamp: string,
  tables: string[] = TABLES
): Promise<BackupData> {
  return getAllTableData(tables, timestamp)
}

export function dataToCSV(data: any[], tableName: string): string {
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
