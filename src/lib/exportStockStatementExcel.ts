import ExcelJS from 'exceljs'

export type StockStatementExportItem = {
  itemCode: string
  itemName: string
  size: string
  unit: string
  openingWarehouse: number
  openingVendor: number
  purchaseIn: number
  otherIn: number
  transferIn: number
  dispatch: number
  jobWorkOut: number
  transferOut: number
  otherOut: number
  jwReturn: number
  stockAtWarehouse: number
  stockAtVendor: number
  totalAvailable: number
  rate: number
  value: number
}

export type StockStatementExportTotals = {
  openingWarehouse: number
  openingVendor: number
  purchase_in: number
  transfer_in: number
  jw_return: number
  other_in: number
  transfer_out: number
  dispatch_out: number
  jw_out: number
  other_out: number
  warehouse: number
  vendor: number
  value: number
}

export type StockStatementExportMeta = {
  companyName: string
  warehouseName: string
  itemLabel: string
  vendorLabel: string
  fromDate: string // YYYY-MM-DD
  toDate: string // YYYY-MM-DD
  generatedBy: string
}

// One row of the Transaction Details extract — the same records shown on
// screen, built from the same opening+period stock_ledger data as the
// Stock Statement summary (see stock-statement/page.tsx). No separate
// recalculation happens here.
export type TransactionDetailRow = {
  isOpeningRow: boolean
  itemKey: string // material_type_id|material_size_id — for UI drill-down/grouping only, not exported as a column
  date: string // YYYY-MM-DD
  typeLabel: string
  stockMovement: 'INWARD' | 'OUTWARD' | 'TRANSFER' | 'ADJUSTMENT' | ''
  documentNumber: string
  companyName: string
  warehouseName: string
  sourceWarehouseName: string
  destinationWarehouseName: string
  vendorName: string
  customerName: string
  itemCode: string
  itemName: string
  size: string
  unit: string
  inwardQty: number
  outwardQty: number
  warehouseChange: number
  vendorChange: number
  warehouseBalance: number
  vendorBalance: number
  rate: number | null
  value: number | null
  remarks: string
  status: string
  createdBy: string
  sourceModule: string
  sourceRecordId: string
  ledgerId: string
}

export type StockStatementReconciliation = {
  reconciled: boolean
  warehouseOpening: number
  warehouseNetMovement: number
  warehouseClosing: number
  vendorOpening: number
  vendorNetMovement: number
  vendorClosing: number
}

// Genuine .xlsx cells are never re-interpreted as formulas unless explicitly
// written as one — but a leading =/+/-/@ can still be misread as a formula
// if a user later pastes this text into a fresh cell or re-saves via a tool
// that does naive re-parsing (e.g. CSV round-trips). Neutralise defensively.
function escapeText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value
}

function sanitizeFilenamePart(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '').trim().replace(/\s+/g, '_')
}

// ExcelJS serializes a Date cell from its raw getTime() (absolute instant),
// so a Date built from browser-local midnight only round-trips correctly at
// UTC+0 — for timezones ahead of UTC (IST included), local midnight is still
// the previous day in absolute-time terms. Build from Date.UTC instead so
// the cell's instant is pinned to actual UTC midnight of the intended date,
// independent of the browser's timezone.
function toDateOnly(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function formatDDMMMYYYY(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(toDateOnly(iso))
    .replace(/ /g, '-')
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
const TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 16, color: { argb: 'FF1E3A5F' } }
const SUBTITLE_FONT: Partial<ExcelJS.Font> = { bold: false, size: 10, color: { argb: 'FF555555' } }
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
  left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
  bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
  right: { style: 'thin', color: { argb: 'FFCCCCCC' } },
}
const NEGATIVE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4E4' } }
const NEGATIVE_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FF9B1C1C' }, bold: true }
const ZERO_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }
const OPENING_ROW_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3F9' } }

const QTY_FMT = '#,##0.000'
const MONEY_FMT = '#,##0.00'

