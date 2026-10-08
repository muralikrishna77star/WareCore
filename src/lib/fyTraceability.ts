/**
 * Financial Year Purchase & Sales Traceability — pure report builder.
 *
 * One block per purchase line: the purchase itself (shown and totalled once)
 * followed by every sale and job-work movement recorded against that line up
 * to the cutoff date. Built on buildPurchaseLineLedger(), so the merged
 * Vendor Direct Sale / Job Transfer rows and the warehouse + vendor running
 * balances are exactly what Purchase Line Movements shows for the same line.
 *
 * Business rules:
 *  - Period = 1 April of the selected month's financial year → the selected
 *    month's last day (the cutoff). Nothing dated after the cutoff counts.
 *  - Balance Qty = what is still unsold under the line = warehouse stock +
 *    stock lying with a job-work vendor. Both parts are carried separately.
 *  - Job-work movements are shown in Sales / Remarks but are not sales.
 *  - A purchase line billed before the financial year is Opening Stock /
 *    Prior-FY Purchase: its movements in the period are shown, but it never
 *    enters the current year's purchase totals.
 *  - Purchase cancellations reduce the line's purchase qty/value (pro rata by
 *    quantity) in the month they are dated. Cancelled sales have no ledger
 *    row, so they never appear.
 *  - Stock Value = Balance Qty × the line's own purchase rate (ex-GST).
 *  - Sale GST: sales are entered without tax, so it is the sale value × the
 *    GST % on the purchase entry of the line sold. A tax amount recorded on
 *    the sale itself wins; a line with no GST % leaves Sale GST blank.
 */

import { buildPurchaseLineLedger, type PurchaseLineEntry } from '@/lib/purchaseLineLedger'

const EPS = 0.0005

export interface TracePurchaseLine {
  purchaseLineId: string
  billNumber: string
  billDate: string // YYYY-MM-DD
  seller: string
  company: string
  warehouse: string
  itemCode: string | null
  description: string
  size: string
  unit: string
  /** Invoiced quantity and values from the bill line. */
  billedQty: number
  rate: number
  basic: number
  gst: number
  total: number
  /** GST % from the purchase entry (CGST + SGST); null when none was entered. */
  gstRate: number | null
  /** For the on-screen Item Stock Ledger link. */
  itemMasterId?: string | null
}

export interface TraceMovement extends PurchaseLineEntry {
  /** Customer for SALE_OUT rows. */
  customerName?: string | null
  /** Sale taxable value / GST for SALE_OUT rows, already apportioned per ledger row. */
  saleValue?: number | null
  saleGst?: number | null
  /** Item label for job-work output rows (the item the line became). */
  itemText?: string | null
  /** Company name, for inter-company transfer remarks. */
  companyName?: string | null
}

export interface UnlinkedSale {
  date: string
  reference: string
  customer: string
  description: string
  size: string
  qty: number
  saleValue: number
  saleGst: number
}

export type DetailKind =
  | 'OPENING'
  | 'SALE'
  | 'VENDOR_DIRECT_SALE'
  | 'JOB_WORK'
  | 'TRANSFER'
  | 'PURCHASE_CANCEL'
  | 'PURCHASE_REENTRY'
  | 'UNSOLD'
  | 'OTHER'

export interface DetailRow {
  kind: DetailKind
  date: string | null
  remarks: string
  reference: string | null
  saleQty: number | null
  saleValue: number | null
  saleGst: number | null
  /** Signed quantity the row changes the purchase by — PURCHASE_CANCEL (negative) and PURCHASE_REENTRY only. */
  purchaseQtyChange?: number
  /** Warehouse + vendor balance after this row. */
  balance: number
}

export interface LineBlock {
  line: TracePurchaseLine
  isPriorFy: boolean
  /** Balance (warehouse + vendor) at the start of the financial year — prior-FY lines only. */
  openingBalance: number
  /** Purchase figures net of cancellations up to the cutoff. */
  purchaseQty: number
  purchaseBasic: number
  purchaseGst: number
  purchaseTotal: number
  cancelledQty: number
  rows: DetailRow[]
  soldQty: number
  saleValue: number
  saleGst: number
  closingBalance: number
  closingWarehouse: number
  closingVendor: number
  stockValue: number
  unsold: boolean
  /** The purchase entry has no GST %, so its sales carry no Sale GST. */
  gstRateMissing: boolean
}

