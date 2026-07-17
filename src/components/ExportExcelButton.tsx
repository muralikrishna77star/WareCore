'use client'

import { Grid3x3 } from 'lucide-react'
import { exportRowsToExcel } from '@/lib/exportExcel'

export function ExportExcelButton({
  rows,
  filename,
  sheetName,
  label = 'Export to Excel',
}: {
  rows: Record<string, unknown>[]
  filename: string
  sheetName?: string
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={() => exportRowsToExcel(rows, filename, sheetName)}
      className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors print:hidden"
    >
      <Grid3x3 className="h-4 w-4" strokeWidth={2} />
      {label}
    </button>
  )
}
