'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import type { ResolvedBill, RowError } from '@/lib/purchaseImport/types'

type Step = 'upload' | 'preview' | 'results'

interface CommitResultBill {
  id: string
  billNumber: string
  companyLabel: string
  warehouseLabel: string
  supplierLabel: string
  billDate: string
  lineCount: number
  totalQuantity: number
  totalAmount: number
}

interface CommitResult {
  bills: CommitResultBill[]
  totalBills: number
  totalLines: number
  totalQuantity: number
  totalAmount: number
}

export default function BillsImportPage() {
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ bills: ResolvedBill[]; errors: RowError[] } | null>(null)
  const [results, setResults] = useState<CommitResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setStep('upload'); setFile(null); setFileName(''); setPreview(null); setResults(null); setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f); setFileName(f.name); setError(''); setLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const res = await fetch('/api/bills/import/preview', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Server error (${res.status})`); return }
      setPreview({ bills: data.bills ?? [], errors: data.errors ?? [] })
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = async () => {
    if (!file) return
    setLoading(true); setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/bills/import/commit', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Server error (${res.status})`)
        if (data.errors) setPreview({ bills: [], errors: data.errors })
        return
      }
      setResults(data)
      setStep('results')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-[1.4375rem] font-bold text-gray-900">Import Purchase Bills from Excel</h1>
        <p className="mt-1 text-[0.9375rem] text-gray-500">
          Upload a spreadsheet of purchases. Each row must match existing Company, Warehouse, Supplier, Material Type,
          Size, and Tax Rate names/codes exactly — download the template below for the exact spelling to use.
          Importing posts directly to stock, the same as saving a bill manually.
        </p>
      </div>

      {step === 'upload' && (
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
              disabled={loading}
              className="block w-full text-sm text-gray-600 file:mr-4 file:rounded file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>
          {loading && <p className="text-sm text-gray-500">Reading {fileName}…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-4">
          {preview.errors.length > 0 ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-900">
                {preview.errors.length} error{preview.errors.length === 1 ? '' : 's'} found — nothing will be imported until these are fixed.
              </p>
              <ul className="mt-3 space-y-1 text-sm text-red-800">
                {preview.errors.map((e, i) => (
                  <li key={i}>
                    {e.rowNumber ? <span className="font-mono text-xs">Row {e.rowNumber}{e.column ? ` (${e.column})` : ''}: </span> : null}
                    {e.message}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={reset}
                className="mt-4 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Fix the file and re-upload
              </button>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">
                  {preview.bills.length} bill{preview.bills.length === 1 ? '' : 's'}, {preview.bills.reduce((s, b) => s + b.lines.length, 0)} line
                  {preview.bills.reduce((s, b) => s + b.lines.length, 0) === 1 ? '' : 's'} ready to import.
                </p>
                <p className="mt-1 text-sm text-amber-800">
                  Confirming will create these bills as Active and post to the stock ledger immediately — same as saving a bill manually. This cannot be undone from this screen.
                </p>
              </div>

              {preview.bills.map((bill) => (
                <div key={bill.groupKey} className="rounded-xl border bg-white overflow-hidden">
                  <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <span className="font-semibold text-gray-900">{bill.billNumber}</span>
                      <span className="text-sm text-gray-500 ml-2">{bill.companyLabel} · {bill.warehouseLabel} · {bill.supplierLabel} · {bill.billDate}</span>
                    </div>
                    <span className="text-sm text-gray-700">Qty {bill.totalQuantity} · ₹{bill.totalAmount.toLocaleString('en-IN')}</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase text-gray-500 border-b">
                        <th className="px-4 py-2 text-left">Row</th>
                        <th className="px-4 py-2 text-left">Line ID</th>
                        <th className="px-4 py-2 text-left">Item</th>
                        <th className="px-4 py-2 text-right">Qty</th>
                        <th className="px-4 py-2 text-left">Unit</th>
                        <th className="px-4 py-2 text-right">Rate</th>
                        <th className="px-4 py-2 text-right">Amount</th>
                        <th className="px-4 py-2 text-right">Total w/ Tax</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {bill.lines.map((line) => (
                        <tr key={line.rowNumber}>
                          <td className="px-4 py-2 text-gray-400 font-mono text-xs">{line.rowNumber}</td>
                          <td className="px-4 py-2 font-mono text-xs">{line.purchaseLineId}</td>
                          <td className="px-4 py-2 text-gray-700">{line.itemName}</td>
                          <td className="px-4 py-2 text-right">{line.quantity}</td>
                          <td className="px-4 py-2 text-gray-500">{line.unit}</td>
                          <td className="px-4 py-2 text-right">{line.rate}</td>
                          <td className="px-4 py-2 text-right">{line.amount}</td>
                          <td className="px-4 py-2 text-right">{line.tax.total_with_tax.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleConfirm}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? 'Importing…' : 'Confirm Import'}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={reset}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </>
          )}
        </div>
      )}

      {step === 'results' && results && (
        <div className="space-y-4">
          <div className="rounded-xl border border-green-200 bg-green-50 p-4">
            <p className="text-sm font-semibold text-green-900">
              Imported {results.totalBills} bill{results.totalBills === 1 ? '' : 's'}, {results.totalLines} line{results.totalLines === 1 ? '' : 's'} — Qty {results.totalQuantity}, ₹{results.totalAmount.toLocaleString('en-IN')} total.
            </p>
          </div>
          <div className="rounded-xl border bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase text-gray-500 border-b bg-gray-50">
                  <th className="px-4 py-2 text-left">Bill</th>
                  <th className="px-4 py-2 text-left">Company / Warehouse / Supplier</th>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-right">Lines</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {results.bills.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-2">
                      <Link href={`/bills/${b.id}`} className="text-blue-600 underline hover:no-underline font-medium">{b.billNumber}</Link>
                    </td>
                    <td className="px-4 py-2 text-gray-600">{b.companyLabel} / {b.warehouseLabel} / {b.supplierLabel}</td>
                    <td className="px-4 py-2 text-gray-600">{b.billDate}</td>
                    <td className="px-4 py-2 text-right">{b.lineCount}</td>
                    <td className="px-4 py-2 text-right">{b.totalQuantity}</td>
                    <td className="px-4 py-2 text-right">₹{b.totalAmount.toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={reset} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Import another file
            </button>
            <Link href="/bills" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              Go to Bills
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
