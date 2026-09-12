import {
  QTY_FMT,
  MONEY_FMT,
  type ProfessionalColumn,
  type ProfessionalSheetSpec,
} from '@/lib/exportProfessionalExcel'
import { ENTRY_TYPE_META, type EntryType, type LedgerReport } from '@/lib/dayWiseItemLedger'
import type { DayWiseFilters } from '@/lib/dayWiseItemLedgerData'

export type CriteriaLine = { label: string; value: string }

const PCT_FMT = '0.00"%"'

/** Human-readable echo of the applied filters, for the header and sheet 1. */
export function buildCriteriaLines(
  f: DayWiseFilters,
  opts: {
    companies: { id: string; name: string }[]
    warehouses: { id: string; name: string }[]
    items: { id: string; item_code: string; item_name: string }[]
    sizes: { id: string; size_label: string }[]
  }
): CriteriaLine[] {
  const names = <T,>(ids: string[], all: T[], match: (t: T, id: string) => boolean, label: (t: T) => string) =>
    ids.length === 0
      ? 'All'
      : ids
          .map((id) => {
            const found = all.find((t) => match(t, id))
            return found ? label(found) : id
          })
          .join(', ')

  return [
    { label: 'Period', value: `${f.fromDate} to ${f.toDate}` },
    { label: 'Company', value: names(f.companyIds, opts.companies, (c, id) => c.id === id, (c) => c.name) },
    { label: 'Warehouse', value: names(f.warehouseIds, opts.warehouses, (w, id) => w.id === id, (w) => w.name) },
    {
      label: 'Item',
      value: names(f.itemMasterIds, opts.items, (i, id) => i.id === id, (i) => `${i.item_code} — ${i.item_name}`),
    },
    { label: 'Item Size', value: names(f.materialSizeIds, opts.sizes, (s, id) => s.id === id, (s) => s.size_label) },
    {
      label: 'Transaction Type',
      value: f.entryTypes.length
        ? f.entryTypes.map((t) => ENTRY_TYPE_META[t as EntryType]?.label ?? t).join(', ')
        : 'All',
    },
    { label: 'Supplier', value: f.supplierIds.length ? f.supplierIds.join(', ') : 'All' },
    { label: 'Customer', value: f.customerIds.length ? f.customerIds.join(', ') : 'All' },
    { label: 'Job Worker', value: f.jobWorkerIds.length ? f.jobWorkerIds.join(', ') : 'All' },
    { label: 'Document / Bill No.', value: f.documentNumber.trim() || 'All' },
    { label: 'Cancelled transactions', value: f.includeCancelled ? 'Included' : 'Excluded' },
  ]
}

