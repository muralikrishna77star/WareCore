// The QR Tracking dashboard and reports. Read only: nothing here writes to
// any table. Book stock is read from stock_ledger, the same rows the Stock
// Statement adds up.
import { actorScopeSql, type TrackingActor } from './access'
import { LIFECYCLE_LABELS, TRACKING_EVENT_LABELS, UUID_RE, type LifecycleStatus } from './constants'
import { OFFLINE_ACTION_LABELS, type OfflineActionType } from './offlineShared'
import { openSyncProblemCount } from './offline'
import {
  TRACKING_REPORTS, type DashboardFigures, type ReportCell, type ReportColumn, type TrackingReportKey, type TrackingReportResult,
} from './reportDefs'
import { query, TrackingError, type Row } from './service'

const ROW_LIMIT = 5000
/** Bundles physically in the yard, as the books would count them. */
const YARD_STATUSES = `('LABELLED', 'IN_STOCK', 'ON_HOLD', 'ON_PICKUP', 'READY')`
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const IST_DATE = (column: string) => `(${column} AT TIME ZONE 'Asia/Kolkata')::date`

export interface ReportFilters {
  company_id?: string | null
  warehouse_id?: string | null
  from?: string | null
  to?: string | null
  place?: string | null
}

function istToday(offsetDays = 0): string {
  return new Date(Date.now() + 5.5 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10)
}

export function readFilters(params: URLSearchParams): ReportFilters {
  const uuid = (key: string) => {
    const value = params.get(key)
    if (!value) return null
    if (!UUID_RE.test(value)) throw new TrackingError(`${key === 'company_id' ? 'Company' : 'Warehouse'} is not valid`)
    return value
  }
  const date = (key: string) => {
    const value = params.get(key)
    if (!value) return null
    if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) throw new TrackingError('Enter dates as YYYY-MM-DD')
    return value
  }
  return { company_id: uuid('company_id'), warehouse_id: uuid('warehouse_id'), from: date('from'), to: date('to'), place: params.get('place') }
}

/** The person's own scope, narrowed by the company and warehouse chosen on screen. */
function scopeSql(actor: TrackingActor, filters: ReportFilters, companyColumn: string, warehouseColumn: string, params: unknown[]): string {
  const parts = [actorScopeSql(actor, companyColumn, warehouseColumn, params)]
  if (filters.company_id) {
    params.push(filters.company_id)
    parts.push(`${companyColumn} = $${params.length}::uuid`)
  }
  if (filters.warehouse_id) {
    params.push(filters.warehouse_id)
    parts.push(`${warehouseColumn} = $${params.length}::uuid`)
  }
  return parts.join(' AND ')
}

function dateRange(filters: ReportFilters, params: unknown[], column: string): string {
  const from = filters.from ?? istToday(-29)
  const to = filters.to ?? istToday()
  if (from > to) throw new TrackingError('The From date is after the To date')
  params.push(from, to)
  return `${IST_DATE(column)} BETWEEN $${params.length - 1}::date AND $${params.length}::date`
}

const num = (value: string | null | undefined) => (value == null ? 0 : Number(value))
const fixed3 = (value: number) => value.toFixed(3)
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)
const statusWords = (status: string | null) => (status ? LIFECYCLE_LABELS[status as LifecycleStatus] ?? status : null)

function finish(key: TrackingReportKey, columns: ReportColumn[], rows: Record<string, ReportCell>[], note: string | null): TrackingReportResult {
  const def = TRACKING_REPORTS.find((report) => report.key === key)!
  return { key, title: def.title, columns, rows: rows.slice(0, ROW_LIMIT), note, truncated: rows.length > ROW_LIMIT }
}

// ── Book stock beside tracked stock ─────────────────────────────────────────

interface BookRow {
  company_id: string
  warehouse_id: string
  warehouse_name: string
  item: string
  size_label: string | null
  unit: string | null
  book: number
  book_new: number
  bundles: number
  tracked: number
  tracked_new: number
}

/**
 * Per warehouse, item type and size: book stock (all of it, and the part from
 * purchase lines received since the Live Date) beside the weight of bundles
 * tracking has in the yard. Only warehouses with tracking switched on.
 */
