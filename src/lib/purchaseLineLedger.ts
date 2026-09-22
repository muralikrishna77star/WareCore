/**
 * Display rows for Purchase Line Movements — the same two running totals the
 * Item Stock Ledger shows (Balance = warehouse stock, Balance at Vendor =
 * what is still lying with a job work vendor), but scoped to one purchase
 * line instead of one item.
 *
 * Mirrors the Item Stock Ledger's report-layer rules (see
 * src/app/(app)/reports/item-ledger/page.tsx): multi-leg postings are merged
 * into one readable row, a Job Transfer sorts before a same-day Vendor Direct
 * Sale, and both running totals are computed in ONE pass over the FINAL
 * display order — never carried over from the query's order.
 *
 * Vendor deltas are not derived here: the caller passes each row's
 * `vendorDelta` straight from vw_job_work_vendor_movements (migration 142),
 * the same view vw_current_vendor_stock uses, so this report can never drift
 * from the vendor-stock reports.
 */

export const VENDOR_DIRECT_SALE_NOTE = 'Vendor direct sale — virtual return'

export interface PurchaseLineEntry {
  id: string
  entry_type: string
  quantity: number | string
  entry_date: string
  created_at?: string | null
  reference_number?: string | null
  reference_type?: string | null
  reference_id?: string | null
  sub_purchase_line_id?: string | null
  size_label?: string | null
  notes?: string | null
  material_type_id?: string | null
  material_size_id?: string | null
  companies?: { name: string; code?: string } | null
  warehouses?: { name: string } | null
  material_types?: { description: string; unit: string } | null
  material_sizes?: { size_label: string } | null
  /** Vendor stock this row moves, from vw_job_work_vendor_movements. 0/absent = not a vendor movement. */
  vendorDelta?: number
  /** The job work vendor this row is posted against, for the Vendor column. */
  vendorName?: string | null
}

export type PurchaseLineDisplayRow = PurchaseLineEntry & {
  itemLabel: string
  balance: number
  vendorBalance: number
  warehouseDelta: number
  vendorDelta: number
  mergedIds?: string[]
  isVendorDirectSale?: boolean
  isJobWorkTransfer?: boolean
  /** The job work order a merged row's other leg is posted against. */
  jobWorkReferenceNumber?: string | null
  jobWorkReferenceType?: string | null
  jobWorkReferenceId?: string | null
}

export interface PurchaseLineLedgerResult {
  rows: PurchaseLineDisplayRow[]
  /** Warehouse stock still held under this line after every movement. */
  closingBalance: number
  /** Still lying with a job work vendor under this line. */
  closingVendorBalance: number
  totalIn: number
  totalOut: number
}

const qty = (row: { quantity: number | string }) => Number(row.quantity)
const vendorDeltaOf = (row: PurchaseLineEntry) => Number(row.vendorDelta ?? 0)

/** Both legs of a pair always share one business date; quantities cancel exactly. */
const offsets = (a: PurchaseLineEntry, b: PurchaseLineEntry) =>
  a.entry_date === b.entry_date && Math.abs(qty(a) + qty(b)) < 0.0005

