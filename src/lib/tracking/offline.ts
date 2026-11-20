// Offline scanning. The phone keeps a snapshot of one warehouse and saves
// scans while there is no signal; here they are applied in the order they
// were scanned, each through the same database rules as an online scan.
// Writes go only to the tracking_ tables.
import { actorCanAccess, actorScopeSql, type TrackingActor } from './access'
import { STOCK_TRACKING_ID_RE, QR_REFERENCE_RE, TRACKING_ROLES, UUID_RE } from './constants'
import { positionJson, resolveLocationId } from './floor'
import {
  DEVICE_ID_RE, MAX_SYNC_BATCH, OFFLINE_ACTION_TYPES,
  type OfflineAction, type OfflineActionType, type OfflineResult, type OfflineSnapshot, type SnapshotWarehouse, type SyncProblem,
} from './offlineShared'
import { assertCan, query, requireUuid, TrackingError, type Row } from './service'

// ── Snapshot ────────────────────────────────────────────────────────────────

/** Warehouses this person can see that have tracking switched on. */
export async function trackingWarehouses(actor: TrackingActor): Promise<SnapshotWarehouse[]> {
  const params: unknown[] = []
  const scope = actorScopeSql(actor, 'w.company_id', 'w.id', params)
  const rows = await query(
    `SELECT w.id::text, w.name, w.company_id::text, c.name AS company_name
       FROM warehouses w JOIN companies c ON c.id = w.company_id
      WHERE w.is_active IS NOT FALSE AND fn_tracking_is_enabled(w.company_id, w.id) AND ${scope}
      ORDER BY c.name, w.name`,
    params,
  )
  return rows as unknown as SnapshotWarehouse[]
}

/**
 * Everything the Offline Scan screen needs to check a scan for one warehouse
 * without a signal: its live bundles, locations, open pickups and dispatches,
 * and this person's open counts.
 */
export async function offlineSnapshot(actor: TrackingActor, warehouseInput: unknown): Promise<OfflineSnapshot> {
  assertCan(actor, 'operate')
  const warehouses = await trackingWarehouses(actor)
  const wanted = typeof warehouseInput === 'string' && UUID_RE.test(warehouseInput) ? warehouseInput : actor.warehouseId
  const warehouse = warehouses.find((w) => w.id === wanted) ?? (warehouses.length === 1 ? warehouses[0] : null)
  const [person] = await query(`SELECT full_name, now()::text AS server_time FROM user_profiles WHERE id = $1::uuid`, [actor.userId])
  const base: OfflineSnapshot = {
    user_id: actor.userId, user_name: person?.full_name ?? '', server_time: person?.server_time ?? new Date().toISOString(),
    warehouses, warehouse, gps: false, units: [], locations: [], pickups: [], dispatches: [], counts: [],
  }
  if (!warehouse) return base

  const [units, locations, pickups, dispatches, counts, gps] = await Promise.all([
    query(
      `SELECT u.id::text, u.stock_tracking_id, u.qr_reference, u.item_code, u.item_name, u.size_label, u.quantity::text, u.unit,
              u.lifecycle_status, l.code AS location_code, u.current_vendor_name
         FROM tracking_units u LEFT JOIN tracking_locations l ON l.id = u.current_location_id
        WHERE u.warehouse_id = $1::uuid AND u.status = 'ACTIVE' AND u.lifecycle_status NOT IN ('PICKED_UP', 'PROCESSED', 'SPLIT')
        ORDER BY u.stock_tracking_id
        LIMIT 20000`,
      [warehouse.id],
    ),
    query(
      `SELECT code, location_ref, name, location_type FROM tracking_locations
        WHERE warehouse_id = $1::uuid AND is_active ORDER BY code`,
      [warehouse.id],
    ),
    query(
      `SELECT id::text, pickup_no, customer_name FROM tracking_pickups
        WHERE warehouse_id = $1::uuid AND status = 'OPEN' AND vendor_id IS NULL ORDER BY created_at DESC LIMIT 200`,
      [warehouse.id],
    ),
    query(
      `SELECT id::text, dispatch_no, vendor_name FROM tracking_vendor_dispatches
        WHERE warehouse_id = $1::uuid AND status = 'OPEN' ORDER BY created_at DESC LIMIT 200`,
      [warehouse.id],
    ),
    query(
      `SELECT s.id::text, s.count_no, l.code AS location_code
         FROM tracking_stock_counts s JOIN tracking_locations l ON l.id = s.location_id
        WHERE s.warehouse_id = $1::uuid AND s.status = 'OPEN' AND s.started_by = $2::uuid ORDER BY s.started_at DESC`,
      [warehouse.id, actor.userId],
    ),
    query(`SELECT fn_tracking_gps_enabled($1::uuid) AS enabled`, [warehouse.company_id]),
  ])
  return {
    ...base,
    gps: gps[0]?.enabled === 't',
    units: units as unknown as OfflineSnapshot['units'],
    locations: locations as unknown as OfflineSnapshot['locations'],
    pickups: pickups as unknown as OfflineSnapshot['pickups'],
    dispatches: dispatches as unknown as OfflineSnapshot['dispatches'],
    counts: counts as unknown as OfflineSnapshot['counts'],
  }
}

