// Draws a label as a print-ready web page, one label per page at the label's
// exact size. This is how labels reach printers that are not driven through
// Zebra Browser Print: any printer with a Windows, Mac or Android driver,
// including a Zebra on its own ZDesigner driver, and "Save as PDF".
//
// Pure functions (no browser needed), so the output can be tested without a
// printer. The layout matches the standard ZPL templates: a 100 x 50 mm design
// scaled to fit the printer's label size.
import QRCode from 'qrcode'
import { code128BBars, code128BModuleCount, isCode128BText } from './code128'

export type LabelLayout = 'bundle' | 'location'

export interface PrintableLabel {
  layout: LabelLayout
  fields: Record<string, string>
  width_mm: number
  height_mm: number
}

/** The design size every layout is drawn at before it is scaled to the label. */
export const DESIGN_WIDTH_MM = 100
export const DESIGN_HEIGHT_MM = 50

const BARCODE_MODULE_MM = 0.3
/** Thinnest bar on the printed label: two dots at 203 dpi. */
export const MIN_PRINTED_MODULE_MM = 0.25

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

/**
 * The QR code as an SVG, sized in millimetres. Each dark run in a row is one
 * rectangle, and shape-rendering keeps module edges sharp on thermal printers.
 * Error correction Q matches the ZPL template (^FDQA).
 */
