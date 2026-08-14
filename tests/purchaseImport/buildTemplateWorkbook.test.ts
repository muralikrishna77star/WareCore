// Regression test for a real bug: the template's required-column headers
// get a " *" suffix (buildTemplateWorkbook.ts), but parseWorkbook.ts's
// header matcher didn't strip it — so a file built from our OWN generated
// template, filled in exactly as intended, was rejected with "missing"
// every required column. The API route wrapped that in a generic "Could
// not read the file." message, hiding the real reason entirely (fixed
// separately in src/app/api/bills/import/batches/route.ts).
//
// This test builds the exact same workbook the /api/bills/import/template
// route serves and feeds it straight into parseWorkbook() — the two must
// never drift apart silently again.
import { describe, expect, it } from 'vitest'
import { buildTemplateWorkbook } from '../../src/lib/purchaseImport/buildTemplateWorkbook'
import { parseWorkbook } from '../../src/lib/purchaseImport/parseWorkbook'
import type { MasterDataSnapshot } from '../../src/lib/purchaseImport/types'

const EMPTY_SNAPSHOT: MasterDataSnapshot = {
  companies: [], warehouses: [], suppliers: [], materialTypes: [], materialSizes: [], taxRates: [],
  existingBillNumbers: [], existingLineIds: [], itemMaster: [],
}

describe('buildTemplateWorkbook() + parseWorkbook() round-trip', () => {
  it('the generated template, with its example row untouched, parses with zero errors', async () => {
    const workbook = buildTemplateWorkbook(EMPTY_SNAPSHOT)
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

    const { rows, errors } = await parseWorkbook(buffer)

    expect(errors).toHaveLength(0)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      company: 'ABC Steel Pvt Ltd',
      warehouse: 'Main Warehouse',
      supplier: 'XYZ Traders',
      billDate: '2024-04-15',
      materialType: 'CR',
      quantity: 10.5,
      rate: 55000,
    })
  })

  it('every required column header (with its " *" suffix) is recognized', async () => {
    const workbook = buildTemplateWorkbook(EMPTY_SNAPSHOT)
    const headerRow = workbook.getWorksheet('Purchases')!.getRow(1)
    const headers = (headerRow.values as unknown[]).filter(Boolean).map(String)

    // Sanity-check the fixture itself still has the asterisk suffix this
    // test exists to guard against — if a future refactor removes it,
    // this assertion (not a parse failure) is what should catch that.
    expect(headers.some((h) => h.endsWith(' *'))).toBe(true)

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
    const { errors } = await parseWorkbook(buffer)
    expect(errors.find((e) => e.message.startsWith('Missing required column'))).toBeUndefined()
  })
})
