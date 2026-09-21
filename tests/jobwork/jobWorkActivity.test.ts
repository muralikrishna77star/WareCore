import { describe, expect, it } from 'vitest'
import { buildJobWorkActivity, type ActivityItem, type ActivityLedgerRow } from '@/lib/jobWorkActivity'

const GI = 'mt-gi'
const SIZE = 'sz-1mm'
const ORDER = 'order-1'

const item = (id: string, pl: string, qty: number, extra: Partial<ActivityItem> = {}): ActivityItem => ({
  id, purchase_line_id: pl, sub_purchase_line_id: null, material_type_id: GI, material_size_id: SIZE,
  quantity_sent: qty, is_transfer_line: false, ...extra,
})

let seq = 0
const row = (entry_type: string, quantity: number, entry_date: string, extra: Partial<ActivityLedgerRow> = {}): ActivityLedgerRow => ({
  id: `r${++seq}`, entry_type, quantity, entry_date, created_at: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`,
  notes: null, material_type_id: GI, material_size_id: SIZE, purchase_line_id: null, sub_purchase_line_id: null, ...extra,
})

const VIRTUAL = 'Vendor direct sale — virtual return'

describe('buildJobWorkActivity', () => {
  // Shape of JW-MSMYAC9J-ZIZQ: two lines of the same item on different
  // purchase lines, JOB_WORK_OUT rows with no purchase_line_id (pre-118),
  // one line sold direct in two parts.
  it('attributes same-item lines by purchase line and turns virtual returns into direct sales', () => {
    const items = [item('a', 'GI0724-0011', 3.76), item('b', 'GI0724-0014', 2.186)]
    const ledger = [
      row('JOB_WORK_OUT', -3.76, '2024-07-24'),
      row('JOB_WORK_OUT', -2.186, '2024-07-24'),
      row('JOB_WORK_RETURN_IN', 1.2, '2024-07-25', { notes: VIRTUAL, purchase_line_id: 'GI0724-0014' }),
      row('JOB_WORK_RETURN_IN', 3.76, '2024-07-29', { notes: VIRTUAL, purchase_line_id: 'GI0724-0011' }),
      row('JOB_WORK_RETURN_IN', 0.986, '2024-08-12', { notes: VIRTUAL, purchase_line_id: 'GI0724-0014' }),
    ]
    const directSales = [
      { dispatchId: 'd1', documentNumber: '0724-0168', customerName: 'STEEL INDIA CORPORATION', entry_date: '2024-07-25', quantity: -1.2, purchase_line_id: 'GI0724-0014' },
      { dispatchId: 'd2', documentNumber: '0824-0278', customerName: 'SHAMILI STEELS', entry_date: '2024-08-12', quantity: -0.986, purchase_line_id: 'GI0724-0014' },
      { dispatchId: 'd3', documentNumber: '0724-0166', customerName: 'SHAMILI STEELS', entry_date: '2024-07-29', quantity: -3.76, purchase_line_id: 'GI0724-0011' },
    ]
    const { events, lines } = buildJobWorkActivity({ orderId: ORDER, items, ledger, directSales, transfers: [] })

    expect(lines.a).toMatchObject({ sent: 3.76, soldDirect: 3.76, returned: 0, missingLedger: false })
    expect(lines.a.atVendor).toBeCloseTo(0, 6)
    expect(lines.b.sent).toBeCloseTo(2.186, 6)
    expect(lines.b.soldDirect).toBeCloseTo(2.186, 6)
    expect(lines.b.atVendor).toBeCloseTo(0, 6)

    const sale = events.find((e) => e.date === '2024-08-12')!
    expect(sale.kind).toBe('direct_sale')
    expect(sale.title).toBe('Sold directly from vendor to SHAMILI STEELS')
    expect(sale.link).toEqual({ href: '/dispatch/d2', label: 'Dispatch 0824-0278' })
    expect(sale.itemId).toBe('b')
    expect(sale.lineBalanceAfter).toBeCloseTo(0, 6)
    expect(events.find((e) => e.date === '2024-07-25')!.lineBalanceAfter).toBeCloseTo(0.986, 6)
  })

  it('agrees with the Stock Statement sign rules for returns, transfers, corrections and outputs', () => {
    const items = [
      item('a', 'PL1', 5),
      item('t', 'PL2', 2, { is_transfer_line: true }),
    ]
    const ledger = [
      row('JOB_WORK_OUT', -5, '2024-01-01', { purchase_line_id: 'PL1' }),
      row('JOB_WORK_TRANSFER_IN', 2, '2024-01-02', { purchase_line_id: 'PL2', notes: 'Vendor transfer — received' }),
      row('JOB_WORK_RETURN_IN', 1, '2024-01-03', { purchase_line_id: 'PL1' }),
      row('JOB_WORK_TRANSFER_OUT', -1.5, '2024-01-04', { purchase_line_id: 'PL1' }),
      row('JOB_WORK_OUTPUT_IN', 0.5, '2024-01-05'), // same material as the input → a return
      row('JOB_WORK_OUTPUT_IN', 0.7, '2024-01-05', { material_type_id: 'mt-other', material_size_id: null, materialLabel: 'Slit coil' }),
    ]
    const transfers = [
      { transferNumber: 'JWT-1', fromOrderId: ORDER, toOrderId: 'order-2', fromVendorName: 'A', toVendorName: 'B', items: [{ purchase_line_id: 'PL1', sub_purchase_line_id: null, quantity_transferred: 1.5 }] },
      { transferNumber: 'JWT-0', fromOrderId: 'order-0', toOrderId: ORDER, fromVendorName: 'C', toVendorName: 'A', items: [{ purchase_line_id: 'PL2', sub_purchase_line_id: null, quantity_transferred: 2 }] },
    ]
    const { events, lines } = buildJobWorkActivity({ orderId: ORDER, items, ledger, directSales: [], transfers })

    // The same-material output row has no purchase line and matches both
    // lines' material; it lands on the non-transfer line as a return.
    expect(lines.a).toMatchObject({ sent: 5, returned: 1.5, transferredOut: 1.5 })
    expect(lines.t).toMatchObject({ sent: 2, atVendor: 2 })
    expect(lines.a.atVendor + lines.t.atVendor).toBeCloseTo(5 + 2 - 1 - 1.5 - 0.5, 6)

    const out = events.find((e) => e.kind === 'transfer_out')!
    expect(out.title).toBe('Transferred to B')
    expect(out.link).toEqual({ href: '/jobwork/order-2', label: 'JWT-1' })
    const inn = events.find((e) => e.kind === 'transfer_in')!
    expect(inn.title).toBe('Received by transfer from C')
    expect(inn.itemId).toBe('t')

    const produced = events.find((e) => e.kind === 'output_received')!
    expect(produced.vendorEffect).toBe(0)
    expect(produced.itemId).toBeNull()
    expect(produced.materialLabel).toBe('Slit coil')
  })

  it('treats a correction of a different-material output as processed output, not vendor stock', () => {
    const { events, lines } = buildJobWorkActivity({
      orderId: ORDER,
      items: [item('a', 'PL1', 6.39)],
      ledger: [
        row('JOB_WORK_OUT', -6.39, '2024-11-08', { purchase_line_id: 'PL1' }),
        row('JOB_WORK_OUTPUT_IN', 6.19, '2024-11-15', { material_size_id: 'sz-other' }),
        row('JOB_WORK_CANCEL', -6.19, '2024-11-15', { material_size_id: 'sz-other', notes: 'Output line corrected via Edit Order' }),
        row('JOB_WORK_OUTPUT_IN', 6.19, '2024-11-15'),
      ],
      directSales: [], transfers: [],
    })
    expect(events.find((e) => e.kind === 'output_corrected')!.vendorEffect).toBe(0)
    expect(lines.a.returned).toBeCloseTo(6.19, 6)
    expect(lines.a.atVendor).toBeCloseTo(0.2, 6)
  })

  it('flags a line that has quantity sent but no ledger rows at all', () => {
    const { lines } = buildJobWorkActivity({
      orderId: ORDER, items: [item('x', 'PL9', 1.865)], ledger: [], directSales: [], transfers: [],
    })
    expect(lines.x.missingLedger).toBe(true)
    expect(lines.x.atVendor).toBe(0)
  })
})
