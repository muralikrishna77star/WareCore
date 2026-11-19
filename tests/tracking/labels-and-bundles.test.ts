import { describe, expect, it } from 'vitest'
import { fromThousandths, splitEqually, sumWeights, toThousandths } from '@/lib/tracking/bundles'
import { normalizePhone, pickupMessageText, whatsappUrl } from '@/lib/tracking/whatsapp'
import { buildLabelZpl, escapeZplField, formatLabelDate, labelFieldsForLocation, labelFieldsForUnit, testLabelFields } from '@/lib/tracking/zpl'

const template = {
  zpl_body: '^XA^PW{{LABEL_WIDTH}}^LL{{LABEL_HEIGHT}}^FO[[100]],[[50]]^FH\\^FD{{ITEM_NAME}}^FS^FDQA,{{QR}}^FS^XZ',
  width_mm: 100, height_mm: 50, dpi: 203,
}
const printer = { dpi: 203, label_width_mm: 100, label_height_mm: 50 }
const unit = {
  qr_reference: 'WC1-0123456789ABCDEF', stock_tracking_id: 'ST2611-000001', item_code: 'CR00171', item_name: 'CR Coil',
  size_label: '0.70 X 175', quantity: '3.333', unit: 'MT', bundle_no: 2, bundle_count: 3, weight_basis: 'estimated',
  purchase_line_id: 'CR0625-0058', receipt_date: '2026-11-18',
}

describe('bundle weights', () => {
  it('splits 10.000 into 3 bundles with the remainder on the last', () => {
    expect(splitEqually('10.000', 3)).toEqual(['3.333', '3.333', '3.334'])
  })

  it('always adds back to the exact total', () => {
    for (const [total, count] of [['2.589', 7], ['29.314', 99], ['0.050', 4], ['1', 3]] as const) {
      expect(toThousandths(sumWeights(splitEqually(total, count))!)).toBe(toThousandths(total))
    }
  })

  it('refuses weights that are not plain numbers with up to 3 decimals', () => {
    for (const bad of ['1.2345', '-1', 'abc', '', '1e3', '1,5']) expect(toThousandths(bad)).toBeNull()
    expect(sumWeights(['1.000', 'abc'])).toBeNull()
  })

  it('keeps thousandths exact', () => {
    expect(fromThousandths(toThousandths('0.070')!)).toBe('0.070')
    expect(sumWeights(['0.100', '0.200'])).toBe('0.300')
  })
})

describe('Zebra label output', () => {
  it('fills the label size and fields at 203 dpi', () => {
    const zpl = buildLabelZpl(template, printer, labelFieldsForUnit(unit))
    expect(zpl).toBe('^XA^PW799^LL400^FO100,50^FH\\^FDCR Coil^FS^FDQA,WC1-0123456789ABCDEF^FS^XZ')
  })

  it('scales positions for a 300 dpi printer', () => {
    expect(buildLabelZpl(template, { ...printer, dpi: 300 }, labelFieldsForUnit(unit))).toContain('^PW1181^LL591^FO148,74')
  })

  it('stops item text from being read as printer commands', () => {
    expect(escapeZplField('A^XZ~JR\\B')).toBe('A\\5EXZ\\7EJR\\5CB')
    const zpl = buildLabelZpl(template, printer, { ...labelFieldsForUnit(unit), ITEM_NAME: 'Bad^XZ\r\n~JA' })
    expect(zpl).toContain('^FDBad\\5EXZ \\7EJA^FS')
    expect(zpl.match(/\^XZ/g)).toHaveLength(1)
  })

  it('never treats item text as a template token', () => {
    const zpl = buildLabelZpl(template, printer, { ...labelFieldsForUnit(unit), ITEM_NAME: '{{QR}} [[100]]' })
    expect(zpl).toContain('^FD{{QR}} [[100]]^FS')
  })

  it('marks estimated weights, and shows bundle position', () => {
    const fields = labelFieldsForUnit(unit)
    expect(fields.WEIGHT).toBe('3.333 MT EST')
    expect(fields.BUNDLE).toBe('Bundle 2 of 3')
    expect(fields.LINE_AND_DATE).toBe('CR0625-0058  18-Nov-2026')
    expect(labelFieldsForUnit({ ...unit, weight_basis: 'weighed' }).WEIGHT).toBe('3.333 MT')
    expect(labelFieldsForUnit({ ...unit, weight_basis: 'whole_line', bundle_no: 1, bundle_count: 1 }).BUNDLE).toBe('Whole line')
  })

  it('puts only the opaque reference in the QR code', () => {
    expect(labelFieldsForUnit(unit).QR).toBe('WC1-0123456789ABCDEF')
  })

  it('marks a test label so it cannot pass as stock', () => {
    const fields = testLabelFields('Dock printer')
    expect(fields.QR).toBe('TEST-NOT-STOCK')
    expect(fields.ITEM_CODE).toBe('TEST - NOT STOCK')
  })

  it('formats label dates', () => {
    expect(formatLabelDate('2025-06-17')).toBe('17-Jun-2025')
    expect(formatLabelDate(null)).toBe('')
  })

  it('shows which part of a bundle a split label is', () => {
    expect(labelFieldsForUnit({ ...unit, part_no: 2 }).BUNDLE).toBe('Bundle 2 of 3, part 2')
  })

  it('builds a location label with its own QR reference', () => {
    const fields = labelFieldsForLocation({ location_ref: 'WL1-0123456789ABCDEF', code: 'A-03-2', name: 'Back ^wall', warehouse_name: 'Main' })
    const zpl = buildLabelZpl({ ...template, zpl_body: '^FDQA,{{QR}}^FS^FD{{CODE}}^FS^FH\\^FD{{NAME}}^FS' }, printer, fields)
    expect(zpl).toContain('WL1-0123456789ABCDEF')
    expect(zpl).toContain('A-03-2')
    expect(zpl).toContain('Back \\5Ewall')
  })
})

describe('WhatsApp message', () => {
  it('turns a typed number into international form', () => {
    expect(normalizePhone('98765 43210')).toBe('919876543210')
    expect(normalizePhone('098765-43210')).toBe('919876543210')
    expect(normalizePhone('+91 98765 43210')).toBe('919876543210')
    expect(normalizePhone('+971 50 123 4567')).toBe('971501234567')
  })

  it('refuses something that cannot be a phone number', () => {
    for (const bad of ['', '12345', 'call me', '1234567890123456', null, 9876543210]) expect(normalizePhone(bad)).toBeNull()
  })

  it('writes the pickup details, and only says ready once it is', () => {
    const pickup = { pickup_no: 'PU1126-0001', company_name: 'Sri Steel', warehouse_name: 'Main', customer_name: 'Acme', bundle_count: 1, total_quantity: '2.500', unit: 'MT', ready: false }
    expect(pickupMessageText(pickup)).toContain('Material: 1 bundle, 2.500 MT')
    expect(pickupMessageText(pickup)).toContain('Status: Being prepared')
    expect(pickupMessageText({ ...pickup, bundle_count: 3, ready: true })).toContain('3 bundles')
    expect(pickupMessageText({ ...pickup, ready: true })).toContain('Status: Ready for pickup')
  })

  it('encodes the message safely into the link', () => {
    expect(whatsappUrl('919876543210', 'A & B\nC')).toBe('https://wa.me/919876543210?text=A%20%26%20B%0AC')
  })
})