async function bookVsTracked(actor: TrackingActor, filters: ReportFilters): Promise<BookRow[]> {
  const params: unknown[] = []
  const bookScope = scopeSql(actor, filters, 's.company_id', 's.warehouse_id', params)
  const unitScope = scopeSql(actor, filters, 'u.company_id', 'u.warehouse_id', params)
  const rows = await query(
    `WITH book AS (
       SELECT s.company_id, s.warehouse_id, s.material_type_id, s.material_size_id,
              SUM(s.quantity) AS book,
              COALESCE(SUM(s.quantity) FILTER (WHERE x.is_new), 0) AS book_new
         FROM stock_ledger s
         LEFT JOIN LATERAL (
           SELECT fn_tracking_line_is_new(i.created_at, b.bill_date, s.company_id, s.warehouse_id) AS is_new
             FROM purchase_bill_items i JOIN purchase_bills b ON b.id = i.bill_id
            WHERE i.purchase_line_id = s.purchase_line_id
            LIMIT 1) x ON true
        WHERE fn_tracking_is_enabled(s.company_id, s.warehouse_id) AND ${bookScope}
        GROUP BY 1, 2, 3, 4
     ), tracked AS (
       SELECT u.company_id, u.warehouse_id, u.material_type_id, u.material_size_id,
              count(*)::int AS bundles, SUM(u.quantity) AS tracked,
              COALESCE(SUM(u.quantity) FILTER (WHERE x.is_new), 0) AS tracked_new
         FROM tracking_units u
         LEFT JOIN LATERAL (
           SELECT fn_tracking_line_is_new(i.created_at, b.bill_date, u.company_id, u.warehouse_id) AS is_new
             FROM purchase_bill_items i JOIN purchase_bills b ON b.id = i.bill_id
            WHERE i.purchase_line_id = u.purchase_line_id AND u.source_type <> 'VERIFIED_EXISTING'
            LIMIT 1) x ON true
        WHERE u.status = 'ACTIVE' AND u.lifecycle_status IN ${YARD_STATUSES} AND ${unitScope}
        GROUP BY 1, 2, 3, 4
     )
     SELECT k.company_id::text, k.warehouse_id::text, w.name AS warehouse_name,
            COALESCE(mt.description, '(no item type)') AS item, ms.size_label, mt.unit,
            COALESCE(b.book, 0)::text AS book, COALESCE(b.book_new, 0)::text AS book_new,
            COALESCE(t.bundles, 0) AS bundles, COALESCE(t.tracked, 0)::text AS tracked, COALESCE(t.tracked_new, 0)::text AS tracked_new
       FROM (SELECT company_id, warehouse_id, material_type_id, material_size_id FROM book
             UNION SELECT company_id, warehouse_id, material_type_id, material_size_id FROM tracked) k
       LEFT JOIN book b ON b.company_id = k.company_id AND b.warehouse_id = k.warehouse_id
                       AND b.material_type_id IS NOT DISTINCT FROM k.material_type_id
                       AND b.material_size_id IS NOT DISTINCT FROM k.material_size_id
       LEFT JOIN tracked t ON t.company_id = k.company_id AND t.warehouse_id = k.warehouse_id
                          AND t.material_type_id IS NOT DISTINCT FROM k.material_type_id
                          AND t.material_size_id IS NOT DISTINCT FROM k.material_size_id
       JOIN warehouses w ON w.id = k.warehouse_id
       LEFT JOIN material_types mt ON mt.id = k.material_type_id
       LEFT JOIN material_sizes ms ON ms.id = k.material_size_id
      WHERE round(COALESCE(b.book, 0), 3) <> 0 OR t.bundles IS NOT NULL
      ORDER BY w.name, item, ms.size_label NULLS FIRST`,
    params,
  )
  return rows.map((row) => ({
    ...(row as unknown as BookRow),
    book: num(row.book), book_new: num(row.book_new), bundles: Number(row.bundles), tracked: num(row.tracked), tracked_new: num(row.tracked_new),
  }))
}

// ── Reports ─────────────────────────────────────────────────────────────────

