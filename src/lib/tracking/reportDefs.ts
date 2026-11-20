// Shared by the report screens and the server, so nothing here may import server modules.

export type TrackingReportKey = 'stock-by-location' | 'tracked-vs-book' | 'ageing' | 'movements' | 'pickups' | 'exceptions'

export interface TrackingReportDef {
  key: TrackingReportKey
  title: string
  description: string
  /** Whether the report takes a From and To date. */
  dates: boolean
}

export const TRACKING_REPORTS: TrackingReportDef[] = [
  { key: 'stock-by-location', title: 'Tracked Stock by Location', description: 'What is on each rack and bay now, by count and weight', dates: false },
  { key: 'tracked-vs-book', title: 'Tracked vs Book', description: 'Book stock beside labelled stock, by warehouse, item and size', dates: false },
  { key: 'ageing', title: 'Stock Ageing', description: 'Days each bundle has spent in the yard or at a vendor', dates: false },
  { key: 'movements', title: 'Movement History', description: 'Every scan and status change, with offline scans marked', dates: true },
  { key: 'pickups', title: 'Pickups', description: 'Yard and vendor pickups, waiting time and linked sales', dates: true },
  { key: 'exceptions', title: 'Exceptions', description: 'Missing, on hold, failed prints, unlinked records and refused scans', dates: false },
]

export const isTrackingReportKey = (value: string): value is TrackingReportKey =>
  TRACKING_REPORTS.some((report) => report.key === value)

export type ReportColumnKind = 'text' | 'number' | 'quantity' | 'percent' | 'datetime' | 'date' | 'code'

export interface ReportColumn {
  key: string
  label: string
  kind?: ReportColumnKind
  /** A row field holding the link for this cell. */
  hrefKey?: string
}

export type ReportCell = string | number | null

export interface TrackingReportResult {
  key: TrackingReportKey
  title: string
  columns: ReportColumn[]
  rows: Record<string, ReportCell>[]
  /** Shown above the table: what the figures mean. */
  note: string | null
  /** True when the report hit its row limit, so the screen can say so. */
  truncated: boolean
}

export interface DashboardFigures {
  enabled: boolean
  statuses: { status: string; bundles: number; quantity: string }[]
  notPutAway: { bundles: number; oldestDays: number | null }
  pickups: { open: number; ready: number; oldestReadyHours: number | null }
  vendors: { vendor_name: string; bundles: number; quantity: string; oldestDays: number | null }[]
  labels: { printedToday: number; failed: number }
  warnings: { kind: string; count: number; href: string }[]
  share: { book: string; bookSinceLive: string; tracked: string; percent: number | null; percentSinceLive: number | null }
  syncProblems: number
  counts: { open: number; waiting: number }
}
