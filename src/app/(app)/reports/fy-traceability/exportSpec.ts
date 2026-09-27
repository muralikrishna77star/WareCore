import { QTY_FMT, MONEY_FMT, type ProfessionalSheetSpec } from '@/lib/exportProfessionalExcel'
import { displayRows, type FyTraceabilityReport, type LineBlock } from '@/lib/fyTraceability'
import { monthLabel } from './format'

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

  const summaryRows = [...report.summary, report.summaryTotal].map((r) => ({
    month: r.month === 'FYTD' ? 'Financial year to date' : monthLabel(r.month),
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
    otherQty: r.otherQty,
    closingQty: r.closingQty,
    closingWarehouse: r.closingWarehouse,
    closingVendor: r.closingVendor,
    closingValue: r.closingValue,
  }))
  const summary: ProfessionalSheetSpec = {
    sheetName: 'Monthly Summary',
    title: 'Monthly Summary — Financial Year to Date',
    highlightRowIndexes: [summaryRows.length - 1],
    columns: [
      { header: 'Month', key: 'month', width: 20, align: 'left' },
      { header: 'Opening Qty', key: 'openingQty', width: 13, align: 'right', numFmt: QTY_FMT },
      { header: 'Purchase Qty', key: 'purchaseQty', width: 13, align: 'right', numFmt: QTY_FMT },
      { header: 'Purchase Basic', key: 'purchaseBasic', width: 16, align: 'right', numFmt: MONEY_FMT },
      { header: 'Purchase GST', key: 'purchaseGst', width: 14, align: 'right', numFmt: MONEY_FMT },
      { header: 'Purchase Total', key: 'purchaseTotal', width: 16, align: 'right', numFmt: MONEY_FMT },
      { header: 'Sale Qty', key: 'saleQty', width: 12, align: 'right', numFmt: QTY_FMT },
      { header: 'Sale Value', key: 'saleValue', width: 16, align: 'right', numFmt: MONEY_FMT },
      { header: 'Sale GST', key: 'saleGst', width: 13, align: 'right', numFmt: MONEY_FMT },
      { header: 'Prior-FY Stock Sold Qty', key: 'priorSaleQty', width: 14, align: 'right', numFmt: QTY_FMT },
      { header: 'Prior-FY Stock Sale Value', key: 'priorSaleValue', width: 16, align: 'right', numFmt: MONEY_FMT },
      { header: 'Prior-FY Stock Sale GST', key: 'priorSaleGst', width: 14, align: 'right', numFmt: MONEY_FMT },
      { header: 'Unlinked Sale Qty', key: 'unlinkedSaleQty', width: 13, align: 'right', numFmt: QTY_FMT },
      { header: 'Unlinked Sale Value', key: 'unlinkedSaleValue', width: 16, align: 'right', numFmt: MONEY_FMT },
      { header: 'Loss / Other Qty', key: 'otherQty', width: 13, align: 'right', numFmt: QTY_FMT },
      { header: 'Closing Qty', key: 'closingQty', width: 13, align: 'right', numFmt: QTY_FMT, negativeWarning: true },
      { header: 'In Warehouse', key: 'closingWarehouse', width: 13, align: 'right', numFmt: QTY_FMT },
      { header: 'At Vendor', key: 'closingVendor', width: 13, align: 'right', numFmt: QTY_FMT },
      { header: 'Closing Stock Value', key: 'closingValue', width: 17, align: 'right', numFmt: MONEY_FMT },
    ],
    rows: summaryRows,
  }

  const sheets = [detail, summary]
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
