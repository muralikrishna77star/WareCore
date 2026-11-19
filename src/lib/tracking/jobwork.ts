// Job work tracking (Phase 4): vendor dispatches, bundles back unprocessed,
// moves between vendors, output receipts with made-from links, vendor stock and
// each bundle's family tree. Writes go only to the tracking_ tables, through
// database functions that each save completely or not at all. Job work
// orders, transfers, output lines and suppliers are read and never changed.
import { actorCanAccess, actorScopeSql, type TrackingActor } from './access'
import {
  MAX_BUNDLES,
  type DispatchLine, type LineageNode, type OutputReceipt, type TrackingUnit, type UnitOrigin, type VendorDispatch, type VendorMove,
} from './constants'
import { findUnitByCode, positionJson, resolveLocationId } from './floor'
import { assertCan, likePattern, query, requireUuid, toUnit, TrackingError, UNIT_COLUMNS, UNIT_FROM, unitInScope, type Row } from './service'

const thousandths = (value: string | number) => Math.round(Number(value) * 1000)
const fixed = (value: number) => (value / 1000).toFixed(3)

/** Warehouses this person can work in, and the vendors job work can go to. */
export async function jobWorkOptions(actor: TrackingActor) {
  const params: unknown[] = []
  const scope = actorScopeSql(actor, 'w.company_id', 'w.id', params)
  const [warehouses, vendors] = await Promise.all([
    query(
      `SELECT w.id::text, w.name, w.company_id::text, c.name AS company_name
         FROM warehouses w JOIN companies c ON c.id = w.company_id
        WHERE w.is_active AND fn_tracking_is_enabled(w.company_id, w.id) AND ${scope}
        ORDER BY c.name, w.name`,
      params,
    ),
    // Vendors already used for job work come first.
    query(
      `SELECT s.id::text, s.name,
              EXISTS (SELECT 1 FROM job_work_orders o WHERE o.vendor_id = s.id) AS used_for_job_work
         FROM suppliers s
        WHERE COALESCE(s.is_active, true)
        ORDER BY used_for_job_work DESC, s.name
        LIMIT 2000`,
    ),
  ])
  return { warehouses, vendors: vendors.map((v) => ({ id: v.id, name: v.name, used_for_job_work: v.used_for_job_work === 't' })) }
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function optionalUuid(value: unknown, label: string): string | null {
  return value === null || value === undefined || value === '' ? null : requireUuid(value, label)
}

function dateText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TrackingError(`Enter the ${label}`)
  return value
}

// ── Vendor dispatches ───────────────────────────────────────────────────────

const LIVE_DISPATCH_LINE = `dl.removed_at IS NULL`

const DISPATCH_COLUMNS = `d.id::text, d.dispatch_no, d.company_id::text, d.warehouse_id::text, c.name AS company_name,
  w.name AS warehouse_name, d.vendor_id::text, d.vendor_name, d.vehicle_number, d.note, d.status, d.sent_at::text,
  d.job_work_order_id::text, d.job_work_reference, d.cancel_reason, d.created_at::text,
  (SELECT count(*)::int FROM tracking_vendor_dispatch_units dl WHERE dl.dispatch_id = d.id AND ${LIVE_DISPATCH_LINE}) AS bundle_count,
  (SELECT COALESCE(SUM(dl.quantity), 0)::text FROM tracking_vendor_dispatch_units dl WHERE dl.dispatch_id = d.id AND ${LIVE_DISPATCH_LINE}) AS total_quantity,
  (SELECT MIN(u.unit) FROM tracking_vendor_dispatch_units dl JOIN tracking_units u ON u.id = dl.tracking_unit_id
    WHERE dl.dispatch_id = d.id AND ${LIVE_DISPATCH_LINE}) AS unit`

const DISPATCH_FROM = `tracking_vendor_dispatches d
  LEFT JOIN companies c ON c.id = d.company_id
  LEFT JOIN warehouses w ON w.id = d.warehouse_id`

function toDispatch(row: Row): VendorDispatch {
  return { ...row, bundle_count: Number(row.bundle_count) } as unknown as VendorDispatch
}

async function dispatchInScope(actor: TrackingActor, dispatchId: unknown): Promise<VendorDispatch> {
  const rows = await query(`SELECT ${DISPATCH_COLUMNS} FROM ${DISPATCH_FROM} WHERE d.id = $1::uuid`, [requireUuid(dispatchId, 'Dispatch')])
  const dispatch = rows[0] ? toDispatch(rows[0]) : null
  if (!dispatch || !actorCanAccess(actor, dispatch.company_id, dispatch.warehouse_id)) throw new TrackingError('Vendor dispatch not found', 404)
  return dispatch
}

export async function listDispatches(actor: TrackingActor, options: { search?: string; status?: string } = {}): Promise<VendorDispatch[]> {
  const params: unknown[] = []
  const conditions = [actorScopeSql(actor, 'd.company_id', 'd.warehouse_id', params)]
  if (options.status && ['OPEN', 'SENT', 'CANCELLED'].includes(options.status)) {
    params.push(options.status)
    conditions.push(`d.status = $${params.length}`)
  }
  if (options.search?.trim()) {
    params.push(likePattern(options.search.trim()))
    const p = `$${params.length}`
    conditions.push(`(d.dispatch_no ILIKE ${p} OR d.vendor_name ILIKE ${p} OR d.job_work_reference ILIKE ${p} OR d.vehicle_number ILIKE ${p})`)
  }
  const rows = await query(`SELECT ${DISPATCH_COLUMNS} FROM ${DISPATCH_FROM} WHERE ${conditions.join(' AND ')} ORDER BY d.created_at DESC LIMIT 200`, params)
  return rows.map(toDispatch)
}