export function qrSvg(text: string, sizeMm: number): string {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'Q' })
  const n = modules.size
  const quiet = 2
  const total = n + quiet * 2
  const rects: string[] = []
  for (let row = 0; row < n; row++) {
    let col = 0
    while (col < n) {
      if (!modules.get(row, col)) { col++; continue }
      const start = col
      while (col < n && modules.get(row, col)) col++
      rects.push(`M${start + quiet} ${row + quiet}h${col - start}v1h${start - col}z`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${sizeMm}mm" height="${sizeMm}mm" shape-rendering="crispEdges">`
    + `<rect width="${total}" height="${total}" fill="#fff"/><path fill="#000" d="${rects.join('')}"/></svg>`
}

/** The tracking ID as a Code 128 barcode, with a quiet zone of ten modules on each side. */
export function code128Svg(text: string, heightMm: number, moduleMm = BARCODE_MODULE_MM): string {
  if (!isCode128BText(text)) return ''
  const quiet = 10
  const total = code128BModuleCount(text) + quiet * 2
  const bars = code128BBars(text).map(([x, w]) => `M${x + quiet} 0h${w}v1h${-w}z`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} 1" preserveAspectRatio="none" width="${(total * moduleMm).toFixed(2)}mm" height="${heightMm}mm" shape-rendering="crispEdges">`
    + `<rect width="${total}" height="1" fill="#fff"/><path fill="#000" d="${bars}"/></svg>`
}

/** Width of the barcode drawing, quiet zones included. */
export function code128WidthMm(text: string, moduleMm = BARCODE_MODULE_MM): number {
  return isCode128BText(text) ? (code128BModuleCount(text) + 20) * moduleMm : 0
}

function text(className: string, value: string | undefined): string {
  return value ? `<div class="${className}">${escapeHtml(value)}</div>` : ''
}

/**
 * Where the barcode and the tracking ID text go, in design millimetres. Bars are
 * never printed thinner than MIN_PRINTED_MODULE_MM (two dots on a 203 dpi
 * printer); a barcode that would then crowd the label is left off, and the
 * tracking ID is printed as text only. The QR code is always printed.
 */
export function barcodePlan(id: string, fit: number): { moduleMm: number; tidLeftMm: number; tidFontMm: number } | null {
  if (!isCode128BText(id)) return null
  const moduleMm = Math.max(BARCODE_MODULE_MM, MIN_PRINTED_MODULE_MM / fit)
  const tidLeftMm = 1 + code128WidthMm(id, moduleMm) + 1
  if (tidLeftMm > 75) return null
  // Bold Arial is about 0.6 em per character.
  const tidFontMm = Math.min(4.4, (DESIGN_WIDTH_MM - 1 - tidLeftMm) / (id.length * 0.6))
  return { moduleMm, tidLeftMm, tidFontMm }
}

function bundleBody(fields: Record<string, string>, fit: number): string {
  const id = fields.TRACKING_ID ?? ''
  const plan = barcodePlan(id, fit)
  const codes = plan
    ? `<div class="bar">${code128Svg(id, 9, plan.moduleMm)}</div>`
      + `<div class="tid" style="left:${plan.tidLeftMm.toFixed(2)}mm;font-size:${plan.tidFontMm.toFixed(2)}mm">${escapeHtml(id)}</div>`
    : `<div class="tid tid-only">${escapeHtml(id)}</div>`
  return `<div class="qr" style="left:1.5mm;top:1mm">${qrSvg(fields.QR ?? '', 29)}</div>`
    + `<div class="col">`
    + text('code', fields.ITEM_CODE)
    + text('name', fields.ITEM_NAME)
    + text('small', fields.SIZE)
    + text('weight', fields.WEIGHT)
    + text('small', fields.BUNDLE)
    + text('small', fields.LINE_AND_DATE)
    + `</div>`
    + codes
}

function locationBody(fields: Record<string, string>): string {
  return `<div class="qr" style="left:1.5mm;top:4mm">${qrSvg(fields.QR ?? '', 33)}</div>`
    + `<div class="col loc">`
    + text('loc-code', fields.CODE)
    + text('loc-name', fields.NAME)
    + text('loc-wh', fields.WAREHOUSE)
    + `</div>`
}

const STYLE = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{position:relative;overflow:hidden;break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
.design{position:absolute;left:0;top:0;width:${DESIGN_WIDTH_MM}mm;height:${DESIGN_HEIGHT_MM}mm;transform-origin:0 0}
.qr{position:absolute;line-height:0}
.qr svg,.bar svg{display:block}
.col{position:absolute;left:32mm;top:2.5mm;width:66mm}
.col div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.code{font-size:4.6mm;font-weight:700;line-height:1.15}
.name{font-size:3.2mm;line-height:1.2;white-space:normal!important;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;max-height:7.7mm}
.small{font-size:3.2mm;line-height:1.3}
.weight{font-size:6mm;font-weight:700;line-height:1.25}
.bar{position:absolute;left:1mm;top:37.5mm;line-height:0}
.tid{position:absolute;top:39mm;font-size:4.4mm;font-weight:700;white-space:nowrap}
.tid-only{left:2mm;top:37.5mm;font-size:8mm}
.loc{left:40mm;top:6mm;width:58mm}
.loc-code{font-size:12mm;font-weight:700;line-height:1.1}
.loc-name{font-size:4.3mm;line-height:1.25;margin-top:2mm;white-space:normal!important;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.loc-wh{font-size:3.5mm;line-height:1.25;margin-top:2mm}
@media screen{body{background:#e5e7eb;padding:8px}.page{background:#fff;margin:0 auto 8px;outline:1px solid #9ca3af}}
`

/** A complete HTML document with one page per label. All labels in one call must share a size. */
export function labelPageHtml(labels: PrintableLabel[], title = 'WareCore labels'): string {
  if (labels.length === 0) throw new Error('Nothing to print')
  const { width_mm: width, height_mm: height } = labels[0]
  if (labels.some((label) => label.width_mm !== width || label.height_mm !== height)) {
    throw new Error('Labels printed together must be the same size')
  }
  const fit = Math.min(width / DESIGN_WIDTH_MM, height / DESIGN_HEIGHT_MM)
  const pages = labels.map((label) => {
    const body = label.layout === 'location' ? locationBody(label.fields) : bundleBody(label.fields, fit)
    return `<div class="page" style="width:${width}mm;height:${height}mm"><div class="design" style="transform:scale(${fit.toFixed(4)})">${body}</div></div>`
  })
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>`
    + `<style>@page{size:${width}mm ${height}mm;margin:0}${STYLE}</style></head><body>${pages.join('')}</body></html>`
}
