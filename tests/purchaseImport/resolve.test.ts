// Pure unit tests for src/lib/purchaseImport/resolve.ts — FK resolution,
// grouping, tax calc, and ID assignment against a hand-built fake master
// data snapshot. No database needed.
import { describe, expect, it } from 'vitest'
import { resolveImport, resolveRowIndependent, findDuplicateLines } from '../../src/lib/purchaseImport/resolve'
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

describe('resolveRowIndependent()', () => {
  it('resolves a fully valid row with no errors', () => {
    const result = resolveRowIndependent(row(), SNAPSHOT)
    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.resolved.companyId).toBe('company-1')
    expect(result.resolved.warehouseId).toBe('wh-1')
    expect(result.resolved.supplierId).toBe('supplier-1')
    expect(result.resolved.materialTypeId).toBe('mt-1')
    expect(result.resolved.materialSizeId).toBe('size-1')
  })

  it('reports every independent problem on a row at once, not just the first', () => {
    const result = resolveRowIndependent(
      row({ company: 'Nonexistent Co', materialType: 'Nonexistent Material', quantity: 0, quantityRaw: '0' }),
      SNAPSHOT
    )
    expect(result.isValid).toBe(false)
    const columns = result.errors.map((e) => e.column)
    expect(columns).toContain('Company')
    expect(columns).toContain('Material Type')
    expect(columns).toContain('Quantity')
    // Warehouse/Supplier/Size were fine and should NOT be reported broken
    // just because Company/Material Type were.
    expect(columns).not.toContain('Supplier')
  })

  it('flags an ambiguous unscoped warehouse match when Company is unresolved, rather than dead-ending', () => {
    const snapshot: MasterDataSnapshot = {
      ...SNAPSHOT,
      companies: [{ id: 'company-1', name: 'Acme Co', code: 'ACME' }, { id: 'company-2', name: 'Beta Co', code: 'BETA' }],
      warehouses: [{ id: 'wh-1', name: 'Main WH', company_id: 'company-1' }, { id: 'wh-2', name: 'Main WH', company_id: 'company-2' }],
    }
    const result = resolveRowIndependent(row({ company: 'Nonexistent Co' }), snapshot)
    expect(result.resolved.warehouseAmbiguous).toBe(true)
    expect(result.errors.find((e) => e.column === 'Warehouse')?.message).toMatch(/fix Company first/)
  })

  it('resolves an unscoped warehouse unambiguously when only one company has that warehouse name, even with Company unresolved', () => {
    const result = resolveRowIndependent(row({ company: 'Nonexistent Co' }), SNAPSHOT)
    expect(result.resolved.warehouseId).toBe('wh-1')
    expect(result.resolved.warehouseAmbiguous).toBe(false)
  })

  it('never fuzzy-matches — a close-but-not-exact supplier name is still unresolved', () => {
    const result = resolveRowIndependent(row({ supplier: 'XYZ Trader' }), SNAPSHOT) // missing the 's'
    expect(result.resolved.supplierId).toBeNull()
    expect(result.errors.find((e) => e.column === 'Supplier')?.message).toMatch(/Unknown supplier/)
  })

  it('agrees with resolveImport()/resolveRow() on valid/invalid verdicts across a shared fixture set — no drift between the two resolvers', () => {
    const fixtures: Partial<ParsedRow>[] = [
      {},
      { company: 'Nonexistent Co' },
      { warehouse: 'Nonexistent WH' },
      { supplier: 'Nonexistent Supplier' },
      { materialType: 'Nonexistent Material' },
      { size: 'Nonexistent Size' },
      { taxRate: 'Nonexistent Tax' },
      { quantity: 0, quantityRaw: '0' },
      { rate: -1, rateRaw: '-1' },
      { billDateRaw: '', billDate: '' },
    ]
    for (const overrides of fixtures) {
      const r = row(overrides, 2)
      const independent = resolveRowIndependent(r, SNAPSHOT)
      const bulk = resolveImport([r], SNAPSHOT)
      expect(independent.isValid).toBe(bulk.errors.length === 0)
    }
  })
})

describe('findDuplicateLines()', () => {
  it('flags a repeated material/size/quantity/rate signature within the same bill group', () => {
    const errors = findDuplicateLines([
      { rowNumber: 2, companyId: 'c1', warehouseId: 'w1', supplierId: 's1', billDate: '2024-04-15', billRef: '', materialTypeId: 'mt-1', materialSizeId: 'size-1', quantity: 10, rate: 55000 },
      { rowNumber: 3, companyId: 'c1', warehouseId: 'w1', supplierId: 's1', billDate: '2024-04-15', billRef: '', materialTypeId: 'mt-1', materialSizeId: 'size-1', quantity: 10, rate: 55000 },
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0].rowNumber).toBe(3)
  })

  it('does not flag the same material/quantity/rate across two different bill groups', () => {
    const errors = findDuplicateLines([
      { rowNumber: 2, companyId: 'c1', warehouseId: 'w1', supplierId: 's1', billDate: '2024-04-15', billRef: '', materialTypeId: 'mt-1', materialSizeId: 'size-1', quantity: 10, rate: 55000 },
      { rowNumber: 3, companyId: 'c1', warehouseId: 'w1', supplierId: 's1', billDate: '2024-05-01', billRef: '', materialTypeId: 'mt-1', materialSizeId: 'size-1', quantity: 10, rate: 55000 },
    ])
    expect(errors).toHaveLength(0)
  })
})
