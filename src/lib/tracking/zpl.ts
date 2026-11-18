// Builds the ZPL sent to a Zebra printer. Pure functions, so label output can
// be tested without a printer. Building a label changes nothing anywhere.
import { TEST_LABEL_CODE } from './constants'

export interface LabelTemplate {
  zpl_body: string
  width_mm: number | string
  height_mm: number | string
  dpi: number | string
}

export interface LabelPrinterSetup {
  dpi: number | string
  label_width_mm: number | string
  label_height_mm: number | string
}

export interface LabelFields {
  QR: string
  TRACKING_ID: string
  ITEM_CODE: string
  ITEM_NAME: string
  SIZE: string
  WEIGHT: string
  BUNDLE: string
  LINE_AND_DATE: string
}

export interface UnitForLabel {
  qr_reference: string
  stock_tracking_id: string
  item_code: string | null
  item_name: string | null
  size_label: string | null
  quantity: string
  unit: string
  bundle_no: number | string
  bundle_count: number | string
  weight_basis: string
  purchase_line_id: string
  receipt_date: string | null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-11-18' becomes '18-Nov-2026'. */
export function formatLabelDate(date: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '')
  if (!match) return ''
  return `${match[3]}-${MONTHS[Number(match[2]) - 1] ?? match[2]}-${match[1]}`
}

/**
 * Makes text safe inside a ^FH\ field. Without this, an item name containing
 * ^ or ~ would be read by the printer as a command. Line breaks and control
 * characters are removed because a label field is a single run of text.
 */
export function escapeZplField(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[\\^~]/g, (ch) => `\\${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .trim()
}

export function labelFieldsForUnit(unit: UnitForLabel): LabelFields {
  const count = Number(unit.bundle_count)
  const estimated = unit.weight_basis === 'estimated' ? ' EST' : ''
  const date = formatLabelDate(unit.receipt_date)
  return {
    QR: unit.qr_reference,
    TRACKING_ID: unit.stock_tracking_id,
    ITEM_CODE: unit.item_code ?? '',
    ITEM_NAME: unit.item_name ?? '',
    SIZE: unit.size_label ?? '',
    WEIGHT: `${unit.quantity} ${unit.unit}${estimated}`,
    BUNDLE: unit.weight_basis === 'whole_line' ? 'Whole line' : `Bundle ${unit.bundle_no} of ${count}`,
    LINE_AND_DATE: date ? `${unit.purchase_line_id}  ${date}` : unit.purchase_line_id,
  }
}

export function testLabelFields(printerName: string): LabelFields {
  return {
    QR: TEST_LABEL_CODE,
    TRACKING_ID: TEST_LABEL_CODE,
    ITEM_CODE: 'TEST - NOT STOCK',
    ITEM_NAME: printerName,
    SIZE: 'Printer test only',
    WEIGHT: '0.000 MT',
    BUNDLE: 'This label is not a stock item',
    LINE_AND_DATE: 'Do not attach to material',
  }
}

/** Fills a template for one printer, scaling its dot sizes to that printer's resolution and label size. */
export function buildLabelZpl(template: LabelTemplate, printer: LabelPrinterSetup, fields: LabelFields): string {
  const printerDpi = Number(printer.dpi)
  const widthDots = Math.round((Number(printer.label_width_mm) / 25.4) * printerDpi)
  const heightDots = Math.round((Number(printer.label_height_mm) / 25.4) * printerDpi)
  const fit = Math.min(
    Number(printer.label_width_mm) / Number(template.width_mm),
    Number(printer.label_height_mm) / Number(template.height_mm),
  )
  const scale = (printerDpi / Number(template.dpi)) * fit

  const values: Record<string, string> = {
    LABEL_WIDTH: String(widthDots),
    LABEL_HEIGHT: String(heightDots),
  }
  for (const [key, value] of Object.entries(fields)) values[key] = escapeZplField(value)

  // One pass over the template, so text from a field is never read as a token.
  return template.zpl_body.replace(/\[\[(\d+)\]\]|\{\{([A-Z_]+)\}\}/g, (_, dots: string | undefined, name: string | undefined) => {
    if (dots !== undefined) return String(Math.max(1, Math.round(Number(dots) * scale)))
    return values[name ?? ''] ?? ''
  })
}
