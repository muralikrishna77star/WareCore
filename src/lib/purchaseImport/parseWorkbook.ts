// Reads an uploaded .xlsx buffer into normalized rows, ready for FK
// resolution in resolve.ts. This is the only place that deals with exceljs
// cell-value quirks (native Date cells vs. typed strings vs. Excel serial
// date numbers, numbers formatted with thousands separators, etc.) — the
// "identify the data corrections" part of the import that normalizes input
// *noise*. Resolving text against master data (matching *content*) happens
// in resolve.ts, not here.
import ExcelJS from 'exceljs'
import { COLUMNS, REQUIRED_COLUMNS, type ColumnName, type ParsedRow, type RowError } from './types'

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ')
}

const HEADER_LOOKUP = new Map<string, ColumnName>(COLUMNS.map((c) => [normalizeHeader(c), c]))

// Excel's epoch is 1899-12-30 (accounting for its intentional 1900 leap-year
// bug) — used only as a fallback for the rare case a date cell survives as a
// raw serial number instead of exceljs's usual auto-converted Date.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)

function excelSerialToDate(serial: number): Date {
  return new Date(EXCEL_EPOCH_MS + serial * 86400_000)
}

function formatDateUTC(d: Date): string {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// Accepts YYYY-MM-DD, DD-MM-YYYY, or DD/MM/YYYY text and normalizes to ISO.
// Returns '' if the string doesn't match any recognized shape.
function parseDateString(s: string): string {
  const trimmed = s.trim()
  let m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return formatDateUTC(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))))
  m = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (m) return formatDateUTC(new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))))
  return ''
}

function cellRawValue(cell: ExcelJS.Cell): unknown {
  const v = cell.value
  if (v && typeof v === 'object' && 'result' in v) return (v as { result: unknown }).result // formula cell
  if (v && typeof v === 'object' && 'richText' in v) {
    return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('')
  }
  if (v && typeof v === 'object' && 'text' in v) return (v as { text: string }).text // hyperlink cell
  return v
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cellRawValue(cell)
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return formatDateUTC(v)
  return String(v).trim()
}

function cellDateText(cell: ExcelJS.Cell): { normalized: string; raw: string } {
  const v = cellRawValue(cell)
  if (v === null || v === undefined || v === '') return { normalized: '', raw: '' }
  if (v instanceof Date) return { normalized: formatDateUTC(v), raw: formatDateUTC(v) }
  if (typeof v === 'number') return { normalized: formatDateUTC(excelSerialToDate(v)), raw: String(v) }
  const raw = String(v).trim()
  return { normalized: parseDateString(raw), raw }
}

// Strips thousands separators/currency symbols/whitespace before parsing —
// e.g. "1,250.50", "Rs. 1250.5", " 1250.5 " all parse to 1250.5. Returns
// null (not NaN/0) when nothing numeric could be recovered, so callers can
// tell "blank" and "unparseable" apart from a real zero.
function cellNumber(cell: ExcelJS.Cell): { value: number | null; raw: string } {
  const v = cellRawValue(cell)
  if (v === null || v === undefined || v === '') return { value: null, raw: '' }
  if (typeof v === 'number') return { value: v, raw: String(v) }
  const raw = String(v).trim()
  // Strip thousands separators first, then pull out the first signed
  // decimal-looking substring — this correctly ignores stray punctuation
  // from currency prefixes like "Rs." (a blanket char-class strip would
  // wrongly keep that period and produce an unparseable "Rs.1250.5").
  const match = raw.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  if (!match) return { value: null, raw }
  const n = Number(match[0])
  return { value: Number.isFinite(n) ? n : null, raw }
}

export async function parseWorkbook(buffer: Buffer | ArrayBuffer): Promise<{ rows: ParsedRow[]; errors: RowError[] }> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer as ExcelJS.Buffer)
  } catch {
    return { rows: [], errors: [{ rowNumber: null, message: 'Could not read the uploaded file — is it a valid .xlsx file?' }] }
  }

  const worksheet = workbook.getWorksheet('Purchases') ?? workbook.worksheets[0]
  if (!worksheet) {
    return { rows: [], errors: [{ rowNumber: null, message: 'The workbook has no worksheets.' }] }
  }

  const headerRow = worksheet.getRow(1)
  const columnIndex = new Map<ColumnName, number>()
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const canonical = HEADER_LOOKUP.get(normalizeHeader(String(cell.value ?? '')))
    if (canonical) columnIndex.set(canonical, colNumber)
  })

  const missing = REQUIRED_COLUMNS.filter((c) => !columnIndex.has(c))
  if (missing.length) {
    return { rows: [], errors: [{ rowNumber: null, message: `Missing required column(s): ${missing.join(', ')}. Download the template to see the expected headers.` }] }
  }

  const rows: ParsedRow[] = []
  const errors: RowError[] = []
  const get = (row: ExcelJS.Row, col: ColumnName): ExcelJS.Cell | null => {
    const idx = columnIndex.get(col)
    return idx ? row.getCell(idx) : null
  }

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    // Skip rows that are entirely blank (common trailing-rows artifact).
    const isBlank = COLUMNS.every((c) => {
      const cell = get(row, c)
      return !cell || cellText(cell) === ''
    })
    if (isBlank) return

    const billDateCell = get(row, 'Bill Date')
    const { normalized: billDate, raw: billDateRaw } = billDateCell ? cellDateText(billDateCell) : { normalized: '', raw: '' }
    const qtyCell = get(row, 'Quantity')
    const { value: quantity, raw: quantityRaw } = qtyCell ? cellNumber(qtyCell) : { value: null, raw: '' }
    const rateCell = get(row, 'Rate')
    const { value: rate, raw: rateRaw } = rateCell ? cellNumber(rateCell) : { value: null, raw: '' }

    const text = (c: ColumnName) => {
      const cell = get(row, c)
      return cell ? cellText(cell) : ''
    }

    if (billDateCell && billDateRaw && !billDate) {
      errors.push({ rowNumber, column: 'Bill Date', message: `Could not read date "${billDateRaw}" — use YYYY-MM-DD or DD-MM-YYYY.` })
    }
    if (qtyCell && quantityRaw && quantity === null) {
      errors.push({ rowNumber, column: 'Quantity', message: `Could not read quantity "${quantityRaw}" as a number.` })
    }
    if (rateCell && rateRaw && rate === null) {
      errors.push({ rowNumber, column: 'Rate', message: `Could not read rate "${rateRaw}" as a number.` })
    }

    rows.push({
      rowNumber,
      company: text('Company'),
      warehouse: text('Warehouse'),
      supplier: text('Supplier'),
      billDate,
      billDateRaw,
      billRef: text('Bill Ref'),
      materialType: text('Material Type'),
      size: text('Size'),
      quantity,
      quantityRaw,
      unit: text('Unit'),
      rate,
      rateRaw,
      taxRate: text('Tax Rate'),
      lineNotes: text('Line Notes'),
      billNotes: text('Bill Notes'),
    })
  })

  return { rows, errors }
}
