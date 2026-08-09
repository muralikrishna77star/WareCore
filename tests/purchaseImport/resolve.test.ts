// Pure unit tests for src/lib/purchaseImport/resolve.ts — FK resolution,
// grouping, tax calc, and ID assignment against a hand-built fake master
// data snapshot. No database needed.
import { describe, expect, it } from 'vitest'
import { resolveImport } from '../../src/lib/purchaseImport/resolve'
import type { MasterDataSnapshot, ParsedRow } from '../../src/lib/purchaseImport/types'

const SNAPSHOT: MasterDataSnapshot = {
  companies: [{ id: 'company-1', name: 'Acme Co', code: 'ACME' }],
  warehouses: [{ id: 'wh-1', name: 'Main WH', company_id: 'company-1' }],
  suppliers: [{ id: 'supplier-1', name: 'XYZ Traders' }],
  materialTypes: [{ id: 'mt-1', code: 'CR', description: 'CR Coil', unit: 'tons' }],
  materialSizes: [{ id: 'size-1', material_type_id: 'mt-1', size_label: '1.40x1080' }],
  taxRates: [{ id: 'tax-1', name: 'GST 18%', cgst_rate: 9, sgst_rate: 9, tds_rate: 0 }],
  existingBillNumbers: [],
  existingLineIds: [],
}

function row(overrides: Partial<ParsedRow> = {}, rowNumber = 2): ParsedRow {
  return {
    rowNumber,
    company: 'Acme Co', warehouse: 'Main WH', supplier: 'XYZ Traders',
    billDate: '2024-04-15', billDateRaw: '2024-04-15', billRef: '',
    materialType: 'CR', size: '1.40x1080',
    quantity: 10, quantityRaw: '10',
    unit: '', rate: 55000, rateRaw: '55000',
    taxRate: '', lineNotes: '', billNotes: '',
    ...overrides,
  }
}

describe('resolveImport()', () => {
  it('resolves a single valid row into one bill with a MMYY-NNNN bill number and a group-code line id', () => {
    const { bills, errors } = resolveImport([row()], SNAPSHOT)
    expect(errors).toHaveLength(0)
    expect(bills).toHaveLength(1)
    expect(bills[0].billNumber).toMatch(/^0424-0001$/)
    expect(bills[0].lines).toHaveLength(1)
    expect(bills[0].lines[0].purchaseLineId).toMatch(/^CR0424-0001$/)
    expect(bills[0].lines[0].unit).toBe('tons') // defaulted from material type
    expect(bills[0].lines[0].amount).toBe(550000)
  })

  it('is case-insensitive and trims whitespace when matching master data (but never fuzzy-matches content)', () => {
    const { bills, errors } = resolveImport([row({ company: '  acme co  ', materialType: 'cr' })], SNAPSHOT)
    expect(errors).toHaveLength(0)
    expect(bills[0].companyId).toBe('company-1')
  })

  it('flags an unknown supplier as a row error and resolves nothing (all-or-nothing)', () => {
    const { bills, errors } = resolveImport([row(), row({ supplier: 'Nonexistent Supplier' }, 3)], SNAPSHOT)
    expect(bills).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(errors[0].rowNumber).toBe(3)
    expect(errors[0].message).toMatch(/Unknown supplier/)
  })

  it('groups multiple rows sharing company/warehouse/supplier/date/ref into one bill, in file order', () => {
    const { bills, errors } = resolveImport(
      [row({}, 2), row({ quantity: 5, quantityRaw: '5' }, 3), row({ supplier: 'XYZ Traders', billDate: '2024-05-01', billDateRaw: '2024-05-01' }, 4)],
      SNAPSHOT
    )
    expect(errors).toHaveLength(0)
    expect(bills).toHaveLength(2)
    expect(bills[0].lines).toHaveLength(2)
    expect(bills[0].totalQuantity).toBe(15)
    expect(bills[1].lines).toHaveLength(1)
  })

  it('keeps two same-day bills from the same supplier separate when Bill Ref differs', () => {
    const { bills, errors } = resolveImport([row({ billRef: 'INV-1' }, 2), row({ billRef: 'INV-2' }, 3)], SNAPSHOT)
    expect(errors).toHaveLength(0)
    expect(bills).toHaveLength(2)
  })

  it('flags an exact-duplicate line within the same bill as a copy-paste guard error', () => {
    const { bills, errors } = resolveImport([row({}, 2), row({}, 3)], SNAPSHOT)
    expect(bills).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/Duplicate line/)
  })

  it('computes CGST/SGST/TDS via the shared calculateLineTax when a Tax Rate is given', () => {
    const { bills, errors } = resolveImport([row({ taxRate: 'GST 18%' })], SNAPSHOT)
    expect(errors).toHaveLength(0)
    const tax = bills[0].lines[0].tax
    expect(tax.taxable_value).toBe(550000)
    expect(tax.cgst_amount).toBeCloseTo(49500)
    expect(tax.sgst_amount).toBeCloseTo(49500)
    expect(tax.total_with_tax).toBeCloseTo(649000)
  })

  it('assigns sequential bill numbers across multiple new bills in the same file, continuing from existing bill numbers', () => {
    const snapshotWithHistory: MasterDataSnapshot = { ...SNAPSHOT, existingBillNumbers: ['0324-0007'] }
    const { bills, errors } = resolveImport(
      [row({}, 2), row({ billDate: '2024-05-01', billDateRaw: '2024-05-01' }, 3)],
      snapshotWithHistory
    )
    expect(errors).toHaveLength(0)
    expect(bills[0].billNumber).toBe('0424-0008')
    expect(bills[1].billNumber).toBe('0524-0009')
  })

  it('requires an exact size match and errors on an unknown size rather than falling back to free text', () => {
    const { bills, errors } = resolveImport([row({ size: 'Not A Real Size' })], SNAPSHOT)
    expect(bills).toHaveLength(0)
    expect(errors[0].message).toMatch(/Unknown size/)
  })

  it('rejects a non-positive quantity', () => {
    const { bills, errors } = resolveImport([row({ quantity: 0, quantityRaw: '0' })], SNAPSHOT)
    expect(bills).toHaveLength(0)
    expect(errors[0].message).toMatch(/greater than 0/)
  })
})
