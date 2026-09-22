import { describe, expect, it } from 'vitest'
import { buildPurchaseLineLedger, type PurchaseLineEntry, VENDOR_DIRECT_SALE_NOTE } from '@/lib/purchaseLineLedger'

const label = () => 'GI00200 — GI 1MM X 1220'

let seq = 0
const row = (
  entry_type: string,
  quantity: number,
  entry_date: string,
  extra: Partial<PurchaseLineEntry> = {},
): PurchaseLineEntry => ({
  id: `r${++seq}`,
  entry_type,
  quantity,
  entry_date,
  created_at: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`,
  reference_type: 'job_work',
  reference_id: `o${seq}`,
  ...extra,
})

/** vw_job_work_vendor_movements: transfers keep their own sign, everything else flips. */
const vendorDelta = (entry_type: string, quantity: number) =>
  entry_type === 'JOB_WORK_TRANSFER_IN' || entry_type === 'JOB_WORK_TRANSFER_OUT' ? quantity : -quantity

const jw = (entry_type: string, quantity: number, entry_date: string, extra: Partial<PurchaseLineEntry> = {}) =>
  row(entry_type, quantity, entry_date, { vendorDelta: vendorDelta(entry_type, quantity), ...extra })

describe('buildPurchaseLineLedger', () => {
  // Shape of GI0524-0018 (GI00200): bought, sent to Mass Decoilers, transferred
  // to Arun Engineering, then sold direct from Arun in three parts.
  it('tracks warehouse and vendor balances through a transfer and direct sales', () => {
    const entries = [
      row('PURCHASE_IN', 7.702, '2024-05-09', { reference_type: 'purchase_bill' }),
      jw('JOB_WORK_OUT', -7.702, '2024-05-13', { vendorName: 'Mass Decoilers' }),
      jw('JOB_WORK_TRANSFER_IN', 7.702, '2024-05-15', { vendorName: 'Arun Engineering' }),
      jw('JOB_WORK_TRANSFER_OUT', -7.702, '2024-05-15', { vendorName: 'Mass Decoilers' }),
      jw('JOB_WORK_RETURN_IN', 3.84, '2024-06-06', { notes: VENDOR_DIRECT_SALE_NOTE, vendorName: 'Arun Engineering' }),
      row('SALE_OUT', -3.84, '2024-06-06', { reference_type: 'dispatch' }),
      jw('JOB_WORK_RETURN_IN', 0.77, '2024-06-07', { notes: VENDOR_DIRECT_SALE_NOTE, vendorName: 'Arun Engineering' }),
      row('SALE_OUT', -0.77, '2024-06-07', { reference_type: 'dispatch' }),
    ]

    const { rows, closingBalance, closingVendorBalance } = buildPurchaseLineLedger(entries, label)

    expect(rows.map((r) => r.entry_type)).toEqual([
      'PURCHASE_IN',
      'JOB_WORK_OUT',
      'JOB_WORK_TRANSFER',
      'VENDOR_DIRECT_SALE',
      'VENDOR_DIRECT_SALE',
    ])
    expect(rows.map((r) => r.balance.toFixed(3))).toEqual(['7.702', '0.000', '0.000', '0.000', '0.000'])
    expect(rows.map((r) => r.vendorBalance.toFixed(3))).toEqual(['0.000', '7.702', '7.702', '3.862', '3.092'])
    expect(closingBalance).toBeCloseTo(0, 6)
    // 7.702 sent, 4.610 sold from the vendor — the rest is still at Arun.
    expect(closingVendorBalance).toBeCloseTo(3.092, 6)

    const transfer = rows[2]
    expect(transfer.notes).toBe('Transfer from Mass Decoilers to Arun Engineering')
    expect(transfer.vendorName).toBe('Arun Engineering')
    expect(transfer.mergedIds).toHaveLength(2)
  })

  it('shows a job transfer before a vendor direct sale booked the same day', () => {
    const entries = [
      jw('JOB_WORK_RETURN_IN', 1.0, '2024-06-06', { notes: VENDOR_DIRECT_SALE_NOTE, vendorName: 'Arun Engineering' }),
      row('SALE_OUT', -1.0, '2024-06-06', { reference_type: 'dispatch' }),
      jw('JOB_WORK_TRANSFER_IN', 4.0, '2024-06-06', { vendorName: 'Arun Engineering' }),
      jw('JOB_WORK_TRANSFER_OUT', -4.0, '2024-06-06', { vendorName: 'Mass Decoilers' }),
    ]

    const { rows } = buildPurchaseLineLedger(entries, label)

    expect(rows.map((r) => r.entry_type)).toEqual(['JOB_WORK_TRANSFER', 'VENDOR_DIRECT_SALE'])
    // Balances follow the order shown, not the order the rows arrived in.
    expect(rows.map((r) => r.vendorBalance.toFixed(3))).toEqual(['0.000', '-1.000'])
  })

  it('counts a processed-output return against the line it came from', () => {
    const entries = [
      row('PURCHASE_IN', 4.452, '2024-11-27', { reference_type: 'purchase_bill' }),
      jw('JOB_WORK_OUT', -4.452, '2024-11-27', { vendorName: 'Arun Engineering' }),
      jw('JOB_WORK_OUTPUT_IN', 4.452, '2024-12-04', { vendorName: 'Arun Engineering' }),
    ]

    const { closingBalance, closingVendorBalance } = buildPurchaseLineLedger(entries, label)

    expect(closingBalance).toBeCloseTo(4.452, 6)
    expect(closingVendorBalance).toBeCloseTo(0, 6)
  })

  it('leaves an unpaired transfer leg as its own row with the vendor effect it really had', () => {
    const entries = [
      jw('JOB_WORK_OUT', -5.0, '2024-05-13', { vendorName: 'Mass Decoilers' }),
      jw('JOB_WORK_TRANSFER_OUT', -5.0, '2024-05-15', { vendorName: 'Mass Decoilers' }),
    ]

    const { rows, closingVendorBalance } = buildPurchaseLineLedger(entries, label)

    expect(rows.map((r) => r.entry_type)).toEqual(['JOB_WORK_OUT', 'JOB_WORK_TRANSFER_OUT'])
    expect(closingVendorBalance).toBeCloseTo(0, 6)
  })

  it('does not merge a return and a sale booked on different dates', () => {
    const entries = [
      jw('JOB_WORK_RETURN_IN', 2.0, '2024-06-06', { notes: VENDOR_DIRECT_SALE_NOTE }),
      row('SALE_OUT', -2.0, '2024-06-10', { reference_type: 'dispatch' }),
    ]

    const { rows } = buildPurchaseLineLedger(entries, label)

    expect(rows.map((r) => r.entry_type)).toEqual(['JOB_WORK_RETURN_IN', 'SALE_OUT'])
  })
})
