'use client'

import { useRef, useState } from 'react'
import { Grid3x3 } from 'lucide-react'
import {
  exportProfessionalWorkbook,
  type ProfessionalExportMeta,
  type ProfessionalSheetSpec,
} from '@/lib/exportProfessionalExcel'

// Server components can't pass closures to client components — sheets/meta
// are plain, serializable data computed server-side; the actual ExcelJS
// workbook generation still runs here in the browser (same split as
// StockStatementExportButton.tsx, which this mirrors for every other report).
export function ProfessionalExportButton({
  meta,
  sheets,
  filenameBase,
  label = 'Export to Excel',
  successMessage = 'Exported successfully.',
  errorMessage = 'Unable to export. Please try again.',
}: {
  meta: ProfessionalExportMeta
  sheets: ProfessionalSheetSpec[]
  filenameBase: string
  label?: string
  successMessage?: string
  errorMessage?: string
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const runningRef = useRef(false)

  const handleClick = async () => {
    if (runningRef.current) return // guard against duplicate clicks while generating
    runningRef.current = true
    setStatus('loading')
    try {
      await exportProfessionalWorkbook(meta, sheets, filenameBase)
      setStatus('success')
    } catch (err) {
      console.error('[ProfessionalExport]', err)
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
        {status === 'loading' ? 'Generating Excel…' : label}
      </button>
      {status === 'success' && <span className="text-xs font-medium text-green-700">{successMessage}</span>}
      {status === 'error' && <span className="text-xs font-medium text-red-600">{errorMessage}</span>}
    </div>
  )
}
