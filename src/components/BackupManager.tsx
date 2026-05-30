'use client'

import { useState, useEffect, useRef } from 'react'
import {
  createAndDownloadBackup,
  exportTableToCSV,
  exportTablesToCSV,
  getBackupsList,
  deleteBackupById,
  restoreBackup,
} from '@/lib/backup/backup.client'

const TABLES = [
  'companies', 'warehouses', 'suppliers', 'customers',
  'material_types', 'material_sizes', 'item_groups', 'item_master',
  'user_profiles', 'purchase_bills', 'purchase_bill_items',
  'stock_ledger', 'transfers', 'transfer_items',
  'job_work_orders', 'job_work_items', 'dispatch_orders', 'dispatch_items',
  'financial_entries',
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

type Tab = 'backup' | 'restore' | 'export'

export function BackupManager() {
  const [backups, setBackups] = useState<Backup[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('backup')
  const [selectedTables, setSelectedTables] = useState<string[]>(TABLES)
  const [backupName, setBackupName] = useState('')
  const [backupNotes, setBackupNotes] = useState('')
  const [pointInTime, setPointInTime] = useState('')
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null)

  // Restore state
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restoreFileData, setRestoreFileData] = useState<any>(null)
  const [restoreTables, setRestoreTables] = useState<string[]>([])
  const [truncateFirst, setTruncateFirst] = useState(false)
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
  const [restoreLoading, setRestoreLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadBackups() }, [])

  const loadBackups = async () => {
    try {
      setLoading(true)
      const data = await getBackupsList()
      setBackups(Array.isArray(data) ? data : [])
    } catch (error) {
      setMessage({ text: `Error loading backups: ${error instanceof Error ? error.message : String(error)}`, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const showMsg = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setMessage({ text, type })
    if (type !== 'error') setTimeout(() => setMessage(null), 5000)
  }

  // ── Create Backup ────────────────────────────────────────────────────────────
  const handleCreateBackup = async () => {
    try {
      setLoading(true)
      showMsg('Creating backup — this may take a moment…', 'info')
      await createAndDownloadBackup(selectedTables, backupName || undefined, backupNotes || undefined)
      showMsg('Backup created and downloaded successfully!', 'success')
      setBackupName('')
      setBackupNotes('')
      await loadBackups()
    } catch (error) {
      showMsg(`Error creating backup: ${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── File Upload for Restore ──────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setRestoreFile(file)
    setRestoreFileData(null)
    setRestoreTables([])
    setMessage(null)

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string)
        if (!parsed?.data || typeof parsed.data !== 'object') {
          showMsg('Invalid backup file — expected a WareCore JSON backup.', 'error')
          return
        }
        setRestoreFileData(parsed)
        const tablesInFile = Object.keys(parsed.data)
        setRestoreTables(tablesInFile)
        showMsg(`Backup loaded: ${tablesInFile.length} tables, created ${new Date(parsed.backup?.timestamp ?? Date.now()).toLocaleString()}`, 'success')
      } catch {
        showMsg('Could not parse file — make sure it is a valid WareCore JSON backup.', 'error')
      }
    }
    reader.readAsText(file)
  }

  const handleRestoreConfirm = async () => {
    if (!restoreFileData) return
    setShowRestoreConfirm(false)
    setRestoreLoading(true)
    showMsg('Restoring data — do not close this page…', 'info')
    try {
      await restoreBackup(restoreFileData.data, { tables: restoreTables, truncateFirst })
      showMsg(`Restore complete! ${restoreTables.length} tables restored.`, 'success')
      setRestoreFile(null)
      setRestoreFileData(null)
      setRestoreTables([])
      setTruncateFirst(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (error) {
      showMsg(`Restore failed: ${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setRestoreLoading(false)
    }
  }

  // ── Export ───────────────────────────────────────────────────────────────────
  const handleExportTable = async (table: string) => {
    try {
      setLoading(true)
      showMsg(`Exporting ${table}…`, 'info')
      await exportTableToCSV(table, pointInTime || undefined)
      showMsg(`${table} exported successfully!`, 'success')
    } catch (error) {
      showMsg(`Error exporting ${table}: ${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleExportAll = async () => {
    try {
      setLoading(true)
      showMsg('Exporting selected tables…', 'info')
      await exportTablesToCSV(selectedTables, pointInTime || undefined)
      showMsg('Export complete!', 'success')
    } catch (error) {
      showMsg(`Error exporting: ${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteBackup = async (backupId: string) => {
    if (!confirm('Delete this backup record? This cannot be undone.')) return
    try {
      setLoading(true)
      await deleteBackupById(backupId)
      showMsg('Backup record deleted.', 'success')
      await loadBackups()
    } catch (error) {
      showMsg(`Error deleting backup: ${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const toggleTable = (table: string, list: string[], setter: (v: string[]) => void) =>
    setter(list.includes(table) ? list.filter((t) => t !== table) : [...list, table])

  const tabCls = (tab: Tab) =>
    `px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
      activeTab === tab
        ? 'border-blue-600 text-blue-700'
        : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
    }`

  const msgBg = message?.type === 'error' ? 'bg-red-50 border-red-200 text-red-800'
    : message?.type === 'success' ? 'bg-green-50 border-green-200 text-green-800'
    : 'bg-blue-50 border-blue-200 text-blue-800'

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Backup & Restore</h1>
        <p className="mt-1 text-sm text-gray-500">
          Create full database backups, restore from a backup file, or export individual tables as CSV.
        </p>
      </div>

      {/* Message banner */}
      {message && (
        <div className={`rounded-lg border px-4 py-3 text-sm flex items-start justify-between gap-3 ${msgBg}`}>
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} className="shrink-0 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Tabs */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-200">
          <button className={tabCls('backup')} onClick={() => setActiveTab('backup')}>💾 Create Backup</button>
          <button className={tabCls('restore')} onClick={() => setActiveTab('restore')}>🔄 Restore</button>
          <button className={tabCls('export')} onClick={() => setActiveTab('export')}>📤 Export CSV</button>
        </div>

        <div className="p-6">

          {/* ── CREATE BACKUP ── */}
          {activeTab === 'backup' && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Backup Name <span className="text-gray-400">(optional)</span></label>
                  <input
                    type="text"
                    value={backupName}
                    onChange={(e) => setBackupName(e.target.value)}
                    placeholder="e.g. Monthly Backup June"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes <span className="text-gray-400">(optional)</span></label>
                  <input
                    type="text"
                    value={backupNotes}
                    onChange={(e) => setBackupNotes(e.target.value)}
                    placeholder="e.g. Before year-end migration"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Tables to include</span>
                  <div className="flex gap-3">
                    <button onClick={() => setSelectedTables([...TABLES])} className="text-xs text-blue-600 hover:underline">All</button>
                    <button onClick={() => setSelectedTables([])} className="text-xs text-blue-600 hover:underline">None</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-1.5 gap-x-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                  {TABLES.map((table) => (
                    <label key={table} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedTables.includes(table)}
                        onChange={() => toggleTable(table, selectedTables, setSelectedTables)}
                        className="rounded"
                      />
                      {table}
                    </label>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-gray-400">{selectedTables.length} of {TABLES.length} tables selected</p>
              </div>

              <button
                onClick={handleCreateBackup}
                disabled={loading || selectedTables.length === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? '⏳ Creating…' : '💾 Create & Download Backup'}
              </button>

              {/* Backup history */}
              {backups.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent Backups</h3>
                  <div className="space-y-2">
                    {backups.slice(0, 5).map((b) => (
                      <div key={b.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
                        <div>
                          <span className="font-medium text-gray-900">{b.name || 'Unnamed backup'}</span>
                          <span className="ml-3 text-gray-400">{new Date(b.timestamp).toLocaleString('en-IN')}</span>
                          <span className="ml-3 text-gray-400">{b.tables?.length ?? 0} tables · {b.totalRows?.toLocaleString() ?? 0} rows</span>
                          {b.notes && <span className="ml-3 text-gray-400 italic">"{b.notes}"</span>}
                        </div>
                        <button
                          onClick={() => handleDeleteBackup(b.id)}
                          className="text-xs text-red-500 hover:text-red-700 ml-4"
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── RESTORE ── */}
          {activeTab === 'restore' && (
            <div className="space-y-5">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <strong>⚠️ Warning:</strong> Restoring will overwrite existing data in the selected tables.
                Use "Truncate before restore" only if you want to completely replace a table's contents.
                Always create a fresh backup before restoring.
              </div>

              {/* Step 1: Upload file */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Step 1 — Upload backup file (.json)</label>
                <div
                  className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {restoreFile ? (
                    <div>
                      <p className="text-sm font-medium text-gray-900">📄 {restoreFile.name}</p>
                      <p className="text-xs text-gray-500 mt-1">{(restoreFile.size / 1024).toFixed(1)} KB — click to change</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-3xl mb-2">📂</p>
                      <p className="text-sm font-medium text-gray-700">Click to select a WareCore backup file</p>
                      <p className="text-xs text-gray-400 mt-1">JSON format only</p>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>
              </div>

              {/* Step 2: Select tables */}
              {restoreFileData && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-semibold text-gray-700">Step 2 — Tables to restore</label>
                    <div className="flex gap-3">
                      <button onClick={() => setRestoreTables(Object.keys(restoreFileData.data))} className="text-xs text-blue-600 hover:underline">All</button>
                      <button onClick={() => setRestoreTables([])} className="text-xs text-blue-600 hover:underline">None</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-1.5 gap-x-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                    {Object.keys(restoreFileData.data).map((table) => {
                      const count = Array.isArray(restoreFileData.data[table]) ? restoreFileData.data[table].length : 0
                      return (
                        <label key={table} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={restoreTables.includes(table)}
                            onChange={() => toggleTable(table, restoreTables, setRestoreTables)}
                            className="rounded"
                          />
                          <span>{table}</span>
                          <span className="text-xs text-gray-400">({count})</span>
                        </label>
                      )
                    })}
                  </div>
                  <p className="mt-1.5 text-xs text-gray-400">{restoreTables.length} tables selected for restore</p>
                </div>
              )}

              {/* Step 3: Options */}
              {restoreFileData && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Step 3 — Options</label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={truncateFirst}
                      onChange={(e) => setTruncateFirst(e.target.checked)}
                      className="mt-0.5 rounded"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900">Truncate tables before restore</span>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Deletes all existing rows in each selected table before inserting backup data.
                        Leave unchecked to merge / upsert (existing records with the same ID are skipped).
                      </p>
                    </div>
                  </label>
                </div>
              )}

              {/* Restore button */}
              {restoreFileData && (
                <button
                  onClick={() => setShowRestoreConfirm(true)}
                  disabled={restoreLoading || restoreTables.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {restoreLoading ? '⏳ Restoring…' : `🔄 Restore ${restoreTables.length} Tables`}
                </button>
              )}

              {/* Backup history for reference */}
              {backups.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Backup History</h3>
                  <div className="space-y-2">
                    {backups.map((b) => (
                      <div key={b.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm bg-white">
                        <div>
                          <span className="font-medium text-gray-900">{b.name || 'Unnamed backup'}</span>
                          <span className="ml-3 text-gray-400">{new Date(b.timestamp).toLocaleString('en-IN')}</span>
                          <span className="ml-3 text-gray-400">{b.tables?.length ?? 0} tables · {b.totalRows?.toLocaleString() ?? 0} rows</span>
                          <span className="ml-3 text-gray-400">by {b.createdBy}</span>
                        </div>
                        <button onClick={() => handleDeleteBackup(b.id)} className="text-xs text-red-500 hover:text-red-700 ml-4">Delete</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── EXPORT ── */}
          {activeTab === 'export' && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Point-in-Time <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={pointInTime}
                  onChange={(e) => setPointInTime(e.target.value)}
                  placeholder="e.g. 2025-01-15 or 2025-01-15T10:30:00Z"
                  className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                <p className="text-xs text-gray-400 mt-1">Leave empty to export current data</p>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Export Single Table as CSV</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {TABLES.map((table) => (
                    <button
                      key={table}
                      onClick={() => handleExportTable(table)}
                      disabled={loading}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:border-blue-400 disabled:opacity-50 transition-colors text-left"
                    >
                      📄 {table}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t pt-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-700">Export Multiple Tables</h3>
                  <div className="flex gap-3">
                    <button onClick={() => setSelectedTables([...TABLES])} className="text-xs text-blue-600 hover:underline">All</button>
                    <button onClick={() => setSelectedTables([])} className="text-xs text-blue-600 hover:underline">None</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-1.5 gap-x-4 rounded-lg border border-gray-200 bg-gray-50 p-4 mb-4">
                  {TABLES.map((table) => (
                    <label key={table} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedTables.includes(table)}
                        onChange={() => toggleTable(table, selectedTables, setSelectedTables)}
                        className="rounded"
                      />
                      {table}
                    </label>
                  ))}
                </div>
                <button
                  onClick={handleExportAll}
                  disabled={loading || selectedTables.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? '⏳ Exporting…' : `📤 Export ${selectedTables.length} Tables as CSV`}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Restore Confirmation Modal */}
      {showRestoreConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Confirm Restore</h2>
            <p className="text-sm text-gray-700">
              You are about to restore <strong>{restoreTables.length} table{restoreTables.length !== 1 ? 's' : ''}</strong>
              {truncateFirst ? <span className="text-red-600"> and delete all existing data in those tables first</span> : ' (merging with existing data)'}.
            </p>
            <p className="text-sm text-gray-500">
              Tables: <span className="font-mono text-xs">{restoreTables.join(', ')}</span>
            </p>
            <p className="text-sm font-semibold text-amber-700">This action cannot be undone. Are you sure?</p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowRestoreConfirm(false)}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRestoreConfirm}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
              >
                Yes, Restore Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