export interface BlockTotals {
  purchaseQty: number
  purchaseBasic: number
  purchaseGst: number
  purchaseTotal: number
  openingBalance: number
  soldQty: number
  saleValue: number
  saleGst: number
  closingBalance: number
  closingWarehouse: number
  closingVendor: number
  stockValue: number
}

export interface MonthGroup {
  month: string // YYYY-MM
  blocks: LineBlock[]
  totals: BlockTotals
}

export interface MonthSummaryRow {
  month: string // YYYY-MM
  purchaseQty: number
  purchaseBasic: number
  purchaseGst: number
  purchaseTotal: number
  /** Sales of lines purchased in this financial year. */
  saleQty: number
  saleValue: number
  saleGst: number
  /** Sales of Opening Stock / Prior-FY purchases, kept separate. */
  priorSaleQty: number
  priorSaleValue: number
  priorSaleGst: number
  /** Sales with no purchase line — they cannot reduce any line's balance. */
  unlinkedSaleQty: number
  unlinkedSaleValue: number
  unlinkedSaleGst: number
  /** Closing balance − (opening + purchases − linked sales): process loss, adjustments. */
  otherQty: number
  openingQty: number
  closingQty: number
  closingWarehouse: number
  closingVendor: number
  closingValue: number
}

export interface FyTraceabilityInput {
  fyStart: string // YYYY-MM-DD
  cutoff: string // YYYY-MM-DD
  lines: TracePurchaseLine[]
  /** Every ledger row of each line dated on or before the cutoff, in ledger order. */
  movementsByLine: Map<string, TraceMovement[]>
  unlinkedSales: UnlinkedSale[]
}

export interface FyTraceabilityReport {
  fyStart: string
  cutoff: string
  currentFy: MonthGroup[]
  currentFyTotals: BlockTotals
  priorFy: LineBlock[]
  priorFyTotals: BlockTotals
  unlinkedSales: UnlinkedSale[]
  unlinkedTotals: { qty: number; saleValue: number; saleGst: number }
  summary: MonthSummaryRow[]
  summaryTotal: MonthSummaryRow
}

// ─── Period helpers ─────────────────────────────────────────────────────────

/** Financial year (April–March) start and month-end cutoff for a month/year pick. */
export function fyPeriod(month: number, year: number): { fyStart: string; cutoff: string } {
  const fyYear = month >= 4 ? year : year - 1
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    fyStart: `${fyYear}-04-01`,
    cutoff: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  }
}

