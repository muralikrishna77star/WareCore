// Customer pickups. A pickup can be finished before its sale is entered, so the
// sale link is optional and differences appear as warnings. Sales are read and
// never changed.
import { actorCanAccess, actorScopeSql, type TrackingActor } from './access'
import { type PickupLine, type PickupSummary } from './constants'
import { findUnitByCode, positionJson } from './floor'
import { assertCan, likePattern, query, requireUuid, TrackingError } from './service'
import { normalizePhone, pickupMessageText } from './whatsapp'

const LIVE_LINE = `pl.removed_at IS NULL AND pl.returned_at IS NULL`

const PICKUP_COLUMNS = `p.id::text, p.pickup_no, p.company_id::text, p.warehouse_id::text, c.name AS company_name,
  w.name AS warehouse_name, p.status, p.customer_id::text, p.customer_name, p.customer_phone,
  p.dispatch_order_id::text, p.invoice_number, p.collector_name, p.collector_phone, p.vehicle_number,
  p.handed_over_at::text, p.cancel_reason, p.created_at::text,
  (SELECT count(*)::int FROM tracking_pickup_units pl WHERE pl.pickup_id = p.id AND ${LIVE_LINE}) AS bundle_count,
  (SELECT COALESCE(SUM(pl.quantity), 0)::text FROM tracking_pickup_units pl WHERE pl.pickup_id = p.id AND ${LIVE_LINE}) AS total_quantity,
  (SELECT MIN(u.unit) FROM tracking_pickup_units pl JOIN tracking_units u ON u.id = pl.tracking_unit_id
    WHERE pl.pickup_id = p.id AND ${LIVE_LINE}) AS unit`

const PICKUP_FROM = `tracking_pickups p
  LEFT JOIN companies c ON c.id = p.company_id
  LEFT JOIN warehouses w ON w.id = p.warehouse_id`

function toPickup(row: Record<string, string>): PickupSummary {
  return { ...row, bundle_count: Number(row.bundle_count) } as unknown as PickupSummary
}

async function pickupInScope(actor: TrackingActor, pickupId: unknown): Promise<PickupSummary> {
  const rows = await query(`SELECT ${PICKUP_COLUMNS} FROM ${PICKUP_FROM} WHERE p.id = $1::uuid`, [requireUuid(pickupId, 'Pickup')])
  const pickup = rows[0] ? toPickup(rows[0]) : null
  if (!pickup || !actorCanAccess(actor, pickup.company_id, pickup.warehouse_id)) throw new TrackingError('Pickup not found', 404)
  return pickup
}

export async function listPickups(actor: TrackingActor, options: { search?: string; status?: string } = {}): Promise<PickupSummary[]> {
  const params: unknown[] = []
  const conditions = [actorScopeSql(actor, 'p.company_id', 'p.warehouse_id', params)]
  if (options.status && ['OPEN', 'READY', 'HANDED_OVER', 'CANCELLED'].includes(options.status)) {
    params.push(options.status)
    conditions.push(`p.status = $${params.length}`)
  }
  if (options.search?.trim()) {
    params.push(likePattern(options.search.trim()))
    const p = `$${params.length}`
    conditions.push(`(p.pickup_no ILIKE ${p} OR p.customer_name ILIKE ${p} OR p.invoice_number ILIKE ${p} OR p.vehicle_number ILIKE ${p})`)
  }
  const rows = await query(`SELECT ${PICKUP_COLUMNS} FROM ${PICKUP_FROM} WHERE ${conditions.join(' AND ')} ORDER BY p.created_at DESC LIMIT 200`, params)
  return rows.map(toPickup)
}

/** Customers and the warehouses this person can start a pickup in. */
export async function pickupOptions(actor: TrackingActor) {
  const params: unknown[] = []
  const scope = actorScopeSql(actor, 'w.company_id', 'w.id', params)
  const [customers, warehouses] = await Promise.all([
    query(`SELECT id::text, name FROM customers WHERE is_active ORDER BY name LIMIT 2000`),
    query(
      `SELECT w.id::text, w.name, w.company_id::text, c.name AS company_name
         FROM warehouses w JOIN companies c ON c.id = w.company_id
        WHERE w.is_active AND fn_tracking_is_enabled(w.company_id, w.id) AND ${scope}
        ORDER BY c.name, w.name`,
      params,
    ),
  ])
  return { customers, warehouses }
}

export async function createPickup(actor: TrackingActor, input: { company_id?: unknown; warehouse_id?: unknown; customer_id?: unknown }): Promise<PickupSummary> {
  assertCan(actor, 'pickup')
  const companyId = requireUuid(input.company_id, 'Company')
  const warehouseId = requireUuid(input.warehouse_id, 'Warehouse')
  const customerId = requireUuid(input.customer_id, 'Customer')
  if (!actorCanAccess(actor, companyId, warehouseId)) throw new TrackingError('Warehouse not found', 404)
  const [row] = await query(`SELECT id::text FROM create_tracking_pickup($1::uuid, $2::uuid, $3::uuid, $4::uuid)`, [companyId, warehouseId, customerId, actor.userId])
  return pickupInScope(actor, row.id)
}

