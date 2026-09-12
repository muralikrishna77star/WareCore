'use client'

import { ProfessionalExportButton } from '@/components/ProfessionalExportButton'
import type { ProfessionalExportMeta, ProfessionalSheetSpec } from '@/lib/exportProfessionalExcel'

/**
 * Thin client wrapper so the server component can hand over plain,
 * serializable sheet specs — the workbook itself is still generated in the
 * browser by ProfessionalExportButton.
 */
export function DayWiseItemLedgerExport({
  meta,
  sheets,
}: {
  meta: ProfessionalExportMeta
  sheets: ProfessionalSheetSpec[]
}) {
  return (
    <ProfessionalExportButton
      meta={meta}
      sheets={sheets}
      filenameBase="Day-Wise_Item_Ledger"
      label="Export to Excel"
    />
  )
}