export async function createDispatch(
  actor: TrackingActor,
  input: { company_id?: unknown; warehouse_id?: unknown; vendor_id?: unknown; vehicle_number?: unknown; note?: unknown },
): Promise<VendorDispatch> {
  assertCan(actor, 'operate')
  const companyId = requireUuid(input.company_id, 'Company')
  const warehouseId = requireUuid(input.warehouse_id, 'Warehouse')
  const vendorId = requireUuid(input.vendor_id, 'Vendor')
  if (!actorCanAccess(actor, companyId, warehouseId)) throw new TrackingError('Warehouse not found', 404)
  const [row] = await query(
    `SELECT id::text FROM create_tracking_vendor_dispatch($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid)`,
    [companyId, warehouseId, vendorId, textOrNull(input.vehicle_number), textOrNull(input.note), actor.userId],
  )
  return dispatchInScope(actor, row.id)
}

async function dispatchLines(dispatchId: string): Promise<DispatchLine[]> {
  const rows = await query(
    `SELECT u.id::text AS unit_id, u.stock_tracking_id, u.item_code, u.item_name, u.size_label, u.purchase_line_id,
            dl.quantity::text, u.unit, u.lifecycle_status, u.current_vendor_name, dl.job_work_item_id::text, ji.job_line_id,
            dl.closed_at::text, dl.closed_reason
       FROM tracking_vendor_dispatch_units dl
       JOIN tracking_units u ON u.id = dl.tracking_unit_id
       LEFT JOIN job_work_items ji ON ji.id = dl.job_work_item_id
      WHERE dl.dispatch_id = $1::uuid AND ${LIVE_DISPATCH_LINE}
      ORDER BY dl.created_at`,
    [dispatchId],
  )
  return rows as unknown as DispatchLine[]
}

/** Compares a dispatch with its job work order. Reports differences and changes nothing. */
export async function dispatchWarnings(dispatch: VendorDispatch, lines: DispatchLine[]): Promise<string[]> {
  const warnings: string[] = []
  if (dispatch.status === 'CANCELLED') return warnings
  if (!dispatch.job_work_order_id) {
    if (dispatch.status === 'SENT') warnings.push('No job work order is linked yet')
    return warnings
  }

  const [order] = await query(`SELECT status, reference_number FROM job_work_orders WHERE id = $1::uuid`, [dispatch.job_work_order_id])
  if (!order) {
    warnings.push(`Job work order ${dispatch.job_work_reference} no longer exists`)
    return warnings
  }
  if (order.status === 'cancelled' && lines.some((line) => !line.closed_at && line.lifecycle_status === 'AT_VENDOR')) {
    warnings.push(`Job work order ${order.reference_number} was cancelled while bundles are still at the vendor`)
  }

  const byInput = new Map<string, number>()
  for (const line of lines) {
    if (!line.job_work_item_id) {
      warnings.push(`Bundle ${line.stock_tracking_id} matches no input line on ${order.reference_number}`)
      continue
    }
    byInput.set(line.job_work_item_id, (byInput.get(line.job_work_item_id) ?? 0) + thousandths(line.quantity))
  }
  if (byInput.size) {
    const inputs = await query(
      `SELECT id::text, job_line_id, quantity_sent::text FROM job_work_items WHERE id = ANY($1::uuid[])`,
      [[...byInput.keys()]],
    )
    for (const input of inputs) {
      const sent = byInput.get(input.id) ?? 0
      if (sent !== thousandths(input.quantity_sent)) {
        warnings.push(`Bundles sent for input line ${input.job_line_id ?? ''} total ${fixed(sent)}, but the job work order sent ${Number(input.quantity_sent).toFixed(3)}`.replace('line  ', 'line '))
      }
    }
  }
  return warnings
}

export async function getDispatchDetail(actor: TrackingActor, dispatchId: string) {
  const dispatch = await dispatchInScope(actor, dispatchId)
  const lines = await dispatchLines(dispatch.id)
  return { dispatch, lines, warnings: await dispatchWarnings(dispatch, lines) }
}

export async function addDispatchUnit(actor: TrackingActor, dispatchId: string, code: unknown): Promise<VendorDispatch> {
  assertCan(actor, 'operate')
  const dispatch = await dispatchInScope(actor, dispatchId)
  const unit = await findUnitByCode(actor, code)
  if (!unit) throw new TrackingError('No bundle has this code', 404)
  await query(`SELECT id FROM add_tracking_dispatch_unit($1::uuid, $2::uuid, $3::uuid)`, [dispatch.id, unit.id, actor.userId])
  return dispatchInScope(actor, dispatch.id)
}

export async function removeDispatchUnit(actor: TrackingActor, dispatchId: string, unitId: unknown, reason: unknown): Promise<VendorDispatch> {
  assertCan(actor, 'operate')
  const dispatch = await dispatchInScope(actor, dispatchId)
  await query(
    `SELECT id FROM remove_tracking_dispatch_unit($1::uuid, $2::uuid, $3, $4::uuid)`,
    [dispatch.id, requireUuid(unitId, 'Bundle'), typeof reason === 'string' ? reason : null, actor.userId],
  )
  return dispatchInScope(actor, dispatch.id)
}

