/**
 * Client-side backup utilities for downloading and managing backups
 */

export interface DownloadOptions {
  filename?: string
  format?: 'json' | 'csv'
}

/**
 * Download data as file (client-side)
 */
export function downloadFile(
  content: string,
  filename: string,
  contentType: string = 'application/json'
): void {
  const blob = new Blob([content], { type: contentType })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

/**
 * Create and download backup
 */
export async function createAndDownloadBackup(
  tables?: string[],
  backupName?: string,
  notes?: string
): Promise<void> {
  try {
    const response = await fetch('/api/backup/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tables,
        name: backupName,
        notes,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to create backup')
    }

    const { data, backup } = await response.json()

    // Download as JSON
    const json = JSON.stringify(
      {
        backup: backup,
        data: data,
      },
      null,
      2
    )

    const filename = `backup_${backup.id}.json`
    downloadFile(json, filename, 'application/json')
  } catch (error) {
    console.error('Error creating backup:', error)
    throw error
  }
}

/**
 * Export single table to CSV
 */
export async function exportTableToCSV(
  table: string,
  pointInTime?: string
): Promise<void> {
  try {
    const params = new URLSearchParams({
      table,
      format: 'csv',
    })

    if (pointInTime) {
      params.append('pointInTime', pointInTime)
    }

    const response = await fetch(`/api/backup/export?${params}`)

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to export table')
    }

    // Get filename from headers
    const contentDisposition = response.headers.get('content-disposition')
    let filename = `${table}.csv`
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/)
      if (filenameMatch) filename = filenameMatch[1]
    }

    const text = await response.text()
    downloadFile(text, filename, 'text/csv')
  } catch (error) {
    console.error('Error exporting table:', error)
    throw error
  }
}

/**
 * Export multiple tables to CSV
 */
export async function exportTablesToCSV(
  tables: string[],
  pointInTime?: string
): Promise<void> {
  try {
    const response = await fetch('/api/backup/export', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tables,
        format: 'csv',
        pointInTime,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to export tables')
    }

    const contentDisposition = response.headers.get('content-disposition')
    let filename = 'backup_all_tables.csv'
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/)
      if (filenameMatch) filename = filenameMatch[1]
    }

    const text = await response.text()
    downloadFile(text, filename, 'text/csv')
  } catch (error) {
    console.error('Error exporting tables:', error)
    throw error
  }
}

/**
 * Export table as JSON
 */
export async function exportTableToJSON(
  table: string,
  pointInTime?: string
): Promise<any> {
  try {
    const params = new URLSearchParams({
      table,
      format: 'json',
    })

    if (pointInTime) {
      params.append('pointInTime', pointInTime)
    }

    const response = await fetch(`/api/backup/export?${params}`)

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to export table')
    }

    return response.json()
  } catch (error) {
    console.error('Error exporting table:', error)
    throw error
  }
}

/**
 * Restore from backup
 */
export async function restoreBackup(
  backupData: any,
  options?: {
    tables?: string[]
    truncateFirst?: boolean
    pointInTime?: string
  }
): Promise<void> {
  try {
    const response = await fetch('/api/backup/restore', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        backupData,
        tables: options?.tables,
        truncateFirst: options?.truncateFirst,
        pointInTime: options?.pointInTime,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to restore backup')
    }

    return response.json()
  } catch (error) {
    console.error('Error restoring backup:', error)
    throw error
  }
}

/**
 * Get list of backups
 */
export async function getBackupsList(): Promise<any[]> {
  try {
    const response = await fetch('/api/backup/metadata')

    if (!response.ok) {
      throw new Error('Failed to fetch backups')
    }

    return response.json()
  } catch (error) {
    console.error('Error fetching backups:', error)
    throw error
  }
}

/**
 * Delete backup
 */
export async function deleteBackupById(backupId: string): Promise<void> {
  try {
    const response = await fetch(`/api/backup/metadata?id=${backupId}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to delete backup')
    }
  } catch (error) {
    console.error('Error deleting backup:', error)
    throw error
  }
}
