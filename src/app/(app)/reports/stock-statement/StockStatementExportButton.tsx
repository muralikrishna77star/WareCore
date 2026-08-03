'use client'

import { useRef, useState } from 'react'
import { Grid3x3 } from 'lucide-react'
import {
  exportStockStatementExcel,
  type StockStatementExportItem,
  type StockStatementExportTotals,
  type StockStatementExportMeta,
} from '@/lib/exportStockStatementExcel'

export function StockStatementExportButton({
  items,
  totals,
  meta,
}: {
  items: StockStatementExportItem[]
  totals: StockStatementExportTotals
  meta: StockStatementExportMeta
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const runningRef = useRef(false)

  const handleClick = async () => {
    if (runningRef.current) return // guard against duplicate clicks while generating
    runningRef.current = true
    setStatus('loading')
    try {
      await exportStockStatementExcel(items, totals, meta)
      setStatus('success')
    } catch (err) {
      console.error('[StockStatementExport]', err)
      setStatus('error')
    } finally {
      runningRef.current = false
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  return (
    <div className="flex items-center gap-2 print:hidden">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === 'loading'}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Grid3x3 className="h-4 w-4" strokeWidth={2} />
        {status === 'loading' ? 'Generating Excel…' : 'Export to Excel'}
      </button>
      {status === 'success' && (
        <span className="text-xs font-medium text-green-700">Stock Statement exported successfully.</span>
      )}
      {status === 'error' && (
        <span className="text-xs font-medium text-red-600">Unable to export the Stock Statement. Please try again.</span>
      )}
    </div>
  )
}
