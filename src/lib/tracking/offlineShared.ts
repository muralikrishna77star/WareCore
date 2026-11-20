// Shared by the Offline Scan screen in the browser and the server, so nothing
// here may import server modules.
import type { LifecycleStatus } from './constants'

export type OfflineActionType = 'PLACE' | 'ADD_TO_PICKUP' | 'ADD_TO_DISPATCH' | 'COUNT_START' | 'COUNT_SCAN' | 'COUNT_SUBMIT'

export const OFFLINE_ACTION_TYPES: readonly OfflineActionType[] = [
  'PLACE', 'ADD_TO_PICKUP', 'ADD_TO_DISPATCH', 'COUNT_START', 'COUNT_SCAN', 'COUNT_SUBMIT',
]

export const OFFLINE_ACTION_LABELS: Record<OfflineActionType, string> = {
  PLACE: 'Put away or move',
  ADD_TO_PICKUP: 'Scan onto pickup',
  ADD_TO_DISPATCH: 'Scan onto vendor dispatch',
  COUNT_START: 'Start stock count',
  COUNT_SCAN: 'Stock count scan',
  COUNT_SUBMIT: 'Submit stock count',
}

/** Scans sent in one request. The phone sends the rest in the next one. */
export const MAX_SYNC_BATCH = 50

export const DEVICE_ID_RE = /^[A-Za-z0-9-]{8,64}$/

/** How often the screen refreshes what it keeps on the phone while it stays open with a signal. */
export const SNAPSHOT_REFRESH_MS = 15 * 60_000

export interface OfflineActionPayload {
  /** A scanned bundle label, or a typed tracking ID. */
  code?: string
  /** A scanned location label, or a typed location code. */
  location?: string
  pickup_id?: string
  dispatch_id?: string
  /** Made on the phone when a count is started, so its scans can follow offline. */
  count_id?: string
  position?: { latitude: number; longitude: number; accuracy_m: number | null } | null
}

/** One scan as the phone saves it and sends it. */
export interface OfflineAction {
  id: string
  action: OfflineActionType
  /** The phone's clock, as an ISO string. */
  scanned_at: string
  warehouse_id: string
  /** The person signed in when it was scanned. Only they can send it. */
  actor_id: string
  payload: OfflineActionPayload
}

export type OfflineOutcome = 'APPLIED' | 'REFUSED'

export interface OfflineResult {
  id: string
  outcome: OfflineOutcome
  reason: string | null
  /** False when the server refused it without keeping a record (it could not be read). */
  recorded: boolean
}

export interface SnapshotWarehouse {
  id: string
  name: string
  company_id: string
  company_name: string
}

export interface SnapshotUnit {
  id: string
  stock_tracking_id: string
  qr_reference: string
  item_code: string | null
  item_name: string | null
  size_label: string | null
  quantity: string
  unit: string
  lifecycle_status: LifecycleStatus
  location_code: string | null
  current_vendor_name: string | null
}

export interface SnapshotLocation {
  code: string
  location_ref: string
  name: string | null
  location_type: string
}

export interface SnapshotPickup {
  id: string
  pickup_no: string
  customer_name: string
}

export interface SnapshotDispatch {
  id: string
  dispatch_no: string
  vendor_name: string
}

export interface SnapshotCount {
  id: string
  count_no: string
  location_code: string
}

/** What the phone keeps for one warehouse. No prices, bills or phone numbers. */
export interface OfflineSnapshot {
  user_id: string
  user_name: string
  server_time: string
  warehouses: SnapshotWarehouse[]
  warehouse: SnapshotWarehouse | null
  gps: boolean
  units: SnapshotUnit[]
  locations: SnapshotLocation[]
  pickups: SnapshotPickup[]
  dispatches: SnapshotDispatch[]
  counts: SnapshotCount[]
}

export type CountStatus = 'OPEN' | 'SUBMITTED' | 'CLOSED' | 'CANCELLED'

export const COUNT_STATUS_LABELS: Record<CountStatus, string> = {
  OPEN: 'Open',
  SUBMITTED: 'Waiting for decisions',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
}

export type CountOutcome = 'FOUND' | 'NOT_FOUND' | 'FOUND_ELSEWHERE' | 'WRONG_STATUS' | 'UNKNOWN_LABEL'

export const COUNT_OUTCOME_LABELS: Record<CountOutcome, string> = {
  FOUND: 'Found',
  NOT_FOUND: 'Not found',
  FOUND_ELSEWHERE: 'Found elsewhere',
  WRONG_STATUS: 'Wrong status',
  UNKNOWN_LABEL: 'Unknown label',
}

export type CountDecision = 'MARKED_MISSING' | 'MOVED_HERE' | 'IGNORED'

export const COUNT_DECISION_LABELS: Record<CountDecision, string> = {
  MARKED_MISSING: 'Marked missing',
  MOVED_HERE: 'Moved here',
  IGNORED: 'Ignored',
}

/** The choices a manager has for each kind of difference. */
export const COUNT_DECISIONS_FOR: Record<CountOutcome, CountDecision[]> = {
  FOUND: [],
  NOT_FOUND: ['MARKED_MISSING', 'IGNORED'],
  FOUND_ELSEWHERE: ['MOVED_HERE', 'IGNORED'],
  WRONG_STATUS: ['IGNORED'],
  UNKNOWN_LABEL: ['IGNORED'],
}

export interface StockCountSummary {
  id: string
  count_no: string
  company_id: string
  warehouse_id: string
  company_name: string | null
  warehouse_name: string | null
  location_code: string
  status: CountStatus
  started_at: string
  started_by_name: string | null
  submitted_at: string | null
  closed_at: string | null
  cancel_reason: string | null
  scanned: number
  differences: number
  undecided: number
}

export interface StockCountLine {
  id: string
  scanned_code: string | null
  tracking_unit_id: string | null
  stock_tracking_id: string | null
  item_code: string | null
  item_name: string | null
  size_label: string | null
  quantity: string | null
  unit: string | null
  scanned_at: string | null
  outcome: CountOutcome | null
  status_at_submit: string | null
  expected_location_code: string | null
  current_status: string | null
  current_location_code: string | null
  decision: CountDecision | null
  decided_by_name: string | null
  decided_at: string | null
  decision_note: string | null
}

export interface SyncProblem {
  id: string
  action: OfflineActionType
  scanned_at: string
  received_at: string
  refusal_reason: string
  actor_name: string | null
  company_name: string | null
  warehouse_name: string | null
  code: string | null
  tracking_unit_id: string | null
  stock_tracking_id: string | null
  reviewed_at: string | null
  reviewed_by_name: string | null
  review_note: string | null
}