async function pickupLines(pickupId: string): Promise<PickupLine[]> {
  const rows = await query(
    `SELECT u.id::text AS unit_id, u.stock_tracking_id, u.item_code, u.item_name, u.size_label, u.purchase_line_id,
            pl.quantity::text, u.unit, u.lifecycle_status, l.code AS location_code, pl.sale_line_id, pl.mismatch_reason,
            pl.returned_at::text
       FROM tracking_pickup_units pl
       JOIN tracking_units u ON u.id = pl.tracking_unit_id
       LEFT JOIN tracking_locations l ON l.id = u.current_location_id
      WHERE pl.pickup_id = $1::uuid AND pl.removed_at IS NULL
      ORDER BY pl.created_at`,
    [pickupId],
  )
  return rows as unknown as PickupLine[]
}

/** Compares a pickup with its linked sale. Reports differences and changes nothing. */
export async function pickupWarnings(pickup: PickupSummary, lines: PickupLine[]): Promise<string[]> {
  const warnings: string[] = []
  if (pickup.status === 'CANCELLED') return warnings

  if (!pickup.dispatch_order_id) {
    if (pickup.status === 'HANDED_OVER') warnings.push('No sale is linked to this pickup yet')
    return warnings
  }

  const [sale] = await query(
    `SELECT o.status, o.invoice_number,
            (SELECT COALESCE(SUM(d.quantity), 0)::text FROM dispatch_items d WHERE d.dispatch_order_id = o.id) AS quantity
       FROM dispatch_orders o WHERE o.id = $1::uuid`,
    [pickup.dispatch_order_id],
  )
  if (!sale) {
    warnings.push(`Sale ${pickup.invoice_number ?? ''} no longer exists`.replace('  ', ' '))
    return warnings
  }
  if (sale.status === 'cancelled') warnings.push(`Sale ${sale.invoice_number} was cancelled`)

  const live = lines.filter((line) => !line.returned_at)
  const total = live.reduce((sum, line) => sum + Math.round(Number(line.quantity) * 1000), 0)
  if (live.length && total !== Math.round(Number(sale.quantity) * 1000)) {
    warnings.push(`Pickup weight is ${(total / 1000).toFixed(3)}, but sale ${sale.invoice_number} is ${Number(sale.quantity).toFixed(3)}`)
  }
  for (const line of live) {
    if (!line.sale_line_id) warnings.push(`Bundle ${line.stock_tracking_id} does not match any line on sale ${sale.invoice_number}`)
  }
  return warnings
}

export async function getPickupDetail(actor: TrackingActor, pickupId: string) {
  const pickup = await pickupInScope(actor, pickupId)
  const [lines, events] = await Promise.all([
    pickupLines(pickup.id),
    query(
      `SELECT e.id::text, e.event_type, e.details::text, e.occurred_at::text, p.full_name AS actor_name
         FROM tracking_pickup_events e LEFT JOIN user_profiles p ON p.id = e.actor_id
        WHERE e.pickup_id = $1::uuid ORDER BY e.occurred_at DESC LIMIT 300`,
      [pickup.id],
    ),
  ])
  const message = pickupMessageText({
    pickup_no: pickup.pickup_no,
    company_name: pickup.company_name ?? '',
    warehouse_name: pickup.warehouse_name ?? '',
    customer_name: pickup.customer_name,
    bundle_count: pickup.bundle_count,
    total_quantity: pickup.total_quantity,
    unit: pickup.unit,
    ready: pickup.status === 'READY',
  })
  return { pickup, lines, events, warnings: await pickupWarnings(pickup, lines), message }
}

/** Active sales for this pickup's customer, to link once the sale has been entered. */
export async function listLinkableSales(actor: TrackingActor, pickupId: string, search = '') {
  const pickup = await pickupInScope(actor, pickupId)
  const params: unknown[] = [pickup.company_id, pickup.warehouse_id, pickup.customer_id]
  let filter = ''
  if (search.trim()) {
    params.push(likePattern(search.trim()))
    filter = `AND o.invoice_number ILIKE $${params.length}`
  }
  return query(
    `SELECT o.id::text, o.invoice_number, o.dispatch_date::text,
            (SELECT COALESCE(SUM(d.quantity), 0)::text FROM dispatch_items d WHERE d.dispatch_order_id = o.id) AS quantity
       FROM dispatch_orders o
      WHERE o.status = 'active' AND o.company_id = $1::uuid AND o.warehouse_id = $2::uuid AND o.customer_id = $3::uuid ${filter}
      ORDER BY o.dispatch_date DESC, o.invoice_number DESC
      LIMIT 30`,
    params,
  )
}

export type PickupAddResult = { needsReason: true; message: string } | { needsReason: false; pickup: PickupSummary }

