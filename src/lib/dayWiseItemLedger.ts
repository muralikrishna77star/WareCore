/**
 * Day-Wise Item Ledger — domain logic.
 *
 * Everything here is pure: the page fetches rows, this module classifies,
 * values, groups and reconciles them. Kept separate so the parts that are
 * easy to get subtly wrong (direction signs, cancellation double-counting,
 * GST derivation, subtotal agreement) are unit-testable without a database.
 *
 * Design rule that drives the whole module: stock_ledger is the spine.
 * Every row in the detailed ledger is exactly one stock_ledger row, and
 * financial/party detail is attached from pre-built maps keyed by a value
 * proven unique — never joined row-to-row. A join from ledger to
 * dispatch_items on (order, material, size) would multiply 3 groups in
 * production; attaching from a map that pre-aggregates those groups cannot.
 * This also makes "cancellations reverse the original only once" true by
 * construction: a cancellation is one ledger row, so it is counted once.
 */

// ── Entry-type classification ───────────────────────────────────────────

/** Every entry_type stock_ledger's CHECK constraint allows. */
export const ENTRY_TYPES = [
  'PURCHASE_IN',
  'PURCHASE_CANCEL',
  'VENDOR_RETURN_IN',
  'SALE_OUT',
  'SALE_CANCEL',
  'JOB_WORK_OUT',
  'JOB_WORK_RETURN_IN',
  'JOB_WORK_OUTPUT_IN',
  'JOB_WORK_CANCEL',
  'JOB_WORK_TRANSFER_OUT',
  'JOB_WORK_TRANSFER_IN',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
] as const

export type EntryType = (typeof ENTRY_TYPES)[number]

/** Which party column an entry type populates. Anything else stays blank. */
export type PartyRole = 'supplier' | 'customer' | 'jobworker' | 'internal' | 'none'

export type EntryTypeMeta = {
  label: string
  /** Group used by the Transaction Type filter. */
  group: 'Purchase' | 'Sale' | 'Job Work' | 'Transfer' | 'Adjustment'
  party: PartyRole
  /** True for reversal postings (cancellations). */
  isCancellation: boolean
}

export const ENTRY_TYPE_META: Record<EntryType, EntryTypeMeta> = {
  PURCHASE_IN: { label: 'Purchase', group: 'Purchase', party: 'supplier', isCancellation: false },
  PURCHASE_CANCEL: { label: 'Purchase Cancellation', group: 'Purchase', party: 'supplier', isCancellation: true },
  VENDOR_RETURN_IN: { label: 'Vendor Return', group: 'Purchase', party: 'jobworker', isCancellation: false },
  SALE_OUT: { label: 'Sale', group: 'Sale', party: 'customer', isCancellation: false },
  SALE_CANCEL: { label: 'Sale Cancellation', group: 'Sale', party: 'customer', isCancellation: true },
  JOB_WORK_OUT: { label: 'Job Work Out', group: 'Job Work', party: 'jobworker', isCancellation: false },
  JOB_WORK_RETURN_IN: { label: 'Job Work Return', group: 'Job Work', party: 'jobworker', isCancellation: false },
  JOB_WORK_OUTPUT_IN: { label: 'Job Work Output', group: 'Job Work', party: 'jobworker', isCancellation: false },
  JOB_WORK_CANCEL: { label: 'Job Work Cancellation', group: 'Job Work', party: 'jobworker', isCancellation: true },
  JOB_WORK_TRANSFER_OUT: { label: 'Job Work Transfer Out', group: 'Job Work', party: 'jobworker', isCancellation: false },
  JOB_WORK_TRANSFER_IN: { label: 'Job Work Transfer In', group: 'Job Work', party: 'jobworker', isCancellation: false },
  TRANSFER_OUT: { label: 'Transfer Out', group: 'Transfer', party: 'internal', isCancellation: false },
  TRANSFER_IN: { label: 'Transfer In', group: 'Transfer', party: 'internal', isCancellation: false },
  ADJUSTMENT_IN: { label: 'Adjustment In', group: 'Adjustment', party: 'none', isCancellation: false },
  ADJUSTMENT_OUT: { label: 'Adjustment Out', group: 'Adjustment', party: 'none', isCancellation: false },
}

export function entryTypeLabel(entryType: string): string {
  return ENTRY_TYPE_META[entryType as EntryType]?.label ?? entryType
}

