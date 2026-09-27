'use client'

import { useMemo } from 'react'
import { ProfessionalExportButton } from '@/components/ProfessionalExportButton'
import type { ProfessionalExportMeta } from '@/lib/exportProfessionalExcel'
import type { FyTraceabilityReport } from '@/lib/fyTraceability'
import { buildExportSheets } from './exportSpec'

/** Builds the sheets in the browser from the report the table already
 * receives, rather than shipping a second, pre-built copy of every row. */
export function FyTraceabilityExport({
  report,
  showJobWork,
  meta,
  filenameBase,
}: {
  report: FyTraceabilityReport
  showJobWork: boolean
  meta: ProfessionalExportMeta
  filenameBase: string
}) {
  const sheets = useMemo(() => buildExportSheets(report, showJobWork), [report, showJobWork])
  return (
    <ProfessionalExportButton
      meta={meta}
      sheets={sheets}
      filenameBase={filenameBase}
      successMessage="Traceability report exported successfully."
      errorMessage="Unable to export the traceability report. Please try again."
    />
  )
}