// ── Sending saved scans ─────────────────────────────────────────────────────

interface UnitRef {
  id: string
  stock_tracking_id: string
  company_id: string
  warehouse_id: string
}

/** The bundle a code names, if this person can see it. Voided labels are found too, so the rules can say so. */
async function unitByCode(actor: TrackingActor, raw: unknown): Promise<UnitRef | null> {
  const code = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  const isQr = QR_REFERENCE_RE.test(code)
  if (!isQr && !STOCK_TRACKING_ID_RE.test(code)) return null
  const [row] = await query(
    `SELECT id::text, stock_tracking_id, company_id::text, warehouse_id::text FROM tracking_units WHERE ${isQr ? 'qr_reference' : 'stock_tracking_id'} = $1`,
    [code],
  )
  return row && actorCanAccess(actor, row.company_id, row.warehouse_id) ? (row as unknown as UnitRef) : null
}

async function unitHere(actor: TrackingActor, code: unknown, warehouseId: string): Promise<UnitRef> {
  const unit = await unitByCode(actor, code)
  const shown = typeof code === 'string' && code.trim() ? code.trim().toUpperCase() : 'This label'
  if (!unit) throw new TrackingError(`${shown} is not a tracked bundle you can see`)
  if (unit.warehouse_id !== warehouseId) throw new TrackingError(`Bundle ${unit.stock_tracking_id} is in a different warehouse`)
  return unit
}

async function recordInWarehouse(table: 'tracking_pickups' | 'tracking_vendor_dispatches' | 'tracking_stock_counts', id: unknown, warehouseId: string, label: string) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new TrackingError(`Choose a ${label}`)
  const [row] = await query(`SELECT warehouse_id::text FROM ${table} WHERE id = $1::uuid`, [id])
  if (!row) throw new TrackingError(`That ${label} was not found`)
  if (row.warehouse_id !== warehouseId) throw new TrackingError(`That ${label} is in a different warehouse`)
  return id
}

