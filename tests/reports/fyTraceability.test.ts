import { describe, expect, it } from 'vitest'
import {
  buildFyTraceability,
  displayRows,
  fyPeriod,
  monthsBetween,
  type TraceMovement,
  type TracePurchaseLine,
} from '@/lib/fyTraceability'
import { VENDOR_DIRECT_SALE_NOTE } from '@/lib/purchaseLineLedger'
import ExcelJS from 'exceljs'
import { buildProfessionalWorkbookBuffer } from '@/lib/exportProfessionalExcel'
import { buildMonthlySummarySheet } from '@/app/(app)/reports/fy-traceability/exportSpec'

const line = (id: string, billDate: string, qty: number, rate = 50000): TracePurchaseLine => ({
  purchaseLineId: id,
  billNumber: `B-${id}`,
  billDate,
  seller: 'JSW',
  company: 'Sri Sai Steels',
  warehouse: 'Main',
  itemCode: null,
  description: 'GI',
  size: '0.80X121',
  unit: 'MT',
  billedQty: qty,
  rate,
  basic: qty * rate,
  gst: qty * rate * 0.18,
  total: qty * rate * 1.18,
  gstRate: 18,
})

let seq = 0
const mv = (entry_type: string, quantity: number, entry_date: string, extra: Partial<TraceMovement> = {}): TraceMovement => ({
  id: `m${++seq}`,
  entry_type,
  quantity,
  entry_date,
  created_at: `${entry_date}T00:00:${String(seq % 60).padStart(2, '0')}Z`,
  reference_number: `R${seq}`,
  vendorDelta: 0,
  ...extra,
})

// Sales are entered without tax, as in production: Sale GST comes from the purchase line.
const sale = (qty: number, date: string, value: number, customer = 'Ravi') =>
  mv('SALE_OUT', -qty, date, { customerName: customer, saleValue: value, saleGst: 0, reference_type: 'dispatch' })

const run = (cutoff: string, lines: TracePurchaseLine[], movements: Record<string, TraceMovement[]>) => {
  const { fyStart } = fyPeriod(Number(cutoff.slice(5, 7)), Number(cutoff.slice(0, 4)))
  return buildFyTraceability({ fyStart, cutoff, lines, movementsByLine: new Map(Object.entries(movements)), unlinkedSales: [] })
}

describe('fyPeriod', () => {
  it('runs from 1 April to the selected month end', () => {
    expect(fyPeriod(8, 2026)).toEqual({ fyStart: '2026-04-01', cutoff: '2026-08-31' })
    expect(fyPeriod(4, 2026)).toEqual({ fyStart: '2026-04-01', cutoff: '2026-04-30' })
  })
  it('puts January–March in the financial year that began the previous April', () => {
    expect(fyPeriod(2, 2024)).toEqual({ fyStart: '2023-04-01', cutoff: '2024-02-29' })
    expect(fyPeriod(3, 2025)).toEqual({ fyStart: '2024-04-01', cutoff: '2025-03-31' })
  })
  it('lists every month in the period', () => {
    expect(monthsBetween('2024-04-01', '2024-11-30')).toEqual([
      '2024-04', '2024-05', '2024-06', '2024-07', '2024-08', '2024-09', '2024-10', '2024-11',
    ])
  })
})

