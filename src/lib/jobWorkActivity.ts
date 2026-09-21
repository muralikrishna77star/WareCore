// Plain-language history of one job work order, built from its stock_ledger
// rows. The ledger records some user actions as more than one row — a vendor
// direct sale posts a "virtual" JOB_WORK_RETURN_IN on the order plus a
// SALE_OUT on the dispatch — which reads as a mysterious return when seen in
// Purchase Line Movements or the Item Ledger. This module turns those rows
// back into the single thing the user actually did, and attributes each one
// to the order's input line it belongs to so the per-line breakdown (sent /
// returned / sold direct / transferred / still at vendor) follows the Stock
// Statement's vendor balance: same vendor-side sign convention, and the same
// row inclusion as vw_job_work_vendor_movements — a same-material
// JOB_WORK_OUTPUT_IN is a return, and a JOB_WORK_CANCEL reversing a
// different-material output entry is not vendor stock.

export interface ActivityLedgerRow {
  id: string
  entry_type: string
  quantity: number | string
  entry_date: string
  created_at: string
  notes: string | null
  material_type_id: string
  material_size_id: string | null
  purchase_line_id: string | null
  sub_purchase_line_id: string | null
  /** Display label for rows not tied to an input line (processed output). */
  materialLabel?: string
}

export interface ActivityItem {
  id: string
  purchase_line_id: string | null
  sub_purchase_line_id: string | null
  material_type_id: string
  material_size_id: string | null
  quantity_sent: number | string
  is_transfer_line: boolean | null
}

/** One SALE_OUT row from a vendor-direct dispatch of this order. */
export interface ActivityDirectSale {
  dispatchId: string
  documentNumber: string | null
  customerName: string | null
  entry_date: string
  quantity: number | string
  purchase_line_id: string | null
}

export interface ActivityTransfer {
  transferNumber: string
  fromOrderId: string | null
  toOrderId: string | null
  fromVendorName: string | null
  toVendorName: string | null
  items: { purchase_line_id: string | null; sub_purchase_line_id: string | null; quantity_transferred: number | string }[]
}

export type ActivityKind =
  | 'sent'
  | 'sent_corrected'
  | 'transfer_in'
  | 'returned'
  | 'direct_sale'
  | 'output_return'
  | 'output_received'
  | 'output_corrected'
  | 'correction'
  | 'transfer_out'

export interface ActivityEvent {
  id: string
  date: string
  kind: ActivityKind
  title: string
  detail: string | null
  /** Effect on the quantity held at the vendor: + more at vendor, − less. */
  vendorEffect: number
  /** Raw ledger quantity, for rows that don't move vendor stock (processed output). */
  quantity: number
  itemId: string | null
  link: { href: string; label: string } | null
  /** Quantity of this line still at the vendor after this event. */
  lineBalanceAfter: number | null
  materialLabel: string | null
}

export interface ActivityLineSummary {
  sent: number
  returned: number
  soldDirect: number
  transferredOut: number
  atVendor: number
  /** Line has quantity_sent but not a single ledger row — a data problem. */
  missingLedger: boolean
}

const EPS = 0.0005
const sameQty = (a: number, b: number) => Math.abs(Math.abs(a) - Math.abs(b)) < EPS
const lineKey = (sub: string | null, main: string | null) => sub || main || null

const KIND_ORDER: Record<ActivityKind, number> = {
  sent: 0, transfer_in: 0, sent_corrected: 1, correction: 1,
  returned: 2, output_return: 2, output_received: 2, output_corrected: 3, direct_sale: 2, transfer_out: 2,
}

export function isVirtualReturn(row: Pick<ActivityLedgerRow, 'entry_type' | 'notes'>): boolean {
  return row.entry_type === 'JOB_WORK_RETURN_IN' && (row.notes ?? '').toLowerCase().includes('virtual return')
}