/** Turns the codes a phone scanned into the ids the database rules work on. Throws the refusal reason. */
async function resolveTarget(actor: TrackingActor, action: OfflineAction, company_id: string, warehouse_id: string): Promise<Record<string, unknown>> {
  const p = action.payload ?? {}
  const position = positionJson(p.position)
  const place = { company_id, warehouse_id }
  switch (action.action) {
    case 'PLACE': {
      const unit = await unitHere(actor, p.code, warehouse_id)
      const location_id = await resolveLocationId(actor, place, p.location)
      return { unit_id: unit.id, location_id, position: position ? JSON.parse(position) : null }
    }
    case 'ADD_TO_PICKUP': {
      const pickup_id = await recordInWarehouse('tracking_pickups', p.pickup_id, warehouse_id, 'pickup')
      return { unit_id: (await unitHere(actor, p.code, warehouse_id)).id, pickup_id }
    }
    case 'ADD_TO_DISPATCH': {
      const dispatch_id = await recordInWarehouse('tracking_vendor_dispatches', p.dispatch_id, warehouse_id, 'vendor dispatch')
      return { unit_id: (await unitHere(actor, p.code, warehouse_id)).id, dispatch_id }
    }
    case 'COUNT_START': {
      if (typeof p.count_id !== 'string' || !UUID_RE.test(p.count_id)) throw new TrackingError('This stock count could not be read')
      return { count_id: p.count_id, location_id: await resolveLocationId(actor, place, p.location) }
    }
    case 'COUNT_SCAN': {
      const count_id = await recordInWarehouse('tracking_stock_counts', p.count_id, warehouse_id, 'stock count')
      const code = typeof p.code === 'string' ? p.code.trim().toUpperCase() : ''
      if (!code) throw new TrackingError('Scan a label')
      // A label that is not a bundle of this warehouse is kept on the count as an unknown label.
      const unit = await unitByCode(actor, code)
      return { count_id, code, unit_id: unit && unit.warehouse_id === warehouse_id ? unit.id : null }
    }
    case 'COUNT_SUBMIT':
      return { count_id: await recordInWarehouse('tracking_stock_counts', p.count_id, warehouse_id, 'stock count') }
  }
}

function readAction(raw: unknown): OfflineAction | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  if (typeof a.id !== 'string' || !UUID_RE.test(a.id)) return null
  if (typeof a.action !== 'string' || !OFFLINE_ACTION_TYPES.includes(a.action as OfflineActionType)) return null
  if (typeof a.warehouse_id !== 'string' || !UUID_RE.test(a.warehouse_id)) return null
  if (typeof a.actor_id !== 'string' || !UUID_RE.test(a.actor_id)) return null
  if (typeof a.scanned_at !== 'string' || Number.isNaN(Date.parse(a.scanned_at))) return null
  const payload = a.payload && typeof a.payload === 'object' ? (a.payload as OfflineAction['payload']) : {}
  return { id: a.id, action: a.action as OfflineActionType, warehouse_id: a.warehouse_id, actor_id: a.actor_id, scanned_at: new Date(a.scanned_at).toISOString(), payload }
}

/**
 * Applies saved scans one at a time, in the order sent. Each is applied or
 * refused and recorded; a scan sent again returns its first result. Scans
 * saved by someone else are never sent under this person's sign-in.
 */
export async function syncOfflineActions(actor: TrackingActor, deviceId: unknown, rawActions: unknown): Promise<OfflineResult[]> {
  if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) throw new TrackingError('This phone could not be identified. Reload the screen')
  if (!Array.isArray(rawActions) || rawActions.length === 0) throw new TrackingError('Nothing to send')
  if (rawActions.length > MAX_SYNC_BATCH) throw new TrackingError(`Send at most ${MAX_SYNC_BATCH} scans at a time`)
  if (rawActions.some((raw) => raw && typeof raw === 'object' && (raw as { actor_id?: unknown }).actor_id !== actor.userId)) {
    throw new TrackingError('These scans were saved by another person. They are sent only while that person is signed in', 409)
  }

  const canOperate = TRACKING_ROLES.operate.has(actor.role)
  const results: OfflineResult[] = []
  for (const raw of rawActions) {
    const action = readAction(raw)
    const rawId = raw && typeof raw === 'object' ? String((raw as { id?: unknown }).id ?? '') : ''
    if (!action) {
      results.push({ id: rawId, outcome: 'REFUSED', reason: 'This scan could not be read', recorded: false })
      continue
    }
    const [warehouse] = await query(`SELECT company_id::text FROM warehouses WHERE id = $1::uuid`, [action.warehouse_id])
    if (!warehouse) {
      results.push({ id: action.id, outcome: 'REFUSED', reason: 'The warehouse for this scan no longer exists', recorded: false })
      continue
    }

    let refusal: string | null = null
    let target: Record<string, unknown> = {}
    if (!canOperate) refusal = 'You no longer have permission to scan'
    else if (!actorCanAccess(actor, warehouse.company_id, action.warehouse_id)) refusal = 'You no longer have access to this warehouse'
    else {
      try {
        target = await resolveTarget(actor, action, warehouse.company_id, action.warehouse_id)
      } catch (err) {
        if (!(err instanceof TrackingError)) throw err
        refusal = err.message
      }
    }

    const [row] = await query(
      `SELECT id::text, actor_id::text, outcome, refusal_reason
         FROM apply_tracking_offline_action($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6, $7::jsonb, $8::jsonb, $9::timestamptz, $10)`,
      [action.id, deviceId, actor.userId, warehouse.company_id, action.warehouse_id, action.action,
       JSON.stringify(action.payload), JSON.stringify(target), action.scanned_at, refusal],
    )
    if (row.actor_id !== actor.userId) {
      results.push({ id: action.id, outcome: 'REFUSED', reason: 'This scan was already recorded for another person', recorded: false })
      continue
    }
    results.push({ id: action.id, outcome: row.outcome as OfflineResult['outcome'], reason: row.refusal_reason ?? null, recorded: true })
  }
  return results
}