export function buildPurchaseLineLedger(
  entries: PurchaseLineEntry[],
  itemLabelFor: (row: PurchaseLineEntry) => string,
): PurchaseLineLedgerResult {
  const consumed = new Set<number>()
  // Merge at whichever leg comes later in ledger order, so the merged row
  // keeps the pair's chronological place.
  const vendorSaleAt = new Map<number, { returnIdx: number; saleIdx: number }>()
  const transferAt = new Map<number, { outIdx: number; inIdx: number }>()

  entries.forEach((row, i) => {
    if (row.entry_type !== 'JOB_WORK_RETURN_IN' || row.notes !== VENDOR_DIRECT_SALE_NOTE) return
    if (consumed.has(i)) return
    const j = entries.findIndex(
      (r, idx) => idx !== i && !consumed.has(idx) && r.entry_type === 'SALE_OUT' && offsets(r, row),
    )
    if (j === -1) return
    consumed.add(i)
    consumed.add(j)
    vendorSaleAt.set(Math.max(i, j), { returnIdx: i, saleIdx: j })
  })

  entries.forEach((row, i) => {
    if (row.entry_type !== 'JOB_WORK_TRANSFER_OUT' || consumed.has(i)) return
    const j = entries.findIndex(
      (r, idx) => idx !== i && !consumed.has(idx) && r.entry_type === 'JOB_WORK_TRANSFER_IN' && offsets(r, row),
    )
    if (j === -1) return
    consumed.add(i)
    consumed.add(j)
    transferAt.set(Math.max(i, j), { outIdx: i, inIdx: j })
  })

  const rows: PurchaseLineDisplayRow[] = []
  entries.forEach((entry, i) => {
    const sale = vendorSaleAt.get(i)
    if (sale) {
      const returnRow = entries[sale.returnIdx]
      const saleRow = entries[sale.saleIdx]
      rows.push({
        ...saleRow,
        id: `vds-${returnRow.id}-${saleRow.id}`,
        mergedIds: [returnRow.id, saleRow.id],
        isVendorDirectSale: true,
        entry_type: 'VENDOR_DIRECT_SALE',
        entry_date: entries[i].entry_date,
        quantity: saleRow.quantity,
        jobWorkReferenceNumber: returnRow.reference_number,
        jobWorkReferenceType: returnRow.reference_type,
        jobWorkReferenceId: returnRow.reference_id,
        vendorName: returnRow.vendorName ?? null,
        itemLabel: itemLabelFor(saleRow),
        // Sold straight from the vendor: the warehouse never sees it (the two
        // legs cancel), and only the return leg closes out vendor stock.
        warehouseDelta: qty(returnRow) + qty(saleRow),
        vendorDelta: vendorDeltaOf(returnRow) + vendorDeltaOf(saleRow),
        notes: 'Direct from vendor — no warehouse movement',
        balance: 0,
        vendorBalance: 0,
      })
      return
    }

    const transfer = transferAt.get(i)
    if (transfer) {
      const outRow = entries[transfer.outIdx]
      const inRow = entries[transfer.inIdx]
      const fromVendor = outRow.vendorName || '—'
      const toVendor = inRow.vendorName || '—'
      rows.push({
        ...inRow,
        id: `jwt-${outRow.id}-${inRow.id}`,
        mergedIds: [outRow.id, inRow.id],
        isJobWorkTransfer: true,
        entry_type: 'JOB_WORK_TRANSFER',
        entry_date: entries[i].entry_date,
        quantity: inRow.quantity,
        jobWorkReferenceNumber: outRow.reference_number,
        jobWorkReferenceType: outRow.reference_type,
        jobWorkReferenceId: outRow.reference_id,
        // Vendor column names only the current holder; the move itself is in Notes.
        vendorName: toVendor,
        itemLabel: itemLabelFor(inRow),
        // Moving between vendors changes neither the warehouse nor the
        // combined at-any-vendor total — both legs cancel exactly.
        warehouseDelta: qty(outRow) + qty(inRow),
        vendorDelta: vendorDeltaOf(outRow) + vendorDeltaOf(inRow),
        notes: `Transfer from ${fromVendor} to ${toVendor}`,
        balance: 0,
        vendorBalance: 0,
      })
      return
    }

    if (consumed.has(i)) return
    rows.push({
      ...entry,
      itemLabel: itemLabelFor(entry),
      warehouseDelta: qty(entry),
      vendorDelta: vendorDeltaOf(entry),
      balance: 0,
      vendorBalance: 0,
    })
  })

  // A transfer that completes on the same day material is then sold from the
  // new vendor reads in that order, whatever the query's tiebreak did. Runs
  // BEFORE the balance pass, which depends on the final order.
  const SAME_DAY_TYPE_PRIORITY: Record<string, number> = { JOB_WORK_TRANSFER: 0, VENDOR_DIRECT_SALE: 1 }
  rows.sort((a, b) => {
    if (a.entry_date !== b.entry_date) return 0
    return (SAME_DAY_TYPE_PRIORITY[a.entry_type] ?? 0.5) - (SAME_DAY_TYPE_PRIORITY[b.entry_type] ?? 0.5)
  })

  const running = { warehouse: 0, vendor: 0 }
  for (const row of rows) {
    running.warehouse += row.warehouseDelta
    running.vendor += row.vendorDelta
    row.balance = running.warehouse
    row.vendorBalance = running.vendor
  }

  const totalIn = rows.reduce((sum, r) => (qty(r) > 0 ? sum + qty(r) : sum), 0)
  const totalOut = rows.reduce((sum, r) => (qty(r) < 0 ? sum + Math.abs(qty(r)) : sum), 0)

  return {
    rows,
    closingBalance: running.warehouse,
    closingVendorBalance: running.vendor,
    totalIn,
    totalOut,
  }
}
