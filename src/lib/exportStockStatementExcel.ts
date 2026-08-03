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

function toDateOnly(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}

function formatDDMMMYYYY(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
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
}

export async function exportStockStatementExcel(
  items: StockStatementExportItem[],
  totals: StockStatementExportTotals,
  meta: StockStatementExportMeta
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = meta.generatedBy || 'WareCore'
  workbook.created = new Date()

  const toDateLabel = formatDDMMMYYYY(meta.toDate)
  const fromDateLabel = formatDDMMMYYYY(meta.fromDate)

  // ── Sheet 1: Stock Statement ────────────────────────────────────────────
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

  // Report header block (rows 1-5), merged across the full table width
  const lastCol = columns.length
  const lastColLetter = sheet.getColumn(lastCol).letter
  const mergeFullWidth = (row: number) => sheet.mergeCells(`A${row}:${lastColLetter}${row}`)

  sheet.getCell('A1').value = meta.companyName
  sheet.getCell('A1').font = TITLE_FONT
  mergeFullWidth(1)

  sheet.getCell('A2').value = 'Stock Statement'
  sheet.getCell('A2').font = { bold: true, size: 13, color: { argb: 'FF333333' } }
  mergeFullWidth(2)

  sheet.getCell('A3').value = `Period: ${fromDateLabel} to ${toDateLabel}`
  sheet.getCell('A3').font = SUBTITLE_FONT
  mergeFullWidth(3)

  const filterBits = [
    `Warehouse: ${meta.warehouseName}`,
    `Item: ${meta.itemLabel}`,
    `Vendor: ${meta.vendorLabel}`,
  ]
  sheet.getCell('A4').value = filterBits.join('   |   ')
  sheet.getCell('A4').font = SUBTITLE_FONT
  mergeFullWidth(4)

  sheet.getCell('A5').value = `Generated On: ${new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date())}   |   Generated By: ${escapeText(meta.generatedBy || '—')}`
  sheet.getCell('A5').font = SUBTITLE_FONT
  mergeFullWidth(5)

  for (let r = 1; r <= 5; r++) sheet.getRow(r).alignment = { vertical: 'middle' }

  // Row 6 blank spacer, row 7 = column headers
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
    addSummarySheet(workbook, items, totals, meta, fromDateLabel, toDateLabel)
    const buffer = await workbook.xlsx.writeBuffer()
    downloadBuffer(buffer, buildFilename(meta))
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

  // Grand total row styling (values/formulas already written by addTable's totalsRow)
  const totalsRow = sheet.getRow(totalsRowIdx)
  totalsRow.eachCell((cell, colNumber) => {
    const col = columns[colNumber - 1]
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF3' } }
    cell.border = { ...THIN_BORDER, top: { style: 'medium', color: { argb: 'FF1E3A5F' } } }
    if (col?.numFmt) cell.numFmt = col.numFmt
    if (col) cell.alignment = { vertical: 'middle', horizontal: col.align }
  })

  // Conditional formatting: negative stock highlighted, zero closing shaded
  const negWarningCols = columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.negativeWarning)
  for (const { i } of negWarningCols) {
    const colLetter = sheet.getColumn(i + 1).letter
    sheet.addConditionalFormatting({
      ref: `${colLetter}${firstDataRow}:${colLetter}${lastDataRow}`,
      rules: [
        {
          type: 'cellIs',
          operator: 'lessThan',
          formulae: ['0'],
          style: { fill: NEGATIVE_FILL, font: NEGATIVE_FONT },
          priority: 1,
        },
      ],
    })
  }
  const zeroShadeCols = columns.map((c, i) => ({ c, i })).filter(({ c }) => c.zeroShade)
  for (const { i } of zeroShadeCols) {
    const colLetter = sheet.getColumn(i + 1).letter
    sheet.addConditionalFormatting({
      ref: `${colLetter}${firstDataRow}:${colLetter}${lastDataRow}`,
      rules: [
        {
          type: 'cellIs',
          operator: 'equal',
          formulae: ['0'],
          style: { fill: ZERO_FILL },
          priority: 2,
        },
      ],
    })
  }

  sheet.headerFooter = {
    oddFooter: `&LGenerated: ${formatDDMMMYYYY(meta.toDate)}&C&P of &N&R${meta.companyName}`,
  }

  addSummarySheet(workbook, items, totals, meta, fromDateLabel, toDateLabel)

  const buffer = await workbook.xlsx.writeBuffer()
  downloadBuffer(buffer, buildFilename(meta))
}

function addSummarySheet(
  workbook: ExcelJS.Workbook,
  items: StockStatementExportItem[],
  totals: StockStatementExportTotals,
  meta: StockStatementExportMeta,
  fromDateLabel: string,
  toDateLabel: string
) {
  const summary = workbook.addWorksheet('Report Summary', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  summary.columns = [
    { header: 'Field', key: 'field', width: 32 },
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

  const rows: { field: string; value: string | number; bold?: boolean }[] = [
    { field: 'Report Name', value: 'Stock Statement' },
    { field: 'Company', value: escapeText(meta.companyName) },
    { field: 'From Date', value: fromDateLabel },
    { field: 'To Date', value: toDateLabel },
    { field: 'Warehouse', value: escapeText(meta.warehouseName) },
    { field: 'Item', value: escapeText(meta.itemLabel) },
    { field: 'Vendor', value: escapeText(meta.vendorLabel) },
    { field: 'Generated On', value: new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date()) },
    { field: 'Generated By', value: escapeText(meta.generatedBy || '—') },
    { field: 'Total Number of Items', value: items.length },
    { field: 'Total Opening Stock at Warehouse', value: fmtQ(totals.openingWarehouse) },
    { field: 'Total Opening Stock at Vendor', value: fmtQ(totals.openingVendor) },
    { field: 'Total Purchases', value: fmtQ(totals.purchase_in) },
    { field: 'Total Transfers In', value: fmtQ(totals.transfer_in) },
    { field: 'Total Other Inward', value: fmtQ(totals.other_in) },
    { field: 'Total Dispatches', value: fmtQ(totals.dispatch_out) },
    { field: 'Total Job Work Out', value: fmtQ(totals.jw_out) },
    { field: 'Total Transfers Out', value: fmtQ(totals.transfer_out) },
    { field: 'Total Other Outward', value: fmtQ(totals.other_out) },
    { field: 'Total Job Work Returns', value: fmtQ(totals.jw_return) },
    { field: `Closing Stock at Warehouse (as on ${toDateLabel})`, value: fmtQ(totals.warehouse), bold: true },
    { field: `Closing Stock at Vendor (as on ${toDateLabel})`, value: fmtQ(totals.vendor), bold: true },
    { field: `Total Available Stock (as on ${toDateLabel})`, value: fmtQ(totals.warehouse + totals.vendor), bold: true },
    { field: 'Total Value (₹)', value: fmtV(totals.value), bold: true },
  ]

  rows.forEach((r) => {
    const row = summary.addRow({ field: r.field, value: r.value })
    row.getCell(1).border = THIN_BORDER
    row.getCell(2).border = THIN_BORDER
    row.getCell(2).alignment = { horizontal: typeof r.value === 'number' ? 'right' : 'left' }
    if (typeof r.value === 'number') row.getCell(2).numFmt = QTY_FMT
    if (r.bold) {
      row.getCell(1).font = { bold: true }
      row.getCell(2).font = { bold: true }
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF3' } }
      row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF3' } }
    }
  })
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