export async function sendDispatch(actor: TrackingActor, dispatchId: string, input: { vehicle_number?: unknown; position?: unknown }): Promise<VendorDispatch> {
  assertCan(actor, 'operate')
  const dispatch = await dispatchInScope(actor, dispatchId)
  await query(
    `SELECT id FROM send_tracking_vendor_dispatch($1::uuid, $2, $3::jsonb, $4::uuid)`,
    [dispatch.id, textOrNull(input.vehicle_number), positionJson(input.position), actor.userId],
  )
  return dispatchInScope(actor, dispatch.id)
}

export async function cancelDispatch(actor: TrackingActor, dispatchId: string, reason: unknown): Promise<VendorDispatch> {
  assertCan(actor, 'manage')
  const dispatch = await dispatchInScope(actor, dispatchId)
  await query(`SELECT id FROM cancel_tracking_vendor_dispatch($1::uuid, $2, $3::uuid)`, [dispatch.id, typeof reason === 'string' ? reason : null, actor.userId])
  return dispatchInScope(actor, dispatch.id)
}

/** orderId null removes the link. */
export async function linkDispatchOrder(actor: TrackingActor, dispatchId: string, orderId: unknown): Promise<VendorDispatch> {
  assertCan(actor, 'operate')
  const dispatch = await dispatchInScope(actor, dispatchId)
  await query(`SELECT id FROM link_tracking_dispatch_order($1::uuid, $2::uuid, $3::uuid)`, [dispatch.id, optionalUuid(orderId, 'Job work order'), actor.userId])
  return dispatchInScope(actor, dispatch.id)
}

/** Job work orders for this vendor and company, to link once the order has been entered. */
async function linkableOrders(companyId: string, vendorId: string, search: string) {
  const params: unknown[] = [companyId, vendorId]
  let filter = ''
  if (search.trim()) {
    params.push(likePattern(search.trim()))
    filter = `AND o.reference_number ILIKE $${params.length}`
  }
  return query(
    `SELECT o.id::text, o.reference_number, o.dispatch_date::text, o.status,
            (SELECT COALESCE(SUM(i.quantity_sent), 0)::text FROM job_work_items i
              WHERE i.job_work_order_id = o.id AND NOT COALESCE(i.is_transfer_line, false)) AS quantity
       FROM job_work_orders o
      WHERE o.company_id = $1::uuid AND o.vendor_id = $2::uuid AND o.status <> 'cancelled' ${filter}
      ORDER BY o.dispatch_date DESC, o.reference_number DESC
      LIMIT 30`,
    params,
  )
}

export async function listDispatchOrders(actor: TrackingActor, dispatchId: string, search = '') {
  const dispatch = await dispatchInScope(actor, dispatchId)
  return linkableOrders(dispatch.company_id, dispatch.vendor_id, search)
}

// ── Back unprocessed and moves between vendors ──────────────────────────────

export async function returnFromVendor(
  actor: TrackingActor, unitId: string, input: { location?: unknown; reason?: unknown; position?: unknown },
): Promise<TrackingUnit> {
  assertCan(actor, 'operate')
  const unit = await unitInScope(actor, unitId)
  const locationId = await resolveLocationId(actor, unit, input.location)
  await query(
    `SELECT id FROM return_tracking_unit_from_vendor($1::uuid, $2::uuid, $3, $4::jsonb, $5::uuid)`,
    [unit.id, locationId, typeof input.reason === 'string' ? input.reason : null, positionJson(input.position), actor.userId],
  )
  return unitInScope(actor, unit.id)
}

export async function moveUnitsToVendor(
  actor: TrackingActor, input: { unit_ids?: unknown; to_vendor_id?: unknown; moved_on?: unknown; reason?: unknown },
): Promise<number> {
  assertCan(actor, 'operate')
  if (!Array.isArray(input.unit_ids) || input.unit_ids.length === 0) throw new TrackingError('Choose at least one bundle')
  if (input.unit_ids.length > 500) throw new TrackingError('Move at most 500 bundles at a time')
  const unitIds = input.unit_ids.map((id) => requireUuid(id, 'Bundle'))
  for (const id of unitIds) await unitInScope(actor, id)
  const [row] = await query(
    `SELECT move_tracking_units_to_vendor($1::uuid[], $2::uuid, $3::date, $4, $5::uuid) AS moved`,
    [unitIds, requireUuid(input.to_vendor_id, 'Vendor'), dateText(input.moved_on, 'move date'), textOrNull(input.reason), actor.userId],
  )
  return Number(row.moved)
}

const MOVE_COLUMNS = `m.id::text, m.tracking_unit_id::text, u.stock_tracking_id, m.from_vendor_name, m.to_vendor_name,
  m.moved_on::text, m.reason, m.job_work_transfer_id::text, m.transfer_number, m.created_at::text`

