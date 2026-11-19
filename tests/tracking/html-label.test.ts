// Labels for "any printer": the print-dialog page and the QR code and barcode
// drawn on it. The codes are rasterised at real printer resolutions and read
// back with a barcode decoder, which is as close to a print as a test can get.
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  BinaryBitmap, Code128Reader, DecodeHintType, HybridBinarizer, MultiFormatReader, QRCodeReader, RGBLuminanceSource, BarcodeFormat,
} from '@zxing/library'
import { code128BBars, code128BModuleCount, code128BValues, isCode128BText } from '@/lib/tracking/code128'
import {
  barcodePlan, code128Svg, code128WidthMm, escapeHtml, labelPageHtml, MIN_PRINTED_MODULE_MM, qrSvg, type PrintableLabel,
} from '@/lib/tracking/htmlLabel'
import { labelFieldsForLocation, labelFieldsForUnit, testLabelFields } from '@/lib/tracking/zpl'

const unit = {
  qr_reference: 'WC1-0123456789ABCDEF', stock_tracking_id: 'ST2611-000001', item_code: 'CR00171', item_name: 'CR Coil',
  size_label: '0.70 X 175', quantity: '3.333', unit: 'MT', bundle_no: 2, bundle_count: 3, weight_basis: 'estimated',
  purchase_line_id: 'CR0625-0058', receipt_date: '2026-11-18',
}

/** Rasterises an SVG at a printer's resolution and returns a decoder-ready bitmap. */
async function bitmapAt(svg: string, dpi: number): Promise<BinaryBitmap> {
  const { data, info } = await sharp(Buffer.from(svg), { density: dpi })
    .flatten({ background: '#ffffff' })
    .extend({ top: 20, bottom: 20, left: 20, right: 20, background: '#ffffff' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const source = new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)
  return new BinaryBitmap(new HybridBinarizer(source))
}

describe('Code 128 barcode', () => {
  it('computes the check digit the standard way', () => {
    // "PJJ123C" by hand: 104 + 48x1 + 42x2 + 42x3 + 17x4 + 18x5 + 19x6 + 35x7 = 879, and 879 mod 103 = 55.
    const values = code128BValues('PJJ123C')
    expect(values.at(-2)).toBe(55)
    expect(values[0]).toBe(104)
    expect(values.at(-1)).toBe(106)
  })

  it('is 11 modules per symbol plus a 13-module stop', () => {
    const id = 'ST2611-000001'
    expect(code128BModuleCount(id)).toBe((1 + id.length + 1) * 11 + 13)
    // Bars and spaces alternate, so bars never touch.
    const bars = code128BBars(id)
    for (let i = 1; i < bars.length; i++) expect(bars[i][0]).toBeGreaterThan(bars[i - 1][0] + bars[i - 1][1] - 1)
  })

  it('refuses text set B cannot carry', () => {
    expect(isCode128BText('ST2611-000001')).toBe(true)
    expect(isCode128BText('')).toBe(false)
    expect(isCode128BText('naïve')).toBe(false)
    expect(code128Svg('naïve', 9)).toBe('')
  })

  for (const dpi of [203, 300, 600]) {
    it(`reads back from a ${dpi} dpi raster`, async () => {
      const bitmap = await bitmapAt(code128Svg('ST2611-000001', 9), dpi)
      const reader = new MultiFormatReader()
      const hints = new Map<DecodeHintType, unknown>([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]], [DecodeHintType.TRY_HARDER, true]])
      expect(reader.decode(bitmap, hints).getText()).toBe('ST2611-000001')
    })
  }

  it('reads back on a 75 mm wide label at 203 dpi, with bars kept at two dots or more', async () => {
    const fit = 0.75
    const plan = barcodePlan('ST2611-000001', fit)
    expect(plan).not.toBeNull()
    expect(plan!.moduleMm * fit).toBeGreaterThanOrEqual(MIN_PRINTED_MODULE_MM - 1e-9)
    const bitmap = await bitmapAt(code128Svg('ST2611-000001', 9 * fit, plan!.moduleMm * fit), 203)
    expect(new Code128Reader().decode(bitmap, new Map([[DecodeHintType.TRY_HARDER, true]])).getText()).toBe('ST2611-000001')
  })

  it('leaves the barcode off a label too small for readable bars, keeping the QR code and ID text', () => {
    expect(barcodePlan('ST2611-000001', 0.5)).toBeNull()
    const html = labelPageHtml([{ layout: 'bundle', fields: { ...labelFieldsForUnit(unit) }, width_mm: 50, height_mm: 25 }])
    expect(html).not.toContain('class="bar"')
    expect(html).toContain('class="tid tid-only">ST2611-000001<')
    expect(html).toContain('class="qr"')
  })
})