describe('buildFyTraceability', () => {
  it('shows one row per sale but counts the purchase once', () => {
    const r = run('2024-08-31', [line('L1', '2024-05-10', 10)], {
      L1: [mv('PURCHASE_IN', 10, '2024-05-10'), sale(3, '2024-06-01', 180000), sale(2, '2024-07-01', 120000)],
    })
    const [block] = r.currentFy[0].blocks
    expect(block.rows.map((x) => [x.kind, x.saleQty, x.balance])).toEqual([
      ['SALE', 3, 7],
      ['SALE', 2, 5],
    ])
    expect(r.currentFyTotals.purchaseQty).toBe(10)
    expect(r.currentFyTotals.purchaseBasic).toBe(500000)
    expect(r.currentFyTotals.soldQty).toBe(5)
    expect(block.closingBalance).toBe(5)
    expect(block.stockValue).toBe(5 * 50000)
  })

  it('charges Sale GST at the purchase entry GST %, and leaves it blank when the entry has none', () => {
    const fivePct = { ...line('L1', '2024-05-10', 10), gstRate: 5 }
    const noRate = { ...line('L2', '2024-05-11', 10), gstRate: null }
    const r = run('2024-08-31', [fivePct, noRate], {
      L1: [mv('PURCHASE_IN', 10, '2024-05-10'), sale(2, '2024-06-01', 100000)],
      L2: [mv('PURCHASE_IN', 10, '2024-05-11'), sale(1, '2024-06-01', 50000)],
    })
    const [a, b] = r.currentFy[0].blocks
    expect(a.rows[0].saleGst).toBeCloseTo(5000)
    expect(b.rows[0].saleGst).toBeNull()
    expect(b.gstRateMissing).toBe(true)
    expect(r.summaryTotal.saleGst).toBeCloseTo(5000)
  })

  it('marks a purchase with no sale as Unsold', () => {
    const r = run('2024-08-31', [line('L1', '2024-05-10', 4)], { L1: [mv('PURCHASE_IN', 4, '2024-05-10')] })
    const [block] = r.currentFy[0].blocks
    expect(block.unsold).toBe(true)
    expect(block.rows).toEqual([expect.objectContaining({ kind: 'UNSOLD', remarks: 'Unsold', balance: 4 })])
  })

  it('ignores sales after the cutoff and purchases billed after it', () => {
    const r = run('2024-06-30', [line('L1', '2024-05-10', 10), line('L2', '2024-07-02', 5)], {
      L1: [mv('PURCHASE_IN', 10, '2024-05-10'), sale(3, '2024-06-30', 1), sale(4, '2024-07-01', 1)],
      L2: [mv('PURCHASE_IN', 5, '2024-07-02')],
    })
    expect(r.currentFy.flatMap((g) => g.blocks).map((b) => b.line.purchaseLineId)).toEqual(['L1'])
    expect(r.currentFyTotals.soldQty).toBe(3)
    expect(r.currentFyTotals.closingBalance).toBe(7)
  })

  it('keeps job work in the balance and out of sales, following the line to its eventual sale', () => {
    const r = run('2024-08-31', [line('L1', '2024-05-10', 10)], {
      L1: [
        mv('PURCHASE_IN', 10, '2024-05-10'),
        mv('JOB_WORK_OUT', -10, '2024-05-12', { vendorDelta: 10, vendorName: 'Macman' }),
        mv('JOB_WORK_RETURN_IN', 6, '2024-06-01', { vendorDelta: -6, vendorName: 'Macman' }),
        sale(6, '2024-06-05', 360000),
        // Sold straight from the vendor: virtual return + sale pair.
        mv('JOB_WORK_RETURN_IN', 1, '2024-07-01', { vendorDelta: -1, vendorName: 'Macman', notes: VENDOR_DIRECT_SALE_NOTE }),
        sale(1, '2024-07-01', 60000, 'GKS'),
      ],
    })
    const [block] = r.currentFy[0].blocks
    expect(block.rows.map((x) => x.kind)).toEqual(['JOB_WORK', 'JOB_WORK', 'SALE', 'VENDOR_DIRECT_SALE'])
    expect(block.rows[0]).toMatchObject({ saleQty: null, balance: 10 })
    expect(block.rows[3].remarks).toBe('GKS — sold direct from Macman')
    expect(block.soldQty).toBe(7)
    expect(block.closingWarehouse).toBe(0)
    expect(block.closingVendor).toBe(3)
    expect(block.closingBalance).toBe(3)
    expect(displayRows(block, false).map((x) => x.kind)).toEqual(['SALE', 'VENDOR_DIRECT_SALE'])
  })

  it('keeps prior-FY purchases out of purchase totals but reports their sales separately', () => {
    const r = run('2024-08-31', [line('OLD', '2024-03-20', 8, 40000), line('GONE', '2024-02-01', 2)], {
      OLD: [mv('PURCHASE_IN', 8, '2024-03-20'), sale(1, '2024-03-25', 1), sale(2, '2024-05-01', 90000)],
      GONE: [mv('PURCHASE_IN', 2, '2024-02-01'), sale(2, '2024-02-10', 1)],
    })
    expect(r.currentFy).toEqual([])
    expect(r.priorFy.map((b) => b.line.purchaseLineId)).toEqual(['OLD']) // GONE was fully sold before April
    const [old] = r.priorFy
    expect(old.isPriorFy).toBe(true)
    expect(old.openingBalance).toBe(7)
    expect(old.purchaseQty).toBe(0)
    expect(old.rows.map((x) => [x.kind, x.balance])).toEqual([['OPENING', 7], ['SALE', 5]])
    expect(r.summaryTotal.purchaseQty).toBe(0)
    expect(r.summaryTotal.saleQty).toBe(0)
    expect(r.summaryTotal.priorSaleQty).toBe(2)
    expect(r.summaryTotal.openingQty).toBe(7)
    expect(r.summaryTotal.closingQty).toBe(5)
    expect(r.summaryTotal.closingValue).toBe(5 * 40000)
  })

  it('reverses a purchase cancellation out of the purchase figures and the balance', () => {
    const r = run('2024-08-31', [line('L1', '2024-05-10', 10)], {
      L1: [mv('PURCHASE_IN', 10, '2024-05-10'), mv('PURCHASE_CANCEL', -4, '2024-06-02')],
    })
    const [block] = r.currentFy[0].blocks
    expect(block.purchaseQty).toBe(6)
    expect(block.purchaseBasic).toBeCloseTo(300000)
    expect(block.closingBalance).toBe(6)
    const may = r.summary.find((s) => s.month === '2024-05')!
    const jun = r.summary.find((s) => s.month === '2024-06')!
    expect(may.purchaseQty).toBe(10)
    expect(jun.purchaseQty).toBe(-4)
    expect(r.summaryTotal.purchaseBasic).toBeCloseTo(300000)
  })

  it('shows an inter-company transfer as one row that leaves the balance unchanged', () => {
    const r = run('2024-08-31', [line('L1', '2024-05-10', 10)], {
      L1: [
        mv('PURCHASE_IN', 10, '2024-05-10'),
        mv('TRANSFER_OUT', -10, '2024-05-11', { reference_number: 'XFER-1', companyName: 'DS Steels' }),
        mv('TRANSFER_IN', 10, '2024-05-11', { reference_number: 'XFER-1', companyName: 'Sri Sai Steels' }),
      ],
    })
    const [block] = r.currentFy[0].blocks
    expect(block.rows).toEqual([
      expect.objectContaining({ kind: 'TRANSFER', remarks: 'Transferred 10.000 from DS Steels to Sri Sai Steels', balance: 10 }),
    ])
    expect(block.unsold).toBe(true)
  })

  it('treats a purchase removed from a bill and entered again as still purchased', () => {
    const r = run('2025-01-31', [line('L1', '2025-01-31', 1.71)], {
      L1: [
        mv('PURCHASE_IN', 1.71, '2025-01-31'),
        mv('PURCHASE_CANCEL', -1.71, '2025-01-31'),
        mv('PURCHASE_IN', 1.71, '2025-01-31', { reference_number: '0125-0430' }),
        mv('JOB_WORK_OUT', -1.71, '2025-01-31', { vendorDelta: 1.71, vendorName: 'Macman' }),
      ],
    })
    const [block] = r.currentFy[0].blocks
    expect(block.purchaseQty).toBeCloseTo(1.71)
    expect(block.cancelledQty).toBe(0)
    expect(block.closingBalance).toBeCloseTo(1.71)
    expect(r.summaryTotal.purchaseQty).toBeCloseTo(1.71)
    expect(r.summaryTotal.otherQty).toBeCloseTo(0)
  })

  it('drops a purchase cancelled in full', () => {
    const r = run('2024-08-31', [line('L1', '2024-05-10', 10)], {
      L1: [mv('PURCHASE_IN', 10, '2024-05-10'), mv('PURCHASE_CANCEL', -10, '2024-05-10')],
    })
    expect(r.currentFy).toEqual([])
  })

  it('closes each month on month-end balances and reconciles opening + purchases − sales', () => {
    const r = run('2024-07-31', [line('L1', '2024-04-05', 10), line('L2', '2024-06-15', 5, 60000)], {
      L1: [mv('PURCHASE_IN', 10, '2024-04-05'), sale(4, '2024-05-20', 1), sale(1, '2024-07-01', 1)],
      L2: [mv('PURCHASE_IN', 5, '2024-06-15'), sale(5, '2024-07-10', 1)],
    })
    expect(r.summary.map((s) => [s.month, s.purchaseQty, s.saleQty, s.closingQty, s.otherQty])).toEqual([
      ['2024-04', 10, 0, 10, 0],
      ['2024-05', 0, 4, 6, 0],
      ['2024-06', 5, 0, 11, 0],
      ['2024-07', 0, 6, 5, 0],
    ])
    expect(r.summary[2].closingValue).toBe(6 * 50000 + 5 * 60000)
  })
})