/** Recent moves between vendors, so office staff can link each one to its WareCore transfer. */
export async function listRecentMoves(actor: TrackingActor, onlyUnlinked = false): Promise<VendorMove[]> {
  const params: unknown[] = []
  const conditions = [actorScopeSql(actor, 'u.company_id', 'u.warehouse_id', params)]
  if (onlyUnlinked) conditions.push('m.job_work_transfer_id IS NULL')
  return (await query(
    `SELECT ${MOVE_COLUMNS} FROM tracking_vendor_moves m JOIN tracking_units u ON u.id = m.tracking_unit_id
      WHERE ${conditions.join(' AND ')} ORDER BY m.created_at DESC LIMIT 100`,
    params,
  )) as unknown as VendorMove[]
}

async function moveInScope(actor: TrackingActor, moveId: unknown) {
  const [move] = await query(
    `SELECT m.id::text, m.company_id::text, m.from_vendor_id::text, m.to_vendor_id::text, m.tracking_unit_id::text
       FROM tracking_vendor_moves m WHERE m.id = $1::uuid`,
    [requireUuid(moveId, 'Vendor move')],
  )
  if (!move) throw new TrackingError('Vendor move not found', 404)
  await unitInScope(actor, move.tracking_unit_id)
  return move
}

export async function listMoveTransfers(actor: TrackingActor, moveId: string, search = '') {
  const move = await moveInScope(actor, moveId)
  const params: unknown[] = [move.from_vendor_id, move.to_vendor_id, move.company_id]
  let filter = ''
  if (search.trim()) {
    params.push(likePattern(search.trim()))
    filter = `AND t.transfer_number ILIKE $${params.length}`
  }
  return query(
    `SELECT t.id::text, t.transfer_number, t.transfer_date::text,
            (SELECT COALESCE(SUM(i.quantity_transferred), 0)::text FROM job_work_transfer_items i
              WHERE i.job_work_transfer_id = t.id AND i.reversed_at IS NULL) AS quantity
       FROM job_work_transfers t JOIN job_work_orders o ON o.id = t.from_job_work_order_id
      WHERE t.from_vendor_id = $1::uuid AND t.to_vendor_id = $2::uuid AND o.company_id = $3::uuid ${filter}
      ORDER BY t.transfer_date DESC
      LIMIT 30`,
    params,
  )
}

/** transferId null removes the link. */
export async function linkMoveTransfer(actor: TrackingActor, moveId: string, transferId: unknown) {
  assertCan(actor, 'operate')
  const move = await moveInScope(actor, moveId)
  await query(`SELECT id FROM link_tracking_vendor_move_transfer($1::uuid, $2::uuid, $3::uuid)`, [move.id, optionalUuid(transferId, 'Transfer'), actor.userId])
  const [row] = await query(
    `SELECT ${MOVE_COLUMNS} FROM tracking_vendor_moves m JOIN tracking_units u ON u.id = m.tracking_unit_id WHERE m.id = $1::uuid`,
    [move.id],
  )
  return row as unknown as VendorMove
}

// ── Vendor stock ────────────────────────────────────────────────────────────

export interface VendorStockGroup {
  material_type_id: string | null
  label: string
  size_label: string | null
  unit: string
  bundle_count: number
  bundle_quantity: string
  book_quantity: string | null
}

export interface VendorStockEntry {
  company_id: string
  company_name: string
  vendor_id: string
  vendor_name: string
  bundle_count: number
  total_quantity: string
  oldest_since: string | null
  groups: VendorStockGroup[]
  units: Array<TrackingUnit & { dispatch_no: string | null; job_work_reference: string | null; on_pickup: string | null }>
  warnings: string[]
}

/**
 * Bundles held at each vendor beside the book vendor balance for the same
 * item type and size. The book figure comes from the same vendor movement
 * rules the Stock Statement uses (vw_job_work_vendor_movements).
 */
