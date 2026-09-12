// Unit tests for the Day-Wise Item Ledger domain logic. Pure functions, no
// DB — these cover the parts the report's validation requirements name
// explicitly: direction signs, cancellations counting exactly once, GST
// derivation from stored document values, decimal precision, and summary
// totals agreeing with the detailed ledger.
import { describe, expect, it } from 'vitest'
import {
  ENTRY_TYPES,
  ENTRY_TYPE_META,
  buildDetailRow,
  buildReport,
  deriveFinancials,
  entryTypeLabel,
  splitDirection,
  splitTimestamp,
  sumTotals,
  verifyTotals,
  type LedgerRow,
  type RowContext,
  type SourceFinancials,
} from '../../src/lib/dayWiseItemLedger'

const ctx = (over: Partial<RowContext> = {}): RowContext => ({
  companyName: 'Sri Sai Steels',
  warehouseName: 'Main',
  itemCode: 'GI00069',
  itemDescription: 'GI Coil',
  itemSize: '1.40X1250',
  unit: 'MT',
  documentNumber: 'CR0824-0008',
  status: 'Active',
  createdByName: 'Anoop',
  financials: null,
  parties: {},
  href: null,
  ...over,
})

const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  id: 'l1',
  entry_type: 'PURCHASE_IN',
  quantity: 5,
  entry_date: '2024-08-02',
  created_at: '2024-08-02T11:42:31+05:30',
  company_id: 'c1',
  warehouse_id: 'w1',
  material_type_id: 'm1',
  material_size_id: 's1',
  ...over,
})