// ── Sync problems ───────────────────────────────────────────────────────────

const PROBLEM_COLUMNS = `a.id::text, a.action, a.scanned_at::text, a.received_at::text, a.refusal_reason,
  p.full_name AS actor_name, c.name AS company_name, w.name AS warehouse_name, a.payload ->> 'code' AS code,
  a.tracking_unit_id::text, u.stock_tracking_id, a.reviewed_at::text, r.full_name AS reviewed_by_name, a.review_note`

const PROBLEM_FROM = `tracking_offline_actions a
  LEFT JOIN user_profiles p ON p.id = a.actor_id
  LEFT JOIN user_profiles r ON r.id = a.reviewed_by
  LEFT JOIN companies c ON c.id = a.company_id
  LEFT JOIN warehouses w ON w.id = a.warehouse_id
  LEFT JOIN tracking_units u ON u.id = a.tracking_unit_id`

/** Refused offline scans, unreviewed first. */
export async function listSyncProblems(actor: TrackingActor, show: unknown): Promise<SyncProblem[]> {
  const params: unknown[] = []
  const conditions = [`a.outcome = 'REFUSED'`, actorScopeSql(actor, 'a.company_id', 'a.warehouse_id', params)]
  if (show !== 'all') conditions.push('a.reviewed_at IS NULL')
  const rows = await query(
    `SELECT ${PROBLEM_COLUMNS} FROM ${PROBLEM_FROM} WHERE ${conditions.join(' AND ')}
      ORDER BY a.reviewed_at IS NOT NULL, a.received_at DESC LIMIT 500`,
    params,
  )
  return rows as unknown as SyncProblem[]
}

export async function reviewSyncProblem(actor: TrackingActor, idInput: unknown, note: unknown): Promise<SyncProblem> {
  assertCan(actor, 'manage')
  const id = requireUuid(idInput, 'Offline scan')
  const [found] = await query(`SELECT company_id::text, warehouse_id::text FROM tracking_offline_actions WHERE id = $1::uuid`, [id])
  if (!found || !actorCanAccess(actor, found.company_id, found.warehouse_id)) throw new TrackingError('Offline scan not found', 404)
  await query(`SELECT id FROM review_tracking_offline_action($1::uuid, $2, $3::uuid)`, [id, typeof note === 'string' ? note : null, actor.userId])
  const [row] = await query(`SELECT ${PROBLEM_COLUMNS} FROM ${PROBLEM_FROM} WHERE a.id = $1::uuid`, [id])
  return row as unknown as SyncProblem
}

/** Refused, unreviewed offline scans in this person's scope. */
export async function openSyncProblemCount(actor: TrackingActor): Promise<number> {
  const params: unknown[] = []
  const scope = actorScopeSql(actor, 'company_id', 'warehouse_id', params)
  const [row] = await query(
    `SELECT count(*)::int AS n FROM tracking_offline_actions WHERE outcome = 'REFUSED' AND reviewed_at IS NULL AND ${scope}`,
    params,
  )
  return Number((row as Row | undefined)?.n ?? 0)
}