type ColumnDef = {
  header: string
  key: string
  width: number
  align: 'left' | 'center' | 'right'
  numFmt?: string
  negativeWarning?: boolean
  zeroShade?: boolean
  totalsFn?: 'sum'
  hidden?: boolean
}

function applyReportHeader(
  sheet: ExcelJS.Worksheet,
  lastColLetter: string,
  title: string,
  meta: StockStatementExportMeta,
  fromDateLabel: string,
  toDateLabel: string,
  filterLine: string
) {
  const mergeFullWidth = (row: number) => sheet.mergeCells(`A${row}:${lastColLetter}${row}`)

  sheet.getCell('A1').value = meta.companyName
  sheet.getCell('A1').font = TITLE_FONT
  mergeFullWidth(1)

  sheet.getCell('A2').value = title
  sheet.getCell('A2').font = { bold: true, size: 13, color: { argb: 'FF333333' } }
  mergeFullWidth(2)

  sheet.getCell('A3').value = `Period: ${fromDateLabel} to ${toDateLabel}`
  sheet.getCell('A3').font = SUBTITLE_FONT
  mergeFullWidth(3)

  sheet.getCell('A4').value = filterLine
  sheet.getCell('A4').font = SUBTITLE_FONT
  mergeFullWidth(4)

  sheet.getCell('A5').value = `Generated On: ${new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date())}   |   Generated By: ${escapeText(meta.generatedBy || '—')}`
  sheet.getCell('A5').font = SUBTITLE_FONT
  mergeFullWidth(5)

  for (let r = 1; r <= 5; r++) sheet.getRow(r).alignment = { vertical: 'middle' }
}

export async function exportStockStatementExcel(
  items: StockStatementExportItem[],
  totals: StockStatementExportTotals,
  meta: StockStatementExportMeta,
  transactions: TransactionDetailRow[],
  reconciliation: StockStatementReconciliation
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = meta.generatedBy || 'WareCore'
  workbook.created = new Date()

  const toDateLabel = formatDDMMMYYYY(meta.toDate)
  const fromDateLabel = formatDDMMMYYYY(meta.fromDate)
  const filterLine = [
    `Warehouse: ${meta.warehouseName}`,
    `Item: ${meta.itemLabel}`,
    `Vendor: ${meta.vendorLabel}`,
  ].join('   |   ')

  // Sheet order per spec: Report Summary, Stock Statement, Transaction Details
  addSummarySheet(workbook, items, totals, meta, fromDateLabel, toDateLabel, reconciliation)
  addStockStatementSheet(workbook, items, meta, fromDateLabel, toDateLabel, filterLine)
  addTransactionDetailsSheet(workbook, transactions, meta, fromDateLabel, toDateLabel, filterLine)

  const buffer = await workbook.xlsx.writeBuffer()
  downloadBuffer(buffer, buildFilename(meta))
}