describe('Monthly Summary export sheet', () => {
  const report = () => {
    const { fyStart } = fyPeriod(7, 2024)
    return buildFyTraceability({
      fyStart,
      cutoff: '2024-07-31',
      lines: [line('OLD', '2024-03-20', 8, 40000), line('L1', '2024-05-10', 10), line('L2', '2024-06-15', 5, 60000)],
      movementsByLine: new Map(Object.entries({
        OLD: [mv('PURCHASE_IN', 8, '2024-03-20'), sale(2, '2024-05-01', 90000)],
        L1: [mv('PURCHASE_IN', 10, '2024-05-10'), mv('PURCHASE_CANCEL', -1, '2024-06-02'), sale(3, '2024-06-20', 180000)],
        L2: [mv('PURCHASE_IN', 5, '2024-06-15'), sale(5, '2024-07-10', 300000)],
      })),
      unlinkedSales: [{ date: '2024-07-05', reference: 'INV-9', customer: 'Anbu', description: 'CR', size: '1 X 500', qty: 1.5, saleValue: 75000, saleGst: 0 }],
    })
  }

  const SUMMED = ['openingQty', 'purchaseQty', 'purchaseBasic', 'purchaseGst', 'purchaseTotal', 'saleQty', 'saleValue',
    'saleGst', 'priorSaleQty', 'priorSaleValue', 'priorSaleGst', 'unlinkedSaleQty', 'unlinkedSaleValue', 'unlinkedSaleGst']

  it('nests each month’s transactions under it, and they add up to the month row', () => {
    const spec = buildMonthlySummarySheet(report())
    const levels = spec.rowOutlineLevels!
    expect(levels).toHaveLength(spec.rows.length)
    expect(spec.rows.filter((_, i) => levels[i] === 0).map((r) => r.month)).toEqual([
      'Opening Stock b/f (01-04-2024)', 'April 2024', 'May 2024', 'June 2024', 'July 2024', 'Financial year to date',
    ])
    for (let i = 0; i < spec.rows.length; i++) {
      if (levels[i] !== 0 || spec.rows[i].month === 'Financial year to date') continue
      const details: Record<string, unknown>[] = []
      for (let j = i + 1; j < spec.rows.length && levels[j] === 1; j++) details.push(spec.rows[j])
      // Opening Qty on a month row is the balance carried in, not a flow — only
      // the Opening Stock row's details add up to it.
      const keys = String(spec.rows[i].month).startsWith('Opening') ? SUMMED : SUMMED.filter((k) => k !== 'openingQty')
      for (const key of keys) {
        const sum = details.reduce((s, d) => s + Number(d[key] ?? 0), 0)
        expect(sum, `${spec.rows[i].month} ${key}`).toBeCloseTo(Number(spec.rows[i][key] ?? 0), 6)
      }
    }
    const types = spec.rows.filter((_, i) => levels[i] === 1).map((r) => r.type)
    expect(types).toEqual([
      'Opening stock (prior-FY purchase)',
      'Purchase', 'Sale of opening / prior-FY stock', // May
      'Purchase cancelled', 'Purchase', 'Sale', // June
      'Sale with no purchase line', 'Sale', // July, by date
    ])
  })

  it('ships with every month collapsed behind a + control', async () => {
    const buffer = await buildProfessionalWorkbookBuffer(
      { companyName: 'All', fromDate: '2024-04-01', toDate: '2024-07-31', filterLine: '', generatedBy: 'Tester' },
      [buildMonthlySummarySheet(report())],
    )
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as ArrayBuffer)
    const sheet = wb.worksheets[0]
    expect(sheet.properties.outlineProperties).toMatchObject({ summaryBelow: false })
    let details = 0
    sheet.eachRow((row) => {
      if (!row.outlineLevel) return
      details++
      expect(row.outlineLevel).toBe(1)
      expect(row.hidden).toBe(true)
    })
    expect(details).toBe(8)
  })
})