async function stockByLocation(actor: TrackingActor, filters: ReportFilters) {
  const params: unknown[] = []
  const rows = await query(
    `SELECT w.name AS warehouse, COALESCE(l.code, '(not put away)') AS location, l.location_type,
            concat_ws(' ', u.item_code, u.item_name) AS item, u.size_label, u.unit,
            count(*)::int AS bundles, SUM(u.quantity)::text AS quantity,
            count(*) FILTER (WHERE u.lifecycle_status = 'ON_HOLD')::int AS on_hold,
            count(*) FILTER (WHERE u.lifecycle_status IN ('ON_PICKUP', 'READY'))::int AS on_pickup
       FROM tracking_units u
       JOIN warehouses w ON w.id = u.warehouse_id
       LEFT JOIN tracking_locations l ON l.id = u.current_location_id
      WHERE u.status = 'ACTIVE' AND u.lifecycle_status IN ${YARD_STATUSES}
        AND ${scopeSql(actor, filters, 'u.company_id', 'u.warehouse_id', params)}
      GROUP BY w.name, l.code, l.location_type, u.item_code, u.item_name, u.size_label, u.unit
      ORDER BY w.name, l.code NULLS FIRST, item, u.size_label
      LIMIT ${ROW_LIMIT + 1}`,
    params,
  )
  return finish('stock-by-location', [
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'location', label: 'Location', kind: 'code' },
    { key: 'item', label: 'Item' },
    { key: 'size_label', label: 'Size' },
    { key: 'bundles', label: 'Bundles', kind: 'number' },
    { key: 'quantity', label: 'Weight', kind: 'quantity' },
    { key: 'unit', label: 'Unit' },
    { key: 'on_hold', label: 'On hold', kind: 'number' },
    { key: 'on_pickup', label: 'On a pickup', kind: 'number' },
  ], rows.map((row) => ({ ...row, bundles: Number(row.bundles), on_hold: Number(row.on_hold), on_pickup: Number(row.on_pickup) })),
  'Bundles in the yard now: labelled, in stock, on hold or on a pickup. Bundles not put away yet are listed first in each warehouse.')
}

async function trackedVsBook(actor: TrackingActor, filters: ReportFilters) {
  const rows = (await bookVsTracked(actor, filters)).map((row) => ({
    warehouse: row.warehouse_name,
    item: row.item,
    size_label: row.size_label,
    unit: row.unit,
    book: fixed3(row.book),
    book_new: fixed3(row.book_new),
    bundles: row.bundles,
    tracked: fixed3(row.tracked),
    untracked: fixed3(row.book - row.tracked),
    share: percent(row.tracked, row.book),
  }))
  return finish('tracked-vs-book', [
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'item', label: 'Item type' },
    { key: 'size_label', label: 'Size' },
    { key: 'unit', label: 'Unit' },
    { key: 'book', label: 'Book stock', kind: 'quantity' },
    { key: 'book_new', label: 'Of which received since Live Date', kind: 'quantity' },
    { key: 'bundles', label: 'Tracked bundles', kind: 'number' },
    { key: 'tracked', label: 'Tracked weight', kind: 'quantity' },
    { key: 'untracked', label: 'Not labelled', kind: 'quantity' },
    { key: 'share', label: 'Labelled share', kind: 'percent' },
  ], rows,
  'Book stock is the Stock Statement closing balance for each warehouse, item type and size. Stock received before the Live Date is labelled only when it is physically verified, so a gap there is expected. Differences are shown, never corrected.')
}

async function ageing(actor: TrackingActor, filters: ReportFilters) {
  const params: unknown[] = []
  const place = filters.place === 'yard' ? `u.lifecycle_status IN ${YARD_STATUSES}`
    : filters.place === 'vendor' ? `u.lifecycle_status = 'AT_VENDOR'`
    : `u.lifecycle_status IN ('LABELLED', 'IN_STOCK', 'ON_HOLD', 'ON_PICKUP', 'READY', 'AT_VENDOR')`
  const rows = await query(
    `SELECT x.*, floor(extract(epoch FROM now() - x.since) / 86400)::int AS days
       FROM (
         SELECT u.id::text AS unit_id, u.stock_tracking_id, w.name AS warehouse, concat_ws(' ', u.item_code, u.item_name) AS item,
                u.size_label, u.quantity::text, u.unit, u.lifecycle_status,
                CASE WHEN u.lifecycle_status = 'AT_VENDOR' THEN u.current_vendor_name ELSE COALESCE(l.code, '(not put away)') END AS place,
                CASE WHEN u.lifecycle_status = 'AT_VENDOR' THEN COALESCE(u.at_vendor_since, u.created_at)
                     ELSE GREATEST(u.created_at, COALESCE((SELECT max(e.occurred_at) FROM tracking_events e
                                    WHERE e.tracking_unit_id = u.id AND e.event_type = 'RETURNED_FROM_VENDOR'), u.created_at)) END AS since
           FROM tracking_units u
           JOIN warehouses w ON w.id = u.warehouse_id
           LEFT JOIN tracking_locations l ON l.id = u.current_location_id
          WHERE u.status = 'ACTIVE' AND ${place}
            AND ${scopeSql(actor, filters, 'u.company_id', 'u.warehouse_id', params)}
       ) x
      ORDER BY x.since, x.stock_tracking_id
      LIMIT ${ROW_LIMIT + 1}`,
    params,
  )
  const band = (days: number) => (days <= 30 ? '0 to 30 days' : days <= 60 ? '31 to 60 days' : days <= 90 ? '61 to 90 days' : 'Over 90 days')
  return finish('ageing', [
    { key: 'stock_tracking_id', label: 'Bundle', kind: 'code', hrefKey: 'href' },
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'item', label: 'Item' },
    { key: 'size_label', label: 'Size' },
    { key: 'quantity', label: 'Weight', kind: 'quantity' },
    { key: 'unit', label: 'Unit' },
    { key: 'status', label: 'Status' },
    { key: 'place', label: 'Location or vendor' },
    { key: 'since', label: 'Since', kind: 'datetime' },
    { key: 'days', label: 'Days', kind: 'number' },
    { key: 'band', label: 'Age band' },
  ], rows.map((row) => ({
    stock_tracking_id: row.stock_tracking_id, href: `/tracking/units/${row.unit_id}`, warehouse: row.warehouse, item: row.item,
    size_label: row.size_label, quantity: row.quantity, unit: row.unit, status: statusWords(row.lifecycle_status), place: row.place,
    since: row.since, days: Number(row.days), band: band(Number(row.days)),
  })),
  'Days in the yard count from labelling, or from the last return from a vendor. Days at a vendor count from when the bundle was sent. Oldest first.')
}