export async function vendorStock(actor: TrackingActor): Promise<VendorStockEntry[]> {
  const params: unknown[] = []
  const scope = actorScopeSql(actor, 'u.company_id', 'u.warehouse_id', params)
  const units = (await query(
    `SELECT ${UNIT_COLUMNS},
            (SELECT d.dispatch_no FROM tracking_vendor_dispatch_units dl JOIN tracking_vendor_dispatches d ON d.id = dl.dispatch_id
              WHERE dl.tracking_unit_id = u.id AND dl.removed_at IS NULL AND dl.closed_at IS NULL LIMIT 1) AS dispatch_no,
            (SELECT d.job_work_reference FROM tracking_vendor_dispatch_units dl JOIN tracking_vendor_dispatches d ON d.id = dl.dispatch_id
              WHERE dl.tracking_unit_id = u.id AND dl.removed_at IS NULL AND dl.closed_at IS NULL LIMIT 1) AS job_work_reference,
            (SELECT p.pickup_no FROM tracking_pickup_units pl JOIN tracking_pickups p ON p.id = pl.pickup_id
              WHERE pl.tracking_unit_id = u.id AND pl.removed_at IS NULL AND pl.returned_at IS NULL LIMIT 1) AS on_pickup
       FROM ${UNIT_FROM}
      WHERE u.status = 'ACTIVE' AND u.lifecycle_status = 'AT_VENDOR' AND ${scope}
      ORDER BY u.current_vendor_name, u.at_vendor_since, u.stock_tracking_id
      LIMIT 3000`,
    params,
  )).map((row) => ({ ...toUnit(row), dispatch_no: row.dispatch_no ?? null, job_work_reference: row.job_work_reference ?? null, on_pickup: row.on_pickup ?? null }))
  if (units.length === 0) return []

  const book = await query(
    `SELECT v.company_id::text, v.vendor_id::text, v.material_type_id::text, v.size_label, SUM(v.vendor_delta)::text AS quantity
       FROM vw_job_work_vendor_movements v
      WHERE (v.company_id, v.vendor_id) IN (
              SELECT DISTINCT company_id, current_vendor_id FROM tracking_units WHERE id = ANY($1::uuid[]))
      GROUP BY 1, 2, 3, 4`,
    [units.map((unit) => unit.id)],
  )
  const bookKey = (company: string, vendor: string, type: string | null, size: string | null) => `${company}|${vendor}|${type ?? ''}|${size ?? ''}`
  const bookByKey = new Map(book.map((row) => [bookKey(row.company_id, row.vendor_id, row.material_type_id, row.size_label), row.quantity]))

  const entries = new Map<string, VendorStockEntry>()
  for (const unit of units) {
    const key = `${unit.company_id}|${unit.current_vendor_id}`
    let entry = entries.get(key)
    if (!entry) {
      entry = {
        company_id: unit.company_id, company_name: unit.company_name ?? '', vendor_id: unit.current_vendor_id ?? '',
        vendor_name: unit.current_vendor_name ?? '', bundle_count: 0, total_quantity: '0.000', oldest_since: null,
        groups: [], units: [], warnings: [],
      }
      entries.set(key, entry)
    }
    entry.units.push(unit)
    entry.bundle_count += 1
    entry.total_quantity = fixed(thousandths(entry.total_quantity) + thousandths(unit.quantity))
    if (!entry.oldest_since || (unit.at_vendor_since && unit.at_vendor_since < entry.oldest_since)) entry.oldest_since = unit.at_vendor_since

    let group = entry.groups.find((g) => g.material_type_id === unit.material_type_id && g.size_label === unit.size_label)
    if (!group) {
      const quantity = bookByKey.get(bookKey(unit.company_id, unit.current_vendor_id ?? '', unit.material_type_id, unit.size_label))
      group = {
        material_type_id: unit.material_type_id, label: [unit.item_code, unit.item_name].filter(Boolean).join(' '),
        size_label: unit.size_label, unit: unit.unit, bundle_count: 0, bundle_quantity: '0.000',
        book_quantity: quantity === undefined ? null : Number(quantity).toFixed(3),
      }
      entry.groups.push(group)
    }
    group.bundle_count += 1
    group.bundle_quantity = fixed(thousandths(group.bundle_quantity) + thousandths(unit.quantity))
  }

  for (const entry of entries.values()) {
    for (const group of entry.groups) {
      const bookQty = group.book_quantity === null ? 0 : thousandths(group.book_quantity)
      if (thousandths(group.bundle_quantity) > bookQty) {
        entry.warnings.push(`Bundles of ${group.label}${group.size_label ? ` ${group.size_label}` : ''} total ${group.bundle_quantity} ${group.unit}, above the book vendor balance of ${fixed(bookQty)} ${group.unit}`)
      }
    }
    const unlinked = entry.units.filter((unit) => unit.dispatch_no && !unit.job_work_reference).length
    if (unlinked) entry.warnings.push(`${unlinked} ${unlinked === 1 ? 'bundle was' : 'bundles were'} sent with no job work order linked yet`)
  }
  return [...entries.values()]
}

// ── Outputs and remainders ──────────────────────────────────────────────────

const RECEIPT_COLUMNS = `r.id::text, r.receipt_no, r.company_id::text, r.warehouse_id::text, c.name AS company_name,
  w.name AS warehouse_name, r.vendor_id::text, r.vendor_name, r.dispatch_id::text, d.dispatch_no, r.received_on::text,
  r.job_work_order_id::text, r.job_work_reference, r.note, r.created_at::text,
  (SELECT count(*)::int FROM tracking_units t WHERE t.output_receipt_id = r.id AND t.source_type = 'JOB_WORK_OUTPUT') AS output_count,
  (SELECT count(*)::int FROM tracking_units t WHERE t.output_receipt_id = r.id AND t.source_type = 'JOB_WORK_REMAINDER') AS remainder_count`

const RECEIPT_FROM = `tracking_output_receipts r
  LEFT JOIN companies c ON c.id = r.company_id
  LEFT JOIN warehouses w ON w.id = r.warehouse_id
  LEFT JOIN tracking_vendor_dispatches d ON d.id = r.dispatch_id`

function toReceipt(row: Row): OutputReceipt {
  return { ...row, output_count: Number(row.output_count), remainder_count: Number(row.remainder_count) } as unknown as OutputReceipt
}

async function receiptInScope(actor: TrackingActor, receiptId: unknown): Promise<OutputReceipt> {
  const rows = await query(`SELECT ${RECEIPT_COLUMNS} FROM ${RECEIPT_FROM} WHERE r.id = $1::uuid`, [requireUuid(receiptId, 'Receipt')])
  const receipt = rows[0] ? toReceipt(rows[0]) : null
  if (!receipt || !actorCanAccess(actor, receipt.company_id, receipt.warehouse_id)) throw new TrackingError('Output receipt not found', 404)
  return receipt
}