// ── Sheet: Stock Statement (item-level summary — unchanged layout/columns) ──
function addStockStatementSheet(
  workbook: ExcelJS.Workbook,
  items: StockStatementExportItem[],
  meta: StockStatementExportMeta,
  fromDateLabel: string,
  toDateLabel: string,
  filterLine: string
) {
  const sheet = workbook.addWorksheet('Stock Statement', {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 7 }],
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      printTitlesRow: '1:7',
    },
  })

  const columns: ColumnDef[] = [
    { header: 'S.No.', key: 'sno', width: 8, align: 'center' },
    { header: 'Item Code', key: 'itemCode', width: 16, align: 'left' },
    { header: 'Item Name', key: 'itemName', width: 32, align: 'left' },
    { header: 'Size', key: 'size', width: 12, align: 'left' },
    { header: 'Unit', key: 'unit', width: 10, align: 'center' },
    { header: 'Opening Stock at Warehouse', key: 'openingWarehouse', width: 20, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
    { header: 'Opening Stock at Vendor', key: 'openingVendor', width: 20, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
    { header: 'Purchase Quantity', key: 'purchaseIn', width: 18, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
    { header: 'Transfer In Quantity', key: 'transferIn', width: 18, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
    { header: 'Other Inward Quantity', key: 'otherIn', width: 18, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
    { header: 'Dispatch Quantity', key: 'dispatch', width: 18, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
    { header: 'Job Work Out Quantity', key: 'jobWorkOut', width: 18, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
    { header: 'Transfer Out Quantity', key: 'transferOut', width: 18, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
    { header: 'Other Outward Quantity', key: 'otherOut', width: 18, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
    { header: 'Job Work Return Quantity', key: 'jwReturn', width: 18, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
    { header: `Stock at Warehouse as on ${toDateLabel}`, key: 'stockAtWarehouse', width: 24, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum', negativeWarning: true, zeroShade: true },
    { header: `Stock at Vendor as on ${toDateLabel}`, key: 'stockAtVendor', width: 22, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum', negativeWarning: true, zeroShade: true },
    { header: `Total Available Stock as on ${toDateLabel}`, key: 'totalAvailable', width: 24, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum', negativeWarning: true },
    { header: 'Avg Rate (₹)', key: 'rate', width: 14, align: 'right', numFmt: MONEY_FMT },
    { header: 'Value (₹)', key: 'value', width: 16, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
  ]

  const lastColLetter = sheet.getColumn(columns.length).letter
  applyReportHeader(sheet, lastColLetter, 'Stock Statement', meta, fromDateLabel, toDateLabel, filterLine)

  const headerRowIdx = 7
  const headerRow = sheet.getRow(headerRowIdx)
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = col.header
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = THIN_BORDER
    sheet.getColumn(i + 1).width = col.width
  })
  headerRow.height = 32

  if (items.length === 0) {
    const msgRow = sheet.getRow(headerRowIdx + 1)
    msgRow.getCell(1).value = 'No stock records found for the selected date range and filters.'
    sheet.mergeCells(`A${headerRowIdx + 1}:${lastColLetter}${headerRowIdx + 1}`)
    msgRow.getCell(1).font = { italic: true, color: { argb: 'FF888888' } }
    msgRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }
    return
  }

  const dataRows = items.map((item, idx) => [
    idx + 1,
    escapeText(item.itemCode || '—'),
    escapeText(item.itemName),
    escapeText(item.size || '—'),
    item.unit,
    item.openingWarehouse,
    item.openingVendor,
    item.purchaseIn,
    item.transferIn,
    item.otherIn,
    item.dispatch,
    item.jobWorkOut,
    item.transferOut,
    item.otherOut,
    item.jwReturn,
    item.stockAtWarehouse,
    item.stockAtVendor,
    item.totalAvailable,
    item.rate || null,
    item.rate ? item.value : null,
  ])

  const table = sheet.addTable({
    name: 'StockStatementTable',
    ref: `A${headerRowIdx}`,
    headerRow: true,
    totalsRow: true,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: columns.map((col) => ({
      name: col.header,
      filterButton: true,
      totalsRowFunction: col.totalsFn,
      totalsRowLabel: col.key === 'sno' ? 'GRAND TOTAL' : undefined,
    })),
    rows: dataRows,
  })
  table.commit()

  // addTable overwrites header cell styling with its theme — reapply ours
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = THIN_BORDER
  })

  const firstDataRow = headerRowIdx + 1
  const lastDataRow = headerRowIdx + items.length
  const totalsRowIdx = lastDataRow + 1

  for (let r = firstDataRow; r <= lastDataRow; r++) {
    const row = sheet.getRow(r)
    columns.forEach((col, i) => {
      const cell = row.getCell(i + 1)
      cell.border = THIN_BORDER
      cell.alignment = { vertical: 'middle', horizontal: col.align, wrapText: col.key === 'itemName' }
      if (col.numFmt) cell.numFmt = col.numFmt
    })
  }

  const totalsRow = sheet.getRow(totalsRowIdx)
  totalsRow.eachCell((cell, colNumber) => {
    const col = columns[colNumber - 1]
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF3' } }
    cell.border = { ...THIN_BORDER, top: { style: 'medium', color: { argb: 'FF1E3A5F' } } }
    if (col?.numFmt) cell.numFmt = col.numFmt
    if (col) cell.alignment = { vertical: 'middle', horizontal: col.align }
  })

  const negWarningCols = columns.map((c, i) => ({ c, i })).filter(({ c }) => c.negativeWarning)
  for (const { i } of negWarningCols) {
    const colLetter = sheet.getColumn(i + 1).letter
    sheet.addConditionalFormatting({
      ref: `${colLetter}${firstDataRow}:${colLetter}${lastDataRow}`,
      rules: [{ type: 'cellIs', operator: 'lessThan', formulae: ['0'], style: { fill: NEGATIVE_FILL, font: NEGATIVE_FONT }, priority: 1 }],
    })
  }
  const zeroShadeCols = columns.map((c, i) => ({ c, i })).filter(({ c }) => c.zeroShade)
  for (const { i } of zeroShadeCols) {
    const colLetter = sheet.getColumn(i + 1).letter
    sheet.addConditionalFormatting({
      ref: `${colLetter}${firstDataRow}:${colLetter}${lastDataRow}`,
      rules: [{ type: 'cellIs', operator: 'equal', formulae: ['0'], style: { fill: ZERO_FILL }, priority: 2 }],
    })
  }

  sheet.headerFooter = {
    oddFooter: `&LGenerated: ${formatDDMMMYYYY(meta.toDate)}&C&P of &N&R${meta.companyName}`,
  }
}

// ── Sheet: Transaction Details ──────────────────────────────────────────────
function addTransactionDetailsSheet(
  workbook: ExcelJS.Workbook,
  transactions: TransactionDetailRow[],
  meta: StockStatementExportMeta,
  fromDateLabel: string,
  toDateLabel: string,
  filterLine: string
) {
  const sheet = workbook.addWorksheet('Transaction Details', {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 7 }],
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      printTitlesRow: '1:7',
    },
  })

  const columns: ColumnDef[] = [
    { header: 'S.No.', key: 'sno', width: 8, align: 'center' },
    { header: 'Transaction Date', key: 'date', width: 16, align: 'center' },
    { header: 'Transaction Type', key: 'typeLabel', width: 22, align: 'left' },
    { header: 'Stock Movement', key: 'stockMovement', width: 14, align: 'center' },
    { header: 'Document Number', key: 'documentNumber', width: 18, align: 'left' },
    { header: 'Company', key: 'companyName', width: 18, align: 'left' },
    { header: 'Warehouse', key: 'warehouseName', width: 18, align: 'left' },
    { header: 'Source Warehouse', key: 'sourceWarehouseName', width: 18, align: 'left' },
    { header: 'Destination Warehouse', key: 'destinationWarehouseName', width: 18, align: 'left' },
    { header: 'Vendor', key: 'vendorName', width: 18, align: 'left' },
    { header: 'Customer', key: 'customerName', width: 18, align: 'left' },
    { header: 'Item Code', key: 'itemCode', width: 14, align: 'left' },
    { header: 'Item Name', key: 'itemName', width: 28, align: 'left' },
    { header: 'Size', key: 'size', width: 12, align: 'left' },
    { header: 'Unit', key: 'unit', width: 10, align: 'center' },
    { header: 'Inward Quantity', key: 'inwardQty', width: 16, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
    { header: 'Outward Quantity', key: 'outwardQty', width: 16, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
    { header: 'Warehouse Quantity Change', key: 'warehouseChange', width: 22, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum', negativeWarning: true },
    { header: 'Vendor Quantity Change', key: 'vendorChange', width: 20, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum', negativeWarning: true },
    { header: 'Warehouse Running Balance', key: 'warehouseBalance', width: 22, align: 'right', numFmt: QTY_FMT, negativeWarning: true },
    { header: 'Vendor Running Balance', key: 'vendorBalance', width: 20, align: 'right', numFmt: QTY_FMT, negativeWarning: true },
    { header: 'Rate (₹)', key: 'rate', width: 12, align: 'right', numFmt: MONEY_FMT },
    { header: 'Transaction Value (₹)', key: 'value', width: 18, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
    { header: 'Remarks', key: 'remarks', width: 22, align: 'left' },
    { header: 'Status', key: 'status', width: 10, align: 'center' },
    { header: 'Created By', key: 'createdBy', width: 16, align: 'left' },
    { header: 'Source Module', key: 'sourceModule', width: 16, align: 'left', hidden: true },
    { header: 'Source Record ID', key: 'sourceRecordId', width: 24, align: 'left', hidden: true },
    { header: 'Ledger ID', key: 'ledgerId', width: 24, align: 'left', hidden: true },
  ]

  const lastColLetter = sheet.getColumn(columns.length).letter
  applyReportHeader(sheet, lastColLetter, 'Stock Statement — Transaction Details', meta, fromDateLabel, toDateLabel, filterLine)

  const headerRowIdx = 7
  const headerRow = sheet.getRow(headerRowIdx)
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = col.header
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = THIN_BORDER
    const c = sheet.getColumn(i + 1)
    c.width = col.width
    if (col.hidden) c.hidden = true
  })
  headerRow.height = 32

  if (transactions.length === 0) {
    const msgRow = sheet.getRow(headerRowIdx + 1)
    msgRow.getCell(1).value = 'No stock movements found for the selected period.'
    sheet.mergeCells(`A${headerRowIdx + 1}:${lastColLetter}${headerRowIdx + 1}`)
    msgRow.getCell(1).font = { italic: true, color: { argb: 'FF888888' } }
    msgRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }
    return
  }

  const dataRows = transactions.map((t, idx) => [
    idx + 1,
    toDateOnly(t.date),
    escapeText(t.typeLabel),
    t.stockMovement,
    escapeText(t.documentNumber || '—'),
    escapeText(t.companyName || '—'),
    escapeText(t.warehouseName || '—'),
    escapeText(t.sourceWarehouseName || ''),
    escapeText(t.destinationWarehouseName || ''),
    escapeText(t.vendorName || ''),
    escapeText(t.customerName || ''),
    escapeText(t.itemCode || '—'),
    escapeText(t.itemName),
    escapeText(t.size || '—'),
    t.unit,
    t.isOpeningRow ? null : t.inwardQty || null,
    t.isOpeningRow ? null : t.outwardQty || null,
    t.isOpeningRow ? null : t.warehouseChange,
    t.isOpeningRow ? null : t.vendorChange,
    t.warehouseBalance,
    t.vendorBalance,
    t.rate ?? null,
    t.value ?? null,
    escapeText(t.remarks || ''),
    t.status,
    escapeText(t.createdBy || '—'),
    escapeText(t.sourceModule || ''),
    escapeText(t.sourceRecordId || ''),
    escapeText(t.ledgerId || ''),
  ])

  const table = sheet.addTable({
    name: 'TransactionDetailsTable',
    ref: `A${headerRowIdx}`,
    headerRow: true,
    totalsRow: true,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: columns.map((col) => ({
      name: col.header,
      filterButton: true,
      // Running balances are point-in-time — never totalled.
      totalsRowFunction: col.totalsFn,
      totalsRowLabel: col.key === 'sno' ? 'GRAND TOTAL' : undefined,
    })),
    rows: dataRows,
  })
  table.commit()

  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = THIN_BORDER
  })

  const firstDataRow = headerRowIdx + 1
  const lastDataRow = headerRowIdx + transactions.length
  const totalsRowIdx = lastDataRow + 1

  for (let r = firstDataRow; r <= lastDataRow; r++) {
    const row = sheet.getRow(r)
    const t = transactions[r - firstDataRow]
    columns.forEach((col, i) => {
      const cell = row.getCell(i + 1)
      cell.border = THIN_BORDER
      cell.alignment = { vertical: 'middle', horizontal: col.align, wrapText: col.key === 'itemName' || col.key === 'remarks' }
      if (col.key === 'date') cell.numFmt = 'dd-mmm-yyyy'
      else if (col.numFmt) cell.numFmt = col.numFmt
    })
    if (t.isOpeningRow) {
      row.eachCell((cell) => {
        cell.fill = OPENING_ROW_FILL
        cell.font = { ...(cell.font ?? {}), italic: true }
      })
    }
  }

  const totalsRow = sheet.getRow(totalsRowIdx)
  totalsRow.eachCell((cell, colNumber) => {
    const col = columns[colNumber - 1]
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF3' } }
    cell.border = { ...THIN_BORDER, top: { style: 'medium', color: { argb: 'FF1E3A5F' } } }
    if (col?.numFmt) cell.numFmt = col.numFmt
    if (col) cell.alignment = { vertical: 'middle', horizontal: col.align }
  })
  // Running-balance columns must never be totalled — addTable only wrote
  // totalsRowFunction for columns that had one (totalsFn), so these two
  // cells are already blank; explicitly clear them in case a future edit
  // adds a totalsFn to either by mistake.
  ;['warehouseBalance', 'vendorBalance'].forEach((key) => {
    const i = columns.findIndex((c) => c.key === key)
    if (i >= 0) totalsRow.getCell(i + 1).value = null
  })

  const negWarningCols = columns.map((c, i) => ({ c, i })).filter(({ c }) => c.negativeWarning)
  for (const { i } of negWarningCols) {
    const colLetter = sheet.getColumn(i + 1).letter
    sheet.addConditionalFormatting({
      ref: `${colLetter}${firstDataRow}:${colLetter}${lastDataRow}`,
      rules: [{ type: 'cellIs', operator: 'lessThan', formulae: ['0'], style: { fill: NEGATIVE_FILL, font: NEGATIVE_FONT }, priority: 1 }],
    })
  }

  sheet.headerFooter = {
    oddFooter: `&LGenerated: ${formatDDMMMYYYY(meta.toDate)}&C&P of &N&R${meta.companyName}`,
  }
}

// ── Sheet: Report Summary ───────────────────────────────────────────────────
function addSummarySheet(
  workbook: ExcelJS.Workbook,
  items: StockStatementExportItem[],
  totals: StockStatementExportTotals,
  meta: StockStatementExportMeta,
  fromDateLabel: string,
  toDateLabel: string,
  reconciliation: StockStatementReconciliation
) {
  const summary = workbook.addWorksheet('Report Summary', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  summary.columns = [
    { header: 'Field', key: 'field', width: 36 },
    { header: 'Value', key: 'value', width: 40 },
  ]
  const header = summary.getRow(1)
  header.eachCell((cell) => {
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.alignment = { horizontal: 'left', vertical: 'middle' }
    cell.border = THIN_BORDER
  })

  const fmtQ = (n: number) => Number(n.toFixed(3))
  const fmtV = (n: number) => Number(n.toFixed(2))

  const addSectionRow = (field: string) => {
    const row = summary.addRow({ field, value: '' })
    row.getCell(1).font = { bold: true, size: 11, color: { argb: 'FF1E3A5F' } }
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F3F8' } }
    row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F3F8' } }
    row.getCell(1).border = THIN_BORDER
    row.getCell(2).border = THIN_BORDER
  }
  const addRow = (field: string, value: string | number, bold = false) => {
    const row = summary.addRow({ field, value })
    row.getCell(1).border = THIN_BORDER
    row.getCell(2).border = THIN_BORDER
    row.getCell(2).alignment = { horizontal: typeof value === 'number' ? 'right' : 'left' }
    if (typeof value === 'number') row.getCell(2).numFmt = QTY_FMT
    if (bold) {
      row.getCell(1).font = { bold: true }
      row.getCell(2).font = { bold: true }
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF3' } }
      row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF3' } }
    }
    return row
  }

  addSectionRow('Report Details')
  addRow('Report Name', 'Stock Statement')
  addRow('Company', escapeText(meta.companyName))
  addRow('From Date', fromDateLabel)
  addRow('To Date', toDateLabel)
  addRow('Warehouse', escapeText(meta.warehouseName))
  addRow('Item', escapeText(meta.itemLabel))
  addRow('Vendor', escapeText(meta.vendorLabel))
  addRow('Generated On', new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date()))
  addRow('Generated By', escapeText(meta.generatedBy || '—'))
  addRow('Total Number of Items', items.length)

  addSectionRow('Movement Totals')
  addRow('Total Opening Stock at Warehouse', fmtQ(totals.openingWarehouse))
  addRow('Total Opening Stock at Vendor', fmtQ(totals.openingVendor))
  addRow('Total Purchases', fmtQ(totals.purchase_in))
  addRow('Total Transfers In', fmtQ(totals.transfer_in))
  addRow('Total Other Inward', fmtQ(totals.other_in))
  addRow('Total Dispatches', fmtQ(totals.dispatch_out))
  addRow('Total Job Work Out', fmtQ(totals.jw_out))
  addRow('Total Transfers Out', fmtQ(totals.transfer_out))
  addRow('Total Other Outward', fmtQ(totals.other_out))
  addRow('Total Job Work Returns', fmtQ(totals.jw_return))
  addRow(`Closing Stock at Warehouse (as on ${toDateLabel})`, fmtQ(totals.warehouse), true)
  addRow(`Closing Stock at Vendor (as on ${toDateLabel})`, fmtQ(totals.vendor), true)
  addRow(`Total Available Stock (as on ${toDateLabel})`, fmtQ(totals.warehouse + totals.vendor), true)
  addRow('Total Value (₹)', fmtV(totals.value), true)

  addSectionRow('Reconciliation')
  addRow('Opening Warehouse Stock', fmtQ(reconciliation.warehouseOpening))
  addRow('Net Warehouse Movement', fmtQ(reconciliation.warehouseNetMovement))
  addRow('Closing Warehouse Stock', fmtQ(reconciliation.warehouseClosing))
  addRow('Opening Vendor Stock', fmtQ(reconciliation.vendorOpening))
  addRow('Net Vendor Movement', fmtQ(reconciliation.vendorNetMovement))
  addRow('Closing Vendor Stock', fmtQ(reconciliation.vendorClosing))
  addRow('Total Available Stock', fmtQ(reconciliation.warehouseClosing + reconciliation.vendorClosing))
  const statusRow = addRow('Reconciliation Status', reconciliation.reconciled ? 'Reconciled' : 'Mismatch Detected', true)
  if (!reconciliation.reconciled) {
    statusRow.getCell(2).font = { bold: true, color: { argb: 'FF9B1C1C' } }
    statusRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4E4' } }
  } else {
    statusRow.getCell(2).font = { bold: true, color: { argb: 'FF1E6B3A' } }
    statusRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4EA' } }
  }
}

function buildFilename(meta: StockStatementExportMeta): string {
  const parts = ['Stock_Statement']
  if (meta.companyName && meta.companyName !== 'All Companies') parts.push(sanitizeFilenamePart(meta.companyName))
  if (meta.warehouseName && meta.warehouseName !== 'All Warehouses') parts.push(sanitizeFilenamePart(meta.warehouseName))
  parts.push(formatDDMMMYYYY(meta.fromDate))
  parts.push('to')
  parts.push(formatDDMMMYYYY(meta.toDate))
  return `${parts.join('_')}.xlsx`
}

function downloadBuffer(buffer: ExcelJS.Buffer, filename: string) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