function describeEvent(type: string, details: Record<string, unknown>): string {
  const d = (key: string) => (details[key] == null ? '' : String(details[key]))
  switch (type) {
    case 'PUT_AWAY': case 'MOVED': return d('to_location') ? `to ${d('to_location')}` : ''
    case 'STATUS_CHANGED': return [statusWords(d('from')), statusWords(d('to'))].filter(Boolean).join(' to ') + (d('reason') ? `: ${d('reason')}` : '')
    case 'ADDED_TO_PICKUP': case 'REMOVED_FROM_PICKUP': case 'MARKED_READY': case 'PICKED_UP': return d('pickup_no')
    case 'ADDED_TO_DISPATCH': case 'REMOVED_FROM_DISPATCH': case 'SENT_TO_VENDOR': return [d('dispatch_no'), d('vendor')].filter(Boolean).join(', ')
    case 'RETURNED_FROM_VENDOR': return [d('vendor'), d('to_location') && `to ${d('to_location')}`].filter(Boolean).join(', ')
    case 'VENDOR_CHANGED': return [d('from_vendor'), d('to_vendor')].filter(Boolean).join(' to ')
    case 'COUNTED': return [d('count_no'), d('location') && `at ${d('location')}`].filter(Boolean).join(' ')
    case 'UNIT_VOIDED': return d('reason')
    default: return ''
  }
}

async function movements(actor: TrackingActor, filters: ReportFilters) {
  const params: unknown[] = []
  const scope = scopeSql(actor, filters, 'u.company_id', 'u.warehouse_id', params)
  const range = dateRange(filters, params, 'e.occurred_at')
  const rows = await query(
    `SELECT e.occurred_at::text, u.id::text AS unit_id, u.stock_tracking_id, w.name AS warehouse, e.event_type, e.details::text,
            p.full_name AS person, e.offline_action_id IS NOT NULL AS offline, oa.received_at::text AS synced_at
       FROM tracking_events e
       JOIN tracking_units u ON u.id = e.tracking_unit_id
       JOIN warehouses w ON w.id = u.warehouse_id
       LEFT JOIN user_profiles p ON p.id = e.actor_id
       LEFT JOIN tracking_offline_actions oa ON oa.id = e.offline_action_id
      WHERE e.event_type <> 'SCAN_LOOKUP' AND ${scope} AND ${range}
      ORDER BY e.occurred_at DESC, u.stock_tracking_id
      LIMIT ${ROW_LIMIT + 1}`,
    params,
  )
  return finish('movements', [
    { key: 'occurred_at', label: 'When', kind: 'datetime' },
    { key: 'stock_tracking_id', label: 'Bundle', kind: 'code', hrefKey: 'href' },
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'step', label: 'Step' },
    { key: 'detail', label: 'Detail' },
    { key: 'person', label: 'Person' },
    { key: 'offline', label: 'Offline' },
    { key: 'synced_at', label: 'Reached server', kind: 'datetime' },
  ], rows.map((row) => {
    let details: Record<string, unknown> = {}
    try { details = JSON.parse(row.details) } catch { /* history rows always hold JSON */ }
    return {
      occurred_at: row.occurred_at, stock_tracking_id: row.stock_tracking_id, href: `/tracking/units/${row.unit_id}`, warehouse: row.warehouse,
      step: TRACKING_EVENT_LABELS[row.event_type] ?? row.event_type, detail: describeEvent(row.event_type, details),
      person: row.person, offline: row.offline === 't' ? 'Yes' : '', synced_at: row.offline === 't' ? row.synced_at : null,
    }
  }),
  'Times are when each step happened. For an offline scan that is when it was scanned; Reached server shows when the phone sent it.')
}