/**
 * Normalises a source document's status for display and filtering.
 *
 * The three source tables spell status differently — purchase_bills and
 * dispatch_orders use active/cancelled, job_work_orders adds dispatched /
 * partial_return / completed. Normalising once means "Cancelled" means the
 * same thing on every row (the Include-cancelled filter depends on it) while
 * still showing the document's real state rather than flattening everything
 * to Active.
 */
export function normalizeStatus(raw: string | null | undefined): string {
  if (!raw) return 'Active'
  return raw
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
}

// ── Precision ───────────────────────────────────────────────────────────
// WareCore stores quantity at 3dp and money at 2dp throughout (see
// QTY_FMT / MONEY_FMT in exportProfessionalExcel.ts). Rounding is applied
// once, where a value is derived, so a subtotal is the sum of the same
// rounded numbers the detail rows display — otherwise summary and detail
// can disagree in the last decimal place.

export const roundQty = (n: number): number => Math.round(n * 1e3) / 1e3
export const roundMoney = (n: number): number => Math.round(n * 1e2) / 1e2

/** Tolerance for "these two should be the same number" comparisons. */
export const QTY_EPSILON = 0.0005
/** Internal consistency (summary vs detail) must be exact to the paisa. */
export const MONEY_EPSILON = 0.005
/**
 * Comparing OUR derived total against the SOURCE DOCUMENT's stored total is
 * a different question: the document did its own rounding when it was
 * written, so sub-paisa drift is the document being itself, not a defect.
 * Anything above this is a real disagreement worth showing the user.
 */
export const DOCUMENT_ROUNDING_TOLERANCE = 0.05

// ── Inputs ──────────────────────────────────────────────────────────────

export type LedgerRow = {
  id: string
  entry_type: string
  /** Signed: positive is inward, negative is outward. */
  quantity: number | string
  entry_date: string
  created_at?: string | null
  created_by?: string | null
  reference_type?: string | null
  reference_id?: string | null
  reference_number?: string | null
  purchase_line_id?: string | null
  sub_purchase_line_id?: string | null
  notes?: string | null
  company_id: string
  warehouse_id: string
  material_type_id: string
  material_size_id?: string | null
  size_label?: string | null
}

/** Financial figures as stored on the source document line. */
export type SourceFinancials = {
  /** Quantity the source line records, for reconciliation against the ledger. */
  sourceQuantity: number
  rate: number | null
  /** Stored taxable/basic value, before tax. */
  basicAmount: number | null
  cgstRate: number | null
  sgstRate: number | null
  cgstAmount: number | null
  sgstAmount: number | null
  /** Stored grand total, used to cross-check the derived one. */
  totalWithTax: number | null
  /** True when this came from a valuation rate rather than a priced document. */
  valuationOnly?: boolean
}

export type PartyNames = {
  supplierName?: string | null
  customerName?: string | null
  jobWorkerName?: string | null
  source?: string | null
  destination?: string | null
}

export type RowContext = {
  companyName: string
  warehouseName: string
  itemCode: string
  itemDescription: string
  itemSize: string
  unit: string
  documentNumber: string
  status: string
  createdByName: string
  financials: SourceFinancials | null
  parties: PartyNames
  href: string | null
}

// ── Output ──────────────────────────────────────────────────────────────

export type ReconciliationFlag = {
  ledgerId: string
  documentNumber: string
  entryType: string
  entryDate: string
  itemCode: string
  itemSize: string
  issue: string
  detail: string
}

export type DetailRow = {
  ledgerId: string
  entryDate: string
  entryTime: string
  entryTypeLabel: string
  entryType: string
  documentNumber: string
  companyName: string
  warehouseName: string
  itemCode: string
  itemDescription: string
  itemSize: string
  unit: string
  inwardQuantity: number
  outwardQuantity: number
  transactedQuantity: number
  rate: number | null
  basicAmount: number | null
  gstPercent: number | null
  cgstAmount: number | null
  sgstAmount: number | null
  igstAmount: number | null
  totalGst: number | null
  totalAmount: number | null
  supplierName: string
  customerName: string
  jobWorkerName: string
  source: string
  destination: string
  status: string
  remarks: string
  createdByName: string
  createdAt: string
  /** Set when this row's values could not be tied back to its source document. */
  reconciliation: ReconciliationFlag | null
  itemKey: string
  sizeKey: string
  /** Deep-link target so clicking a transaction opens its source document. */
  href: string | null
}

/**
 * Splits a ledger row's signed quantity into the inward/outward pair.
 *
 * The stored sign is authoritative. A cancellation is already posted as its
 * own single reversing row, so reading the sign counts each reversal exactly
 * once and never needs to re-derive it from the original transaction.
 */