export async function listReceipts(actor: TrackingActor, search = ''): Promise<OutputReceipt[]> {
  const params: unknown[] = []
  const conditions = [actorScopeSql(actor, 'r.company_id', 'r.warehouse_id', params)]
  if (search.trim()) {
    params.push(likePattern(search.trim()))
    const p = `$${params.length}`
    conditions.push(`(r.receipt_no ILIKE ${p} OR r.vendor_name ILIKE ${p} OR r.job_work_reference ILIKE ${p} OR d.dispatch_no ILIKE ${p})`)
  }
  const rows = await query(`SELECT ${RECEIPT_COLUMNS} FROM ${RECEIPT_FROM} WHERE ${conditions.join(' AND ')} ORDER BY r.created_at DESC LIMIT 200`, params)
  return rows.map(toReceipt)
}

/** Bundles a vendor holds for this company, and the dispatches they went out on. */
export async function receiptCandidates(actor: TrackingActor, companyIdInput: unknown, vendorIdInput: unknown) {
  const companyId = requireUuid(companyIdInput, 'Company')
  const vendorId = requireUuid(vendorIdInput, 'Vendor')
  const params: unknown[] = [companyId, vendorId]
  const scope = actorScopeSql(actor, 'u.company_id', 'u.warehouse_id', params)
  const units = await query(
    `SELECT ${UNIT_COLUMNS},
            (SELECT dl.dispatch_id::text FROM tracking_vendor_dispatch_units dl
              WHERE dl.tracking_unit_id = u.id AND dl.removed_at IS NULL AND dl.closed_at IS NULL LIMIT 1) AS dispatch_id
       FROM ${UNIT_FROM}
      WHERE u.status = 'ACTIVE' AND u.lifecycle_status = 'AT_VENDOR' AND u.company_id = $1::uuid AND u.current_vendor_id = $2::uuid
        AND NOT EXISTS (SELECT 1 FROM tracking_pickup_units pl WHERE pl.tracking_unit_id = u.id AND pl.removed_at IS NULL AND pl.returned_at IS NULL)
        AND ${scope}
      ORDER BY u.at_vendor_since, u.stock_tracking_id`,
    params,
  )
  const dispatchParams: unknown[] = [companyId, vendorId]
  const dispatchScope = actorScopeSql(actor, 'd.company_id', 'd.warehouse_id', dispatchParams)
  const dispatches = await query(
    `SELECT d.id::text, d.dispatch_no, d.sent_at::text, d.job_work_reference
       FROM tracking_vendor_dispatches d
      WHERE d.status = 'SENT' AND d.company_id = $1::uuid AND d.vendor_id = $2::uuid AND ${dispatchScope}
        AND EXISTS (SELECT 1 FROM tracking_vendor_dispatch_units dl WHERE dl.dispatch_id = d.id AND dl.removed_at IS NULL AND dl.closed_at IS NULL)
      ORDER BY d.sent_at DESC`,
    dispatchParams,
  )
  return { units: units.map((row) => ({ ...toUnit(row), dispatch_id: row.dispatch_id ?? null })), dispatches }
}

/** Items an output can be, for the output receipt form. */
export async function searchItems(search = '') {
  const params: unknown[] = []
  let filter = ''
  if (search.trim()) {
    params.push(likePattern(search.trim()))
    filter = `AND (im.item_code ILIKE $1 OR im.item_name ILIKE $1 OR im.size_label ILIKE $1)`
  }
  return query(
    `SELECT im.id::text, im.item_code, im.item_name, im.size_label, COALESCE(im.unit, mt.unit) AS unit
       FROM item_master im LEFT JOIN material_types mt ON mt.id = im.material_type_id
      WHERE COALESCE(im.is_active, true) ${filter}
      ORDER BY im.item_code
      LIMIT 40`,
    params,
  )
}

export interface ReceiptInput {
  company_id?: unknown
  warehouse_id?: unknown
  vendor_id?: unknown
  dispatch_id?: unknown
  received_on?: unknown
  outputs?: unknown
  remainders?: unknown
  used_up?: unknown
  note?: unknown
}

const WEIGHT_RE = /^[0-9]+(\.[0-9]{1,3})?$/

function weightRow(value: Record<string, unknown>, label: string) {
  const quantity = typeof value.quantity === 'string' ? value.quantity.trim() : typeof value.quantity === 'number' ? String(value.quantity) : ''
  if (!WEIGHT_RE.test(quantity) || Number(quantity) <= 0) throw new TrackingError(`Each ${label} needs a weight above zero, with up to 3 decimals`)
  const basis = value.weight_basis === 'estimated' ? 'estimated' : 'weighed'
  return { quantity, weight_basis: basis }
}