function attributeToItem(row: ActivityLedgerRow, items: ActivityItem[]): ActivityItem | null {
  let candidates = items.filter(
    (it) => it.material_type_id === row.material_type_id && (it.material_size_id ?? null) === (row.material_size_id ?? null)
  )
  if (candidates.length === 0) return null
  const rowLine = lineKey(row.sub_purchase_line_id, row.purchase_line_id)
  if (rowLine) {
    const byLine = candidates.filter(
      (it) => lineKey(it.sub_purchase_line_id, it.purchase_line_id) === rowLine || (row.purchase_line_id && it.purchase_line_id === row.purchase_line_id)
    )
    if (byLine.length > 0) candidates = byLine
    else if (candidates.length > 1) return null
  }
  const wantTransferLine = row.entry_type === 'JOB_WORK_TRANSFER_IN'
  const byType = candidates.filter((it) => Boolean(it.is_transfer_line) === wantTransferLine)
  if (byType.length > 0) candidates = byType
  if (candidates.length > 1 && row.entry_type === 'JOB_WORK_OUT') {
    const byQty = candidates.find((it) => sameQty(Number(it.quantity_sent), Number(row.quantity)))
    if (byQty) return byQty
  }
  return candidates[0]
}

export function buildJobWorkActivity(input: {
  orderId: string
  items: ActivityItem[]
  ledger: ActivityLedgerRow[]
  directSales: ActivityDirectSale[]
  transfers: ActivityTransfer[]
}): { events: ActivityEvent[]; lines: Record<string, ActivityLineSummary> } {
  const { orderId, items, ledger, directSales, transfers } = input

  const lines: Record<string, ActivityLineSummary> = {}
  for (const it of items) lines[it.id] = { sent: 0, returned: 0, soldDirect: 0, transferredOut: 0, atVendor: 0, missingLedger: true }

  // Same-material check for JOB_WORK_OUTPUT_IN — mirrors isVendorMovementRow:
  // an output line of the same material as one of the order's own inputs is
  // really the vendor handing the material back, not a conversion.
  const inputMaterials = new Set(items.map((it) => `${it.material_type_id}|${it.material_size_id ?? ''}`))

  const usedSales = new Set<number>()
  const findSale = (row: ActivityLedgerRow): ActivityDirectSale | null => {
    const qty = Number(row.quantity)
    const tries: ((s: ActivityDirectSale) => boolean)[] = [
      (s) => s.purchase_line_id === row.purchase_line_id && s.entry_date === row.entry_date && sameQty(Number(s.quantity), qty),
      (s) => s.entry_date === row.entry_date && sameQty(Number(s.quantity), qty),
      (s) => s.purchase_line_id === row.purchase_line_id && sameQty(Number(s.quantity), qty),
    ]
    for (const match of tries) {
      const idx = directSales.findIndex((s, i) => !usedSales.has(i) && match(s))
      if (idx >= 0) {
        usedSales.add(idx)
        return directSales[idx]
      }
    }
    return null
  }

  const usedTransferItems = new Set<string>()
  const findTransfer = (row: ActivityLedgerRow, direction: 'out' | 'in') => {
    const rowLine = lineKey(row.sub_purchase_line_id, row.purchase_line_id)
    for (const t of transfers) {
      if ((direction === 'out' ? t.fromOrderId : t.toOrderId) !== orderId) continue
      for (let i = 0; i < t.items.length; i++) {
        const key = `${t.transferNumber}|${i}|${direction}`
        if (usedTransferItems.has(key)) continue
        const ti = t.items[i]
        if (!sameQty(Number(ti.quantity_transferred), Number(row.quantity))) continue
        if (rowLine && lineKey(ti.sub_purchase_line_id, ti.purchase_line_id) !== rowLine && ti.purchase_line_id !== row.purchase_line_id) continue
        usedTransferItems.add(key)
        return t
      }
    }
    return null
  }

  const sorted = [...ledger].sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1
    const ka = KIND_ORDER[kindOf(a)] - KIND_ORDER[kindOf(b)]
    if (ka !== 0) return ka
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
  })

  function kindOf(row: ActivityLedgerRow): ActivityKind {
    switch (row.entry_type) {
      case 'JOB_WORK_OUT':
        return (row.notes ?? '').toLowerCase().includes('corrected') ? 'sent_corrected' : 'sent'
      case 'JOB_WORK_TRANSFER_IN':
        return 'transfer_in'
      case 'JOB_WORK_TRANSFER_OUT':
        return 'transfer_out'
      case 'JOB_WORK_RETURN_IN':
        return isVirtualReturn(row) ? 'direct_sale' : 'returned'
      case 'JOB_WORK_CANCEL':
        // Reversing a processed-output entry of a different material (an
        // Output Materials line corrected via Edit Order) never touched the
        // vendor's stock of the input, so it isn't a vendor movement.
        return inputMaterials.has(`${row.material_type_id}|${row.material_size_id ?? ''}`) ? 'correction' : 'output_corrected'
      case 'JOB_WORK_OUTPUT_IN':
        return inputMaterials.has(`${row.material_type_id}|${row.material_size_id ?? ''}`) ? 'output_return' : 'output_received'
      default:
        return 'correction'
    }
  }

  const events: ActivityEvent[] = []
  for (const row of sorted) {
    const qty = Number(row.quantity)
    const kind = kindOf(row)
    const isVendorMovement = kind !== 'output_received' && kind !== 'output_corrected'
    // Vendor side is the inverse of the warehouse-signed quantity, except the
    // two transfer legs, which are already posted with the vendor's sign.
    const vendorEffect = !isVendorMovement ? 0 : kind === 'transfer_in' || kind === 'transfer_out' ? qty : -qty
    const item = isVendorMovement ? attributeToItem(row, items) : null
    let title = ''
    let detail: string | null = null
    let link: ActivityEvent['link'] = null

    switch (kind) {
      case 'sent':
        title = 'Sent to vendor'
        break
      case 'sent_corrected':
        title = vendorEffect >= 0 ? 'Quantity sent increased (Edit Order)' : 'Quantity sent reduced (Edit Order)'
        break
      case 'correction':
        title = 'Correction'
        detail = row.notes
        break
      case 'returned':
        title = 'Returned to warehouse'
        break
      case 'output_return':
        title = 'Returned to warehouse'
        detail = 'Entered as an Output Material of the same item as sent'
        break
      case 'output_received':
        title = 'Processed material received'
        detail = row.materialLabel ?? null
        break
      case 'output_corrected':
        title = 'Processed material entry corrected'
        detail = [row.materialLabel, row.notes].filter(Boolean).join(' — ') || null
        break
      case 'direct_sale': {
        const sale = findSale(row)
        title = sale?.customerName ? `Sold directly from vendor to ${sale.customerName}` : 'Sold directly from vendor'
        detail = 'Material went straight from the vendor to the customer. Stock reports show this as a "virtual return" plus a sale.'
        if (sale) link = { href: `/dispatch/${sale.dispatchId}`, label: `Dispatch ${sale.documentNumber ?? ''}`.trim() }
        break
      }
      case 'transfer_out': {
        const t = findTransfer(row, 'out')
        title = t?.toVendorName ? `Transferred to ${t.toVendorName}` : 'Transferred to another vendor'
        if (t?.toOrderId) link = { href: `/jobwork/${t.toOrderId}`, label: t.transferNumber }
        break
      }
      case 'transfer_in': {
        const t = findTransfer(row, 'in')
        title = t?.fromVendorName ? `Received by transfer from ${t.fromVendorName}` : 'Received by transfer from another vendor'
        if (t?.fromOrderId) link = { href: `/jobwork/${t.fromOrderId}`, label: t.transferNumber }
        break
      }
    }

    let lineBalanceAfter: number | null = null
    if (item) {
      const s = lines[item.id]
      s.missingLedger = false
      if (kind === 'sent' || kind === 'sent_corrected' || kind === 'transfer_in' || kind === 'correction') s.sent += vendorEffect
      else if (kind === 'returned' || kind === 'output_return') s.returned -= vendorEffect
      else if (kind === 'direct_sale') s.soldDirect -= vendorEffect
      else if (kind === 'transfer_out') s.transferredOut -= vendorEffect
      s.atVendor += vendorEffect
      lineBalanceAfter = s.atVendor
    }

    events.push({
      id: row.id, date: row.entry_date, kind, title, detail, vendorEffect, quantity: qty,
      itemId: item?.id ?? null, link, lineBalanceAfter,
      materialLabel: item ? null : row.materialLabel ?? null,
    })
  }

  for (const it of items) {
    if (Number(it.quantity_sent) <= EPS) lines[it.id].missingLedger = false
  }

  return { events, lines }
}