export function splitDirection(signedQuantity: number): {
  inward: number
  outward: number
  transacted: number
} {
  const q = roundQty(signedQuantity)
  return {
    inward: q > 0 ? q : 0,
    outward: q < 0 ? roundQty(-q) : 0,
    transacted: roundQty(Math.abs(q)),
  }
}

/**
 * Derives one detail row's money columns from its source document.
 *
 * Stored values are used verbatim when the ledger quantity matches the
 * source line's quantity — that preserves whatever discount, rounding or
 * tax-inclusive adjustment the original document applied. When the two
 * differ (a partial received_quantity, or a key that collapsed several
 * source lines) the stored totals describe a different quantity than this
 * row moved, so they are pro-rated and the row is flagged rather than
 * silently reported as exact.
 *
 * Returns nulls, never zeros, when there is no financial source at all —
 * a blank cell is honest, a 0.00 is not.
 */
export function deriveFinancials(
  transactedQuantity: number,
  financials: SourceFinancials | null
): {
  rate: number | null
  basicAmount: number | null
  gstPercent: number | null
  cgstAmount: number | null
  sgstAmount: number | null
  igstAmount: number | null
  totalGst: number | null
  totalAmount: number | null
  prorated: boolean
  sourceQuantity: number | null
} {
  const blank = {
    rate: null,
    basicAmount: null,
    gstPercent: null,
    cgstAmount: null,
    sgstAmount: null,
    igstAmount: null,
    totalGst: null,
    totalAmount: null,
    prorated: false,
    sourceQuantity: null,
  }
  if (!financials) return blank

  const srcQty = financials.sourceQuantity
  const exact = srcQty > 0 && Math.abs(srcQty - transactedQuantity) <= QTY_EPSILON
  // Scale stored amounts to the quantity this row actually moved.
  const factor = exact ? 1 : srcQty > 0 ? transactedQuantity / srcQty : 0

  const rate = financials.rate != null ? roundMoney(financials.rate) : null

  // Prefer the document's own basic amount; fall back to qty x rate only
  // when the document never stored one.
  let basicAmount: number | null = null
  if (financials.basicAmount != null) basicAmount = roundMoney(financials.basicAmount * factor)
  else if (rate != null) basicAmount = roundMoney(transactedQuantity * rate)

  const cgstAmount = financials.cgstAmount != null ? roundMoney(financials.cgstAmount * factor) : null
  const sgstAmount = financials.sgstAmount != null ? roundMoney(financials.sgstAmount * factor) : null
  // WareCore does not model IGST anywhere — tax_rates carries cgst/sgst/tds/
  // tcs only — so this stays null rather than a fabricated split.
  const igstAmount: number | null = null

  const gstParts = [cgstAmount, sgstAmount].filter((v): v is number => v != null)
  const totalGst = gstParts.length ? roundMoney(gstParts.reduce((a, b) => a + b, 0)) : null

  const gstPercent =
    financials.cgstRate != null || financials.sgstRate != null
      ? roundMoney((financials.cgstRate ?? 0) + (financials.sgstRate ?? 0))
      : null

  const totalAmount = basicAmount != null ? roundMoney(basicAmount + (totalGst ?? 0)) : null

  return {
    rate,
    basicAmount,
    gstPercent,
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalGst,
    totalAmount,
    prorated: !exact && srcQty > 0,
    sourceQuantity: srcQty > 0 ? srcQty : null,
  }
}

/** Splits a timestamptz into the date and HH:MM:SS the report shows. */
export function splitTimestamp(ts: string | null | undefined): { date: string; time: string } {
  if (!ts) return { date: '', time: '' }
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  }
}