export async function createReceipt(actor: TrackingActor, input: ReceiptInput): Promise<{ receipt: OutputReceipt; units: TrackingUnit[] }> {
  assertCan(actor, 'manage')
  const companyId = requireUuid(input.company_id, 'Company')
  const warehouseId = requireUuid(input.warehouse_id, 'Warehouse')
  const vendorId = requireUuid(input.vendor_id, 'Vendor')
  const dispatchId = optionalUuid(input.dispatch_id, 'Dispatch')
  if (!actorCanAccess(actor, companyId, warehouseId)) throw new TrackingError('Warehouse not found', 404)

  const outputsIn = Array.isArray(input.outputs) ? input.outputs : []
  const remaindersIn = Array.isArray(input.remainders) ? input.remainders : []
  if (outputsIn.length + remaindersIn.length === 0) throw new TrackingError('Enter at least one output or remainder')
  if (outputsIn.length + remaindersIn.length > MAX_BUNDLES) throw new TrackingError(`A receipt can hold at most ${MAX_BUNDLES} bundles`)

  const outputs = outputsIn.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>
    const parents = Array.isArray(row.parents) ? row.parents.map((id) => requireUuid(id, 'Source bundle')) : []
    if (parents.length === 0) throw new TrackingError('Choose the bundles each output was made from')
    return {
      item_master_id: requireUuid(row.item_master_id, 'Output item'),
      size_label: textOrNull(row.size_label),
      ...weightRow(row, 'output'),
      parents,
    }
  })
  const remainders = remaindersIn.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>
    return { parent: requireUuid(row.parent, 'Source bundle'), ...weightRow(row, 'remainder') }
  })
  const usedUp = Array.isArray(input.used_up) ? input.used_up.map((id) => requireUuid(id, 'Source bundle')) : []

  const sources = new Set([...outputs.flatMap((o) => o.parents), ...remainders.map((r) => r.parent), ...usedUp])
  for (const id of sources) await unitInScope(actor, id)

  const created = await query(
    `SELECT id::text, output_receipt_id::text FROM receive_tracking_outputs(
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::date, $6::jsonb, $7::jsonb, $8::uuid[], $9, $10::uuid)`,
    [companyId, warehouseId, vendorId, dispatchId, dateText(input.received_on, 'received date'),
     JSON.stringify(outputs), JSON.stringify(remainders), usedUp, textOrNull(input.note), actor.userId],
  )
  const rows = await query(
    `SELECT ${UNIT_COLUMNS} FROM ${UNIT_FROM} WHERE u.id = ANY($1::uuid[]) ORDER BY u.source_type, u.stock_tracking_id`,
    [created.map((row) => row.id)],
  )
  return { receipt: await receiptInScope(actor, created[0].output_receipt_id), units: rows.map(toUnit) }
}

export async function getReceiptDetail(actor: TrackingActor, receiptId: string) {
  const receipt = await receiptInScope(actor, receiptId)
  const units = (await query(
    `SELECT ${UNIT_COLUMNS} FROM ${UNIT_FROM} WHERE u.output_receipt_id = $1::uuid ORDER BY u.source_type, u.stock_tracking_id`,
    [receipt.id],
  )).map(toUnit)
  const sources = await query(
    `SELECT g.child_unit_id::text AS child_id, p.id::text AS unit_id, p.stock_tracking_id, p.item_code, p.item_name,
            p.size_label, p.quantity::text, p.unit, p.lifecycle_status, p.purchase_line_id, g.relation
       FROM tracking_unit_lineage g JOIN tracking_units p ON p.id = g.parent_unit_id
      WHERE g.child_unit_id = ANY($1::uuid[])
      ORDER BY p.stock_tracking_id`,
    [units.map((unit) => unit.id)],
  )
  return { receipt, units, sources, warnings: await receiptWarnings(receipt, units) }
}

/** Compares a receipt's outputs with the output lines of its job work order. Changes nothing. */
export async function receiptWarnings(receipt: OutputReceipt, units: TrackingUnit[]): Promise<string[]> {
  const warnings: string[] = []
  const outputs = units.filter((unit) => unit.source_type === 'JOB_WORK_OUTPUT' && unit.status === 'ACTIVE')
  if (!receipt.job_work_order_id) {
    if (outputs.length) warnings.push('No job work order is linked yet')
    return warnings
  }
  const [order] = await query(`SELECT status, reference_number FROM job_work_orders WHERE id = $1::uuid`, [receipt.job_work_order_id])
  if (!order) return [`Job work order ${receipt.job_work_reference} no longer exists`]
  if (order.status === 'cancelled') warnings.push(`Job work order ${order.reference_number} was cancelled`)

  const byLine = new Map<string, TrackingUnit[]>()
  for (const unit of outputs) {
    if (!unit.job_work_output_item_id) {
      warnings.push(`Output ${unit.stock_tracking_id} matches no output line on ${order.reference_number}`)
      continue
    }
    byLine.set(unit.job_work_output_item_id, [...(byLine.get(unit.job_work_output_item_id) ?? []), unit])
  }
  if (byLine.size) {
    const lines = await query(
      `SELECT x.id::text, x.item_master_id::text, x.size_label, x.quantity::text, im.item_code
         FROM job_work_output_items x LEFT JOIN item_master im ON im.id = x.item_master_id
        WHERE x.id = ANY($1::uuid[])`,
      [[...byLine.keys()]],
    )
    for (const line of lines) {
      const matched = byLine.get(line.id) ?? []
      const total = matched.reduce((sum, unit) => sum + thousandths(unit.quantity), 0)
      if (total !== thousandths(line.quantity)) {
        warnings.push(`Outputs matched to ${line.item_code ?? 'an output line'}${line.size_label ? ` ${line.size_label}` : ''} total ${fixed(total)}, but the job work order records ${Number(line.quantity).toFixed(3)}`)
      }
      for (const unit of matched) {
        if (line.size_label && unit.size_label && line.size_label !== unit.size_label) {
          warnings.push(`Output ${unit.stock_tracking_id} is size ${unit.size_label}, but the job work order records ${line.size_label}`)
        }
      }
    }
  }
  return warnings
}

