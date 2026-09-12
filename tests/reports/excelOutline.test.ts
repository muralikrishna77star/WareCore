// Verifies the Excel export actually produces a single sheet whose day rows
// group their own transaction rows — the native +/- outline controls — by
// writing a real workbook and reading it back with ExcelJS. Asserting the
// generated file rather than the intent, because row grouping is the kind of
// thing that silently does nothing if the properties are wrong.
import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import {
  buildProfessionalWorkbookBuffer,
  QTY_FMT,
  type ProfessionalExportMeta,
  type ProfessionalSheetSpec,
} from '../../src/lib/exportProfessionalExcel'

const meta: ProfessionalExportMeta = {
  companyName: 'Sri Sai Steels',
  fromDate: '2024-11-01',
  toDate: '2024-11-30',
  filterLine: 'Period: November 2024 (selected month)',
  generatedBy: 'Tester',
}

/** Two days, each with its own transactions nested beneath it. */
function combinedSpec(): ProfessionalSheetSpec {
  return {
    sheetName: 'Daywise + Transactions',
    title: 'Daywise Stock Statement — Day Totals with Transactions',
    columns: [
      { header: 'Date', key: 'date', width: 14, align: 'center', isDate: true },
      { header: 'Day / Transaction Type', key: 'kind', width: 22, align: 'left' },
      { header: 'Customer / Vendor / Supplier', key: 'partyLabel', width: 30, align: 'left' },
      { header: 'Inward Qty', key: 'inward', width: 14, align: 'right', numFmt: QTY_FMT },
      { header: 'Outward Qty', key: 'outward', width: 14, align: 'right', numFmt: QTY_FMT },
    ],
    rows: [
      { date: '2024-11-01', kind: 'DAY TOTAL', inward: 0, outward: 1.46 },
      { date: '2024-11-01', kind: 'Job Work Out', partyLabel: 'MODERN AGE (Vendor)', outward: 1.46 },
      { date: '2024-11-03', kind: 'DAY TOTAL', inward: 19.57, outward: 19.57 },
      { date: '2024-11-03', kind: 'Purchase', partyLabel: 'MKK Metal Sections (Supplier)', inward: 19.57 },
      { date: '2024-11-03', kind: 'Sale', partyLabel: 'ACME (Customer)', outward: 19.57 },
    ],
    rowOutlineLevels: [0, 1, 0, 1, 1],
    highlightRowIndexes: [0, 2],
  }
}

async function readBack(spec: ProfessionalSheetSpec) {
  const buffer = await buildProfessionalWorkbookBuffer(meta, [spec])
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as ArrayBuffer)
  return wb
}

describe('combined Daywise + Transactions sheet', () => {
  it('writes one sheet, not two', async () => {
    const wb = await readBack(combinedSpec())
    expect(wb.worksheets).toHaveLength(1)
    expect(wb.worksheets[0].name).toBe('Daywise + Transactions')
  })

  it('nests transaction rows one outline level under their day row', async () => {
    const wb = await readBack(combinedSpec())
    const sheet = wb.worksheets[0]

    // Locate the data rows by their first-column date value, skipping the
    // report header block ExcelJS writes above the table.
    const levels: number[] = []
    sheet.eachRow((row) => {
      const kind = row.getCell(2).value
      if (kind === 'DAY TOTAL' || kind === 'Job Work Out' || kind === 'Purchase' || kind === 'Sale') {
        levels.push(row.outlineLevel ?? 0)
      }
    })

    expect(levels).toEqual([0, 1, 0, 1, 1])
  })

  it('puts the summary row above its group, not below', async () => {
    const wb = await readBack(combinedSpec())
    // Without this Excel attaches the +/- control to the row AFTER the group,
    // so the day total would collapse into the following day.
    expect(wb.worksheets[0].properties.outlineProperties).toMatchObject({
      summaryBelow: false,
    })
  })

  it('ships expanded so the reader sees the detail by default', async () => {
    const wb = await readBack(combinedSpec())
    const sheet = wb.worksheets[0]
    sheet.eachRow((row) => {
      if (row.outlineLevel && row.outlineLevel > 0) expect(row.hidden).toBe(false)
    })
  })

  it('carries the single combined party column through to the file', async () => {
    const wb = await readBack(combinedSpec())
    const sheet = wb.worksheets[0]
    // Only the data rows — the report header block above the table also
    // writes text into column 3.
    const dataKinds = new Set(['DAY TOTAL', 'Job Work Out', 'Purchase', 'Sale'])
    const parties: string[] = []
    sheet.eachRow((row) => {
      if (!dataKinds.has(String(row.getCell(2).value))) return
      const v = row.getCell(3).value
      if (typeof v === 'string' && v) parties.push(v)
    })
    expect(parties).toEqual([
      'MODERN AGE (Vendor)',
      'MKK Metal Sections (Supplier)',
      'ACME (Customer)',
    ])
  })

  it('leaves a sheet without outline levels ungrouped', async () => {
    const plain = combinedSpec()
    delete plain.rowOutlineLevels
    const wb = await readBack(plain)
    const sheet = wb.worksheets[0]
    sheet.eachRow((row) => expect(row.outlineLevel ?? 0).toBe(0))
  })
})
