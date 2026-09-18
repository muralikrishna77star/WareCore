// Checking each sale line against its purchase line's balance on its own is
// not enough: two lines drawing on the same purchase line each pass while
// together overdrawing it (2.000 + 2.000 against a balance of 3.480 is two
// individually-valid rows and one impossible sale). These helpers total the
// allocation per purchase line first, then compare once.

export type AllocationLine = {
  /** The line's selected purchase-line key, '' when nothing is picked. */
  purchase_line_id: string
  quantity: string | number
  item_name?: string | null
  size_label?: string | null
}

export type AllocationBalance = {
  /** Matches AllocationLine.purchase_line_id (a real id, or an "ID:<uuid>" key). */
  _key: string
  purchase_line_id: string | null
  available_quantity: number
}

/** Quantities below this are rounding dust, not a real over-allocation. */
const TOLERANCE = 0.0005

function toNumber(v: string | number): number {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/** Total quantity this sale allocates to each purchase line, keyed by _key. */
export function allocationByPurchaseLine(lines: AllocationLine[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const line of lines) {
    if (!line.purchase_line_id) continue
    totals.set(line.purchase_line_id, (totals.get(line.purchase_line_id) ?? 0) + toNumber(line.quantity))
  }
  return totals
}

/** How much this sale over-allocates a given purchase line, 0 when it fits. */
export function overAllocationFor(
  key: string,
  lines: AllocationLine[],
  balances: AllocationBalance[],
): number {
  if (!key) return 0
  const balance = balances.find(b => b._key === key)
  if (!balance) return 0
  const allocated = allocationByPurchaseLine(lines).get(key) ?? 0
  const over = allocated - balance.available_quantity
  return over > TOLERANCE ? over : 0
}

/**
 * One message per over-allocated purchase line — not per row, so a purchase
 * line split across three rows is reported once, naming how many rows share it.
 */
export function purchaseLineOverAllocationWarnings(
  lines: AllocationLine[],
  balances: AllocationBalance[],
): string[] {
  const totals = allocationByPurchaseLine(lines)
  const warnings: string[] = []

  for (const [key, allocated] of totals) {
    const balance = balances.find(b => b._key === key)
    // No balance on file is a different situation (reported separately by the
    // caller for lines with no purchase line at all), not an over-allocation.
    if (!balance) continue
    if (allocated - balance.available_quantity <= TOLERANCE) continue

    const rows = lines.filter(l => l.purchase_line_id === key)
    const label = balance.purchase_line_id
      ?? rows[0]?.item_name
      ?? rows[0]?.size_label
      ?? 'this stock'
    const across = rows.length > 1 ? ` across ${rows.length} lines` : ''
    warnings.push(
      `${label}: dispatching ${allocated.toFixed(3)}${across} but only ${balance.available_quantity.toFixed(3)} available`
    )
  }

  return warnings
}
