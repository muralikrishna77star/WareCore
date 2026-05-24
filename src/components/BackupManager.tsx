'use client'

import { useState, useEffect } from 'react'
import {
  createAndDownloadBackup,
  exportTableToCSV,
  exportTablesToCSV,
  getBackupsList,
  deleteBackupById,
  restoreBackup,
} from '@/lib/backup/backup.client'

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

interface Backup {
  id: string
  name: string
  timestamp: string
  tables: string[]
  totalRows: number
  createdBy: string
  notes?: string
}

export function BackupManager() {
  const [backups, setBackups] = useState<Backup[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'backup' | 'restore' | 'export'>('backup')
  const [selectedTables, setSelectedTables] = useState<string[]>(TABLES)
  const [backupName, setBackupName] = useState('')
  const [backupNotes, setBackupNotes] = useState('')
  const [pointInTime, setPointInTime] = useState('')
  const [message, setMessage] = useState('')

  // Load backups on mount
  useEffect(() => {
    loadBackups()
  }, [])

  const loadBackups = async () => {
    try {
      setLoading(true)
      const data = await getBackupsList()
      setBackups(data)
    } catch (error) {
      setMessage(`Error loading backups: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateBackup = async () => {
    try {
      setLoading(true)
      setMessage('Creating backup...')
      await createAndDownloadBackup(selectedTables, backupName || undefined, backupNotes || undefined)
      setMessage('Backup created and downloaded successfully!')
      setBackupName('')
      setBackupNotes('')
      await loadBackups()
    } catch (error) {
      setMessage(`Error creating backup: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  const handleExportTable = async (table: string) => {
    try {
      setLoading(true)
      setMessage(`Exporting ${table}...`)
      await exportTableToCSV(table, pointInTime || undefined)
      setMessage(`${table} exported successfully!`)
    } catch (error) {
      setMessage(`Error exporting ${table}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  const handleExportAll = async () => {
    try {
      setLoading(true)
      setMessage('Exporting all tables...')
      await exportTablesToCSV(selectedTables, pointInTime || undefined)
      setMessage('All tables exported successfully!')
    } catch (error) {
      setMessage(`Error exporting tables: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteBackup = async (backupId: string) => {
    if (!confirm('Are you sure you want to delete this backup?')) {
      return
    }

    try {
      setLoading(true)
      await deleteBackupById(backupId)
      setMessage('Backup deleted successfully!')
      await loadBackups()
    } catch (error) {
      setMessage(`Error deleting backup: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  const toggleTableSelection = (table: string) => {
    setSelectedTables((prev) =>
      prev.includes(table) ? prev.filter((t) => t !== table) : [...prev, table]
    )
  }

  const toggleAllTables = (select: boolean) => {
    setSelectedTables(select ? TABLES : [])
  }

  return (
    <div className="w-full max-w-6xl mx-auto p-6 bg-white rounded-lg shadow">
      <h1 className="text-3xl font-bold mb-6">Backup & Restore Manager</h1>

      {message && (
        <div className={`mb-4 p-4 rounded ${message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
          {message}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b mb-6">
        <button
          onClick={() => setActiveTab('backup')}
          className={`px-4 py-2 font-semibold ${
            activeTab === 'backup' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-600'
          }`}
        >
          Create Backup
        </button>
        <button
          onClick={() => setActiveTab('restore')}
          className={`px-4 py-2 font-semibold ${
            activeTab === 'restore' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-600'
          }`}
        >
          Restore
        </button>
        <button
          onClick={() => setActiveTab('export')}
          className={`px-4 py-2 font-semibold ${
            activeTab === 'export' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-600'
          }`}
        >
          Export Data
        </button>
      </div>

      {/* Create Backup Tab */}
      {activeTab === 'backup' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Backup Name (Optional)</label>
            <input
              type="text"
              value={backupName}
              onChange={(e) => setBackupName(e.target.value)}
              placeholder="e.g., Monthly Backup"
              className="w-full px-3 py-2 border rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Notes (Optional)</label>
            <textarea
              value={backupNotes}
              onChange={(e) => setBackupNotes(e.target.value)}
              placeholder="Add any notes about this backup..."
              className="w-full px-3 py-2 border rounded h-20"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium">Select Tables to Backup</label>
              <div className="space-x-2">
                <button
                  onClick={() => toggleAllTables(true)}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Select All
                </button>
                <button
                  onClick={() => toggleAllTables(false)}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Deselect All
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {TABLES.map((table) => (
                <label key={table} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={selectedTables.includes(table)}
                    onChange={() => toggleTableSelection(table)}
                    className="mr-2"
                  />
                  <span className="text-sm">{table}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={handleCreateBackup}
            disabled={loading || selectedTables.length === 0}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
          >
            {loading ? 'Creating Backup...' : 'Create & Download Backup'}
          </button>
        </div>
      )}

      {/* Restore Tab */}
      {activeTab === 'restore' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold mb-4">Available Backups</h3>
            {backups.length === 0 ? (
              <p className="text-gray-500">No backups available</p>
            ) : (
              <div className="space-y-2">
                {backups.map((backup) => (
                  <div key={backup.id} className="border p-4 rounded">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-semibold">{backup.name}</h4>
                        <p className="text-sm text-gray-600">
                          Created: {new Date(backup.timestamp).toLocaleString()}
                        </p>
                        <p className="text-sm text-gray-600">
                          Tables: {backup.tables.length} | Rows: {backup.totalRows}
                        </p>
                        <p className="text-sm text-gray-600">Created by: {backup.createdBy}</p>
                        {backup.notes && (
                          <p className="text-sm text-gray-600">Notes: {backup.notes}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleDeleteBackup(backup.id)}
                        className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-yellow-50 border border-yellow-200 p-4 rounded">
            <p className="text-sm text-yellow-800">
              <strong>Note:</strong> To restore data from a backup, download a backup file from "Create Backup" tab and upload it using your database management tools, or contact your administrator.
            </p>
          </div>
        </div>
      )}

      {/* Export Tab */}
      {activeTab === 'export' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Point-in-Time (Optional) - Format: YYYY-MM-DD or full ISO timestamp
            </label>
            <input
              type="text"
              value={pointInTime}
              onChange={(e) => setPointInTime(e.target.value)}
              placeholder="e.g., 2024-01-15 or 2024-01-15T10:30:00Z"
              className="w-full px-3 py-2 border rounded"
            />
            <p className="text-xs text-gray-500 mt-1">
              Leave empty to export current data
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-4">Export Single Table</h3>
            <div className="grid grid-cols-2 gap-2">
              {TABLES.map((table) => (
                <button
                  key={table}
                  onClick={() => handleExportTable(table)}
                  disabled={loading}
                  className="px-3 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:bg-gray-400"
                >
                  Export {table}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-4">Export Multiple Tables</h3>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium">Select Tables</label>
                <div className="space-x-2">
                  <button
                    onClick={() => toggleAllTables(true)}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => toggleAllTables(false)}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {TABLES.map((table) => (
                  <label key={table} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={selectedTables.includes(table)}
                      onChange={() => toggleTableSelection(table)}
                      className="mr-2"
                    />
                    <span className="text-sm">{table}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={handleExportAll}
              disabled={loading || selectedTables.length === 0}
              className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
            >
              {loading ? 'Exporting...' : `Export ${selectedTables.length} Tables as CSV`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