describe('QR code', () => {
  for (const [text, dpi] of [['WC1-0123456789ABCDEF', 203], ['WC1-0123456789ABCDEF', 300], ['WL1-0123456789ABCDEF', 203], ['TEST-NOT-STOCK', 203]] as const) {
    it(`reads back ${text} from a ${dpi} dpi raster`, async () => {
      const bitmap = await bitmapAt(qrSvg(text, 29), dpi)
      expect(new QRCodeReader().decode(bitmap).getText()).toBe(text)
    })
  }

  it('still reads when scaled down for a 50 x 25 mm label', async () => {
    const bitmap = await bitmapAt(qrSvg('WC1-0123456789ABCDEF', 29 * 0.5), 203)
    expect(new QRCodeReader().decode(bitmap).getText()).toBe('WC1-0123456789ABCDEF')
  })
})

describe('print-dialog label page', () => {
  const bundle: PrintableLabel = { layout: 'bundle', fields: { ...labelFieldsForUnit(unit) }, width_mm: 100, height_mm: 50 }

  it('sets the paper to the label size with no margins, one page per label', () => {
    const html = labelPageHtml([bundle, { ...bundle, fields: { ...bundle.fields, TRACKING_ID: 'ST2611-000002' } }])
    expect(html).toContain('@page{size:100mm 50mm;margin:0}')
    expect(html.match(/class="page"/g)).toHaveLength(2)
    expect(html).toContain('ST2611-000001')
    expect(html).toContain('ST2611-000002')
    expect(html).toContain('3.333 MT EST')
    expect(html).toContain('Bundle 2 of 3')
  })

  it('scales the 100 x 50 mm design to fit other label sizes', () => {
    expect(labelPageHtml([{ ...bundle, width_mm: 75, height_mm: 50 }])).toContain('transform:scale(0.7500)')
    expect(labelPageHtml([{ ...bundle, width_mm: 100, height_mm: 75 }])).toContain('transform:scale(1.0000)')
    expect(labelPageHtml([{ ...bundle, width_mm: 50, height_mm: 25 }])).toContain('@page{size:50mm 25mm;margin:0}')
  })

  it('keeps the tracking ID text clear of the barcode', () => {
    const html = labelPageHtml([bundle])
    const left = Number(/class="tid" style="left:([\d.]+)mm;/.exec(html)?.[1])
    expect(left).toBeGreaterThan(1 + code128WidthMm('ST2611-000001'))
    expect(left).toBeLessThan(65)
  })

  it('shows item text as text, never as markup', () => {
    const html = labelPageHtml([{ ...bundle, fields: { ...bundle.fields, ITEM_NAME: '<img src=x onerror=alert(1)> & "coil"' } }])
    expect(html).not.toContain('<img')
    expect(html).toContain('&#60;img src=x onerror=alert(1)&#62; &#38; &#34;coil&#34;')
    expect(escapeHtml(`'`)).toBe('&#39;')
  })

  it('draws location labels with the location code', () => {
    const html = labelPageHtml([{
      layout: 'location',
      fields: labelFieldsForLocation({ location_ref: 'WL1-0123456789ABCDEF', code: 'A-01', name: 'Bay A, row 1', warehouse_name: 'Main Yard' }),
      width_mm: 100, height_mm: 50,
    }])
    expect(html).toContain('class="loc-code">A-01<')
    expect(html).toContain('Main Yard')
    expect(html).not.toContain('class="bar"')
  })

  it('prints test labels that say they are not stock', () => {
    const html = labelPageHtml([{ layout: 'bundle', fields: { ...testLabelFields('Dock ZD230') }, width_mm: 100, height_mm: 50 }])
    expect(html).toContain('TEST - NOT STOCK')
    expect(html).toContain('Dock ZD230')
  })

  it('refuses an empty print or mixed label sizes', () => {
    expect(() => labelPageHtml([])).toThrow('Nothing to print')
    expect(() => labelPageHtml([bundle, { ...bundle, width_mm: 75 }])).toThrow('same size')
  })
})
