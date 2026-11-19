// Locations, bundle statuses, splitting and labelling existing stock. Writes go
// only to the tracking_ tables, through database functions that each save
// completely or not at all. Existing tables are read and never changed.
import { actorCanAccess, actorScopeSql, type TrackingActor } from './access'
import {
  LOCATION_CODE_RE, LOCATION_REF_RE, MAX_BUNDLES, QR_REFERENCE_RE, STOCK_TRACKING_ID_RE,
  type LocationType, type ScanPosition, type TrackingLocation, type TrackingUnit, type VerifiableLine,
} from './constants'
import {
  activeTemplate, assertCan, likePattern, printableLabel, printerInScope, query, requireUuid, toUnit, TrackingError,
  UNIT_COLUMNS, UNIT_FROM, unitInScope, type PrintRequestResult, type Row,
} from './service'
import { buildLabelZpl, labelFieldsForLocation } from './zpl'

const LOCATION_TYPES: readonly LocationType[] = ['STORAGE', 'PICKUP_BAY', 'HOLD']

/** A position that can't be read is dropped, because GPS must never stop a scan. */
export function positionJson(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const { latitude, longitude, accuracy_m: accuracy } = value as Partial<ScanPosition>
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return JSON.stringify({ latitude, longitude, accuracy_m: typeof accuracy === 'number' && Number.isFinite(accuracy) ? accuracy : null })
}

// ── Locations ───────────────────────────────────────────────────────────────

const LOCATION_COLUMNS = `l.id::text, l.location_ref, l.company_id::text, l.warehouse_id::text, w.name AS warehouse_name,
  l.code, l.name, l.location_type, l.is_active,
  (SELECT count(*)::int FROM tracking_units u WHERE u.current_location_id = l.id AND u.status = 'ACTIVE') AS bundle_count`

function toLocation(row: Row): TrackingLocation {
  return { ...row, is_active: row.is_active === 't', bundle_count: Number(row.bundle_count) } as unknown as TrackingLocation
}

export async function listLocations(actor: TrackingActor, warehouseId?: string | null): Promise<TrackingLocation[]> {
  const params: unknown[] = []
  const conditions = [actorScopeSql(actor, 'l.company_id', 'l.warehouse_id', params)]
  if (warehouseId) {
    params.push(requireUuid(warehouseId, 'Warehouse'))
    conditions.push(`l.warehouse_id = $${params.length}::uuid`)
  }
  const rows = await query(
    `SELECT ${LOCATION_COLUMNS}
       FROM tracking_locations l LEFT JOIN warehouses w ON w.id = l.warehouse_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY w.name, l.code
      LIMIT 1000`,
    params,
  )
  return rows.map(toLocation)
}

async function locationInScope(actor: TrackingActor, locationId: unknown): Promise<TrackingLocation> {
  const rows = await query(
    `SELECT ${LOCATION_COLUMNS} FROM tracking_locations l LEFT JOIN warehouses w ON w.id = l.warehouse_id WHERE l.id = $1::uuid`,
    [requireUuid(locationId, 'Location')],
  )
  const location = rows[0] ? toLocation(rows[0]) : null
  if (!location || !actorCanAccess(actor, location.company_id, location.warehouse_id)) throw new TrackingError('Location not found', 404)
  return location
}

export interface LocationInput {
  company_id?: unknown
  warehouse_id?: unknown
  code?: unknown
  name?: unknown
  location_type?: unknown
}

