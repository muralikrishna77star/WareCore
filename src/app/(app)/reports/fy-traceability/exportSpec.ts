import { QTY_FMT, MONEY_FMT, type ProfessionalSheetSpec } from '@/lib/exportProfessionalExcel'
import { displayRows, type FyTraceabilityReport, type LineBlock, type MonthSummaryRow } from '@/lib/fyTraceability'
import { fmtDate, monthLabel } from './format'

/**
 * Detail sheet: purchase amounts sit on each line's first row only and Stock
 * Value on its last row only, so the sheet's own column totals never count a
 * purchase twice. Prior-FY purchases keep their purchase figures in separate
 * "Prior-FY" columns so they stay out of the current year's purchase totals.
 */
export function buildExportSheets(report: FyTraceabilityReport, showJobWork: boolean): ProfessionalSheetSpec[] {
  const detailRows: Record<string, unknown>[] = []
  const highlight: number[] = []

  const pushBlock = (block: LineBlock, section: string) => {
    const rows = displayRows(block, showJobWork)
    const { line } = block
    rows.forEach((r, i) => {
      const first = i === 0
      const last = i === rows.length - 1
      const purchase = first && !block.isPriorFy
      if (first && block.isPriorFy) highlight.push(detailRows.length)
      detailRows.push({
        section,
        lineId: first ? line.purchaseLineId : '',
        purchaseDate: first ? line.billDate : null,
        seller: first ? line.seller : '',
        description: first ? line.description : '',
        size: first ? line.size : '',
        purchaseQty: purchase ? block.purchaseQty : null,
        rate: first ? line.rate : null,
        basic: purchase ? block.purchaseBasic : null,
        purchaseGst: purchase ? block.purchaseGst : null,
        purchaseTotal: purchase ? block.purchaseTotal : null,
        priorQty: first && block.isPriorFy ? line.billedQty : null,
        priorTotal: first && block.isPriorFy ? line.total : null,
        remarks: `${r.remarks}${r.reference ? ` (${r.reference})` : ''}`,
        saleDate: r.kind === 'OPENING' ? null : r.date,
        saleQty: r.saleQty,
        balance: r.balance,
        atWarehouse: last ? block.closingWarehouse : null,
        atVendor: last ? block.closingVendor : null,
        saleValue: r.saleValue,
        saleGst: r.saleGst,
        stockValue: last ? block.stockValue : null,
      })
    })
  }

  for (const g of report.currentFy) for (const b of g.blocks) pushBlock(b, `Purchased ${monthLabel(g.month)}`)
  for (const b of report.priorFy) pushBlock(b, 'Opening Stock / Prior-FY')

  const detail: ProfessionalSheetSpec = {
    sheetName: 'Traceability',
    title: 'Purchase & Sales Traceability',
    emptyMessage: 'No purchase lines match these filters for the period.',
    highlightRowIndexes: highlight,
    columns: [
      { header: 'Section', key: 'section', width: 20, align: 'left' },
      { header: 'Purchase Line ID', key: 'lineId', width: 16, align: 'left' },
      { header: 'Purchase Date', key: 'purchaseDate', width: 13, align: 'center', isDate: true },
      { header: 'Seller', key: 'seller', width: 22, align: 'left' },
      { header: 'Purchase Item Description', key: 'description', width: 26, align: 'left' },
      { header: 'Size', key: 'size', width: 14, align: 'left' },
      { header: 'Purchase Qty', key: 'purchaseQty', width: 13, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Rate', key: 'rate', width: 11, align: 'right', numFmt: MONEY_FMT },
      { header: 'Basic', key: 'basic', width: 15, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
      { header: 'Purchase GST', key: 'purchaseGst', width: 13, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
      { header: 'Purchase Total', key: 'purchaseTotal', width: 15, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
      { header: 'Prior-FY Purchase Qty', key: 'priorQty', width: 13, align: 'right', numFmt: QTY_FMT },
      { header: 'Prior-FY Purchase Total', key: 'priorTotal', width: 15, align: 'right', numFmt: MONEY_FMT },
      { header: 'Sales / Remarks', key: 'remarks', width: 40, align: 'left' },
      { header: 'Sale Date', key: 'saleDate', width: 12, align: 'center', isDate: true },
      { header: 'Sale Qty', key: 'saleQty', width: 11, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Balance Qty', key: 'balance', width: 12, align: 'right', numFmt: QTY_FMT, negativeWarning: true },
      { header: 'In Warehouse', key: 'atWarehouse', width: 12, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'At Vendor', key: 'atVendor', width: 12, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Sale Value', key: 'saleValue', width: 15, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
      { header: 'Sale GST', key: 'saleGst', width: 12, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
      { header: 'Stock Value', key: 'stockValue', width: 15, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum', negativeWarning: true },
    ],
    rows: detailRows,
  }

  const sheets = [buildMonthlySummarySheet(report), detail]
  if (report.unlinkedSales.length > 0) {
    sheets.push({
      sheetName: 'Unlinked Sales',
      title: 'Sales Not Linked to a Purchase Line',
      columns: [
        { header: 'Sale Date', key: 'date', width: 12, align: 'center', isDate: true },
        { header: 'Invoice', key: 'reference', width: 14, align: 'left' },
        { header: 'Customer', key: 'customer', width: 28, align: 'left' },
        { header: 'Item', key: 'description', width: 30, align: 'left' },
        { header: 'Size', key: 'size', width: 18, align: 'left' },
        { header: 'Sale Qty', key: 'qty', width: 12, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
        { header: 'Sale Value', key: 'saleValue', width: 16, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
        { header: 'Sale GST', key: 'saleGst', width: 13, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
      ],
      rows: report.unlinkedSales.map((s) => ({ ...s })),
    })
  }
  return sheets
}

const SALE_KINDS = new Set(['SALE', 'VENDOR_DIRECT_SALE'])

const summaryFigures = (r: MonthSummaryRow) => ({
  openingQty: r.openingQty,
  purchaseQty: r.purchaseQty,
  purchaseBasic: r.purchaseBasic,
  purchaseGst: r.purchaseGst,
  purchaseTotal: r.purchaseTotal,
  saleQty: r.saleQty,
  saleValue: r.saleValue,
  saleGst: r.saleGst,
  priorSaleQty: r.priorSaleQty,
  priorSaleValue: r.priorSaleValue,
  priorSaleGst: r.priorSaleGst,
  unlinkedSaleQty: r.unlinkedSaleQty,
  unlinkedSaleValue: r.unlinkedSaleValue,
  unlinkedSaleGst: r.unlinkedSaleGst,
  otherQty: r.otherQty,
  closingQty: r.closingQty,
  closingWarehouse: r.closingWarehouse,
  closingVendor: r.closingVendor,
  closingValue: r.closingValue,
})

/**
 * Monthly Summary as an Excel outline: each month is one level-0 row with the
 * on-screen summary figures, and expands into the transactions behind them —
 * purchases (and cancellations / re-entries) dated in the month, then every
 * sale made in the month. A detail row puts its amount in the same column as
 * its month row, so an expanded month's details add up exactly to it.
 * Opening Stock expands into the prior-FY lines carried into the year.
 *
 * Deliberately no column totals: with months expanded they would count every
 * month twice. The "Financial year to date" row is the total. Ships collapsed.
 */
export function buildMonthlySummarySheet(report: FyTraceabilityReport): ProfessionalSheetSpec {
  const rows: Record<string, unknown>[] = []
  const levels: number[] = []
  const highlight: number[] = []
  const blocks = [...report.currentFy.flatMap((g) => g.blocks), ...report.priorFy]

  const heading = (label: string, figures: Record<string, unknown>) => {
    highlight.push(rows.length)
    levels.push(0)
    rows.push({ month: label, ...figures })
  }
  const detail = (row: Record<string, unknown>) => {
    levels.push(1)
    rows.push(row)
  }
  const lineInfo = (b: LineBlock) => ({
    lineId: b.line.purchaseLineId,
    purchaseDate: b.line.billDate,
    item: b.line.description,
    size: b.line.size,
  })

  heading(`Opening Stock b/f (${fmtDate(report.fyStart)})`, { openingQty: report.summary[0]?.openingQty ?? 0 })
  for (const b of report.priorFy) {
    if (Math.abs(b.openingBalance) < 0.0005) continue
    detail({
      type: 'Opening stock (prior-FY purchase)',
      party: b.line.seller,
      reference: b.line.billNumber,
      ...lineInfo(b),
      openingQty: b.openingBalance,
    })
  }

  for (const m of report.summary) {
    heading(monthLabel(m.month), summaryFigures(m))
    const inMonth = (d: string | null) => !!d && d.startsWith(m.month)

    for (const b of blocks) {
      if (b.isPriorFy) continue
      const { line } = b
      if (inMonth(line.billDate)) {
        detail({
          type: 'Purchase',
          date: line.billDate,
          party: line.seller,
          reference: line.billNumber,
          ...lineInfo(b),
          purchaseQty: line.billedQty,
          purchaseBasic: line.basic,
          purchaseGst: line.gst,
          purchaseTotal: line.total,
        })
      }
      for (const r of b.rows) {
        if (r.purchaseQtyChange == null || !inMonth(r.date) || line.billedQty < 0.0005) continue
        const share = r.purchaseQtyChange / line.billedQty
        detail({
          type: r.kind === 'PURCHASE_CANCEL' ? 'Purchase cancelled' : 'Purchase re-entered',
          date: r.date,
          party: line.seller,
          reference: r.reference ?? '',
          ...lineInfo(b),
          purchaseQty: r.purchaseQtyChange,
          purchaseBasic: line.basic * share,
          purchaseGst: line.gst * share,
          purchaseTotal: line.total * share,
        })
      }
    }

    const sales: { date: string; row: Record<string, unknown> }[] = []
    for (const b of blocks) {
      for (const r of b.rows) {
        if (!SALE_KINDS.has(r.kind) || !inMonth(r.date)) continue
        const prior = b.isPriorFy
        sales.push({
          date: r.date as string,
          row: {
            type: prior ? 'Sale of opening / prior-FY stock' : 'Sale',
            date: r.date,
            party: r.remarks,
            reference: r.reference ?? '',
            ...lineInfo(b),
            [prior ? 'priorSaleQty' : 'saleQty']: r.saleQty,
            [prior ? 'priorSaleValue' : 'saleValue']: r.saleValue,
            [prior ? 'priorSaleGst' : 'saleGst']: r.saleGst,
          },
        })
      }
    }
    for (const s of report.unlinkedSales) {
      if (!inMonth(s.date)) continue
      sales.push({
        date: s.date,
        row: {
          type: 'Sale with no purchase line',
          date: s.date,
          party: s.customer,
          reference: s.reference,
          item: s.description,
          size: s.size,
          unlinkedSaleQty: s.qty,
          unlinkedSaleValue: s.saleValue,
          unlinkedSaleGst: s.saleGst,
        },
      })
    }
    sales.sort((a, b) => a.date.localeCompare(b.date))
    for (const s of sales) detail(s.row)
  }

  heading('Financial year to date', summaryFigures(report.summaryTotal))

  return {
    sheetName: 'Monthly Summary',
    title: 'Monthly Summary — Financial Year to Date (click + to expand a month)',
    highlightRowIndexes: highlight,
    rowOutlineLevels: levels,
    outlineCollapsed: true,
    columns: [
      { header: 'Month', key: 'month', width: 26, align: 'left' },
      { header: 'Type', key: 'type', width: 28, align: 'left' },
      { header: 'Date', key: 'date', width: 12, align: 'center', isDate: true },
      { header: 'Seller / Customer', key: 'party', width: 30, align: 'left' },
      { header: 'Bill / Invoice', key: 'reference', width: 14, align: 'left' },
      { header: 'Purchase Line ID', key: 'lineId', width: 15, align: 'left' },
      { header: 'Purchase Date', key: 'purchaseDate', width: 12, align: 'center', isDate: true },
      { header: 'Item', key: 'item', width: 24, align: 'left' },
      { header: 'Size', key: 'size', width: 14, align: 'left' },
      { header: 'Opening Qty', key: 'openingQty', width: 12, align: 'right', numFmt: QTY_FMT },
      { header: 'Purchase Qty', key: 'purchaseQty', width: 12, align: 'right', numFmt: QTY_FMT },
      { header: 'Purchase Basic', key: 'purchaseBasic', width: 15, align: 'right', numFmt: MONEY_FMT },
      { header: 'Purchase GST', key: 'purchaseGst', width: 13, align: 'right', numFmt: MONEY_FMT },
      { header: 'Purchase Total', key: 'purchaseTotal', width: 15, align: 'right', numFmt: MONEY_FMT },
      { header: 'Sale Qty', key: 'saleQty', width: 11, align: 'right', numFmt: QTY_FMT },
      { header: 'Sale Value', key: 'saleValue', width: 15, align: 'right', numFmt: MONEY_FMT },
      { header: 'Sale GST', key: 'saleGst', width: 13, align: 'right', numFmt: MONEY_FMT },
      { header: 'Prior-FY Stock Sold Qty', key: 'priorSaleQty', width: 13, align: 'right', numFmt: QTY_FMT },
      { header: 'Prior-FY Stock Sale Value', key: 'priorSaleValue', width: 15, align: 'right', numFmt: MONEY_FMT },
      { header: 'Prior-FY Stock Sale GST', key: 'priorSaleGst', width: 13, align: 'right', numFmt: MONEY_FMT },
      { header: 'Unlinked Sale Qty', key: 'unlinkedSaleQty', width: 12, align: 'right', numFmt: QTY_FMT },
      { header: 'Unlinked Sale Value', key: 'unlinkedSaleValue', width: 15, align: 'right', numFmt: MONEY_FMT },
      { header: 'Unlinked Sale GST', key: 'unlinkedSaleGst', width: 13, align: 'right', numFmt: MONEY_FMT },
      { header: 'Loss / Other Qty', key: 'otherQty', width: 12, align: 'right', numFmt: QTY_FMT },
      { header: 'Closing Qty', key: 'closingQty', width: 12, align: 'right', numFmt: QTY_FMT, negativeWarning: true },
      { header: 'In Warehouse', key: 'closingWarehouse', width: 12, align: 'right', numFmt: QTY_FMT },
      { header: 'At Vendor', key: 'closingVendor', width: 12, align: 'right', numFmt: QTY_FMT },
      { header: 'Closing Stock Value', key: 'closingValue', width: 16, align: 'right', numFmt: MONEY_FMT },
    ],
    rows,
  }
}