describe('entry type coverage', () => {
  it('classifies every entry_type the CHECK constraint allows', () => {
    for (const t of ENTRY_TYPES) {
      expect(ENTRY_TYPE_META[t], t).toBeDefined()
      expect(ENTRY_TYPE_META[t].label.length).toBeGreaterThan(0)
    }
    expect(ENTRY_TYPES).toHaveLength(15)
  })

  it('marks exactly the three cancellation types as reversals', () => {
    const cancels = ENTRY_TYPES.filter((t) => ENTRY_TYPE_META[t].isCancellation)
    expect(cancels.sort()).toEqual(['JOB_WORK_CANCEL', 'PURCHASE_CANCEL', 'SALE_CANCEL'])
  })

  it('falls back to the raw code for an unknown type rather than throwing', () => {
    expect(entryTypeLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW')
  })
})

describe('splitDirection', () => {
  it('routes a positive quantity to inward only', () => {
    expect(splitDirection(5.125)).toEqual({ inward: 5.125, outward: 0, transacted: 5.125 })
  })

  it('routes a negative quantity to outward only, unsigned', () => {
    expect(splitDirection(-3.2)).toEqual({ inward: 0, outward: 3.2, transacted: 3.2 })
  })

  it('keeps three-decimal quantity precision', () => {
    expect(splitDirection(1.8655).transacted).toBe(1.866)
    expect(splitDirection(-0.0004).outward).toBe(0)
  })
})

describe('deriveFinancials', () => {
  const purchase: SourceFinancials = {
    sourceQuantity: 10,
    rate: 50000,
    basicAmount: 500000,
    cgstRate: 9,
    sgstRate: 9,
    cgstAmount: 45000,
    sgstAmount: 45000,
    totalWithTax: 590000,
  }

  it('uses stored document values verbatim when quantities match', () => {
    const f = deriveFinancials(10, purchase)
    expect(f.basicAmount).toBe(500000)
    expect(f.cgstAmount).toBe(45000)
    expect(f.sgstAmount).toBe(45000)
    expect(f.totalGst).toBe(90000)
    expect(f.totalAmount).toBe(590000)
    expect(f.gstPercent).toBe(18)
    expect(f.prorated).toBe(false)
  })

  it('pro-rates and flags when the ledger moved less than the line invoiced', () => {
    const f = deriveFinancials(4, purchase)
    expect(f.basicAmount).toBe(200000)
    expect(f.totalGst).toBe(36000)
    expect(f.totalAmount).toBe(236000)
    expect(f.prorated).toBe(true)
    expect(f.sourceQuantity).toBe(10)
  })

  it('returns blanks, not zeros, when there is no financial source', () => {
    const f = deriveFinancials(3, null)
    expect(f.basicAmount).toBeNull()
    expect(f.totalAmount).toBeNull()
    expect(f.totalGst).toBeNull()
    expect(f.rate).toBeNull()
  })

  it('never fabricates IGST, which WareCore does not model', () => {
    expect(deriveFinancials(10, purchase).igstAmount).toBeNull()
  })

  it('falls back to quantity x rate only when no basic amount was stored', () => {
    const valuation: SourceFinancials = {
      sourceQuantity: 0, rate: 1000, basicAmount: null, cgstRate: null,
      sgstRate: null, cgstAmount: null, sgstAmount: null, totalWithTax: null,
      valuationOnly: true,
    }
    const f = deriveFinancials(2.5, valuation)
    expect(f.basicAmount).toBe(2500)
    expect(f.totalGst).toBeNull()
    expect(f.totalAmount).toBe(2500) // basic only, no tax invented
  })

  it('keeps money at two decimals', () => {
    const f = deriveFinancials(3, { ...purchase, sourceQuantity: 7 })
    expect(f.basicAmount).toBe(214285.71)
    expect(Number.isInteger(f.basicAmount! * 100)).toBe(true)
  })
})

describe('buildDetailRow', () => {
  it('populates only the applicable party column', () => {
    const purchase = buildDetailRow(row(), ctx({ parties: { supplierName: 'Tata Steel', customerName: 'Should Not Appear' } }))
    expect(purchase.supplierName).toBe('Tata Steel')
    expect(purchase.customerName).toBe('')
    expect(purchase.jobWorkerName).toBe('')

    const sale = buildDetailRow(
      row({ entry_type: 'SALE_OUT', quantity: -2 }),
      ctx({ parties: { customerName: 'ACME', supplierName: 'Should Not Appear' } })
    )
    expect(sale.customerName).toBe('ACME')
    expect(sale.supplierName).toBe('')

    const jw = buildDetailRow(
      row({ entry_type: 'JOB_WORK_OUT', quantity: -1 }),
      ctx({ parties: { jobWorkerName: 'Mass Decoilers' } })
    )
    expect(jw.jobWorkerName).toBe('Mass Decoilers')
    expect(jw.customerName).toBe('')
  })

  it('carries source and destination for transfers', () => {
    const t = buildDetailRow(
      row({ entry_type: 'TRANSFER_OUT', quantity: -4 }),
      ctx({ parties: { source: 'Sri Sai Steels / Main', destination: 'DS Steel / Unit 2' } })
    )
    expect(t.source).toBe('Sri Sai Steels / Main')
    expect(t.destination).toBe('DS Steel / Unit 2')
    expect(t.outwardQuantity).toBe(4)
  })

  it('splits created_at into the date and time columns', () => {
    const r = buildDetailRow(row(), ctx())
    expect(r.entryTime).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('flags a row whose derived total contradicts the stored document total', () => {
    const r = buildDetailRow(
      row(),
      ctx({
        financials: {
          sourceQuantity: 5, rate: 100, basicAmount: 500, cgstRate: 9, sgstRate: 9,
          cgstAmount: 45, sgstAmount: 45, totalWithTax: 999, // deliberately wrong
        },
      })
    )
    expect(r.reconciliation).not.toBeNull()
    expect(r.reconciliation!.issue).toMatch(/Total differs/)
    expect(r.totalAmount).toBe(590)
  })

  it('does not flag a row that ties out exactly', () => {
    const r = buildDetailRow(
      row(),
      ctx({
        financials: {
          sourceQuantity: 5, rate: 100, basicAmount: 500, cgstRate: 9, sgstRate: 9,
          cgstAmount: 45, sgstAmount: 45, totalWithTax: 590,
        },
      })
    )
    expect(r.reconciliation).toBeNull()
  })
})

describe('cancellations', () => {
  it('counts a cancellation exactly once, as the reverse of the original', () => {
    const original = buildDetailRow(row({ id: 'a', quantity: 5 }), ctx())
    const cancel = buildDetailRow(
      row({ id: 'b', entry_type: 'PURCHASE_CANCEL', quantity: -5 }),
      ctx()
    )
    const totals = sumTotals([original, cancel])
    expect(totals.inwardQuantity).toBe(5)
    expect(totals.outwardQuantity).toBe(5)
    // Net stock effect is nil: the reversal cancels the original once, not twice.
    expect(totals.inwardQuantity - totals.outwardQuantity).toBe(0)
    expect(totals.transactionCount).toBe(2)
  })

  it('honours a positively-signed cancellation (JOB_WORK_CANCEL occurs both ways)', () => {
    const r = buildDetailRow(row({ entry_type: 'JOB_WORK_CANCEL', quantity: 0.69 }), ctx())
    expect(r.inwardQuantity).toBe(0.69)
    expect(r.outwardQuantity).toBe(0)
  })
})

describe('buildReport grouping and totals', () => {
  const rows = [
    buildDetailRow(row({ id: '1', quantity: 5, entry_date: '2024-08-02' }), ctx()),
    buildDetailRow(row({ id: '2', entry_type: 'SALE_OUT', quantity: -2, entry_date: '2024-08-02' }), ctx()),
    buildDetailRow(
      row({ id: '3', quantity: 3, entry_date: '2024-08-02', material_size_id: 's2' }),
      ctx({ itemSize: '0.90X1200' })
    ),
    buildDetailRow(row({ id: '4', quantity: 1, entry_date: '2024-08-01' }), ctx()),
  ]

  it('groups by date then item then size, dates ascending', () => {
    const report = buildReport(rows)
    expect(report.days.map((d) => d.entryDate)).toEqual(['2024-08-01', '2024-08-02'])
    const secondDay = report.days[1]
    expect(secondDay.groups).toHaveLength(2) // two sizes on 02-Aug
    expect(secondDay.groups.map((g) => g.itemSize)).toEqual(['0.90X1200', '1.40X1250'])
  })

  it('day totals equal the sum of that day transactions', () => {
    const report = buildReport(rows)
    const aug2 = report.days.find((d) => d.entryDate === '2024-08-02')!
    expect(aug2.totals.inwardQuantity).toBe(8) // 5 + 3
    expect(aug2.totals.outwardQuantity).toBe(2)
    expect(aug2.totals.transactionCount).toBe(3)
  })

  it('grand totals equal the flat detail list', () => {
    const report = buildReport(rows)
    expect(report.grandTotals.inwardQuantity).toBe(9)
    expect(report.grandTotals.outwardQuantity).toBe(2)
    expect(report.detail).toHaveLength(4)
    expect(verifyTotals(report)).toEqual([])
  })

  it('summary and detail agree even with pro-rated money', () => {
    const priced = [
      buildDetailRow(
        row({ id: 'p1', quantity: 4 }),
        ctx({
          financials: {
            sourceQuantity: 10, rate: 50000, basicAmount: 500000, cgstRate: 9, sgstRate: 9,
            cgstAmount: 45000, sgstAmount: 45000, totalWithTax: 590000,
          },
        })
      ),
      buildDetailRow(
        row({ id: 'p2', entry_type: 'SALE_OUT', quantity: -1 }),
        ctx({
          financials: {
            sourceQuantity: 1, rate: 60000, basicAmount: 60000, cgstRate: 9, sgstRate: 9,
            cgstAmount: 5400, sgstAmount: 5400, totalWithTax: 70800,
          },
        })
      ),
    ]
    const report = buildReport(priced)
    expect(verifyTotals(report)).toEqual([])
    const day = report.days[0]
    const manual = day.groups.flatMap((g) => g.rows).reduce((s, r) => s + (r.totalAmount ?? 0), 0)
    expect(day.totals.totalAmount).toBeCloseTo(manual, 2)
  })

  it('collects every flagged row into the exceptions list', () => {
    const report = buildReport([
      buildDetailRow(row({ id: 'ok', quantity: 1 }), ctx()),
      buildDetailRow(
        row({ id: 'bad', quantity: 4 }),
        ctx({
          financials: {
            sourceQuantity: 10, rate: 1, basicAmount: 10, cgstRate: null, sgstRate: null,
            cgstAmount: null, sgstAmount: null, totalWithTax: null,
          },
        })
      ),
    ])
    expect(report.exceptions).toHaveLength(1)
    expect(report.exceptions[0].ledgerId).toBe('bad')
    const flagged = report.days[0].groups.find((g) => g.hasReconciliationIssue)
    expect(flagged).toBeDefined()
  })

  it('handles an empty result set without producing NaN totals', () => {
    const report = buildReport([])
    expect(report.days).toEqual([])
    expect(report.grandTotals.totalAmount).toBe(0)
    expect(verifyTotals(report)).toEqual([])
  })
})

describe('splitTimestamp', () => {
  it('returns blanks for a missing timestamp rather than Invalid Date', () => {
    expect(splitTimestamp(null)).toEqual({ date: '', time: '' })
    expect(splitTimestamp('not a date')).toEqual({ date: '', time: '' })
  })
})