/** Builds one detail row from a ledger row plus its resolved context. */
export function buildDetailRow(row: LedgerRow, ctx: RowContext): DetailRow {
  const signed = Number(row.quantity) || 0
  const { inward, outward, transacted } = splitDirection(signed)
  const money = deriveFinancials(transacted, ctx.financials)
  const meta = ENTRY_TYPE_META[row.entry_type as EntryType]
  const party = meta?.party ?? 'none'
  const { time } = splitTimestamp(row.created_at)

  let reconciliation: ReconciliationFlag | null = null
  const flag = (issue: string, detail: string) => {
    if (!reconciliation) {
      reconciliation = {
        ledgerId: row.id,
        documentNumber: ctx.documentNumber,
        entryType: row.entry_type,
        entryDate: row.entry_date,
        itemCode: ctx.itemCode,
        itemSize: ctx.itemSize,
        issue,
        detail,
      }
    }
  }

  if (money.prorated && money.sourceQuantity != null) {
    flag(
      'Quantity differs from source document',
      `Ledger moved ${transacted.toFixed(3)} but the source line records ` +
        `${money.sourceQuantity.toFixed(3)}. Amounts shown are pro-rated to the ledger quantity.`
    )
  }

  // Cross-check the derived grand total against the one the document stored.
  if (
    ctx.financials?.totalWithTax != null &&
    money.totalAmount != null &&
    !money.prorated &&
    Math.abs(ctx.financials.totalWithTax - money.totalAmount) > DOCUMENT_ROUNDING_TOLERANCE
  ) {
    flag(
      'Total differs from source document',
      `Document total ${ctx.financials.totalWithTax.toFixed(2)} vs calculated ` +
        `${money.totalAmount.toFixed(2)} (basic ${money.basicAmount?.toFixed(2) ?? '—'} + GST ` +
        `${money.totalGst?.toFixed(2) ?? '0.00'}).`
    )
  }

  return {
    ledgerId: row.id,
    entryDate: row.entry_date,
    entryTime: time,
    entryType: row.entry_type,
    entryTypeLabel: entryTypeLabel(row.entry_type),
    documentNumber: ctx.documentNumber,
    companyName: ctx.companyName,
    warehouseName: ctx.warehouseName,
    itemCode: ctx.itemCode,
    itemDescription: ctx.itemDescription,
    itemSize: ctx.itemSize,
    unit: ctx.unit,
    inwardQuantity: inward,
    outwardQuantity: outward,
    transactedQuantity: transacted,
    rate: money.rate,
    basicAmount: money.basicAmount,
    gstPercent: money.gstPercent,
    cgstAmount: money.cgstAmount,
    sgstAmount: money.sgstAmount,
    igstAmount: money.igstAmount,
    totalGst: money.totalGst,
    totalAmount: money.totalAmount,
    // Only the applicable party column is populated; the rest stay blank
    // rather than carrying a misleading default.
    supplierName: party === 'supplier' ? ctx.parties.supplierName ?? '' : '',
    customerName: party === 'customer' ? ctx.parties.customerName ?? '' : '',
    jobWorkerName: party === 'jobworker' ? ctx.parties.jobWorkerName ?? '' : '',
    source: ctx.parties.source ?? '',
    destination: ctx.parties.destination ?? '',
    status: ctx.status,
    remarks: row.notes ?? '',
    createdByName: ctx.createdByName,
    createdAt: row.created_at ?? '',
    reconciliation,
    itemKey: `${row.material_type_id}|${ctx.itemCode}`,
    sizeKey: row.material_size_id ?? row.size_label ?? '',
    href: ctx.href,
  }
}

// ── Grouping and totals ─────────────────────────────────────────────────

export type Totals = {
  inwardQuantity: number
  outwardQuantity: number
  basicAmount: number
  totalGst: number
  totalAmount: number
  transactionCount: number
}

export function emptyTotals(): Totals {
  return {
    inwardQuantity: 0,
    outwardQuantity: 0,
    basicAmount: 0,
    totalGst: 0,
    totalAmount: 0,
    transactionCount: 0,
  }
}

/**
 * Accumulates detail rows into a totals block.
 *
 * Sums the same rounded values the detail rows display and rounds once at
 * the end, so a summary line always equals the sum of the rows beneath it —
 * the report's core validation requirement.
 */
export function sumTotals(rows: DetailRow[]): Totals {
  const t = emptyTotals()
  for (const r of rows) {
    t.inwardQuantity += r.inwardQuantity
    t.outwardQuantity += r.outwardQuantity
    t.basicAmount += r.basicAmount ?? 0
    t.totalGst += r.totalGst ?? 0
    t.totalAmount += r.totalAmount ?? 0
    t.transactionCount += 1
  }
  return {
    inwardQuantity: roundQty(t.inwardQuantity),
    outwardQuantity: roundQty(t.outwardQuantity),
    basicAmount: roundMoney(t.basicAmount),
    totalGst: roundMoney(t.totalGst),
    totalAmount: roundMoney(t.totalAmount),
    transactionCount: t.transactionCount,
  }
}

/** One Day-Wise Summary line: a date + item + size bucket. */
export type SummaryGroup = {
  key: string
  entryDate: string
  itemCode: string
  itemDescription: string
  itemSize: string
  unit: string
  totals: Totals
  rows: DetailRow[]
  /** True when any underlying transaction carries a reconciliation flag. */
  hasReconciliationIssue: boolean
}