async function pickupsReport(actor: TrackingActor, filters: ReportFilters) {
  const params: unknown[] = []
  const scope = scopeSql(actor, filters, 'p.company_id', 'p.warehouse_id', params)
  const range = dateRange(filters, params, 'p.created_at')
  const rows = await query(
    `SELECT p.id::text, p.pickup_no, p.vendor_name, p.status, p.customer_name, p.collector_name, p.vehicle_number,
            p.invoice_number, p.created_at::text, p.handed_over_at::text, w.name AS warehouse,
            (SELECT count(*)::int FROM tracking_pickup_units pu WHERE pu.pickup_id = p.id AND pu.removed_at IS NULL) AS bundles,
            (SELECT COALESCE(SUM(pu.quantity), 0)::text FROM tracking_pickup_units pu WHERE pu.pickup_id = p.id AND pu.removed_at IS NULL) AS quantity,
            (SELECT max(e.occurred_at)::text FROM tracking_pickup_events e WHERE e.pickup_id = p.id AND e.event_type = 'MARKED_READY') AS ready_at,
            (SELECT round(extract(epoch FROM COALESCE(p.handed_over_at, now()) - max(e.occurred_at)) / 3600, 1)::text
               FROM tracking_pickup_events e WHERE e.pickup_id = p.id AND e.event_type = 'MARKED_READY') AS waiting_hours
       FROM tracking_pickups p JOIN warehouses w ON w.id = p.warehouse_id
      WHERE ${scope} AND ${range}
      ORDER BY p.created_at DESC
      LIMIT ${ROW_LIMIT + 1}`,
    params,
  )
  const statusLabel: Record<string, string> = { OPEN: 'Open', READY: 'Ready', HANDED_OVER: 'Handed over', CANCELLED: 'Cancelled' }
  return finish('pickups', [
    { key: 'pickup_no', label: 'Pickup', kind: 'code', hrefKey: 'href' },
    { key: 'kind', label: 'Type' },
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'status', label: 'Status' },
    { key: 'customer_name', label: 'Customer' },
    { key: 'collector_name', label: 'Collector' },
    { key: 'vehicle_number', label: 'Vehicle' },
    { key: 'bundles', label: 'Bundles', kind: 'number' },
    { key: 'quantity', label: 'Weight', kind: 'quantity' },
    { key: 'created_at', label: 'Created', kind: 'datetime' },
    { key: 'ready_at', label: 'Ready', kind: 'datetime' },
    { key: 'handed_over_at', label: 'Handed over', kind: 'datetime' },
    { key: 'waiting_hours', label: 'Hours waiting after ready', kind: 'number' },
    { key: 'invoice_number', label: 'Linked sale' },
  ], rows.map((row) => ({
    pickup_no: row.pickup_no, href: `/tracking/pickups/${row.id}`, kind: row.vendor_name ? `At vendor: ${row.vendor_name}` : 'Yard',
    warehouse: row.warehouse, status: statusLabel[row.status] ?? row.status, customer_name: row.customer_name,
    collector_name: row.collector_name, vehicle_number: row.vehicle_number, bundles: Number(row.bundles), quantity: row.quantity,
    created_at: row.created_at, ready_at: row.ready_at, handed_over_at: row.handed_over_at,
    waiting_hours: row.waiting_hours == null || row.status === 'CANCELLED' ? null : Number(row.waiting_hours),
    invoice_number: row.invoice_number ?? (row.status === 'HANDED_OVER' ? 'Not linked' : null),
  })),
  'Pickups created between the two dates. Hours waiting runs from Marked ready to Handed over, or to now while it is still waiting.')
}

