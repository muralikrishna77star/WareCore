// Phase 3 of QR tracking: locations, statuses, pickups, GPS and old stock. Runs
// the real service against a throwaway Postgres with every migration applied.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { startTestDb } from '../../scripts/test/testDb.mjs'
import type { TrackingActor } from '@/lib/tracking/access'
import type { TrackingLocation, TrackingUnit } from '@/lib/tracking/constants'

let db: Awaited<ReturnType<typeof startTestDb>>
let client: pg.Client
let service: typeof import('@/lib/tracking/service')
let floor: typeof import('@/lib/tracking/floor')
let pickups: typeof import('@/lib/tracking/pickups')
let pool: typeof import('@/lib/localdb/pool')
let backup: typeof import('@/lib/backup/backup.service')

const ids: Record<string, string> = {}
let admin: TrackingActor
let rackA: TrackingLocation

const q = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0]
const today = `(now() AT TIME ZONE 'Asia/Kolkata')::date`

/** A fingerprint of every row in every table outside the tracking layer. */
async function existingDataFingerprint() {
  const tables = (await q(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE 'tracking\\_%' AND tablename <> 'schema_migrations' ORDER BY 1`)).map((r) => r.tablename)
  const out: Record<string, string> = {}
  for (const table of tables) {
    const row = await one(`SELECT count(*)::text || ':' || md5(coalesce(string_agg(x.v, '|' ORDER BY x.v), '')) AS f FROM (SELECT t::text AS v FROM "${table}" t) x`)
    out[table] = row.f
  }
  return out
}

let lineSeq = 0
async function newLine(quantity = 10, billId = ids.bill) {
  lineSeq += 1
  const row = await one(
    `INSERT INTO purchase_bill_items (bill_id, material_type_id, item_master_id, purchase_line_id, quantity, unit, rate, amount)
     VALUES ($1, $2, $3, $4, $5, 'MT', 100, 1000) RETURNING purchase_line_id`,
    [billId, ids.material, ids.item, `P3${String(lineSeq).padStart(4, '0')}-0001`, quantity])
  return row.purchase_line_id as string
}

const actorFor = (role: string, companyId: string | null = ids.company, warehouseId: string | null = null): TrackingActor => ({
  userId: ids.user, role, companyId, warehouseId, allCompanies: role === 'admin' || role === 'developer',
})

/** A labelled bundle, already put away at rack A unless told otherwise. */
async function stockedUnit(quantity = 5, place = true): Promise<TrackingUnit> {
  const [unit] = await service.createUnits(admin, await newLine(quantity), null)
  return place ? floor.placeUnit(admin, unit.id, rackA.code) : unit
}

const status = async (id: string) => (await one(`SELECT lifecycle_status FROM tracking_units WHERE id = $1`, [id])).lifecycle_status
const newPickup = (customer = ids.customer) => pickups.createPickup(admin, { company_id: ids.company, warehouse_id: ids.warehouse, customer_id: customer })

async function saleFor(customer: string, lines: { line: string | null; quantity: number }[], invoice = `INV-${randomUUID().slice(0, 8)}`) {
  const order = await one(
    `INSERT INTO dispatch_orders (invoice_number, customer_id, company_id, warehouse_id, dispatch_date, status)
     VALUES ($1, $2, $3, $4, ${today}, 'draft') RETURNING id`,
    [invoice, customer, ids.company, ids.warehouse])
  for (const { line, quantity } of lines) {
    await client.query(
      `INSERT INTO dispatch_items (dispatch_order_id, material_type_id, item_master_id, quantity, unit, purchase_line_id, sale_line_id)
       VALUES ($1, $2, $3, $4, 'MT', $5, $6)`,
      [order.id, ids.material, ids.item, quantity, line, `SL-${randomUUID().slice(0, 8)}`])
  }
  await client.query(`UPDATE dispatch_orders SET status = 'active' WHERE id = $1`, [order.id])
  return order.id as string
}

beforeAll(async () => {
  db = await startTestDb({})
  client = new pg.Client({ connectionString: db.connectionString })
  await client.connect()
  process.env.DATABASE_URL = db.connectionString
  process.env.DIRECT_DB = 'true'
  process.env.NEXT_PUBLIC_TRACKING_ENABLED = 'true'
  service = await import('@/lib/tracking/service')
  floor = await import('@/lib/tracking/floor')
  pickups = await import('@/lib/tracking/pickups')
  pool = await import('@/lib/localdb/pool')
  backup = await import('@/lib/backup/backup.service')

  ids.company = (await one(`INSERT INTO companies (name, code) VALUES ('Phase Co', 'PH') RETURNING id`)).id
  ids.otherCompany = (await one(`INSERT INTO companies (name, code) VALUES ('Other Co', 'OC') RETURNING id`)).id
  ids.warehouse = (await one(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'Main') RETURNING id`, [ids.company])).id
  ids.warehouse2 = (await one(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'Second') RETURNING id`, [ids.company])).id
  ids.supplier = (await one(`INSERT INTO suppliers (name) VALUES ('Phase Supplier') RETURNING id`)).id
  ids.material = (await one(`INSERT INTO material_types (code, description, unit) VALUES ('PH', 'Phase steel', 'MT') RETURNING id`)).id
  ids.item = (await one(`INSERT INTO item_master (item_code, item_name, material_type_id) VALUES ('PH00001', 'Phase coil', $1) RETURNING id`, [ids.material])).id
  ids.customer = (await one(`INSERT INTO customers (name) VALUES ('Acme Fabricators') RETURNING id`)).id
  ids.customer2 = (await one(`INSERT INTO customers (name) VALUES ('Other Buyer') RETURNING id`)).id
  ids.user = (await one(
    `INSERT INTO user_profiles (full_name, role, email, password_hash, is_active) VALUES ('Admin', 'admin', $1, 'x', true) RETURNING id`,
    [`${randomUUID()}@test.local`])).id
  admin = actorFor('admin', null)

  // A bill from before go-live, then tracking switched on, then a current bill.
  ids.oldBill = (await one(
    `INSERT INTO purchase_bills (supplier_id, company_id, warehouse_id, bill_number, bill_date, status)
     VALUES ($1, $2, $3, 'OLD-1', '2024-06-01', 'active') RETURNING id`, [ids.supplier, ids.company, ids.warehouse])).id
  await service.setFeatureFlag(admin, ids.company, null, true)
  ids.bill = (await one(
    `INSERT INTO purchase_bills (supplier_id, company_id, warehouse_id, bill_number, bill_date, status)
     VALUES ($1, $2, $3, 'NEW-1', ${today}, 'active') RETURNING id`, [ids.supplier, ids.company, ids.warehouse])).id

  rackA = await floor.createLocation(admin, { company_id: ids.company, warehouse_id: ids.warehouse, code: 'a-01' })
  await floor.createLocation(admin, { company_id: ids.company, warehouse_id: ids.warehouse, code: 'B-02', name: 'Back wall' })
  await floor.createLocation(admin, { company_id: ids.company, warehouse_id: ids.warehouse, code: 'BAY-1', location_type: 'PICKUP_BAY' })
}, 300_000)

afterAll(async () => {
  await pool?.closePool()
  await client?.end()
  await db?.stop()
}, 60_000)

describe('Locations', () => {
  it('stores codes in capitals with their own QR reference', () => {
    expect(rackA.code).toBe('A-01')
    expect(rackA.location_ref).toMatch(/^WL1-[0-9A-HJKMNP-TV-Z]{16}$/)
  })

  it('refuses a duplicate code in one warehouse but allows it in another', async () => {
    await expect(floor.createLocation(admin, { company_id: ids.company, warehouse_id: ids.warehouse, code: 'A-01' })).rejects.toThrow(/already exists/)
    const other = await floor.createLocation(admin, { company_id: ids.company, warehouse_id: ids.warehouse2, code: 'A-01' })
    expect(other.code).toBe('A-01')
  })

  it('refuses a code with spaces or symbols', async () => {
    await expect(floor.createLocation(admin, { company_id: ids.company, warehouse_id: ids.warehouse, code: 'A 01!' })).rejects.toThrow(/letters, numbers and dashes/)
  })

  it('cannot be deactivated while it holds a bundle, and cannot be deleted', async () => {
    const spot = await floor.createLocation(admin, { company_id: ids.company, warehouse_id: ids.warehouse, code: 'TEMP-1' })
    const [unit] = await service.createUnits(admin, await newLine(1), null)
    await floor.placeUnit(admin, unit.id, spot.code)
    await expect(floor.setLocationActive(admin, spot.id, false)).rejects.toThrow(/still holds bundles/)
    await floor.placeUnit(admin, unit.id, rackA.code)
    expect((await floor.setLocationActive(admin, spot.id, false)).is_active).toBe(false)
    await expect(floor.placeUnit(admin, unit.id, spot.code)).rejects.toThrow(/not active/)
    await expect(client.query(`DELETE FROM tracking_locations WHERE id = $1`, [spot.id])).rejects.toThrow(/cannot be deleted/)
  })

  it('builds a location label that does not disturb the bundle label template', async () => {
    const printer = await one(`INSERT INTO tracking_printers (company_id, warehouse_id, name) VALUES ($1, $2, 'Dock') RETURNING id`, [ids.company, ids.warehouse])
    ids.printer = printer.id
    const job = await floor.requestLocationPrint(admin, rackA.id, printer.id)
    expect(job.jobType).toBe('LOCATION')
    expect(job.zpl).toContain(rackA.location_ref)
    expect(job.zpl).toContain('A-01')

    const unit = await stockedUnit(2)
    const bundle = await service.requestPrint(admin, unit.id, printer.id, null)
    expect(bundle.zpl).toContain(unit.qr_reference)
    expect(bundle.zpl).not.toContain('{{')
  })
})

describe('Put away and move', () => {
  it('a scan moves a labelled bundle into stock and records it', async () => {
    const unit = await stockedUnit(3, false)
    expect(unit.lifecycle_status).toBe('LABELLED')
    const placed = await floor.placeUnit(admin, unit.id, rackA.location_ref)
    expect(placed.lifecycle_status).toBe('IN_STOCK')
    expect(placed.location_code).toBe('A-01')
    expect((await one(`SELECT event_type FROM tracking_events WHERE tracking_unit_id = $1 ORDER BY occurred_at DESC LIMIT 1`, [unit.id])).event_type).toBe('PUT_AWAY')
  })

  it('a move keeps the status and records both locations', async () => {
    const unit = await stockedUnit(3)
    const moved = await floor.placeUnit(admin, unit.id, 'b-02')
    expect(moved.location_code).toBe('B-02')
    const event = await one(`SELECT details FROM tracking_events WHERE tracking_unit_id = $1 AND event_type = 'MOVED'`, [unit.id])
    expect(event.details.to_location).toBe('B-02')
    await expect(floor.placeUnit(admin, unit.id, 'B-02')).rejects.toThrow(/already at B-02/)
  })

  it('refuses a location in another warehouse', async () => {
    const elsewhere = await floor.createLocation(admin, { company_id: ids.company, warehouse_id: ids.warehouse2, code: 'FAR-1' })
    const unit = await stockedUnit(1)
    await expect(floor.placeUnit(admin, unit.id, elsewhere.location_ref)).rejects.toThrow(/different warehouse/)
  })

  it('a voided label cannot be placed', async () => {
    const unit = await stockedUnit(1, false)
    await service.voidUnit(admin, unit.id, 'Wrong item')
    await expect(floor.placeUnit(admin, unit.id, rackA.code)).rejects.toThrow(/voided/)
  })
})

describe('Status rules', () => {
  it('hold needs a reason, and release returns the bundle to stock', async () => {
    const unit = await stockedUnit()
    await expect(floor.changeUnitStatus(admin, unit.id, 'ON_HOLD', {})).rejects.toThrow(/reason is required/)
    const held = await floor.changeUnitStatus(admin, unit.id, 'ON_HOLD', { reason: 'Rust on edge' })
    expect(held.lifecycle_status).toBe('ON_HOLD')
    expect(held.status_reason).toBe('Rust on edge')
    const released = await floor.changeUnitStatus(admin, unit.id, 'IN_STOCK', {})
    expect(released.lifecycle_status).toBe('IN_STOCK')
    expect(released.location_code).toBe('A-01')
    expect(released.status_reason).toBeNull()
  })

  it('missing clears the location, and found needs a new one', async () => {
    const unit = await stockedUnit()
    const missing = await floor.changeUnitStatus(admin, unit.id, 'MISSING', { reason: 'Not found in count' })
    expect(missing.location_code).toBeNull()
    await expect(floor.changeUnitStatus(admin, unit.id, 'IN_STOCK', {})).rejects.toThrow(/Scan the location/)
    expect((await floor.changeUnitStatus(admin, unit.id, 'IN_STOCK', { location: 'B-02' })).location_code).toBe('B-02')
  })

  it('left warehouse can come back to a location', async () => {
    const unit = await stockedUnit()
    await floor.changeUnitStatus(admin, unit.id, 'LEFT_WAREHOUSE', { reason: 'Sent to job work' })
    expect((await floor.changeUnitStatus(admin, unit.id, 'IN_STOCK', { location: 'A-01' })).lifecycle_status).toBe('IN_STOCK')
  })

  it('the database refuses a status change outside the approved list', async () => {
    const unit = await stockedUnit(1, false)
    await expect(client.query(`UPDATE tracking_units SET lifecycle_status = 'PICKED_UP' WHERE id = $1`, [unit.id])).rejects.toThrow(/cannot become/)
    await expect(floor.changeUnitStatus(admin, unit.id, 'ON_HOLD', { reason: 'x' })).rejects.toThrow(/cannot become/)
  })

  it('a bundle on a pickup cannot be voided', async () => {
    const unit = await stockedUnit()
    const pickup = await newPickup()
    await pickups.addPickupUnit(admin, pickup.id, unit.stock_tracking_id, null)
    await expect(service.voidUnit(admin, unit.id, 'Oops')).rejects.toThrow(/cannot be voided/)
  })
})

describe('Split', () => {
  it('parts must add up exactly to the original', async () => {
    const unit = await stockedUnit(5)
    await expect(floor.splitUnit(admin, unit.id, [{ quantity: '2', weight_basis: 'weighed' }, { quantity: '2.999', weight_basis: 'weighed' }], 'Customer took part')).rejects.toThrow(/total 4\.999/)
    expect(await status(unit.id)).toBe('IN_STOCK')
  })

  it('makes labelled parts in stock where the original was, and retires the original', async () => {
    const unit = await stockedUnit(5)
    const parts = await floor.splitUnit(admin, unit.id, [{ quantity: '1.250', weight_basis: 'weighed' }, { quantity: '3.750', weight_basis: 'estimated' }], 'Customer took part')
    expect(parts.map((p) => p.part_no)).toEqual([1, 2])
    expect(parts.map((p) => p.quantity)).toEqual(['1.250', '3.750'])
    expect(parts.every((p) => p.lifecycle_status === 'IN_STOCK' && p.location_code === 'A-01' && p.parent_unit_id === unit.id)).toBe(true)
    expect(new Set(parts.map((p) => p.qr_reference)).size).toBe(2)
    expect(await status(unit.id)).toBe('SPLIT')

    await expect(service.requestPrint(admin, unit.id, ids.printer, null)).rejects.toThrow(/was split/)
    const scan = await service.lookupCode(admin, unit.qr_reference)
    expect(scan.kind === 'found' && scan.warnings.join()).toMatch(/was split/)
  })

  it('a split bundle does not trigger the purchase line weight warning', async () => {
    const unit = await stockedUnit(4)
    const [part] = await floor.splitUnit(admin, unit.id, [{ quantity: '1', weight_basis: 'weighed' }, { quantity: '3', weight_basis: 'weighed' }], 'Part sale')
    const scan = await service.lookupCode(admin, part.qr_reference)
    expect(scan.kind === 'found' && scan.warnings.join()).not.toMatch(/labels total/)
  })

  it('splitting a bundle on a pickup takes it off, and the part can be scanned on', async () => {
    const unit = await stockedUnit(6)
    const pickup = await newPickup()
    await pickups.addPickupUnit(admin, pickup.id, unit.qr_reference, null)
    const [take] = await floor.splitUnit(admin, unit.id, [{ quantity: '2', weight_basis: 'weighed' }, { quantity: '4', weight_basis: 'weighed' }], 'Customer needs 2')
    let detail = await pickups.getPickupDetail(admin, pickup.id)
    expect(detail.lines).toHaveLength(0)
    await pickups.addPickupUnit(admin, pickup.id, take.qr_reference, null)
    detail = await pickups.getPickupDetail(admin, pickup.id)
    expect(detail.lines.map((l) => l.unit_id)).toEqual([take.id])
  })
})

describe('Customer pickup', () => {
  it('runs from creation to handover without a sale, then shows the sale is missing', async () => {
    const a = await stockedUnit(2)
    const b = await stockedUnit(3)
    const pickup = await newPickup()
    expect(pickup.pickup_no).toMatch(/^PU\d{4}-\d{4}$/)

    await pickups.addPickupUnit(admin, pickup.id, a.qr_reference, null)
    await pickups.addPickupUnit(admin, pickup.id, b.stock_tracking_id, null)
    expect(await status(a.id)).toBe('ON_PICKUP')

    await expect(pickups.handOverPickup(admin, pickup.id, { collector_name: 'Ravi', vehicle_number: 'TS09AB1234' })).rejects.toThrow(/Mark the pickup ready/)
    const ready = await pickups.markPickupReady(admin, pickup.id, 'BAY-1')
    expect(ready.status).toBe('READY')
    expect((await one(`SELECT l.code FROM tracking_units u JOIN tracking_locations l ON l.id = u.current_location_id WHERE u.id = $1`, [a.id])).code).toBe('BAY-1')

    await expect(pickups.handOverPickup(admin, pickup.id, { collector_name: 'Ravi' })).rejects.toThrow(/vehicle number/)
    const done = await pickups.handOverPickup(admin, pickup.id, { collector_name: 'Ravi', collector_phone: '98765 43210', vehicle_number: 'ts09ab1234' })
    expect(done.status).toBe('HANDED_OVER')
    expect(done.vehicle_number).toBe('TS09AB1234')
    expect(done.collector_phone).toBe('919876543210')
    expect(await status(a.id)).toBe('PICKED_UP')

    const detail = await pickups.getPickupDetail(admin, pickup.id)
    expect(detail.warnings).toEqual(['No sale is linked to this pickup yet'])
  })

  it('a bundle can never be on two pickups, even when scanned at the same moment', async () => {
    const unit = await stockedUnit()
    const [first, second] = await Promise.all([newPickup(), newPickup()])
    const results = await Promise.allSettled([
      pickups.addPickupUnit(admin, first.id, unit.qr_reference, null),
      pickups.addPickupUnit(admin, second.id, unit.qr_reference, null),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await one(`SELECT count(*)::int AS n FROM tracking_pickup_units WHERE tracking_unit_id = $1`, [unit.id])).n).toBe(1)
  })

  it('only a bundle in stock can be added', async () => {
    const unit = await stockedUnit(1, false)
    const pickup = await newPickup()
    await expect(pickups.addPickupUnit(admin, pickup.id, unit.qr_reference, null)).rejects.toThrow(/labelled, so it cannot be added/)
  })

  it('removing a bundle needs a reason, and emptying a ready pickup reopens it', async () => {
    const unit = await stockedUnit()
    const pickup = await newPickup()
    await pickups.addPickupUnit(admin, pickup.id, unit.qr_reference, null)
    await pickups.markPickupReady(admin, pickup.id, null)
    await expect(pickups.removePickupUnit(admin, pickup.id, unit.id, ' ')).rejects.toThrow(/reason is required/)
    const reopened = await pickups.removePickupUnit(admin, pickup.id, unit.id, 'Customer changed mind')
    expect(reopened.status).toBe('OPEN')
    expect(await status(unit.id)).toBe('IN_STOCK')
  })

  it('cancelling returns every bundle to stock and is refused after handover', async () => {
    const unit = await stockedUnit()
    const pickup = await newPickup()
    await pickups.addPickupUnit(admin, pickup.id, unit.qr_reference, null)
    await pickups.markPickupReady(admin, pickup.id, null)
    expect((await pickups.cancelPickup(admin, pickup.id, 'Order changed')).status).toBe('CANCELLED')
    expect(await status(unit.id)).toBe('IN_STOCK')
    await expect(pickups.cancelPickup(admin, pickup.id, 'Again')).rejects.toThrow(/before handover/)
  })

  it('a customer return brings the bundle back to a location and it can be picked again', async () => {
    const unit = await stockedUnit()
    const pickup = await newPickup()
    await pickups.addPickupUnit(admin, pickup.id, unit.qr_reference, null)
    await pickups.markPickupReady(admin, pickup.id, null)
    await pickups.handOverPickup(admin, pickup.id, { collector_name: 'Ravi', vehicle_number: 'TS09' })

    await expect(floor.changeUnitStatus(admin, unit.id, 'IN_STOCK', { location: 'A-01' })).rejects.toThrow(/reason is required/)
    const back = await floor.changeUnitStatus(admin, unit.id, 'IN_STOCK', { location: 'A-01', reason: 'Wrong size delivered' })
    expect(back.lifecycle_status).toBe('IN_STOCK')

    const next = await newPickup()
    await pickups.addPickupUnit(admin, next.id, unit.qr_reference, null)
    expect(await status(unit.id)).toBe('ON_PICKUP')
  })
})

describe('Linking a sale', () => {
  it('links a later sale, matches bundles and warns on a weight difference', async () => {
    const unit = await stockedUnit(5)
    const pickup = await newPickup()
    await pickups.addPickupUnit(admin, pickup.id, unit.qr_reference, null)
    const sale = await saleFor(ids.customer, [{ line: unit.purchase_line_id, quantity: 4 }])

    expect((await pickups.listLinkableSales(admin, pickup.id)).map((s) => s.id)).toContain(sale)
    await pickups.linkPickupSale(admin, pickup.id, sale)
    const detail = await pickups.getPickupDetail(admin, pickup.id)
    expect(detail.lines[0].sale_line_id).toBeTruthy()
    expect(detail.warnings.join()).toMatch(/Pickup weight is 5\.000.*is 4\.000/)
  })

  it('refuses a sale for another customer', async () => {
    const unit = await stockedUnit(1)
    const pickup = await newPickup()
    const sale = await saleFor(ids.customer2, [{ line: unit.purchase_line_id, quantity: 1 }])
    await expect(pickups.linkPickupSale(admin, pickup.id, sale)).rejects.toThrow(/different customer/)
  })

  it('a bundle that is not on the sale needs a reason, which is kept', async () => {
    const onSale = await stockedUnit(1)
    const offSale = await stockedUnit(1)
    const pickup = await newPickup()
    await pickups.linkPickupSale(admin, pickup.id, await saleFor(ids.customer, [{ line: onSale.purchase_line_id, quantity: 1 }]))

    const asked = await pickups.addPickupUnit(admin, pickup.id, offSale.qr_reference, null)
    expect(asked.needsReason).toBe(true)
    expect(await status(offSale.id)).toBe('IN_STOCK')

    const added = await pickups.addPickupUnit(admin, pickup.id, offSale.qr_reference, 'Same grade, customer agreed')
    expect(added.needsReason).toBe(false)
    const detail = await pickups.getPickupDetail(admin, pickup.id)
    expect(detail.lines[0].mismatch_reason).toBe('Same grade, customer agreed')
    expect(detail.warnings.join()).toMatch(/does not match any line/)
  })

  it('warns when the linked sale is cancelled, without changing the pickup', async () => {
    const unit = await stockedUnit(2)
    const pickup = await newPickup()
    await pickups.addPickupUnit(admin, pickup.id, unit.qr_reference, null)
    const sale = await saleFor(ids.customer, [{ line: unit.purchase_line_id, quantity: 2 }])
    await pickups.linkPickupSale(admin, pickup.id, sale)
    await client.query(`UPDATE dispatch_orders SET status = 'cancelled' WHERE id = $1`, [sale])
    const detail = await pickups.getPickupDetail(admin, pickup.id)
    expect(detail.warnings.join()).toMatch(/was cancelled/)
    expect(detail.pickup.status).toBe('OPEN')
  })
})

describe('WhatsApp', () => {
  it('records that WhatsApp was opened and keeps the number on the pickup only', async () => {
    const pickup = await newPickup()
    const before = await one(`SELECT phone FROM customers WHERE id = $1`, [ids.customer])
    const shared = await pickups.recordPickupShare(admin, pickup.id, '98765 43210')
    expect(shared.customer_phone).toBe('919876543210')
    expect(await one(`SELECT phone FROM customers WHERE id = $1`, [ids.customer])).toEqual(before)
    expect((await one(`SELECT event_type FROM tracking_pickup_events WHERE pickup_id = $1 ORDER BY occurred_at DESC LIMIT 1`, [pickup.id])).event_type).toBe('WHATSAPP_OPENED')
    await expect(pickups.recordPickupShare(admin, pickup.id, '123')).rejects.toThrow(/valid WhatsApp number/)
  })

  it('writes the pickup details into the message', async () => {
    const unit = await stockedUnit(2.5)
    const pickup = await newPickup()
    await pickups.addPickupUnit(admin, pickup.id, unit.qr_reference, null)
    const { message } = await pickups.getPickupDetail(admin, pickup.id)
    expect(message).toContain(pickup.pickup_no)
    expect(message).toContain('1 bundle, 2.500 MT')
    expect(message).toContain('Collect from: Main')
  })
})

describe('GPS', () => {
  const position = { latitude: 17.385044, longitude: 78.486671, accuracy_m: 12.5 }
  const positions = async (unitId: string) => q(
    `SELECT p.latitude::text FROM tracking_event_positions p JOIN tracking_events e ON e.id = p.event_id WHERE e.tracking_unit_id = $1`, [unitId])

  it('stores nothing while the company has GPS off', async () => {
    const unit = await stockedUnit(1, false)
    await floor.placeUnit(admin, unit.id, rackA.code, position)
    expect(await positions(unit.id)).toHaveLength(0)
  })

  it('stores the position of a scan once GPS is on', async () => {
    await service.setGpsFlag(admin, ids.company, true)
    const unit = await stockedUnit(1, false)
    await floor.placeUnit(admin, unit.id, rackA.code, position)
    expect((await positions(unit.id))[0].latitude).toBe('17.385044')
  })

  it('a bad or refused position never stops the scan', async () => {
    for (const bad of [null, {}, { latitude: 'x', longitude: 1 }, { latitude: 500, longitude: 900 }, 'nowhere']) {
      const unit = await stockedUnit(1, false)
      expect((await floor.placeUnit(admin, unit.id, rackA.code, bad)).lifecycle_status).toBe('IN_STOCK')
      expect(await positions(unit.id)).toHaveLength(0)
    }
    const unit = await stockedUnit(1, false)
    await client.query(`SELECT place_tracking_unit($1::uuid, $2::uuid, '{"latitude":"1e999","longitude":"abc"}'::jsonb, $3::uuid)`, [unit.id, rackA.id, ids.user])
    expect(await status(unit.id)).toBe('IN_STOCK')
  })

  it('the 90-day clean-up removes old positions and keeps the event', async () => {
    const unit = await stockedUnit(1, false)
    await floor.placeUnit(admin, unit.id, rackA.code, position)
    await client.query(`UPDATE tracking_event_positions SET captured_at = now() - interval '91 days' WHERE event_id IN (SELECT id FROM tracking_events WHERE tracking_unit_id = $1)`, [unit.id])
    expect(await floor.purgeExpiredPositions()).toBeGreaterThan(0)
    expect(await positions(unit.id)).toHaveLength(0)
    expect((await one(`SELECT count(*)::int AS n FROM tracking_events WHERE tracking_unit_id = $1 AND event_type = 'PUT_AWAY'`, [unit.id])).n).toBe(1)
    await service.setGpsFlag(admin, ids.company, false)
  })
})

describe('Labelling existing stock', () => {
  const weighed = (...weights: string[]) => weights.map((quantity) => ({ quantity, weight_basis: 'weighed' }))
  const verify = (line: string, bundles: unknown, note: string | null = null) => floor.verifyExistingStock(admin, {
    purchase_line_id: line, company_id: ids.company, warehouse_id: ids.warehouse, bundles, note,
  })

  it('a late-entered old bill is not offered as a new purchase', async () => {
    const line = await newLine(4, ids.oldBill)
    expect((await service.listEligibleLines(admin)).map((l) => l.purchase_line_id)).not.toContain(line)
    await expect(service.createUnits(admin, line, null)).rejects.toThrow(/before QR tracking started/)
    expect((await floor.listVerifiableLines(admin, line)).map((l) => l.purchase_line_id)).toContain(line)
  })

  it('a new purchase cannot be labelled as old stock', async () => {
    await expect(verify(await newLine(4), weighed('4'))).rejects.toThrow(/Receive & Label/)
  })

  it('records the weighed and book quantity, and never changes the ledger', async () => {
    const line = await newLine(10, ids.oldBill)
    const ledgerBefore = await q(`SELECT id, quantity::text FROM stock_ledger ORDER BY id`)
    const balance = await one(`SELECT COALESCE(SUM(quantity), 0)::text AS q FROM stock_ledger WHERE purchase_line_id = $1`, [line])

    const units = await verify(line, weighed('2.500', '1.500'), 'Found behind rack C')
    expect(units.map((u) => `${u.bundle_no}/${u.bundle_count}`)).toEqual(['1/2', '2/2'])
    expect(units.every((u) => u.source_type === 'VERIFIED_EXISTING' && u.lifecycle_status === 'LABELLED')).toBe(true)

    const check = await one(`SELECT verified_quantity::text, book_quantity::text, note FROM tracking_verifications WHERE purchase_line_id = $1`, [line])
    expect(check.verified_quantity).toBe('4.000')
    expect(Number(check.book_quantity)).toBe(Number(balance.q))
    expect(check.note).toBe('Found behind rack C')
    expect(await q(`SELECT id, quantity::text FROM stock_ledger ORDER BY id`)).toEqual(ledgerBefore)
  })

  it('a later batch carries on the bundle numbers', async () => {
    const line = await newLine(10, ids.oldBill)
    await verify(line, weighed('1'))
    const second = await verify(line, weighed('2', '3'))
    expect(second.map((u) => `${u.bundle_no}/${u.bundle_count}`)).toEqual(['2/3', '3/3'])
  })

  it('verified stock is not warned about as a short purchase line', async () => {
    const line = await newLine(10, ids.oldBill)
    const [unit] = await verify(line, weighed('1'))
    const scan = await service.lookupCode(admin, unit.qr_reference)
    expect(scan.kind === 'found' && scan.warnings.join()).not.toMatch(/labels total/)
  })

  it('warns when bundles on hand exceed the book stock, but still allows it', async () => {
    const line = await newLine(10, ids.oldBill)
    const [unit] = await verify(line, weighed('12'))
    const scan = await service.lookupCode(admin, unit.qr_reference)
    expect(scan.kind === 'found' && scan.warnings.join()).toMatch(/above its book stock/)
  })

  it('a verification record is permanent', async () => {
    const row = await one(`SELECT id FROM tracking_verifications LIMIT 1`)
    await expect(client.query(`UPDATE tracking_verifications SET note = 'x' WHERE id = $1`, [row.id])).rejects.toThrow(/permanent/)
  })
})

describe('Permissions and scope', () => {
  it('each role can only do what the approved table allows', async () => {
    const unit = await stockedUnit()
    const pickup = await newPickup()
    const billing = actorFor('billing_staff')
    const sales = actorFor('sales_manager')

    await expect(floor.placeUnit(billing, unit.id, 'B-02')).resolves.toBeTruthy()
    await expect(floor.placeUnit(sales, unit.id, 'A-01')).rejects.toThrow(/Insufficient/)
    await expect(floor.changeUnitStatus(billing, unit.id, 'ON_HOLD', { reason: 'x' })).rejects.toThrow(/Insufficient/)
    await expect(floor.splitUnit(billing, unit.id, [], 'x')).rejects.toThrow(/Insufficient/)
    await expect(floor.createLocation(billing, { company_id: ids.company, warehouse_id: ids.warehouse, code: 'NOPE' })).rejects.toThrow(/Insufficient/)
    await expect(floor.listVerifiableLines(billing)).rejects.toThrow(/Insufficient/)
    await expect(pickups.cancelPickup(billing, pickup.id, 'x')).rejects.toThrow(/Insufficient/)
    await expect(pickups.addPickupUnit(sales, pickup.id, unit.qr_reference, null)).rejects.toThrow(/Insufficient/)
    await expect(pickups.createPickup(sales, { company_id: ids.company, warehouse_id: ids.warehouse, customer_id: ids.customer })).resolves.toBeTruthy()
    await expect(service.setGpsFlag(actorFor('company_manager'), ids.company, true)).rejects.toThrow(/Insufficient/)
  })

  it('another company cannot see or touch this company\'s records', async () => {
    const unit = await stockedUnit()
    const pickup = await newPickup()
    const outsider = actorFor('company_manager', ids.otherCompany)
    expect(await floor.listLocations(outsider)).toHaveLength(0)
    expect(await pickups.listPickups(outsider)).toHaveLength(0)
    await expect(floor.placeUnit(outsider, unit.id, 'A-01')).rejects.toThrow(/not found/)
    await expect(pickups.getPickupDetail(outsider, pickup.id)).rejects.toThrow(/not found/)
    await expect(pickups.addPickupUnit(outsider, pickup.id, unit.qr_reference, null)).rejects.toThrow(/not found/)
  })

  it('a warehouse manager stays inside their warehouse', async () => {
    const pickup = await newPickup()
    const manager = actorFor('warehouse_manager', ids.company, ids.warehouse2)
    await expect(pickups.getPickupDetail(manager, pickup.id)).rejects.toThrow(/not found/)
    expect((await floor.listLocations(manager)).every((l) => l.warehouse_id === ids.warehouse2)).toBe(true)
  })

  it('switching tracking off stops scans but keeps the records', async () => {
    const unit = await stockedUnit(1, false)
    await service.setFeatureFlag(admin, ids.company, ids.warehouse, false)
    try {
      await expect(floor.placeUnit(admin, unit.id, 'A-01')).rejects.toThrow(/switched off/)
      expect((await service.getUnitDetail(admin, unit.id)).unit.id).toBe(unit.id)
    } finally {
      await service.setFeatureFlag(admin, ids.company, ids.warehouse, null)
    }
  })
})

describe('Nothing in Phase 3 touches existing data', () => {
  it('a full run of every flow leaves all existing tables identical', async () => {
    const unit = await stockedUnit(6)
    const other = await stockedUnit(2)
    const oldLine = await newLine(5, ids.oldBill)
    const sale = await saleFor(ids.customer, [{ line: unit.purchase_line_id, quantity: 2 }])
    const before = await existingDataFingerprint()

    await floor.placeUnit(admin, unit.id, 'B-02')
    await floor.changeUnitStatus(admin, other.id, 'ON_HOLD', { reason: 'Check' })
    await floor.changeUnitStatus(admin, other.id, 'IN_STOCK', {})
    const [take] = await floor.splitUnit(admin, unit.id, [{ quantity: '2', weight_basis: 'weighed' }, { quantity: '4', weight_basis: 'weighed' }], 'Part sale')
    await floor.verifyExistingStock(admin, { purchase_line_id: oldLine, company_id: ids.company, warehouse_id: ids.warehouse, bundles: [{ quantity: '1', weight_basis: 'weighed' }] })
    const pickup = await newPickup()
    await pickups.linkPickupSale(admin, pickup.id, sale)
    await pickups.addPickupUnit(admin, pickup.id, take.qr_reference, null)
    await pickups.recordPickupShare(admin, pickup.id, '9876543210')
    await pickups.markPickupReady(admin, pickup.id, 'BAY-1')
    await pickups.handOverPickup(admin, pickup.id, { collector_name: 'Ravi', vehicle_number: 'TS09' })
    await floor.changeUnitStatus(admin, take.id, 'IN_STOCK', { location: 'A-01', reason: 'Returned' })

    expect(await existingDataFingerprint()).toEqual(before)
  })

  it('a pickup, its history and a location cannot be deleted', async () => {
    const pickup = await newPickup()
    await expect(client.query(`DELETE FROM tracking_pickups WHERE id = $1`, [pickup.id])).rejects.toThrow(/cannot be deleted/)
    const event = await one(`SELECT id FROM tracking_pickup_events WHERE pickup_id = $1`, [pickup.id])
    await expect(client.query(`DELETE FROM tracking_pickup_events WHERE id = $1`, [event.id])).rejects.toThrow(/permanent/)
  })

  it('a full backup restored over itself keeps every tracking record', async () => {
    const tracked = (await q(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'tracking\\_%' ORDER BY 1`)).map((r) => r.tablename as string)
    // 13 from Phases 2 and 3, 5 from Phase 4 (migration 180) and 3 from Phase 5 (migration 181).
    expect(tracked).toHaveLength(21)
    const read = async () => Object.fromEntries(await Promise.all(tracked.map(async (t) => [t, (await q(`SELECT t::text AS v FROM "${t}" t ORDER BY 1`)).map((r) => r.v)])))
    const before = await read()
    const data = await backup.getAllTableData()
    for (const table of tracked) expect(data[table]?.length, table).toBe(before[table].length)

    const result = await backup.restoreFromBackup(data, { truncateFirst: true })
    expect(Object.entries(result.tableResults).filter(([, r]) => r.failed > 0)).toEqual([])
    expect(await read()).toEqual(before)
  })

  it('a warehouse merge carries locations and pickups, and renames a clashing code', async () => {
    const jwt = (await import('jsonwebtoken')).default
    const { NextRequest } = await import('next/server')
    process.env.JWT_SECRET = 'phase3-merge-secret'
    const merge = await import('@/app/api/warehouses/merge/route')
    const source = (await one(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'Merge me') RETURNING id`, [ids.company])).id
    const target = (await one(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'Keep me') RETURNING id`, [ids.company])).id
    const clash = await floor.createLocation(admin, { company_id: ids.company, warehouse_id: source, code: 'SAME-1' })
    const kept = await floor.createLocation(admin, { company_id: ids.company, warehouse_id: target, code: 'SAME-1' })
    const pickup = await pickups.createPickup(admin, { company_id: ids.company, warehouse_id: source, customer_id: ids.customer })

    const cookie = `wc_session=${jwt.sign({ userId: ids.user, email: 'a@b.c', role: 'admin', fullName: 'T' }, process.env.JWT_SECRET, { algorithm: 'HS256' })}`
    const res = await merge.POST(new NextRequest('http://localhost/api/warehouses/merge', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ sourceId: source, targetId: target }),
    }))
    expect(res.status).toBe(200)

    const moved = await one(`SELECT warehouse_id, code FROM tracking_locations WHERE id = $1`, [clash.id])
    expect(moved.warehouse_id).toBe(target)
    expect(moved.code).toMatch(/^SAME-1-[0-9A-F]{6}$/)
    expect((await one(`SELECT code FROM tracking_locations WHERE id = $1`, [kept.id])).code).toBe('SAME-1')
    expect((await one(`SELECT warehouse_id FROM tracking_pickups WHERE id = $1`, [pickup.id])).warehouse_id).toBe(target)
  })
})