/** Adds a scanned bundle. A bundle that doesn't match the linked sale needs a reason first. */
export async function addPickupUnit(actor: TrackingActor, pickupId: string, code: unknown, reason: unknown): Promise<PickupAddResult> {
  assertCan(actor, 'operate')
  const pickup = await pickupInScope(actor, pickupId)
  const unit = await findUnitByCode(actor, code)
  if (!unit) throw new TrackingError('No bundle has this code', 404)
  try {
    await query(
      `SELECT id FROM add_tracking_pickup_unit($1::uuid, $2::uuid, $3, $4::uuid)`,
      [pickup.id, unit.id, typeof reason === 'string' ? reason : null, actor.userId],
    )
  } catch (err) {
    if ((err as { code?: string }).code === 'WC003') return { needsReason: true, message: (err as Error).message }
    throw err
  }
  return { needsReason: false, pickup: await pickupInScope(actor, pickup.id) }
}

export async function removePickupUnit(actor: TrackingActor, pickupId: string, unitId: unknown, reason: unknown): Promise<PickupSummary> {
  assertCan(actor, 'operate')
  const pickup = await pickupInScope(actor, pickupId)
  await query(
    `SELECT id FROM remove_tracking_pickup_unit($1::uuid, $2::uuid, $3, $4::uuid)`,
    [pickup.id, requireUuid(unitId, 'Bundle'), typeof reason === 'string' ? reason : null, actor.userId],
  )
  return pickupInScope(actor, pickup.id)
}

export async function markPickupReady(actor: TrackingActor, pickupId: string, bayCode: unknown): Promise<PickupSummary> {
  assertCan(actor, 'operate')
  const pickup = await pickupInScope(actor, pickupId)
  let bayId: string | null = null
  const text = typeof bayCode === 'string' ? bayCode.trim().toUpperCase() : ''
  if (text) {
    const [bay] = await query(
      `SELECT id::text FROM tracking_locations WHERE warehouse_id = $1::uuid AND (code = $2 OR location_ref = $2)`,
      [pickup.warehouse_id, text],
    )
    if (!bay) throw new TrackingError(`No location ${text} was found in this warehouse`, 404)
    bayId = bay.id
  }
  await query(`SELECT id FROM mark_tracking_pickup_ready($1::uuid, $2::uuid, $3::uuid)`, [pickup.id, bayId, actor.userId])
  return pickupInScope(actor, pickup.id)
}

export async function handOverPickup(
  actor: TrackingActor, pickupId: string,
  input: { collector_name?: unknown; collector_phone?: unknown; vehicle_number?: unknown; position?: unknown },
): Promise<PickupSummary> {
  assertCan(actor, 'operate')
  const pickup = await pickupInScope(actor, pickupId)
  const rawPhone = typeof input.collector_phone === 'string' ? input.collector_phone.trim() : ''
  const phone = rawPhone ? normalizePhone(rawPhone) : null
  if (rawPhone && !phone) throw new TrackingError('Enter a valid phone number for the collector')
  await query(
    `SELECT id FROM hand_over_tracking_pickup($1::uuid, $2, $3, $4, $5::jsonb, $6::uuid)`,
    [
      pickup.id,
      typeof input.collector_name === 'string' ? input.collector_name : null,
      phone,
      typeof input.vehicle_number === 'string' ? input.vehicle_number : null,
      positionJson(input.position),
      actor.userId,
    ],
  )
  return pickupInScope(actor, pickup.id)
}

export async function cancelPickup(actor: TrackingActor, pickupId: string, reason: unknown): Promise<PickupSummary> {
  assertCan(actor, 'manage')
  const pickup = await pickupInScope(actor, pickupId)
  await query(`SELECT id FROM cancel_tracking_pickup($1::uuid, $2, $3::uuid)`, [pickup.id, typeof reason === 'string' ? reason : null, actor.userId])
  return pickupInScope(actor, pickup.id)
}

/** saleId null removes the link. */
export async function linkPickupSale(actor: TrackingActor, pickupId: string, saleId: unknown): Promise<PickupSummary> {
  assertCan(actor, 'pickup')
  const pickup = await pickupInScope(actor, pickupId)
  const sale = saleId === null || saleId === '' || saleId === undefined ? null : requireUuid(saleId, 'Sale')
  await query(`SELECT id FROM link_tracking_pickup_sale($1::uuid, $2::uuid, $3::uuid)`, [pickup.id, sale, actor.userId])
  return pickupInScope(actor, pickup.id)
}

/** Records that staff opened WhatsApp for this pickup. Whether they pressed send can't be known. */
export async function recordPickupShare(actor: TrackingActor, pickupId: string, phoneInput: unknown): Promise<PickupSummary> {
  assertCan(actor, 'pickup')
  const pickup = await pickupInScope(actor, pickupId)
  const phone = normalizePhone(phoneInput)
  if (!phone) throw new TrackingError('Enter a valid WhatsApp number')
  await query(`SELECT id FROM record_tracking_pickup_share($1::uuid, $2, $3::uuid)`, [pickup.id, phone, actor.userId])
  return pickupInScope(actor, pickup.id)
}
