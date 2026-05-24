import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// List of all tables in the database
const TABLES = [
  'companies',
  'warehouses',
  'suppliers',
  'customers',
  'material_types',
  'material_sizes',
  'user_profiles',
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
  timestamp?: string // For point-in-time restore
  tables?: string[] // Specific tables to restore
  truncateFirst?: boolean // Whether to truncate tables before restore
}

/**
 * Get all data from specified tables
 */
export async function getAllTableData(
  tables: string[] = TABLES,
  beforeTimestamp?: string
): Promise<BackupData> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const backupData: BackupData = {}

  for (const table of tables) {
    try {
      let query = supabase.from(table).select('*')

      // If timestamp provided, filter for records created before that time
      if (beforeTimestamp) {
        query = query.lte('created_at', beforeTimestamp)
      }

      const { data, error } = await query

      if (error) {
        console.error(`Error fetching ${table}:`, error)
        continue
      }

      backupData[table] = data || []
    } catch (error) {
      console.error(`Error fetching ${table}:`, error)
    }
  }

  return backupData
}

/**
 * Convert data to CSV format
 */
export function dataToCSV(data: any[], tableName: string): string {
  if (data.length === 0) {
    return `"Table: ${tableName}"\n"No data found"`
  }

  const headers = Object.keys(data[0])
  const csvContent = [
    headers.map((h) => `"${h}"`).join(','),
    ...data.map((row) =>
      headers
        .map((header) => {
          const value = row[header]
          if (value === null || value === undefined) return ''
          if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`
          if (typeof value === 'object') return `"${JSON.stringify(value).replace(/"/g, '""')}"`
          return value.toString()
        })
        .join(',')
    ),
  ].join('\n')

  return csvContent
}

/**
 * Create a backup ZIP file with all tables as CSV files
 */
export async function createBackup(
  tables: string[] = TABLES,
  backupName?: string
): Promise<{
  filename: string
  metadata: BackupMetadata
  backupData: BackupData
}> {
  const timestamp = new Date().toISOString()
  const formattedDate = timestamp.replace(/[:.]/g, '-')
  const filename = `backup_${backupName || formattedDate}.json`

  // Fetch all data
  const backupData = await getAllTableData(tables)

  // Calculate total rows
  const totalRows = Object.values(backupData).reduce((sum, tableData) => sum + tableData.length, 0)

  const metadata: BackupMetadata = {
    id: crypto.randomUUID(),
    name: backupName || `Backup ${timestamp}`,
    timestamp,
    tables: Object.keys(backupData),
    totalRows,
    backupPath: `backups/${filename}`,
    createdBy: 'system',
  }

  return {
    filename,
    metadata,
    backupData,
  }
}

/**
 * Save backup metadata to database
 */
export async function saveBackupMetadata(metadata: BackupMetadata): Promise<void> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { error } = await supabase
    .from('backup_history')
    .insert([
      {
        id: metadata.id,
        name: metadata.name,
        timestamp: metadata.timestamp,
        tables: metadata.tables,
        total_rows: metadata.totalRows,
        backup_path: metadata.backupPath,
        created_by: metadata.createdBy,
        notes: metadata.notes,
      },
    ])

  if (error) {
    console.error('Error saving backup metadata:', error)
    throw error
  }
}

/**
 * Restore data from backup
 */
export async function restoreFromBackup(
  backupData: BackupData,
  options: RestoreOptions = {}
): Promise<{ success: boolean; message: string; restored: number }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const tablesToRestore = options.tables || Object.keys(backupData)
  let restoredCount = 0

  for (const table of tablesToRestore) {
    if (!backupData[table]) continue

    try {
      const data = backupData[table]

      // Truncate table if requested
      if (options.truncateFirst && data.length > 0) {
        const { error: truncateError } = await supabase.rpc('truncate_table', {
          table_name: table,
        })

        if (truncateError) {
          console.warn(`Could not truncate ${table}, proceeding with insert:`, truncateError)
        }
      }

      // Insert data in batches
      const batchSize = 1000
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize)
        const { error } = await supabase.from(table).insert(batch)

        if (error) {
          console.error(`Error restoring ${table}:`, error)
          continue
        }

        restoredCount += batch.length
      }
    } catch (error) {
      console.error(`Error processing ${table}:`, error)
    }
  }

  return {
    success: restoredCount > 0,
    message: `Restored ${restoredCount} records`,
    restored: restoredCount,
  }
}

/**
 * Get point-in-time backup (records as they existed at a specific time)
 */
export async function getPointInTimeBackup(
  timestamp: string,
  tables: string[] = TABLES
): Promise<BackupData> {
  return getAllTableData(tables, timestamp)
}

/**
 * List all available backups
 */
export async function listBackups(): Promise<BackupMetadata[]> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data, error } = await supabase
    .from('backup_history')
    .select('*')
    .order('timestamp', { ascending: false })

  if (error) {
    console.error('Error listing backups:', error)
    throw error
  }

  return (data || []).map((backup: any) => ({
    id: backup.id,
    name: backup.name,
    timestamp: backup.timestamp,
    tables: backup.tables,
    totalRows: backup.total_rows,
    backupPath: backup.backup_path,
    createdBy: backup.created_by,
    notes: backup.notes,
  }))
}

/**
 * Get specific backup metadata
 */
export async function getBackup(backupId: string): Promise<BackupMetadata | null> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data, error } = await supabase
    .from('backup_history')
    .select('*')
    .eq('id', backupId)
    .single()

  if (error) {
    console.error('Error getting backup:', error)
    return null
  }

  if (!data) return null

  return {
    id: data.id,
    name: data.name,
    timestamp: data.timestamp,
    tables: data.tables,
    totalRows: data.total_rows,
    backupPath: data.backup_path,
    createdBy: data.created_by,
    notes: data.notes,
  }
}

/**
 * Delete backup record
 */
export async function deleteBackup(backupId: string): Promise<void> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { error } = await supabase.from('backup_history').delete().eq('id', backupId)

  if (error) {
    console.error('Error deleting backup:', error)
    throw error
  }
}