export type DayGroup = {
  entryDate: string
  groups: SummaryGroup[]
  totals: Totals
}

export type LedgerReport = {
  days: DayGroup[]
  /** Flat detail list, in the same order as the grouped view. */
  detail: DetailRow[]
  grandTotals: Totals
  exceptions: ReconciliationFlag[]
}

/**
 * Groups detail rows into Date → Item → Size, with per-day and grand totals.
 *
 * Ordering: date ascending, then item code, then size — stable so the
 * on-screen report, the Excel summary sheet and the detail sheet all walk
 * the data in the same order.
 */
export function buildReport(rows: DetailRow[]): LedgerReport {
  const byDate = new Map<string, Map<string, SummaryGroup>>()

  for (const row of rows) {
    if (!byDate.has(row.entryDate)) byDate.set(row.entryDate, new Map())
    const groups = byDate.get(row.entryDate)!
    const key = `${row.entryDate}|${row.itemKey}|${row.sizeKey}`
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        entryDate: row.entryDate,
        itemCode: row.itemCode,
        itemDescription: row.itemDescription,
        itemSize: row.itemSize,
        unit: row.unit,
        totals: emptyTotals(),
        rows: [],
        hasReconciliationIssue: false,
      }
      groups.set(key, group)
    }
    group.rows.push(row)
    if (row.reconciliation) group.hasReconciliationIssue = true
  }

  const days: DayGroup[] = []
  for (const entryDate of Array.from(byDate.keys()).sort()) {
    const groups = Array.from(byDate.get(entryDate)!.values()).sort(
      (a, b) => a.itemCode.localeCompare(b.itemCode) || a.itemSize.localeCompare(b.itemSize)
    )
    for (const g of groups) {
      g.rows.sort((a, b) => a.entryTime.localeCompare(b.entryTime) || a.ledgerId.localeCompare(b.ledgerId))
      g.totals = sumTotals(g.rows)
    }
    days.push({ entryDate, groups, totals: sumTotals(groups.flatMap((g) => g.rows)) })
  }

  const detail = days.flatMap((d) => d.groups.flatMap((g) => g.rows))
  const exceptions = detail
    .map((r) => r.reconciliation)
    .filter((f): f is ReconciliationFlag => f != null)

  return { days, detail, grandTotals: sumTotals(detail), exceptions }
}

/**
 * Re-checks that every summary total equals the sum of its own detail rows.
 *
 * buildReport derives both from the same array so this should never fail;
 * it runs anyway because "summary totals must exactly match the detailed
 * ledger" is a stated requirement, and a silent regression here would
 * misstate money. Returns the mismatches, empty when consistent.
 */
export function verifyTotals(report: LedgerReport): string[] {
  const problems: string[] = []
  const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps

  for (const day of report.days) {
    const fromGroups = sumTotals(day.groups.flatMap((g) => g.rows))
    if (
      !near(fromGroups.inwardQuantity, day.totals.inwardQuantity, QTY_EPSILON) ||
      !near(fromGroups.outwardQuantity, day.totals.outwardQuantity, QTY_EPSILON) ||
      !near(fromGroups.totalAmount, day.totals.totalAmount, MONEY_EPSILON)
    ) {
      problems.push(`Day ${day.entryDate} totals do not match its transactions.`)
    }
    for (const g of day.groups) {
      const recomputed = sumTotals(g.rows)
      if (
        !near(recomputed.inwardQuantity, g.totals.inwardQuantity, QTY_EPSILON) ||
        !near(recomputed.outwardQuantity, g.totals.outwardQuantity, QTY_EPSILON) ||
        !near(recomputed.totalAmount, g.totals.totalAmount, MONEY_EPSILON)
      ) {
        problems.push(`${day.entryDate} ${g.itemCode} ${g.itemSize} summary does not match its transactions.`)
      }
    }
  }

  const fromDays = sumTotals(report.detail)
  if (
    !near(fromDays.inwardQuantity, report.grandTotals.inwardQuantity, QTY_EPSILON) ||
    !near(fromDays.outwardQuantity, report.grandTotals.outwardQuantity, QTY_EPSILON) ||
    !near(fromDays.totalAmount, report.grandTotals.totalAmount, MONEY_EPSILON)
  ) {
    problems.push('Report grand total does not match the detailed ledger.')
  }

  return problems
}
