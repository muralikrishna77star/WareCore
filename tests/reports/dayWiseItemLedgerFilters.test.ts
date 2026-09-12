// Unit tests for the Day-Wise Item Ledger's filter translation. buildLedgerWhere
// is what decides which rows the report is even allowed to see, so the
// cancellation-exclusion default and the item/size key translation are
// worth pinning down separately from the grouping logic.
import { describe, expect, it } from 'vitest'
import { buildLedgerWhere, type DayWiseFilters } from '../../src/lib/dayWiseItemLedgerData'
import { ENTRY_TYPES, ENTRY_TYPE_META, type EntryType } from '../../src/lib/dayWiseItemLedger'

const filters = (over: Partial<DayWiseFilters> = {}): DayWiseFilters => ({
  fromDate: '2024-11-01',
  toDate: '2024-11-30',
  companyIds: [],
  warehouseIds: [],
  itemMasterIds: [],
  materialSizeIds: [],
  entryTypes: [],
  supplierIds: [],
  customerIds: [],
  jobWorkerIds: [],
  documentNumber: '',
  includeCancelled: false,
  ...over,
})

const noItems = { materialTypeIds: [], materialSizeIds: [] }

/** Pulls the clauses out of the generated _and array for assertions. */
const clauses = (where: Record<string, unknown>) => where._and as Record<string, never>[]
const findClause = (where: Record<string, unknown>, field: string) =>
  clauses(where).find((c) => Object.prototype.hasOwnProperty.call(c, field))

describe('buildLedgerWhere', () => {
  it('always bounds the date range inclusively', () => {
    const w = buildLedgerWhere(filters(), noItems)
    expect(findClause(w, 'entry_date')).toEqual({ entry_date: { _gte: '2024-11-01' } })
    expect(clauses(w)[1]).toEqual({ entry_date: { _lte: '2024-11-30' } })
  })

  it('excludes cancellation entry types by default', () => {
    const w = buildLedgerWhere(filters(), noItems)
    const types = (findClause(w, 'entry_type') as unknown as { entry_type: { _in: string[] } }).entry_type._in
    expect(types).not.toContain('PURCHASE_CANCEL')
    expect(types).not.toContain('SALE_CANCEL')
    expect(types).not.toContain('JOB_WORK_CANCEL')
    expect(types).toContain('PURCHASE_IN')
    // Every non-cancellation type stays selectable.
    const expected = ENTRY_TYPES.filter((t) => !ENTRY_TYPE_META[t as EntryType].isCancellation)
    expect(types.sort()).toEqual([...expected].sort())
  })

  it('places no entry_type restriction when cancelled rows are included', () => {
    const w = buildLedgerWhere(filters({ includeCancelled: true }), noItems)
    expect(findClause(w, 'entry_type')).toBeUndefined()
  })

  it('honours an explicit type selection', () => {
    const w = buildLedgerWhere(filters({ entryTypes: ['SALE_OUT'], includeCancelled: true }), noItems)
    expect(findClause(w, 'entry_type')).toEqual({ entry_type: { _in: ['SALE_OUT'] } })
  })

  it('strips cancellation types from an explicit selection unless cancelled are included', () => {
    const w = buildLedgerWhere(
      filters({ entryTypes: ['SALE_OUT', 'SALE_CANCEL'], includeCancelled: false }),
      noItems
    )
    expect(findClause(w, 'entry_type')).toEqual({ entry_type: { _in: ['SALE_OUT'] } })
  })

  it('filters company and warehouse with _in', () => {
    const w = buildLedgerWhere(filters({ companyIds: ['c1', 'c2'], warehouseIds: ['w1'] }), noItems)
    expect(findClause(w, 'company_id')).toEqual({ company_id: { _in: ['c1', 'c2'] } })
    expect(findClause(w, 'warehouse_id')).toEqual({ warehouse_id: { _in: ['w1'] } })
  })

  it('translates selected items into their material keys', () => {
    const w = buildLedgerWhere(filters({ itemMasterIds: ['i1'] }), {
      materialTypeIds: ['m1'],
      materialSizeIds: ['s1'],
    })
    expect(findClause(w, 'material_type_id')).toEqual({ material_type_id: { _in: ['m1'] } })
    expect(findClause(w, 'material_size_id')).toEqual({ material_size_id: { _in: ['s1'] } })
  })

  it('lets an explicit size filter override the sizes implied by the items', () => {
    const w = buildLedgerWhere(filters({ materialSizeIds: ['chosen'] }), {
      materialTypeIds: ['m1'],
      materialSizeIds: ['implied'],
    })
    expect(findClause(w, 'material_size_id')).toEqual({ material_size_id: { _in: ['chosen'] } })
  })

  it('matches the document number as a case-insensitive partial', () => {
    const w = buildLedgerWhere(filters({ documentNumber: ' 1124-0482 ' }), noItems)
    expect(findClause(w, 'reference_number')).toEqual({
      reference_number: { _ilike: '%1124-0482%' },
    })
  })

  it('omits the document clause when the box is blank or whitespace', () => {
    expect(findClause(buildLedgerWhere(filters({ documentNumber: '   ' }), noItems), 'reference_number')).toBeUndefined()
  })

  it('adds no party clauses — those are resolved after enrichment', () => {
    const w = buildLedgerWhere(
      filters({ supplierIds: ['Tata'], customerIds: ['ACME'], jobWorkerIds: ['Mass'] }),
      noItems
    )
    const keys = clauses(w).flatMap((c) => Object.keys(c))
    expect(keys).not.toContain('supplier_id')
    expect(keys).not.toContain('customer_id')
  })
})

describe('normalizeStatus', () => {
  it('spells Cancelled the same way whatever table it came from', async () => {
    const { normalizeStatus } = await import('../../src/lib/dayWiseItemLedger')
    // purchase_bills / dispatch_orders store lowercase
    expect(normalizeStatus('cancelled')).toBe('Cancelled')
    expect(normalizeStatus('active')).toBe('Active')
  })

  it('keeps a job work order real state instead of flattening it to Active', async () => {
    const { normalizeStatus } = await import('../../src/lib/dayWiseItemLedger')
    expect(normalizeStatus('dispatched')).toBe('Dispatched')
    expect(normalizeStatus('partial_return')).toBe('Partial Return')
    expect(normalizeStatus('completed')).toBe('Completed')
  })

  it('defaults a missing status to Active rather than blank', async () => {
    const { normalizeStatus } = await import('../../src/lib/dayWiseItemLedger')
    expect(normalizeStatus(null)).toBe('Active')
    expect(normalizeStatus(undefined)).toBe('Active')
    expect(normalizeStatus('')).toBe('Active')
  })
})