/** orderId null removes the link. */
export async function linkReceiptOrder(actor: TrackingActor, receiptId: string, orderId: unknown): Promise<OutputReceipt> {
  assertCan(actor, 'operate')
  const receipt = await receiptInScope(actor, receiptId)
  await query(`SELECT id FROM link_tracking_receipt_order($1::uuid, $2::uuid, $3::uuid)`, [receipt.id, optionalUuid(orderId, 'Job work order'), actor.userId])
  return receiptInScope(actor, receipt.id)
}

export async function listReceiptOrders(actor: TrackingActor, receiptId: string, search = '') {
  const receipt = await receiptInScope(actor, receiptId)
  return linkableOrders(receipt.company_id, receipt.vendor_id, search)
}

// ── Genealogy ───────────────────────────────────────────────────────────────

const LINEAGE_EDGES = `edges AS (
    SELECT child_unit_id AS child, parent_unit_id AS parent, relation FROM tracking_unit_lineage
    UNION ALL
    SELECT id, parent_unit_id, 'SPLIT_PART' FROM tracking_units WHERE parent_unit_id IS NOT NULL
  )`

const NODE_COLUMNS = `n.unit_id::text, u.stock_tracking_id, u.item_code, u.item_name, u.size_label, u.quantity::text, u.unit,
  u.lifecycle_status, u.status, u.source_type, COALESCE(l.code, u.current_vendor_name) AS place, n.related_id::text,
  n.relation, n.depth::int, u.company_id::text, u.warehouse_id::text`

/**
 * What a bundle was made from and what it became, up to twelve steps each
 * way. Split parts, outputs and remainders are all included.
 */
export async function unitGenealogy(actor: TrackingActor, unitId: string) {
  const unit = await unitInScope(actor, unitId)
  const [up, down, origins, moves, dispatches] = await Promise.all([
    query(
      `WITH RECURSIVE ${LINEAGE_EDGES},
       walk AS (
         SELECT e.parent AS unit_id, e.child AS related_id, e.relation, 1 AS depth FROM edges e WHERE e.child = $1::uuid
         UNION
         SELECT e.parent, e.child, e.relation, w.depth + 1 FROM edges e JOIN walk w ON e.child = w.unit_id WHERE w.depth < 12
       )
       SELECT DISTINCT ON (n.unit_id) ${NODE_COLUMNS}
         FROM walk n JOIN tracking_units u ON u.id = n.unit_id LEFT JOIN tracking_locations l ON l.id = u.current_location_id
        ORDER BY n.unit_id, n.depth`,
      [unit.id],
    ),
    query(
      `WITH RECURSIVE ${LINEAGE_EDGES},
       walk AS (
         SELECT e.child AS unit_id, e.parent AS related_id, e.relation, 1 AS depth FROM edges e WHERE e.parent = $1::uuid
         UNION
         SELECT e.child, e.parent, e.relation, w.depth + 1 FROM edges e JOIN walk w ON e.parent = w.unit_id WHERE w.depth < 12
       )
       SELECT DISTINCT ON (n.unit_id) ${NODE_COLUMNS}
         FROM walk n JOIN tracking_units u ON u.id = n.unit_id LEFT JOIN tracking_locations l ON l.id = u.current_location_id
        ORDER BY n.unit_id, n.depth`,
      [unit.id],
    ),
    query(`SELECT purchase_line_id, quantity::text FROM tracking_unit_origins WHERE tracking_unit_id = $1::uuid ORDER BY purchase_line_id`, [unit.id]),
    query(`SELECT ${MOVE_COLUMNS} FROM tracking_vendor_moves m JOIN tracking_units u ON u.id = m.tracking_unit_id WHERE m.tracking_unit_id = $1::uuid ORDER BY m.created_at`, [unit.id]),
    query(
      `SELECT d.id::text, d.dispatch_no, d.vendor_name, d.status, d.sent_at::text, d.job_work_reference,
              dl.closed_at::text, dl.closed_reason
         FROM tracking_vendor_dispatch_units dl JOIN tracking_vendor_dispatches d ON d.id = dl.dispatch_id
        WHERE dl.tracking_unit_id = $1::uuid AND dl.removed_at IS NULL
        ORDER BY dl.created_at DESC`,
      [unit.id],
    ),
  ])
  // Other companies' bundles never show, even when they share a family tree.
  const visible = (rows: Row[]): LineageNode[] => rows
    .filter((row) => actorCanAccess(actor, row.company_id, row.warehouse_id))
    .map((row) => {
      const node: Row = { ...row }
      delete node.company_id
      delete node.warehouse_id
      return { ...node, depth: Number(row.depth) } as unknown as LineageNode
    })
    .sort((a, b) => a.depth - b.depth || a.stock_tracking_id.localeCompare(b.stock_tracking_id))

  const warnings: string[] = []
  const live = dispatches.find((d) => d.status === 'SENT' && !d.closed_at)
  if (unit.lifecycle_status === 'AT_VENDOR' && live && !live.job_work_reference) {
    warnings.push(`Sent on ${live.dispatch_no} with no job work order linked yet`)
  }
  return {
    madeFrom: visible(up),
    became: visible(down),
    origins: origins as unknown as UnitOrigin[],
    moves: moves as unknown as VendorMove[],
    dispatches,
    warnings,
  }
}