async function exceptionRows(actor: TrackingActor, filters: ReportFilters): Promise<Record<string, ReportCell>[]> {
  const params: unknown[] = []
  const units = scopeSql(actor, filters, 'u.company_id', 'u.warehouse_id', params)
  const pickups = scopeSql(actor, filters, 'p.company_id', 'p.warehouse_id', params)
  const dispatches = scopeSql(actor, filters, 'd.company_id', 'd.warehouse_id', params)
  const counts = scopeSql(actor, filters, 's.company_id', 's.warehouse_id', params)
  const offline = scopeSql(actor, filters, 'a.company_id', 'a.warehouse_id', params)
  const rows = await query(
    `SELECT * FROM (
       SELECT 1 AS sort, 'Missing' AS problem, u.stock_tracking_id AS reference, '/tracking/units/' || u.id AS href, w.name AS warehouse,
              concat_ws(' ', u.item_code, u.size_label, u.quantity || ' ' || u.unit, NULLIF(': ' || COALESCE(u.status_reason, ''), ': ')) AS detail,
              u.updated_at::text AS since
         FROM tracking_units u JOIN warehouses w ON w.id = u.warehouse_id
        WHERE u.status = 'ACTIVE' AND u.lifecycle_status = 'MISSING' AND ${units}
       UNION ALL
       SELECT 2, 'On hold', u.stock_tracking_id, '/tracking/units/' || u.id, w.name,
              concat_ws(' ', u.item_code, u.size_label, NULLIF(': ' || COALESCE(u.status_reason, ''), ': ')), u.updated_at::text
         FROM tracking_units u JOIN warehouses w ON w.id = u.warehouse_id
        WHERE u.status = 'ACTIVE' AND u.lifecycle_status = 'ON_HOLD' AND ${units}
       UNION ALL
       SELECT 3, 'Not put away', u.stock_tracking_id, '/tracking/units/' || u.id, w.name,
              concat_ws(' ', u.item_code, u.size_label, 'labelled but on no location for over a day'), u.created_at::text
         FROM tracking_units u JOIN warehouses w ON w.id = u.warehouse_id
        WHERE u.status = 'ACTIVE' AND u.lifecycle_status = 'LABELLED' AND u.created_at < now() - interval '1 day' AND ${units}
       UNION ALL
       SELECT 4, 'Failed print', u.stock_tracking_id, '/tracking/units/' || u.id, w.name,
              'The last label print failed and nothing has printed since', j.created_at::text
         FROM tracking_units u JOIN warehouses w ON w.id = u.warehouse_id
         JOIN LATERAL (SELECT status, created_at FROM tracking_print_jobs WHERE tracking_unit_id = u.id ORDER BY created_at DESC LIMIT 1) j ON true
        WHERE u.status = 'ACTIVE' AND j.status = 'failed' AND ${units}
       UNION ALL
       SELECT 5, 'Pickup without a sale', p.pickup_no, '/tracking/pickups/' || p.id, w.name,
              concat_ws(', ', p.customer_name, 'handed over with no sale linked'), p.handed_over_at::text
         FROM tracking_pickups p JOIN warehouses w ON w.id = p.warehouse_id
        WHERE p.status = 'HANDED_OVER' AND p.dispatch_order_id IS NULL AND ${pickups}
       UNION ALL
       SELECT 6, 'Dispatch without a job work order', d.dispatch_no, '/tracking/dispatches/' || d.id, w.name,
              concat_ws(', ', d.vendor_name, 'sent with no job work order linked'), d.sent_at::text
         FROM tracking_vendor_dispatches d JOIN warehouses w ON w.id = d.warehouse_id
        WHERE d.status = 'SENT' AND d.job_work_order_id IS NULL AND ${dispatches}
       UNION ALL
       SELECT 7, 'Stock count differences', s.count_no, '/tracking/counts/' || s.id, w.name,
              (SELECT count(*) FROM tracking_stock_count_lines x WHERE x.count_id = s.id AND x.outcome <> 'FOUND' AND x.decision IS NULL)
                || ' to decide on ' || l.code, s.submitted_at::text
         FROM tracking_stock_counts s JOIN warehouses w ON w.id = s.warehouse_id JOIN tracking_locations l ON l.id = s.location_id
        WHERE s.status = 'SUBMITTED' AND ${counts}
       UNION ALL
       SELECT 8, 'Refused offline scan', COALESCE(u.stock_tracking_id, a.payload ->> 'code', a.action), '/tracking/sync-problems', w.name,
              a.action || ': ' || a.refusal_reason, a.received_at::text
         FROM tracking_offline_actions a JOIN warehouses w ON w.id = a.warehouse_id
         LEFT JOIN tracking_units u ON u.id = a.tracking_unit_id
        WHERE a.outcome = 'REFUSED' AND a.reviewed_at IS NULL AND ${offline}
     ) x
     ORDER BY sort, since NULLS LAST
     LIMIT ${ROW_LIMIT + 1}`,
    params,
  )
  return rows.map((row) => {
    const detail = row.problem === 'Refused offline scan'
      ? row.detail.replace(/^([A-Z_]+): /, (_, action: string) => `${OFFLINE_ACTION_LABELS[action as OfflineActionType] ?? action}: `)
      : row.detail
    return { problem: row.problem, reference: row.reference, href: row.href, warehouse: row.warehouse, detail, since: row.since }
  })
}

