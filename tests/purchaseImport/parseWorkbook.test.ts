// Pure unit tests for src/lib/purchaseImport/parseWorkbook.ts — no database
// needed, just exceljs round-tripping an in-memory workbook.
import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { parseWorkbook } from '../../src/lib/purchaseImport/parseWorkbook'

async function buildWorkbook(headers: string[], rows: (string | number | Date | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Purchases')
  ws.addRow(headers)
  for (const r of rows) ws.addRow(r)
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

const REQUIRED_HEADERS = ['Company', 'Warehouse', 'Supplier', 'Bill Date', 'Material Type', 'Quantity', 'Rate']

describe('parseWorkbook()', () => {
  it('matches headers case-insensitively and independent of column order', async () => {
    const buffer = await buildWorkbook(
      ['supplier', 'COMPANY', 'Rate', 'quantity', 'material type', 'bill date', 'warehouse'],
      [['XYZ Traders', 'Acme Co', 55000, 10.5, 'CR', '2024-04-15', 'Main WH']]
    )
    const { rows, errors } = await parseWorkbook(buffer)
    expect(errors).toHaveLength(0)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ company: 'Acme Co', warehouse: 'Main WH', supplier: 'XYZ Traders', materialType: 'CR', quantity: 10.5, rate: 55000, billDate: '2024-04-15' })
  })

  it('reports a file-level error when a required column is missing', async () => {
    const buffer = await buildWorkbook(['Company', 'Warehouse', 'Supplier', 'Material Type', 'Quantity', 'Rate'], [['A', 'B', 'C', 'CR', 1, 2]])
    const { rows, errors } = await parseWorkbook(buffer)
    expect(rows).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(errors[0].rowNumber).toBeNull()
    expect(errors[0].message).toMatch(/Bill Date/)
  })

  it('skips fully-blank trailing rows', async () => {
    const buffer = await buildWorkbook(REQUIRED_HEADERS, [
      ['A', 'B', 'C', '2024-04-15', 'CR', 1, 2],
      [null, null, null, null, null, null, null],
    ])
    const { rows, errors } = await parseWorkbook(buffer)
    expect(errors).toHaveLength(0)
    expect(rows).toHaveLength(1)
  })

  describe('date normalization', () => {
    it.each([
      ['2024-04-15', '2024-04-15'],
      ['15-04-2024', '2024-04-15'],
      ['15/04/2024', '2024-04-15'],
    ])('parses %s as %s', async (input, expected) => {
      const buffer = await buildWorkbook(REQUIRED_HEADERS, [['A', 'B', 'C', input, 'CR', 1, 2]])
      const { rows, errors } = await parseWorkbook(buffer)
      expect(errors).toHaveLength(0)
      expect(rows[0].billDate).toBe(expected)
    })

    it('accepts a native Excel date cell', async () => {
      const buffer = await buildWorkbook(REQUIRED_HEADERS, [['A', 'B', 'C', new Date(Date.UTC(2024, 3, 15)), 'CR', 1, 2]])
      const { rows, errors } = await parseWorkbook(buffer)
      expect(errors).toHaveLength(0)
      expect(rows[0].billDate).toBe('2024-04-15')
    })

    it('flags an unparseable date as a row error', async () => {
      const buffer = await buildWorkbook(REQUIRED_HEADERS, [['A', 'B', 'C', 'not-a-date', 'CR', 1, 2]])
      const { rows, errors } = await parseWorkbook(buffer)
      expect(errors).toHaveLength(1)
      expect(errors[0].column).toBe('Bill Date')
      expect(rows[0].billDate).toBe('')
    })
  })

  describe('number normalization', () => {
    it.each([
      ['1,250.50', 1250.5],
      ['Rs. 1250.5', 1250.5],
      [' 1250.5 ', 1250.5],
    ])('parses quantity "%s" as %d', async (input, expected) => {
      const buffer = await buildWorkbook(REQUIRED_HEADERS, [['A', 'B', 'C', '2024-04-15', 'CR', input, 2]])
      const { rows, errors } = await parseWorkbook(buffer)
      expect(errors).toHaveLength(0)
      expect(rows[0].quantity).toBe(expected)
    })

    it('flags an unparseable quantity as a row error', async () => {
      const buffer = await buildWorkbook(REQUIRED_HEADERS, [['A', 'B', 'C', '2024-04-15', 'CR', 'abc', 2]])
      const { rows, errors } = await parseWorkbook(buffer)
      expect(errors).toHaveLength(1)
      expect(errors[0].column).toBe('Quantity')
      expect(rows[0].quantity).toBeNull()
    })
  })
})