export async function createLocation(actor: TrackingActor, input: LocationInput): Promise<TrackingLocation> {
  assertCan(actor, 'manage')
  const companyId = requireUuid(input.company_id, 'Company')
  const warehouseId = requireUuid(input.warehouse_id, 'Warehouse')
  if (!actorCanAccess(actor, companyId, warehouseId)) throw new TrackingError('Warehouse not found', 404)
  const [warehouse] = await query(`SELECT 1 AS ok FROM warehouses WHERE id = $1::uuid AND company_id = $2::uuid`, [warehouseId, companyId])
  if (!warehouse) throw new TrackingError('That warehouse does not belong to this company')

  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : ''
  if (!LOCATION_CODE_RE.test(code)) throw new TrackingError('Use up to 24 letters, numbers and dashes for the code, for example A-03-2')
  const type = (input.location_type ?? 'STORAGE') as LocationType
  if (!LOCATION_TYPES.includes(type)) throw new TrackingError('Choose a location type')
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : null

  const [existing] = await query(`SELECT 1 AS ok FROM tracking_locations WHERE warehouse_id = $1::uuid AND code = $2`, [warehouseId, code])
  if (existing) throw new TrackingError(`Location ${code} already exists in this warehouse`, 409)

  const [row] = await query(
    `INSERT INTO tracking_locations (location_ref, company_id, warehouse_id, code, name, location_type, created_by)
     VALUES ('WL1-' || substr(fn_tracking_new_qr_reference(), 5), $1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
     RETURNING id::text`,
    [companyId, warehouseId, code, name, type, actor.userId],
  )
  return locationInScope(actor, row.id)
}

export async function setLocationActive(actor: TrackingActor, locationId: unknown, active: unknown): Promise<TrackingLocation> {
  assertCan(actor, 'manage')
  if (typeof active !== 'boolean') throw new TrackingError('Choose active or inactive')
  const location = await locationInScope(actor, locationId)
  await query(`SELECT id FROM set_tracking_location_active($1::uuid, $2::boolean)`, [location.id, active])
  return locationInScope(actor, location.id)
}