async function exceptions(actor: TrackingActor, filters: ReportFilters) {
  return finish('exceptions', [
    { key: 'problem', label: 'Problem' },
    { key: 'reference', label: 'Reference', kind: 'code', hrefKey: 'href' },
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'detail', label: 'Detail' },
    { key: 'since', label: 'Since', kind: 'datetime' },
  ], await exceptionRows(actor, filters), 'Every open tracking problem, grouped by kind and oldest first. Nothing here changes stock figures.')
}

export async function runTrackingReport(actor: TrackingActor, key: TrackingReportKey, filters: ReportFilters): Promise<TrackingReportResult> {
  switch (key) {
    case 'stock-by-location': return stockByLocation(actor, filters)
    case 'tracked-vs-book': return trackedVsBook(actor, filters)
    case 'ageing': return ageing(actor, filters)
    case 'movements': return movements(actor, filters)
    case 'pickups': return pickupsReport(actor, filters)
    case 'exceptions': return exceptions(actor, filters)
  }
}

// ── Dashboard ───────────────────────────────────────────────────────────────

export async function dashboardFigures(actor: TrackingActor, filters: ReportFilters): Promise<DashboardFigures> {
  const scope = (company: string, warehouse: string, params: unknown[]) => scopeSql(actor, filters, company, warehouse, params)

  const enabledParams: unknown[] = []
  const [enabled] = await query(
    `SELECT EXISTS (SELECT 1 FROM warehouses w WHERE fn_tracking_is_enabled(w.company_id, w.id) AND ${scope('w.company_id', 'w.id', enabledParams)}) AS enabled`,
    enabledParams,
  )

  const p1: unknown[] = []
  const p2: unknown[] = []
  const p3: unknown[] = []
  const p4: unknown[] = []
  const p5: unknown[] = []
  const [statuses, labelled, pickups, vendors, labels, warningRows, book, counts, sync] = await Promise.all([
    query(
      `SELECT lifecycle_status AS status, count(*)::int AS bundles, SUM(quantity)::text AS quantity
         FROM tracking_units u WHERE status = 'ACTIVE' AND ${scope('u.company_id', 'u.warehouse_id', p1)}
        GROUP BY lifecycle_status`,
      p1,
    ),
    query(
      `SELECT count(*)::int AS bundles, floor(extract(epoch FROM now() - min(created_at)) / 86400)::int AS oldest
         FROM tracking_units u WHERE status = 'ACTIVE' AND lifecycle_status = 'LABELLED' AND ${scope('u.company_id', 'u.warehouse_id', p2)}`,
      p2,
    ),
    query(
      `SELECT count(*) FILTER (WHERE p.status = 'OPEN')::int AS open, count(*) FILTER (WHERE p.status = 'READY')::int AS ready,
              round(extract(epoch FROM now() - min(r.ready_at) FILTER (WHERE p.status = 'READY')) / 3600, 1)::text AS oldest
         FROM tracking_pickups p
         LEFT JOIN LATERAL (SELECT max(occurred_at) AS ready_at FROM tracking_pickup_events e
                             WHERE e.pickup_id = p.id AND e.event_type = 'MARKED_READY') r ON true
        WHERE p.status IN ('OPEN', 'READY') AND ${scope('p.company_id', 'p.warehouse_id', p3)}`,
      p3,
    ),
    query(
      `SELECT current_vendor_name AS vendor_name, count(*)::int AS bundles, SUM(quantity)::text AS quantity,
              floor(extract(epoch FROM now() - min(at_vendor_since)) / 86400)::int AS oldest
         FROM tracking_units u WHERE status = 'ACTIVE' AND lifecycle_status = 'AT_VENDOR' AND ${scope('u.company_id', 'u.warehouse_id', p4)}
        GROUP BY current_vendor_name ORDER BY count(*) DESC, current_vendor_name`,
      p4,
    ),
    query(
      `SELECT count(*) FILTER (WHERE j.status IN ('sent', 'confirmed') AND ${IST_DATE('j.created_at')} = ${IST_DATE('now()')})::int AS today
         FROM tracking_print_jobs j JOIN tracking_units u ON u.id = j.tracking_unit_id
        WHERE ${scope('u.company_id', 'u.warehouse_id', p5)}`,
      p5,
    ),
    exceptionRows(actor, filters),
    bookVsTracked(actor, filters),
    (async () => {
      const params: unknown[] = []
      return query(
        `SELECT count(*) FILTER (WHERE status = 'OPEN')::int AS open, count(*) FILTER (WHERE status = 'SUBMITTED')::int AS waiting
           FROM tracking_stock_counts s WHERE ${scope('s.company_id', 's.warehouse_id', params)}`,
        params,
      )
    })(),
    openSyncProblemCount(actor),
  ])

  const warningCounts = new Map<string, number>()
  for (const row of warningRows) warningCounts.set(String(row.problem), (warningCounts.get(String(row.problem)) ?? 0) + 1)
  const totals = book.reduce((acc, row) => ({ book: acc.book + row.book, bookNew: acc.bookNew + row.book_new, tracked: acc.tracked + row.tracked, trackedNew: acc.trackedNew + row.tracked_new }), { book: 0, bookNew: 0, tracked: 0, trackedNew: 0 })
  const first = (rows: Row[]) => rows[0] ?? ({} as Row)

  return {
    enabled: enabled?.enabled === 't',
    statuses: statuses.map((row) => ({ status: row.status, bundles: Number(row.bundles), quantity: Number(row.quantity).toFixed(3) })),
    notPutAway: { bundles: Number(first(labelled).bundles ?? 0), oldestDays: first(labelled).oldest == null ? null : Number(first(labelled).oldest) },
    pickups: {
      open: Number(first(pickups).open ?? 0), ready: Number(first(pickups).ready ?? 0),
      oldestReadyHours: first(pickups).oldest == null ? null : Number(first(pickups).oldest),
    },
    vendors: vendors.map((row) => ({
      vendor_name: row.vendor_name, bundles: Number(row.bundles), quantity: Number(row.quantity).toFixed(3),
      oldestDays: row.oldest == null ? null : Number(row.oldest),
    })),
    labels: { printedToday: Number(first(labels).today ?? 0), failed: warningCounts.get('Failed print') ?? 0 },
    warnings: [...warningCounts.entries()].map(([kind, count]) => ({ kind, count, href: '/reports/tracking/exceptions' })),
    share: {
      book: fixed3(totals.book), bookSinceLive: fixed3(totals.bookNew), tracked: fixed3(totals.tracked),
      percent: percent(totals.tracked, totals.book), percentSinceLive: percent(totals.trackedNew, totals.bookNew),
    },
    syncProblems: sync,
    counts: { open: Number(first(counts).open ?? 0), waiting: Number(first(counts).waiting ?? 0) },
  }
}

