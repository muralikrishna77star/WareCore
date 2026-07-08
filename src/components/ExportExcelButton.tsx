'use client'

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
      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
      </svg>
      {label}
    </button>
  )
}
