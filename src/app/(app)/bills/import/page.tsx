'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface BatchSummary {
  id: string
  batch_number: string
  file_name: string
  status: string
  row_count: string
  valid_rows: string
  reviewed_rows: string
  created_at: string
  imported_at: string | null
}

interface DuplicateMatch {
  id: string
  batchNumber: string
  status: string
  createdAt: string
}

interface UploadError {
  rowNumber: number | null
  column?: string
  message: string
}

const STATUS_COLOR: Record<string, string> = {
  STAGED: 'bg-amber-100 text-amber-800',
  IMPORTED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-gray-100 text-gray-500',
}

export default function BillsImportPage() {
  const router = useRouter()
  const [batches, setBatches] = useState<BatchSummary[]>([])
  const [loadingBatches, setLoadingBatches] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [uploadErrors, setUploadErrors] = useState<UploadError[]>([])
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadBatches = async () => {
    setLoadingBatches(true)
    try {
      const res = await fetch('/api/bills/import/batches')
      const data = await res.json().catch(() => ({}))
      if (res.ok) setBatches(data.batches ?? [])
    } finally {
      setLoadingBatches(false)
    }
  }

  useEffect(() => { loadBatches() }, [])

  const upload = async (file: File, confirmDuplicate: boolean) => {
    setUploading(true)
    setError('')
    setUploadErrors([])
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (confirmDuplicate) fd.append('confirmDuplicate', 'true')
      const res = await fetch('/api/bills/import/batches', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Server error (${res.status})`)
        setUploadErrors(data.errors ?? [])
        return
      }
      if (data.duplicate) {
        setDuplicates(data.matchingBatches)
        setPendingFile(file)
        return
      }
      router.push(`/bills/import/${data.batchId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setUploading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setDuplicates(null)
    setPendingFile(null)
    upload(f, false)
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-[1.4375rem] font-bold text-gray-900">Import Purchase Bills from Excel</h1>
        <p className="mt-1 text-[0.9375rem] text-gray-500">
          Upload a spreadsheet, review and correct any problem rows, then import once everything checks out.
          Importing posts directly to stock, the same as saving a bill manually.
        </p>
      </div>

      <div className="rounded-xl border bg-white p-6 space-y-4">
        <a
          href="/api/bills/import/template"
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Download template (.xlsx)
        </a>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Upload filled template</label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            onChange={handleFileChange}
            disabled={uploading}
            className="block w-full text-sm text-gray-600 file:mr-4 file:rounded file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
          />
        </div>
        {uploading && <p className="text-sm text-gray-500">Uploading and validating…</p>}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm font-medium text-red-700">{error}</p>
            {uploadErrors.length > 1 && (
              <ul className="mt-2 space-y-1 text-sm text-red-600">
                {uploadErrors.map((e, i) => (
                  <li key={i}>{e.rowNumber ? <span className="font-mono text-xs">Row {e.rowNumber}{e.column ? ` (${e.column})` : ''}: </span> : null}{e.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {duplicates && pendingFile && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">This file looks like it was already uploaded:</p>
            <ul className="mt-2 space-y-1 text-sm text-amber-800">
              {duplicates.map((d) => (
                <li key={d.id}>
                  <Link href={`/bills/import/${d.id}`} className="underline hover:no-underline">{d.batchNumber}</Link>
                  {' '}— {d.status}, uploaded {new Date(d.createdAt).toLocaleString()}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => { const f = pendingFile; setDuplicates(null); setPendingFile(null); upload(f, true) }}
                className="rounded border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
              >
                Upload anyway
              </button>
              <button
                type="button"
                onClick={() => { setDuplicates(null); setPendingFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50">
          <span className="font-semibold text-gray-700 text-sm">Import batches</span>
        </div>
        {loadingBatches ? (
          <p className="p-4 text-sm text-gray-500">Loading…</p>
        ) : batches.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">No import batches yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase text-gray-500 border-b">
                <th className="px-4 py-2 text-left">Batch</th>
                <th className="px-4 py-2 text-left">File</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-right">Valid</th>
                <th className="px-4 py-2 text-right">Reviewed</th>
                <th className="px-4 py-2 text-left">Uploaded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {batches.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <Link href={`/bills/import/${b.id}`} className="text-blue-600 underline hover:no-underline font-medium">{b.batch_number}</Link>
                  </td>
                  <td className="px-4 py-2 text-gray-600">{b.file_name}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[b.status] ?? 'bg-gray-100'}`}>{b.status}</span>
                  </td>
                  <td className="px-4 py-2 text-right text-gray-600">{b.valid_rows}/{b.row_count}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{b.reviewed_rows}/{b.row_count}</td>
                  <td className="px-4 py-2 text-gray-500">{new Date(b.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
