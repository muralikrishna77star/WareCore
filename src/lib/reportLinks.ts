// Where an item, purchase line, vendor or job work reference links to, from
// any screen: Item Stock Ledger, Purchase Line Movements, Vendorwise Stock
// Movement and the Job Work Report.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isoDay = (d: Date) => d.toISOString().split('T')[0]

/** 1 April of the financial year containing `d`. */
export function financialYearStart(d = new Date()) {
  const year = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return `${year}-04-01`
}

/** Date-range reports open from the document's own date (or the start of
 * the current financial year when there is none) up to today, so the
 * document's movement is always inside the window. */
function reportRange(fromDate?: string | null) {
  const today = isoDay(new Date())
  const from = fromDate && /^\d{4}-\d{2}-\d{2}/.test(fromDate) ? fromDate.slice(0, 10) : financialYearStart()
  return { from: from > today ? today : from, to: today }
}

export function itemLedgerHref(itemMasterId: string, fromDate?: string | null) {
  const { from, to } = reportRange(fromDate)
  return `/reports/item-ledger?item=${encodeURIComponent(itemMasterId)}&from=${from}&to=${to}`
}

export function purchaseLineHref(purchaseLineId: string) {
  return `/reports/purchase-line-ledger?line=${encodeURIComponent(purchaseLineId)}`
}

export function vendorMovementsHref(vendorId: string, fromDate?: string | null) {
  const { from, to } = reportRange(fromDate)
  return `/reports/vendor-movements?vendor=${encodeURIComponent(vendorId)}&from=${from}&to=${to}`
}

export function jobWorkReportHref(jobWorkOrderId: string) {
  return `/reports/jobwork?order=${encodeURIComponent(jobWorkOrderId)}`
}