/** The three figures on the main Dashboard card. Cheap: no book stock is read. */
export async function dashboardCard(actor: TrackingActor): Promise<{ enabled: boolean; notPutAway: number; pickupsReady: number; syncProblems: number }> {
  const p1: unknown[] = []
  const p2: unknown[] = []
  const p3: unknown[] = []
  const [[enabled], [labelled], [ready], sync] = await Promise.all([
    query(`SELECT EXISTS (SELECT 1 FROM warehouses w WHERE fn_tracking_is_enabled(w.company_id, w.id) AND ${actorScopeSql(actor, 'w.company_id', 'w.id', p1)}) AS enabled`, p1),
    query(`SELECT count(*)::int AS n FROM tracking_units u WHERE u.status = 'ACTIVE' AND u.lifecycle_status = 'LABELLED' AND ${actorScopeSql(actor, 'u.company_id', 'u.warehouse_id', p2)}`, p2),
    query(`SELECT count(*)::int AS n FROM tracking_pickups p WHERE p.status = 'READY' AND ${actorScopeSql(actor, 'p.company_id', 'p.warehouse_id', p3)}`, p3),
    openSyncProblemCount(actor),
  ])
  return { enabled: enabled?.enabled === 't', notPutAway: Number(labelled?.n ?? 0), pickupsReady: Number(ready?.n ?? 0), syncProblems: sync }
}