/** Every YYYY-MM from the FY start month through the cutoff month. */
export function monthsBetween(fyStart: string, cutoff: string): string[] {
  const out: string[] = []
  let y = Number(fyStart.slice(0, 4))
  let m = Number(fyStart.slice(5, 7))
  const endKey = cutoff.slice(0, 7)
  for (let guard = 0; guard < 24; guard++) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    out.push(key)
    if (key === endKey) break
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

const monthEnd = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${month}-${String(d).padStart(2, '0')}`
}

// ─── Per-line build ─────────────────────────────────────────────────────────

const JOB_WORK_REMARK: Partial<Record<string, (m: TraceMovement) => string>> = {
  JOB_WORK_OUT: (m) => `Sent for job work${m.vendorName ? ` to ${m.vendorName}` : ''}`,
  JOB_WORK_RETURN_IN: (m) => `Returned from job work${m.vendorName ? ` (${m.vendorName})` : ''}`,
  JOB_WORK_OUTPUT_IN: (m) =>
    `Job work output received${m.itemText ? `: ${m.itemText}` : ''}${m.vendorName ? ` from ${m.vendorName}` : ''}`,
  JOB_WORK_CANCEL: (m) => `Job work cancelled${m.vendorName ? ` (${m.vendorName})` : ''}`,
  JOB_WORK_TRANSFER_OUT: (m) => `Job work transfer out${m.vendorName ? ` from ${m.vendorName}` : ''}`,
  JOB_WORK_TRANSFER_IN: (m) => `Job work transfer in${m.vendorName ? ` to ${m.vendorName}` : ''}`,
}

const itemLabelFor = (row: PurchaseLineEntry) => (row as TraceMovement).itemText ?? ''

interface LedgerPoint {
  date: string
  warehouse: number
  vendor: number
}

/** Line balance (warehouse, vendor) as of a date, from the merged ledger's running totals. */
function balanceAsOf(points: LedgerPoint[], date: string): { warehouse: number; vendor: number } {
  let warehouse = 0
  let vendor = 0
  for (const p of points) {
    if (p.date > date) break
    warehouse = p.warehouse
    vendor = p.vendor
  }
  return { warehouse, vendor }
}

interface LineWork {
  block: LineBlock
  points: LedgerPoint[]
  /** Sales dated inside the period, for the monthly summary. */
  periodSales: { date: string; qty: number; value: number; gst: number }[]
  /** Quantity cancelled off the purchase, by date. Negative = a cancelled quantity re-entered. */
  cancels: { date: string; qty: number }[]
}

function buildLine(line: TracePurchaseLine, movements: TraceMovement[], fyStart: string, cutoff: string): LineWork {
  const isPriorFy = line.billDate < fyStart
  const { rows: merged } = buildPurchaseLineLedger(movements, itemLabelFor)

  const points: LedgerPoint[] = merged.map((r) => ({ date: r.entry_date, warehouse: r.balance, vendor: r.vendorBalance }))
  const opening = balanceAsOf(points, prevDate(fyStart))
  const openingBalance = isPriorFy ? opening.warehouse + opening.vendor : 0

  const rows: DetailRow[] = []
  if (isPriorFy) {
    rows.push({
      kind: 'OPENING',
      date: fyStart,
      remarks: 'Opening Stock / Prior-FY Purchase — balance brought forward',
      reference: null,
      saleQty: null,
      saleValue: null,
      saleGst: null,
      balance: openingBalance,
    })
  }

  const periodSales: LineWork['periodSales'] = []
  const cancels: LineWork['cancels'] = []
  let seenPurchaseIn = false
  let soldQty = 0
  let saleValue = 0
  let saleGst = 0

  // An inter-company transfer posts an OUT and an IN leg under the same line;
  // they read as one move, shown at whichever leg comes later.
  const place = (m: TraceMovement) => `${m.companyName || 'company'}${m.warehouses?.name ? ` / ${m.warehouses.name}` : ''}`
  const transferPartner = new Map<number, number>()
  merged.forEach((r, i) => {
    if (r.entry_type !== 'TRANSFER_OUT' || transferPartner.has(i)) return
    const j = merged.findIndex(
      (x, k) => !transferPartner.has(k) && x.entry_type === 'TRANSFER_IN' && x.entry_date === r.entry_date &&
        x.reference_number === r.reference_number && Math.abs(Number(x.quantity) + Number(r.quantity)) < EPS,
    )
    if (j === -1) return
    transferPartner.set(i, j)
    transferPartner.set(j, i)
  })

  for (const [idx, r] of merged.entries()) {
    const balance = r.balance + r.vendorBalance
    const qty = Number(r.quantity)
    const src = r as unknown as TraceMovement
    // A PURCHASE_IN after the line's first re-enters stock removed from a bill
    // (e.g. an item deleted then added back), so it undoes that cancellation.
    const reEntry = r.entry_type === 'PURCHASE_IN' && seenPurchaseIn
    if (r.entry_type === 'PURCHASE_IN') seenPurchaseIn = true
    if (r.entry_type === 'PURCHASE_CANCEL') cancels.push({ date: r.entry_date, qty: Math.abs(qty) })
    if (reEntry) cancels.push({ date: r.entry_date, qty: -Math.abs(qty) })
    // Prior-FY lines show only what happened inside the period; the opening row carries the rest.
    if (r.entry_date < fyStart) continue

    switch (r.entry_type) {
      case 'PURCHASE_IN':
        if (!reEntry) continue // the purchase columns already show it
        rows.push({
          kind: 'PURCHASE_REENTRY',
          purchaseQtyChange: Math.abs(qty),
          date: r.entry_date,
          remarks: `Purchase re-entered after cancellation — ${Math.abs(qty).toFixed(3)}`,
          reference: r.reference_number ?? null,
          saleQty: null, saleValue: null, saleGst: null,
          balance,
        })
        continue
      case 'SALE_OUT':
      case 'VENDOR_DIRECT_SALE': {
        const q = Math.abs(qty)
        const v = Number(src.saleValue ?? 0)
        const recorded = Number(src.saleGst ?? 0)
        const g: number | null =
          recorded > EPS ? recorded : line.gstRate != null ? (v * line.gstRate) / 100 : null
        soldQty += q
        saleValue += v
        saleGst += g ?? 0
        periodSales.push({ date: r.entry_date, qty: q, value: v, gst: g ?? 0 })
        const customer = src.customerName || 'Customer'
        rows.push({
          kind: r.entry_type === 'VENDOR_DIRECT_SALE' ? 'VENDOR_DIRECT_SALE' : 'SALE',
          date: r.entry_date,
          remarks: r.entry_type === 'VENDOR_DIRECT_SALE'
            ? `${customer} — sold direct from ${r.vendorName || 'job work vendor'}`
            : customer,
          reference: r.reference_number ?? null,
          saleQty: q,
          saleValue: v,
          saleGst: g,
          balance,
        })
        continue
      }
      case 'PURCHASE_CANCEL':
        rows.push({
          kind: 'PURCHASE_CANCEL',
          purchaseQtyChange: -Math.abs(qty),
          date: r.entry_date,
          remarks: `Purchase cancelled — ${Math.abs(qty).toFixed(3)} returned to seller`,
          reference: r.reference_number ?? null,
          saleQty: null, saleValue: null, saleGst: null,
          balance,
        })
        continue
      case 'JOB_WORK_TRANSFER':
        rows.push({
          kind: 'JOB_WORK',
          date: r.entry_date,
          remarks: `Job work ${r.notes ? r.notes.charAt(0).toLowerCase() + r.notes.slice(1) : 'transfer between vendors'}`,
          reference: r.reference_number ?? null,
          saleQty: null, saleValue: null, saleGst: null,
          balance,
        })
        continue
      case 'TRANSFER_OUT':
      case 'TRANSFER_IN': {
        const partner = transferPartner.get(idx)
        if (partner != null && partner > idx) continue // shown with the later leg
        const out = partner == null ? null : (r.entry_type === 'TRANSFER_OUT' ? r : merged[partner]) as unknown as TraceMovement
        const inn = partner == null ? null : (r.entry_type === 'TRANSFER_IN' ? r : merged[partner]) as unknown as TraceMovement
        rows.push({
          kind: 'TRANSFER',
          date: r.entry_date,
          remarks: out && inn
            ? `Transferred ${Math.abs(qty).toFixed(3)} from ${place(out)} to ${place(inn)}`
            : `${r.entry_type === 'TRANSFER_OUT' ? 'Transferred out of' : 'Transferred in to'} ${place(src)}`,
          reference: r.reference_number ?? null,
          saleQty: null, saleValue: null, saleGst: null,
          balance,
        })
        continue
      }
      default: {
        const jw = JOB_WORK_REMARK[r.entry_type]
        rows.push({
          kind: jw ? 'JOB_WORK' : 'OTHER',
          date: r.entry_date,
          remarks: jw ? jw(src) : `${r.entry_type.replace(/_/g, ' ').toLowerCase()}${r.notes ? ` — ${r.notes}` : ''}`,
          reference: r.reference_number ?? null,
          saleQty: null, saleValue: null, saleGst: null,
          balance,
        })
      }
    }
  }

  const closing = balanceAsOf(points, cutoff)
  const closingBalance = closing.warehouse + closing.vendor
  const unsold = soldQty < EPS

  // Only the part cancelled on or before the cutoff reverses the purchase.
  const cancelledQty = isPriorFy ? 0 : Math.max(0, cancels.reduce((s, c) => s + c.qty, 0))
  const keep = line.billedQty > EPS ? Math.max(0, (line.billedQty - cancelledQty) / line.billedQty) : 1

  if (unsold && rows.every((r) => r.kind === 'OPENING')) {
    rows.push({
      kind: 'UNSOLD',
      date: null,
      remarks: 'Unsold',
      reference: null,
      saleQty: null, saleValue: null, saleGst: null,
      balance: closingBalance,
    })
  }

  return {
    block: {
      line,
      isPriorFy,
      openingBalance,
      purchaseQty: isPriorFy ? 0 : line.billedQty - cancelledQty,
      purchaseBasic: isPriorFy ? 0 : line.basic * keep,
      purchaseGst: isPriorFy ? 0 : line.gst * keep,
      purchaseTotal: isPriorFy ? 0 : line.total * keep,
      cancelledQty,
      rows,
      soldQty,
      saleValue,
      saleGst,
      closingBalance,
      closingWarehouse: closing.warehouse,
      closingVendor: closing.vendor,
      stockValue: closingBalance * line.rate,
      unsold,
      gstRateMissing: line.gstRate == null,
    },
    points,
    periodSales,
    cancels,
  }
}

function prevDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * The rows a block renders with. Hiding job-work movements must never leave a
 * line with no row at all: it falls back to one row carrying the closing
 * balance, marked Unsold when nothing was sold.
 */
export function displayRows(block: LineBlock, showJobWork: boolean): DetailRow[] {
  const rows = showJobWork ? block.rows : block.rows.filter((r) => r.kind !== 'JOB_WORK' && r.kind !== 'TRANSFER')
  if (rows.length > 0) return rows
  return [{
    kind: block.unsold ? 'UNSOLD' : 'OTHER',
    date: null,
    remarks: block.unsold ? 'Unsold' : '',
    reference: null,
    saleQty: null, saleValue: null, saleGst: null,
    balance: block.closingBalance,
  }]
}

const emptyTotals = (): BlockTotals => ({
  purchaseQty: 0, purchaseBasic: 0, purchaseGst: 0, purchaseTotal: 0, openingBalance: 0,
  soldQty: 0, saleValue: 0, saleGst: 0, closingBalance: 0, closingWarehouse: 0, closingVendor: 0, stockValue: 0,
})

export function sumBlocks(blocks: LineBlock[]): BlockTotals {
  const t = emptyTotals()
  for (const b of blocks) {
    t.purchaseQty += b.purchaseQty
    t.purchaseBasic += b.purchaseBasic
    t.purchaseGst += b.purchaseGst
    t.purchaseTotal += b.purchaseTotal
    t.openingBalance += b.openingBalance
    t.soldQty += b.soldQty
    t.saleValue += b.saleValue
    t.saleGst += b.saleGst
    t.closingBalance += b.closingBalance
    t.closingWarehouse += b.closingWarehouse
    t.closingVendor += b.closingVendor
    t.stockValue += b.stockValue
  }
  return t
}

// ─── Report ─────────────────────────────────────────────────────────────────

export function buildFyTraceability(input: FyTraceabilityInput): FyTraceabilityReport {
  const { fyStart, cutoff } = input
  const months = monthsBetween(fyStart, cutoff)
  const inPeriod = (d: string) => d >= fyStart && d <= cutoff

  const works: LineWork[] = []
  for (const line of input.lines) {
    if (line.billDate > cutoff) continue
    const movements = (input.movementsByLine.get(line.purchaseLineId) ?? []).filter((m) => m.entry_date <= cutoff)
    const work = buildLine(line, movements, fyStart, cutoff)
    const b = work.block
    if (b.isPriorFy) {
      // Opening stock matters only if something was left at the FY start or it moved in the period.
      const moved = movements.some((m) => inPeriod(m.entry_date))
      if (Math.abs(b.openingBalance) < EPS && !moved) continue
    } else if (b.purchaseQty < EPS && b.line.billedQty > EPS && Math.abs(b.closingBalance) < EPS && b.soldQty < EPS) {
      continue // fully cancelled purchase: nothing was bought
    }
    works.push(work)
  }

  const byBill = (a: LineWork, b: LineWork) =>
    a.block.line.billDate.localeCompare(b.block.line.billDate) ||
    a.block.line.billNumber.localeCompare(b.block.line.billNumber) ||
    a.block.line.purchaseLineId.localeCompare(b.block.line.purchaseLineId)
  works.sort(byBill)

  const current = works.filter((w) => !w.block.isPriorFy)
  const prior = works.filter((w) => w.block.isPriorFy)

  const currentFy: MonthGroup[] = months
    .map((month) => {
      const blocks = current.filter((w) => w.block.line.billDate.startsWith(month)).map((w) => w.block)
      return { month, blocks, totals: sumBlocks(blocks) }
    })
    .filter((g) => g.blocks.length > 0)

  const unlinked = input.unlinkedSales.filter((s) => inPeriod(s.date))

  // Monthly summary
  const summary: MonthSummaryRow[] = []
  let prevClosing = prior.reduce((s, w) => s + w.block.openingBalance, 0)
  for (const month of months) {
    const start = `${month}-01`
    const end = monthEnd(month) < cutoff ? monthEnd(month) : cutoff
    const inMonth = (d: string) => d >= start && d <= end
    const row: MonthSummaryRow = {
      month,
      purchaseQty: 0, purchaseBasic: 0, purchaseGst: 0, purchaseTotal: 0,
      saleQty: 0, saleValue: 0, saleGst: 0,
      priorSaleQty: 0, priorSaleValue: 0, priorSaleGst: 0,
      unlinkedSaleQty: 0, unlinkedSaleValue: 0, unlinkedSaleGst: 0,
      otherQty: 0, openingQty: prevClosing, closingQty: 0, closingWarehouse: 0, closingVendor: 0, closingValue: 0,
    }
    for (const w of works) {
      const { line, isPriorFy } = w.block
      if (!isPriorFy) {
        if (inMonth(line.billDate)) {
          row.purchaseQty += line.billedQty
          row.purchaseBasic += line.basic
          row.purchaseGst += line.gst
          row.purchaseTotal += line.total
        }
        for (const c of w.cancels) {
          if (!inMonth(c.date) || line.billedQty < EPS) continue
          const share = c.qty / line.billedQty
          row.purchaseQty -= c.qty
          row.purchaseBasic -= line.basic * share
          row.purchaseGst -= line.gst * share
          row.purchaseTotal -= line.total * share
        }
      }
      for (const s of w.periodSales) {
        if (!inMonth(s.date)) continue
        if (isPriorFy) {
          row.priorSaleQty += s.qty
          row.priorSaleValue += s.value
          row.priorSaleGst += s.gst
        } else {
          row.saleQty += s.qty
          row.saleValue += s.value
          row.saleGst += s.gst
        }
      }
      if (!isPriorFy && line.billDate > end) continue
      const bal = balanceAsOf(w.points, end)
      row.closingWarehouse += bal.warehouse
      row.closingVendor += bal.vendor
      row.closingValue += (bal.warehouse + bal.vendor) * line.rate
    }
    for (const s of unlinked) {
      if (!inMonth(s.date)) continue
      row.unlinkedSaleQty += s.qty
      row.unlinkedSaleValue += s.saleValue
      row.unlinkedSaleGst += s.saleGst
    }
    row.closingQty = row.closingWarehouse + row.closingVendor
    row.otherQty = row.closingQty - (row.openingQty + row.purchaseQty - row.saleQty - row.priorSaleQty)
    prevClosing = row.closingQty
    summary.push(row)
  }

  const last = summary[summary.length - 1]
  const summaryTotal: MonthSummaryRow = summary.reduce<MonthSummaryRow>(
    (acc, r) => ({
      ...acc,
      purchaseQty: acc.purchaseQty + r.purchaseQty,
      purchaseBasic: acc.purchaseBasic + r.purchaseBasic,
      purchaseGst: acc.purchaseGst + r.purchaseGst,
      purchaseTotal: acc.purchaseTotal + r.purchaseTotal,
      saleQty: acc.saleQty + r.saleQty,
      saleValue: acc.saleValue + r.saleValue,
      saleGst: acc.saleGst + r.saleGst,
      priorSaleQty: acc.priorSaleQty + r.priorSaleQty,
      priorSaleValue: acc.priorSaleValue + r.priorSaleValue,
      priorSaleGst: acc.priorSaleGst + r.priorSaleGst,
      unlinkedSaleQty: acc.unlinkedSaleQty + r.unlinkedSaleQty,
      unlinkedSaleValue: acc.unlinkedSaleValue + r.unlinkedSaleValue,
      unlinkedSaleGst: acc.unlinkedSaleGst + r.unlinkedSaleGst,
      otherQty: acc.otherQty + r.otherQty,
    }),
    {
      month: 'FYTD',
      purchaseQty: 0, purchaseBasic: 0, purchaseGst: 0, purchaseTotal: 0,
      saleQty: 0, saleValue: 0, saleGst: 0,
      priorSaleQty: 0, priorSaleValue: 0, priorSaleGst: 0,
      unlinkedSaleQty: 0, unlinkedSaleValue: 0, unlinkedSaleGst: 0,
      otherQty: 0,
      openingQty: summary[0]?.openingQty ?? 0,
      closingQty: last?.closingQty ?? 0,
      closingWarehouse: last?.closingWarehouse ?? 0,
      closingVendor: last?.closingVendor ?? 0,
      closingValue: last?.closingValue ?? 0,
    },
  )

  return {
    fyStart,
    cutoff,
    currentFy,
    currentFyTotals: sumBlocks(current.map((w) => w.block)),
    priorFy: prior.map((w) => w.block),
    priorFyTotals: sumBlocks(prior.map((w) => w.block)),
    unlinkedSales: unlinked,
    unlinkedTotals: unlinked.reduce(
      (t, s) => ({ qty: t.qty + s.qty, saleValue: t.saleValue + s.saleValue, saleGst: t.saleGst + s.saleGst }),
      { qty: 0, saleValue: 0, saleGst: 0 },
    ),
    summary,
    summaryTotal,
  }
}