export async function requestLocationPrint(actor: TrackingActor, locationId: unknown, printerId: unknown): Promise<PrintRequestResult> {
  assertCan(actor, 'manage')
  const location = await locationInScope(actor, locationId)
  const printer = await printerInScope(actor, printerId)
  const template = await activeTemplate('LOCATION')
  const [job] = await query(
    `SELECT id::text, job_type FROM request_tracking_location_print($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
    [location.id, printer.id, template.id, actor.userId],
  )
  const fields = labelFieldsForLocation(location)
  return { jobId: job.id, jobType: job.job_type, zpl: buildLabelZpl(template, printer, fields), label: printableLabel('location', printer, fields) }
}

/** Accepts a scanned location label, or a code typed by hand. */
async function resolveLocationId(actor: TrackingActor, unit: { company_id: string; warehouse_id: string }, raw: unknown): Promise<string> {
  const text = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  if (!text) throw new TrackingError('Scan a location')
  const byRef = LOCATION_REF_RE.test(text)
  const rows = await query(
    `SELECT id::text, company_id::text, warehouse_id::text, code FROM tracking_locations
      WHERE ${byRef ? 'location_ref = $1' : 'code = $1 AND warehouse_id = $2::uuid'}`,
    byRef ? [text] : [text, unit.warehouse_id],
  )
  const location = rows[0]
  if (!location || !actorCanAccess(actor, location.company_id, location.warehouse_id)) {
    throw new TrackingError(`No location ${text} was found in this warehouse`, 404)
  }
  if (location.warehouse_id !== unit.warehouse_id) throw new TrackingError(`Location ${location.code} is in a different warehouse`, 409)
  return location.id
}

// ── Bundle status ───────────────────────────────────────────────────────────

/** Puts a labelled bundle away, or moves one already in stock. */
export async function placeUnit(actor: TrackingActor, unitId: string, locationInput: unknown, position?: unknown): Promise<TrackingUnit> {
  assertCan(actor, 'operate')
  const unit = await unitInScope(actor, unitId)
  const locationId = await resolveLocationId(actor, unit, locationInput)
  await query(`SELECT id FROM place_tracking_unit($1::uuid, $2::uuid, $3::jsonb, $4::uuid)`, [unit.id, locationId, positionJson(position), actor.userId])
  return unitInScope(actor, unit.id)
}

const MANUAL_STATUSES = new Set(['IN_STOCK', 'ON_HOLD', 'MISSING', 'LEFT_WAREHOUSE'])

/** Hold, release, missing, found, left warehouse, back in, and customer return. */
export async function changeUnitStatus(
  actor: TrackingActor, unitId: string, to: unknown, input: { location?: unknown; reason?: unknown; position?: unknown },
): Promise<TrackingUnit> {
  assertCan(actor, 'manage')
  if (typeof to !== 'string' || !MANUAL_STATUSES.has(to)) throw new TrackingError('Choose a status')
  const unit = await unitInScope(actor, unitId)
  const hasLocation = typeof input.location === 'string' && input.location.trim() !== ''
  const locationId = hasLocation ? await resolveLocationId(actor, unit, input.location) : null
  await query(
    `SELECT id FROM set_tracking_unit_status($1::uuid, $2, $3::uuid, $4, $5::jsonb, $6::uuid)`,
    [unit.id, to, locationId, typeof input.reason === 'string' ? input.reason : null, positionJson(input.position), actor.userId],
  )
  return unitInScope(actor, unit.id)
}

export async function splitUnit(actor: TrackingActor, unitId: string, parts: unknown, reason: unknown): Promise<TrackingUnit[]> {
  assertCan(actor, 'manage')
  if (!Array.isArray(parts)) throw new TrackingError('Enter the weight of each part')
  const unit = await unitInScope(actor, unitId)
  const created = await query(
    `SELECT id::text FROM split_tracking_unit($1::uuid, $2::jsonb, $3, $4::uuid)`,
    [unit.id, JSON.stringify(parts), typeof reason === 'string' ? reason : null, actor.userId],
  )
  const rows = await query(`SELECT ${UNIT_COLUMNS} FROM ${UNIT_FROM} WHERE u.id = ANY($1::uuid[]) ORDER BY u.part_no`, [created.map((row) => row.id)])
  return rows.map(toUnit)
}

/** The bundle a scanned label or typed tracking ID refers to, or null if the code isn't one. */
export async function findUnitByCode(actor: TrackingActor, rawCode: unknown): Promise<TrackingUnit | null> {
  const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : ''
  const isQr = QR_REFERENCE_RE.test(code)
  if (!isQr && !STOCK_TRACKING_ID_RE.test(code)) return null
  const rows = await query(`SELECT ${UNIT_COLUMNS} FROM ${UNIT_FROM} WHERE ${isQr ? 'u.qr_reference' : 'u.stock_tracking_id'} = $1`, [code])
  const unit = rows[0] ? toUnit(rows[0]) : null
  return unit && actorCanAccess(actor, unit.company_id, unit.warehouse_id) ? unit : null
}

export async function unitParts(actor: TrackingActor, unitId: string): Promise<TrackingUnit[]> {
  const unit = await unitInScope(actor, unitId)
  const rows = await query(`SELECT ${UNIT_COLUMNS} FROM ${UNIT_FROM} WHERE u.parent_unit_id = $1::uuid ORDER BY u.part_no`, [unit.id])
  return rows.map(toUnit)
}

// ── Labelling existing stock ────────────────────────────────────────────────

/**
 * Old purchase lines, one row for each company and warehouse the ledger holds
 * stock in. Lines the books show as empty still appear when searched for,
 * because material can be on the floor before the books have caught up.
 */
export async function listVerifiableLines(actor: TrackingActor, search = ''): Promise<VerifiableLine[]> {
  assertCan(actor, 'manage')
  const params: unknown[] = []
  const scope = actorScopeSql(actor, 'x.company_id', 'x.warehouse_id', params)
  let filter = `AND x.book_quantity > 0`
  if (search.trim()) {
    params.push(likePattern(search.trim()))
    const p = `$${params.length}`
    filter = `AND (x.purchase_line_id ILIKE ${p} OR x.bill_number ILIKE ${p} OR x.item_code ILIKE ${p} OR x.item_name ILIKE ${p})`
  }
  const rows = await query(
    `WITH balances AS (
       SELECT purchase_line_id, company_id, warehouse_id, SUM(quantity) AS quantity, MAX(entry_date) AS as_of
         FROM stock_ledger WHERE purchase_line_id IS NOT NULL
        GROUP BY purchase_line_id, company_id, warehouse_id
     ), x AS (
       SELECT i.purchase_line_id, i.unit, i.size_label, i.created_at, b.bill_number, b.bill_date,
              im.item_code, COALESCE(i.item_name, im.item_name) AS item_name,
              COALESCE(s.company_id, b.company_id) AS company_id,
              COALESCE(s.warehouse_id, b.warehouse_id) AS warehouse_id,
              COALESCE(s.quantity, 0) AS book_quantity, s.as_of
         FROM purchase_bill_items i
         JOIN purchase_bills b ON b.id = i.bill_id AND b.status = 'active'
         LEFT JOIN item_master im ON im.id = i.item_master_id
         LEFT JOIN balances s ON s.purchase_line_id = i.purchase_line_id
     )
     SELECT x.purchase_line_id, x.item_code, x.item_name, x.size_label, x.unit, x.bill_number, x.bill_date::text,
            x.company_id::text, x.warehouse_id::text, c.name AS company_name, w.name AS warehouse_name,
            x.book_quantity::text, x.as_of::text AS book_as_of,
            (SELECT COALESCE(SUM(t.quantity), 0)::text FROM tracking_units t
              WHERE t.purchase_line_id = x.purchase_line_id AND t.company_id = x.company_id AND t.warehouse_id = x.warehouse_id
                AND t.status = 'ACTIVE' AND t.lifecycle_status <> 'SPLIT') AS labelled_quantity
       FROM x
       JOIN companies c ON c.id = x.company_id
       JOIN warehouses w ON w.id = x.warehouse_id
      WHERE fn_tracking_is_enabled(x.company_id, x.warehouse_id)
        AND NOT fn_tracking_line_is_new(x.created_at, x.bill_date, x.company_id, x.warehouse_id)
        AND ${scope} ${filter}
      ORDER BY x.book_quantity DESC, x.purchase_line_id
      LIMIT 100`,
    params,
  )
  return rows as unknown as VerifiableLine[]
}

export interface VerifyInput {
  purchase_line_id?: unknown
  company_id?: unknown
  warehouse_id?: unknown
  bundles?: unknown
  note?: unknown
}

export async function verifyExistingStock(actor: TrackingActor, input: VerifyInput): Promise<TrackingUnit[]> {
  assertCan(actor, 'manage')
  if (typeof input.purchase_line_id !== 'string' || !input.purchase_line_id.trim()) throw new TrackingError('Choose a purchase line')
  const companyId = requireUuid(input.company_id, 'Company')
  const warehouseId = requireUuid(input.warehouse_id, 'Warehouse')
  if (!actorCanAccess(actor, companyId, warehouseId)) throw new TrackingError('Warehouse not found', 404)
  if (!Array.isArray(input.bundles) || input.bundles.length === 0 || input.bundles.length > MAX_BUNDLES) {
    throw new TrackingError(`Enter the weight of 1 to ${MAX_BUNDLES} bundles`)
  }
  const created = await query(
    `SELECT id::text FROM create_verified_tracking_units($1, $2::uuid, $3::uuid, $4::jsonb, $5, $6::uuid)`,
    [input.purchase_line_id.trim(), companyId, warehouseId, JSON.stringify(input.bundles), typeof input.note === 'string' ? input.note : null, actor.userId],
  )
  const rows = await query(`SELECT ${UNIT_COLUMNS} FROM ${UNIT_FROM} WHERE u.id = ANY($1::uuid[]) ORDER BY u.bundle_no`, [created.map((row) => row.id)])
  return rows.map(toUnit)
}

// ── GPS clean-up ────────────────────────────────────────────────────────────

/** Deletes positions older than 90 days. The events they belonged to are permanent and stay. */
export async function purgeExpiredPositions(): Promise<number> {
  const [row] = await query(`SELECT purge_tracking_positions(90) AS removed`)
  return Number(row?.removed ?? 0)
}