const SUMMARY_COLUMNS: ProfessionalColumn[] = [
  { header: 'Transaction Date', key: 'entryDate', width: 16, align: 'center', isDate: true },
  { header: 'Item Code', key: 'itemCode', width: 14, align: 'left' },
  { header: 'Item Description', key: 'itemDescription', width: 30, align: 'left' },
  { header: 'Item Size', key: 'itemSize', width: 14, align: 'left' },
  { header: 'UOM', key: 'unit', width: 8, align: 'center' },
  { header: 'Transactions', key: 'transactionCount', width: 13, align: 'right', totalsFn: 'sum' },
  { header: 'Inward Qty', key: 'inwardQuantity', width: 14, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
  { header: 'Outward Qty', key: 'outwardQuantity', width: 14, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
  { header: 'Basic Amount', key: 'basicAmount', width: 16, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum', negativeWarning: true },
  { header: 'Total GST', key: 'totalGst', width: 14, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
  { header: 'Total incl. GST', key: 'totalAmount', width: 18, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum', negativeWarning: true },
]

const DETAIL_COLUMNS: ProfessionalColumn[] = [
  { header: 'Transaction Date', key: 'entryDate', width: 16, align: 'center', isDate: true },
  { header: 'Transaction Time', key: 'entryTime', width: 15, align: 'center' },
  { header: 'Transaction Type', key: 'entryTypeLabel', width: 22, align: 'left' },
  { header: 'Document / Bill No.', key: 'documentNumber', width: 20, align: 'left' },
  { header: 'Company', key: 'companyName', width: 22, align: 'left' },
  { header: 'Warehouse', key: 'warehouseName', width: 18, align: 'left' },
  { header: 'Item Code', key: 'itemCode', width: 14, align: 'left' },
  { header: 'Item Description', key: 'itemDescription', width: 30, align: 'left' },
  { header: 'Item Size', key: 'itemSize', width: 14, align: 'left' },
  { header: 'UOM', key: 'unit', width: 8, align: 'center' },
  { header: 'Inward Qty', key: 'inwardQuantity', width: 14, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
  { header: 'Outward Qty', key: 'outwardQuantity', width: 14, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
  { header: 'Transacted Qty', key: 'transactedQuantity', width: 15, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
  { header: 'Rate', key: 'rate', width: 13, align: 'right', numFmt: MONEY_FMT },
  { header: 'Basic Amount', key: 'basicAmount', width: 16, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum', negativeWarning: true },
  { header: 'GST %', key: 'gstPercent', width: 9, align: 'right', numFmt: PCT_FMT },
  { header: 'CGST Amount', key: 'cgstAmount', width: 14, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
  { header: 'SGST Amount', key: 'sgstAmount', width: 14, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
  { header: 'IGST Amount', key: 'igstAmount', width: 14, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
  { header: 'Total GST', key: 'totalGst', width: 14, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
  { header: 'Total incl. GST', key: 'totalAmount', width: 18, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum', negativeWarning: true },
  { header: 'Supplier Name', key: 'supplierName', width: 24, align: 'left' },
  { header: 'Customer Name', key: 'customerName', width: 24, align: 'left' },
  { header: 'Job Worker Name', key: 'jobWorkerName', width: 24, align: 'left' },
  { header: 'Source', key: 'source', width: 24, align: 'left' },
  { header: 'Destination', key: 'destination', width: 24, align: 'left' },
  { header: 'Status', key: 'status', width: 12, align: 'center' },
  { header: 'Remarks', key: 'remarks', width: 34, align: 'left' },
  { header: 'Created By', key: 'createdByName', width: 20, align: 'left' },
  { header: 'Created Date & Time', key: 'createdAt', width: 22, align: 'center' },
]

const EXCEPTION_COLUMNS: ProfessionalColumn[] = [
  { header: 'Transaction Date', key: 'entryDate', width: 16, align: 'center', isDate: true },
  { header: 'Transaction Type', key: 'entryType', width: 24, align: 'left' },
  { header: 'Document / Bill No.', key: 'documentNumber', width: 20, align: 'left' },
  { header: 'Item Code', key: 'itemCode', width: 14, align: 'left' },
  { header: 'Item Size', key: 'itemSize', width: 14, align: 'left' },
  { header: 'Issue', key: 'issue', width: 34, align: 'left' },
  { header: 'Detail', key: 'detail', width: 80, align: 'left' },
  { header: 'Ledger Row ID', key: 'ledgerId', width: 38, align: 'left' },
]

const CRITERIA_COLUMNS: ProfessionalColumn[] = [
  { header: 'Filter', key: 'label', width: 26, align: 'left' },
  { header: 'Applied Value', key: 'value', width: 90, align: 'left' },
]

/** Formats a timestamp for the export, keeping it a string so Excel shows it verbatim. */
function formatCreatedAt(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}-${d.toLocaleString('en-IN', { month: 'short' })}-${d.getFullYear()} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Builds the four-sheet workbook: Report Criteria, Day-Wise Summary,
 * Detailed Ledger, Reconciliation Exceptions.
 *
 * Day subtotal rows are interleaved into the summary sheet and marked as
 * highlighted rows, so the daily totals are visible in Excel exactly where
 * they appear on screen rather than only as a grand total.
 */
export function buildExportSheets(report: LedgerReport, criteria: CriteriaLine[]): ProfessionalSheetSpec[] {
  const summaryRows: Record<string, unknown>[] = []
  const highlightRowIndexes: number[] = []

  for (const day of report.days) {
    for (const g of day.groups) {
      summaryRows.push({
        entryDate: g.entryDate,
        itemCode: g.itemCode,
        itemDescription: g.itemDescription,
        itemSize: g.itemSize,
        unit: g.unit,
        transactionCount: g.totals.transactionCount,
        inwardQuantity: g.totals.inwardQuantity,
        outwardQuantity: g.totals.outwardQuantity,
        basicAmount: g.totals.basicAmount,
        totalGst: g.totals.totalGst,
        totalAmount: g.totals.totalAmount,
      })
    }
    highlightRowIndexes.push(summaryRows.length)
    summaryRows.push({
      entryDate: day.entryDate,
      itemCode: '',
      itemDescription: `Total for ${day.entryDate}`,
      itemSize: '',
      unit: '',
      transactionCount: day.totals.transactionCount,
      inwardQuantity: day.totals.inwardQuantity,
      outwardQuantity: day.totals.outwardQuantity,
      basicAmount: day.totals.basicAmount,
      totalGst: day.totals.totalGst,
      totalAmount: day.totals.totalAmount,
    })
  }

  const detailRows = report.detail.map((r) => ({
    entryDate: r.entryDate,
    entryTime: r.entryTime,
    entryTypeLabel: r.entryTypeLabel,
    documentNumber: r.documentNumber,
    companyName: r.companyName,
    warehouseName: r.warehouseName,
    itemCode: r.itemCode,
    itemDescription: r.itemDescription,
    itemSize: r.itemSize,
    unit: r.unit,
    inwardQuantity: r.inwardQuantity,
    outwardQuantity: r.outwardQuantity,
    transactedQuantity: r.transactedQuantity,
    rate: r.rate,
    basicAmount: r.basicAmount,
    gstPercent: r.gstPercent,
    cgstAmount: r.cgstAmount,
    sgstAmount: r.sgstAmount,
    igstAmount: r.igstAmount,
    totalGst: r.totalGst,
    totalAmount: r.totalAmount,
    supplierName: r.supplierName,
    customerName: r.customerName,
    jobWorkerName: r.jobWorkerName,
    source: r.source,
    destination: r.destination,
    status: r.status,
    remarks: r.remarks,
    createdByName: r.createdByName,
    createdAt: formatCreatedAt(r.createdAt),
  }))

  return [
    {
      sheetName: 'Report Criteria',
      title: 'Day-Wise Item Ledger — Report Criteria',
      columns: CRITERIA_COLUMNS,
      rows: criteria.map((c) => ({ label: c.label, value: c.value })),
    },
    {
      sheetName: 'Day-Wise Summary',
      title: 'Day-Wise Item Ledger — Summary by Date, Item and Size',
      columns: SUMMARY_COLUMNS,
      rows: summaryRows,
      highlightRowIndexes,
      emptyMessage: 'No transactions for the selected criteria.',
    },
    {
      sheetName: 'Detailed Ledger',
      title: 'Day-Wise Item Ledger — Detailed Transactions',
      columns: DETAIL_COLUMNS,
      rows: detailRows,
      emptyMessage: 'No transactions for the selected criteria.',
    },
    {
      sheetName: 'Reconciliation Exceptions',
      title: 'Day-Wise Item Ledger — Reconciliation Exceptions',
      columns: EXCEPTION_COLUMNS,
      rows: report.exceptions.map((e) => ({
        entryDate: e.entryDate,
        entryType: e.entryType,
        documentNumber: e.documentNumber,
        itemCode: e.itemCode,
        itemSize: e.itemSize,
        issue: e.issue,
        detail: e.detail,
        ledgerId: e.ledgerId,
      })),
      emptyMessage: 'No reconciliation exceptions — every row tied back to its source document.',
    },
  ]
}
