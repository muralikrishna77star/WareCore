// Phase 4 of QR tracking: job work. Vendor dispatches, bundles back
// unprocessed, moves between vendors, vendor pickups, output receipts with
// made-from links and vendor stock. Runs the real service against a throwaway
// Postgres with every migration applied.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { startTestDb } from '../../scripts/test/testDb.mjs'
import type { TrackingActor } from '@/lib/tracking/access'
import type { TrackingUnit } from '@/lib/tracking/constants'

let db: Awaited<ReturnType<typeof startTestDb>>
let client: pg.Client
let service: typeof import('@/lib/tracking/service')
let floor: typeof import('@/lib/tracking/floor')
let pickups: typeof import('@/lib/tracking/pickups')
let jobwork: typeof import('@/lib/tracking/jobwork')
let zpl: typeof import('@/lib/tracking/zpl')
let pool: typeof import('@/lib/localdb/pool')
let backup: typeof import('@/lib/backup/backup.service')

const ids: Record<string, string> = {}
let admin: TrackingActor
let fingerprintBefore: Record<string, string>

const q = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0]
const today = `(now() AT TIME ZONE 'Asia/Kolkata')::date`
const todayText = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

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

/** Fixture rows in existing tables, written without their triggers, before the fingerprint is taken. */
async function fixture<T>(write: () => Promise<T>): Promise<T> {
  await client.query(`SET session_replication_role = replica`)
  try {
    return await write()
  } finally {
    await client.query(`SET session_replication_role = origin`)
  }
}

let lineSeq = 0
async function newLine(quantity = 10) {
  lineSeq += 1
  const row = await one(
    `INSERT INTO purchase_bill_items (bill_id, material_type_id, item_master_id, purchase_line_id, quantity, unit, rate, amount)
     VALUES ($1, $2, $3, $4, $5, 'MT', 100, 1000) RETURNING purchase_line_id`,
    [ids.bill, ids.material, ids.item, `P4${String(lineSeq).padStart(4, '0')}-0001`, quantity])
  return row.purchase_line_id as string
}

const actorFor = (role: string, companyId: string | null = ids.company): TrackingActor => ({
  userId: ids.user, role, companyId, warehouseId: null, allCompanies: role === 'admin' || role === 'developer',
})

const lines: string[] = []
/** A labelled bundle put away at rack A, from one of the lines made in beforeAll. */
async function stockedUnit(lineIndex: number, quantity: string): Promise<TrackingUnit> {
  const line = lines[lineIndex]
  const existing = await one(`SELECT count(*)::int AS n FROM tracking_units WHERE purchase_line_id = $1`, [line])
  if (existing.n === 0) {
    const full = await one(`SELECT quantity::text FROM purchase_bill_items WHERE purchase_line_id = $1`, [line])
    // One bundle per line: the line is made with exactly the bundle's weight.
    expect(Number(full.quantity)).toBe(Number(quantity))
  }
  const [unit] = await service.createUnits(admin, line, null)
  return floor.placeUnit(admin, unit.id, 'A-01')
}

const status = async (id: string) => (await one(`SELECT lifecycle_status, current_vendor_id::text AS vendor FROM tracking_units WHERE id = $1`, [id]))
const newDispatch = (vendor = ids.vendorA) => jobwork.createDispatch(admin, { company_id: ids.company, warehouse_id: ids.warehouse, vendor_id: vendor, vehicle_number: 'ts09 ab 1234' })

/** Bundles sent to a vendor on one dispatch. */
async function sentBundles(unitList: TrackingUnit[], vendor = ids.vendorA) {
  const dispatch = await newDispatch(vendor)
  for (const unit of unitList) await jobwork.addDispatchUnit(admin, dispatch.id, unit.qr_reference)
  return jobwork.sendDispatch(admin, dispatch.id, {})
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
  jobwork = await import('@/lib/tracking/jobwork')
  zpl = await import('@/lib/tracking/zpl')
  pool = await import('@/lib/localdb/pool')
  backup = await import('@/lib/backup/backup.service')

  ids.company = (await one(`INSERT INTO companies (name, code) VALUES ('Job Co', 'JC') RETURNING id`)).id
  ids.otherCompany = (await one(`INSERT INTO companies (name, code) VALUES ('Other Co', 'OC') RETURNING id`)).id
  ids.warehouse = (await one(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'Main') RETURNING id`, [ids.company])).id
  ids.supplier = (await one(`INSERT INTO suppliers (name) VALUES ('Coil Mill') RETURNING id`)).id
  ids.vendorA = (await one(`INSERT INTO suppliers (name) VALUES ('Slitter A') RETURNING id`)).id
  ids.vendorB = (await one(`INSERT INTO suppliers (name) VALUES ('Galvaniser B') RETURNING id`)).id
  ids.material = (await one(`INSERT INTO material_types (code, description, unit) VALUES ('JC', 'Job steel', 'MT') RETURNING id`)).id
  ids.item = (await one(`INSERT INTO item_master (item_code, item_name, material_type_id) VALUES ('JC00001', 'CR coil', $1) RETURNING id`, [ids.material])).id
  ids.outItem = (await one(
    `INSERT INTO item_master (item_code, item_name, material_type_id, size_label) VALUES ('JC00002', 'Slit coil', $1, '0.80 X 150') RETURNING id`,
    [ids.material])).id
  ids.customer = (await one(`INSERT INTO customers (name) VALUES ('Acme Fabricators') RETURNING id`)).id
  ids.user = (await one(
    `INSERT INTO user_profiles (full_name, role, email, password_hash, is_active) VALUES ('Admin', 'admin', $1, 'x', true) RETURNING id`,
    [`${randomUUID()}@test.local`])).id
  admin = actorFor('admin', null)

  await service.setFeatureFlag(admin, ids.company, null, true)
  ids.bill = (await one(
    `INSERT INTO purchase_bills (supplier_id, company_id, warehouse_id, bill_number, bill_date, status)
     VALUES ($1, $2, $3, 'JW-BILL-1', ${today}, 'active') RETURNING id`, [ids.supplier, ids.company, ids.warehouse])).id
  // One purchase line per bundle used below.
  for (const quantity of [4, 3, 5, 2, 6, 2.5, 1.2, 3, 3, 4, 2, 1, 1, 2, 2]) lines.push(await newLine(quantity))

  await floor.createLocation(admin, { company_id: ids.company, warehouse_id: ids.warehouse, code: 'A-01' })
  await floor.createLocation(admin, { company_id: ids.company, warehouse_id: ids.warehouse, code: 'B-01' })

  // Existing job work records, read by tracking and never changed by it.
  await fixture(async () => {
    ids.order = (await one(
      `INSERT INTO job_work_orders (reference_number, vendor_id, company_id, warehouse_id, dispatch_date, status)
       VALUES ('JW-TEST-1', $1, $2, $3, ${today}, 'dispatched') RETURNING id`, [ids.vendorA, ids.company, ids.warehouse])).id
    ids.orderB = (await one(
      `INSERT INTO job_work_orders (reference_number, vendor_id, company_id, warehouse_id, dispatch_date, status)
       VALUES ('JW-TEST-B', $1, $2, $3, ${today}, 'dispatched') RETURNING id`, [ids.vendorB, ids.company, ids.warehouse])).id
    ids.input0 = (await one(
      `INSERT INTO job_work_items (job_work_order_id, material_type_id, item_master_id, quantity_sent, quantity_received, unit, purchase_line_id, job_line_id)
       VALUES ($1, $2, $3, 4, 0, 'MT', $4, 'JC-IN-0001') RETURNING id`, [ids.order, ids.material, ids.item, lines[0]])).id
    ids.input1 = (await one(
      `INSERT INTO job_work_items (job_work_order_id, material_type_id, item_master_id, quantity_sent, quantity_received, unit, purchase_line_id, job_line_id)
       VALUES ($1, $2, $3, 2.5, 0, 'MT', $4, 'JC-IN-0002') RETURNING id`, [ids.order, ids.material, ids.item, lines[1]])).id
    ids.outputLine = (await one(
      `INSERT INTO job_work_output_items (job_work_order_id, item_master_id, material_type_id, size_label, quantity, unit, source_purchase_line_ids)
       VALUES ($1, $2, $3, '0.80 X 150', 6.5, 'MT', $4::jsonb) RETURNING id`,
      [ids.order, ids.outItem, ids.material, JSON.stringify([lines[2], lines[3]])])).id
    ids.transfer = (await one(
      `INSERT INTO job_work_transfers (transfer_number, transfer_date, from_job_work_order_id, from_vendor_id, to_job_work_order_id, to_vendor_id)
       VALUES ('TR-TEST-1', ${today}, $1, $2, $3, $4) RETURNING id`, [ids.order, ids.vendorA, ids.orderB, ids.vendorB])).id
    ids.vendorSale = (await one(
      `INSERT INTO dispatch_orders (invoice_number, customer_id, company_id, warehouse_id, dispatch_date, status, is_vendor_direct, source_job_work_order_id)
       VALUES ('VDS-1', $1, $2, $3, ${today}, 'active', true, $4) RETURNING id`, [ids.customer, ids.company, ids.warehouse, ids.order])).id
    await client.query(
      `INSERT INTO dispatch_items (dispatch_order_id, material_type_id, item_master_id, quantity, unit, purchase_line_id, sale_line_id)
       VALUES ($1, $2, $3, 1.2, 'MT', $4, 'SL-VDS-1')`, [ids.vendorSale, ids.material, ids.item, lines[6]])
    ids.yardSale = (await one(
      `INSERT INTO dispatch_orders (invoice_number, customer_id, company_id, warehouse_id, dispatch_date, status, is_vendor_direct)
       VALUES ('YARD-1', $1, $2, $3, ${today}, 'active', false) RETURNING id`, [ids.customer, ids.company, ids.warehouse])).id
  })

  fingerprintBefore = await existingDataFingerprint()
}, 300_000)

afterAll(async () => {
  await pool?.closePool()
  await client?.end()
  await db?.stop()
}, 60_000)

describe('Vendor dispatch', () => {
  it('scans bundles onto a dispatch, and sending moves them all to the vendor together', async () => {
    const first = await stockedUnit(0, '4')
    const second = await stockedUnit(1, '3')
    const dispatch = await newDispatch()
    expect(dispatch.dispatch_no).toMatch(/^VD[0-9]{4}-0001$/)
    expect(dispatch.vehicle_number).toBe('TS09 AB 1234')

    await jobwork.addDispatchUnit(admin, dispatch.id, first.qr_reference)
    await jobwork.addDispatchUnit(admin, dispatch.id, second.stock_tracking_id)
    expect((await status(first.id)).lifecycle_status).toBe('IN_STOCK')

    const sent = await jobwork.sendDispatch(admin, dispatch.id, {})
    expect(sent.status).toBe('SENT')
    expect(sent.bundle_count).toBe(2)
    for (const unit of [first, second]) {
      const row = await one(`SELECT lifecycle_status, current_vendor_name, current_location_id, at_vendor_since FROM tracking_units WHERE id = $1`, [unit.id])
      expect(row.lifecycle_status).toBe('AT_VENDOR')
      expect(row.current_vendor_name).toBe('Slitter A')
      expect(row.current_location_id).toBeNull()
      expect(row.at_vendor_since).not.toBeNull()
    }
    const event = await one(`SELECT details FROM tracking_events WHERE tracking_unit_id = $1 AND event_type = 'SENT_TO_VENDOR'`, [first.id])
    expect(event.details.dispatch_no).toBe(dispatch.dispatch_no)
    await expect(jobwork.addDispatchUnit(admin, dispatch.id, (await stockedUnit(2, '5')).qr_reference)).rejects.toThrow(/while a dispatch is open/)
  })

  it('keeps a bundle on one live dispatch only, and off yard pickups while it is loading', async () => {
    const unit = await stockedUnit(3, '2')
    const dispatch = await newDispatch()
    await jobwork.addDispatchUnit(admin, dispatch.id, unit.qr_reference)
    await expect(jobwork.addDispatchUnit(admin, (await newDispatch()).id, unit.qr_reference)).rejects.toThrow(/already on dispatch/)
    const pickup = await pickups.createPickup(admin, { company_id: ids.company, warehouse_id: ids.warehouse, customer_id: ids.customer })
    await expect(pickups.addPickupUnit(admin, pickup.id, unit.qr_reference, null)).rejects.toThrow(/on vendor dispatch/)

    await jobwork.cancelDispatch(admin, dispatch.id, 'Truck did not come')
    expect((await status(unit.id)).lifecycle_status).toBe('IN_STOCK')
    const again = await newDispatch()
    await jobwork.addDispatchUnit(admin, again.id, unit.qr_reference)
    await jobwork.removeDispatchUnit(admin, again.id, unit.id, 'Wrong bundle')
    expect((await pickups.addPickupUnit(admin, pickup.id, unit.qr_reference, null)).needsReason).toBe(false)
  })

  it('refuses to send when a bundle on it changed since it was scanned, and sends nothing', async () => {
    const ok = await stockedUnit(4, '6')
    const held = await stockedUnit(5, '2.5')
    const dispatch = await newDispatch()
    await jobwork.addDispatchUnit(admin, dispatch.id, ok.qr_reference)
    await jobwork.addDispatchUnit(admin, dispatch.id, held.qr_reference)
    await floor.changeUnitStatus(admin, held.id, 'ON_HOLD', { reason: 'Rust' })
    await expect(jobwork.sendDispatch(admin, dispatch.id, {})).rejects.toThrow(/is now on hold/)
    expect((await status(ok.id)).lifecycle_status).toBe('IN_STOCK')
    expect((await one(`SELECT status FROM tracking_vendor_dispatches WHERE id = $1`, [dispatch.id])).status).toBe('OPEN')
    await jobwork.removeDispatchUnit(admin, dispatch.id, held.id, 'On hold')
    await jobwork.sendDispatch(admin, dispatch.id, {})
    expect((await status(ok.id)).lifecycle_status).toBe('AT_VENDOR')
  })

  it('two people scanning one bundle onto two dispatches at once put it on only one', async () => {
    const unit = await stockedUnit(14, '2')
    const [left, right] = [await newDispatch(), await newDispatch()]
    const results = await Promise.allSettled([
      jobwork.addDispatchUnit(admin, left.id, unit.qr_reference),
      jobwork.addDispatchUnit(admin, right.id, unit.qr_reference),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.message).toMatch(/already on dispatch/)
    expect((await one(`SELECT count(*)::int AS n FROM tracking_vendor_dispatch_units WHERE tracking_unit_id = $1 AND removed_at IS NULL`, [unit.id])).n).toBe(1)
    for (const d of [left, right]) await jobwork.cancelDispatch(admin, d.id, 'Test only')
  })

  it('links a job work order later, matching each bundle to its input line, and warns about differences', async () => {
    const [dispatch] = (await jobwork.listDispatches(admin, { search: 'Slitter' })).filter((d) => d.bundle_count === 2 && d.status === 'SENT')
    expect((await jobwork.getDispatchDetail(admin, dispatch.id)).warnings).toContain('No job work order is linked yet')
    await expect(jobwork.linkDispatchOrder(admin, dispatch.id, ids.orderB)).rejects.toThrow(/different vendor/)
    expect((await jobwork.listDispatchOrders(admin, dispatch.id, '')).map((o) => o.reference_number)).toEqual(['JW-TEST-1'])

    await jobwork.linkDispatchOrder(admin, dispatch.id, ids.order)
    const detail = await jobwork.getDispatchDetail(admin, dispatch.id)
    expect(detail.dispatch.job_work_reference).toBe('JW-TEST-1')
    expect(detail.lines.map((l) => l.job_line_id).sort()).toEqual(['JC-IN-0001', 'JC-IN-0002'])
    // Bundle 2 weighs 3, the order sent 2.5 on that line.
    expect(detail.warnings).toEqual(['Bundles sent for input line JC-IN-0002 total 3.000, but the job work order sent 2.500'])
  })
})

describe('Back unprocessed and moves between vendors', () => {
  it('a bundle that comes back whole keeps its label and can go out again', async () => {
    const unit = await stockedUnit(6, '1.2')
    await sentBundles([unit])
    await expect(floor.placeUnit(admin, unit.id, 'B-01')).rejects.toThrow(/at a vendor cannot be moved/)
    await expect(service.voidUnit(admin, unit.id, 'test')).rejects.toThrow(/cannot be voided while it is at a vendor/)

    const back = await jobwork.returnFromVendor(admin, unit.id, { location: 'B-01', reason: 'Not needed' })
    expect(back.lifecycle_status).toBe('IN_STOCK')
    expect(back.location_code).toBe('B-01')
    expect(back.stock_tracking_id).toBe(unit.stock_tracking_id)
    expect((await one(`SELECT closed_reason FROM tracking_vendor_dispatch_units WHERE tracking_unit_id = $1`, [unit.id])).closed_reason).toBe('Returned unprocessed')
    await sentBundles([unit])
    expect((await status(unit.id)).lifecycle_status).toBe('AT_VENDOR')
  })

  it('moves bundles to another vendor and links the WareCore transfer later', async () => {
    const unit = await stockedUnit(7, '3')
    await sentBundles([unit])
    await expect(jobwork.moveUnitsToVendor(admin, { unit_ids: [unit.id], to_vendor_id: ids.vendorA, moved_on: todayText() })).rejects.toThrow(/already at Slitter A/)
    await expect(jobwork.moveUnitsToVendor(admin, { unit_ids: [unit.id], to_vendor_id: ids.vendorB, moved_on: '2099-01-01' })).rejects.toThrow(/not a valid date/)
    expect(await jobwork.moveUnitsToVendor(admin, { unit_ids: [unit.id], to_vendor_id: ids.vendorB, moved_on: todayText(), reason: 'For galvanising' })).toBe(1)
    expect((await status(unit.id)).vendor).toBe(ids.vendorB)

    const [move] = await jobwork.listRecentMoves(admin, true)
    expect(move.from_vendor_name).toBe('Slitter A')
    expect((await jobwork.listMoveTransfers(admin, move.id, '')).map((t) => t.transfer_number)).toEqual(['TR-TEST-1'])
    expect((await jobwork.linkMoveTransfer(admin, move.id, ids.transfer)).transfer_number).toBe('TR-TEST-1')
    await expect(client.query(`DELETE FROM tracking_vendor_moves WHERE id = $1`, [move.id])).rejects.toThrow(/cannot be deleted/)
  })
})

describe('Outputs and genealogy', () => {
  it('an output made from two purchase lines lists both, and its sources become Processed', async () => {
    const a = await stockedUnit(8, '3')
    const b = await stockedUnit(9, '4')
    await sentBundles([a, b])
    const { receipt, units } = await jobwork.createReceipt(admin, {
      company_id: ids.company, warehouse_id: ids.warehouse, vendor_id: ids.vendorA, received_on: todayText(),
      outputs: [
        { item_master_id: ids.outItem, quantity: '3.400', weight_basis: 'weighed', parents: [a.id, b.id] },
        { item_master_id: ids.outItem, quantity: '3.300', weight_basis: 'weighed', parents: [a.id, b.id] },
      ],
      used_up: [a.id, b.id],
    })
    expect(receipt.receipt_no).toMatch(/^JR[0-9]{4}-0001$/)
    expect(units).toHaveLength(2)
    const [output] = units
    expect(output.source_type).toBe('JOB_WORK_OUTPUT')
    expect(output.purchase_line_id).toBeNull()
    expect(output.lifecycle_status).toBe('LABELLED')
    expect(output.size_label).toBe('0.80 X 150')
    expect(output.item_code).toBe('JC00002')

    const origins = await q(`SELECT purchase_line_id, quantity::text FROM tracking_unit_origins WHERE tracking_unit_id = $1 ORDER BY 1`, [output.id])
    expect(origins).toEqual([{ purchase_line_id: lines[8], quantity: '3.000' }, { purchase_line_id: lines[9], quantity: '4.000' }])
    expect((await status(a.id)).lifecycle_status).toBe('PROCESSED')
    expect((await status(b.id)).lifecycle_status).toBe('PROCESSED')

    const label = zpl.labelFieldsForUnit(output)
    expect(label.BUNDLE).toBe('Output 1 of 2')
    expect(label.LINE_AND_DATE.startsWith(receipt.receipt_no)).toBe(true)

    const tree = await jobwork.unitGenealogy(admin, output.id)
    expect(tree.madeFrom.map((n) => n.stock_tracking_id).sort()).toEqual([a.stock_tracking_id, b.stock_tracking_id].sort())
    expect(tree.origins).toHaveLength(2)
    const down = await jobwork.unitGenealogy(admin, a.id)
    expect(down.became.map((n) => n.stock_tracking_id).sort()).toEqual(units.map((u) => u.stock_tracking_id).sort())

    // Searching either purchase line finds the output.
    const found = await service.listUnits(admin, { search: lines[9] })
    expect(found.map((u) => u.id)).toEqual(expect.arrayContaining([b.id, output.id]))

    const printer = await one(`INSERT INTO tracking_printers (company_id, warehouse_id, name) VALUES ($1, $2, 'Dock') RETURNING id`, [ids.company, ids.warehouse])
    await expect(service.requestPrint(admin, a.id, printer.id, null)).rejects.toThrow(/used up in job work/)
    expect((await service.requestPrint(admin, output.id, printer.id, null)).label.fields.BUNDLE).toBe('Output 1 of 2')
    await floor.placeUnit(admin, output.id, 'A-01')
    expect((await status(output.id)).lifecycle_status).toBe('IN_STOCK')
  })

  it('an output from one purchase line keeps that line and its bill', async () => {
    const unit = await stockedUnit(10, '2')
    await sentBundles([unit])
    const { units } = await jobwork.createReceipt(admin, {
      company_id: ids.company, warehouse_id: ids.warehouse, vendor_id: ids.vendorA, received_on: todayText(),
      outputs: [{ item_master_id: ids.outItem, size_label: '0.80 X 100', quantity: '1.950', weight_basis: 'weighed', parents: [unit.id] }],
      used_up: [unit.id],
    })
    expect(units[0].purchase_line_id).toBe(lines[10])
    expect(units[0].bill_number).toBe('JW-BILL-1')
    expect(units[0].size_label).toBe('0.80 X 100')
    expect(await service.sourceWarnings(units[0])).toEqual([])
  })

  it('a source bundle can feed two receipts until used up, and a lighter remainder gets its own label', async () => {
    const unit = await stockedUnit(11, '1')
    await sentBundles([unit])
    await jobwork.createReceipt(admin, {
      company_id: ids.company, warehouse_id: ids.warehouse, vendor_id: ids.vendorA, received_on: todayText(),
      outputs: [{ item_master_id: ids.outItem, quantity: '0.400', weight_basis: 'weighed', parents: [unit.id] }],
    })
    expect((await status(unit.id)).lifecycle_status).toBe('AT_VENDOR')

    await expect(jobwork.createReceipt(admin, {
      company_id: ids.company, warehouse_id: ids.warehouse, vendor_id: ids.vendorA, received_on: todayText(),
      remainders: [{ parent: unit.id, quantity: '1.000', weight_basis: 'weighed' }],
    })).rejects.toThrow(/must weigh less/)

    const { units } = await jobwork.createReceipt(admin, {
      company_id: ids.company, warehouse_id: ids.warehouse, vendor_id: ids.vendorA, received_on: todayText(),
      remainders: [{ parent: unit.id, quantity: '0.550', weight_basis: 'weighed' }],
    })
    const [rest] = units
    expect(rest.source_type).toBe('JOB_WORK_REMAINDER')
    expect(rest.purchase_line_id).toBe(lines[11])
    expect(zpl.labelFieldsForUnit(rest).BUNDLE).toBe('Remainder of bundle 1')
    expect((await one(`SELECT quantity::text FROM tracking_unit_origins WHERE tracking_unit_id = $1`, [rest.id])).quantity).toBe('0.550')
    expect((await one(`SELECT relation FROM tracking_unit_lineage WHERE child_unit_id = $1`, [rest.id])).relation).toBe('REMAINDER_OF')
    expect((await status(unit.id)).lifecycle_status).toBe('PROCESSED')
  })

  it('refuses sources that are not at that vendor, and used-up bundles that were not used', async () => {
    const atA = await stockedUnit(12, '1')
    const home = await stockedUnit(13, '2')
    await sentBundles([atA])
    const base = { company_id: ids.company, warehouse_id: ids.warehouse, received_on: todayText() }
    await expect(jobwork.createReceipt(admin, { ...base, vendor_id: ids.vendorB, outputs: [{ item_master_id: ids.outItem, quantity: '1', parents: [atA.id] }] }))
      .rejects.toThrow(/is not at Galvaniser B/)
    await expect(jobwork.createReceipt(admin, { ...base, vendor_id: ids.vendorA, outputs: [{ item_master_id: ids.outItem, quantity: '1', parents: [home.id] }] }))
      .rejects.toThrow(/is not at Slitter A/)
    await expect(jobwork.createReceipt(admin, { ...base, vendor_id: ids.vendorA, outputs: [{ item_master_id: ids.outItem, quantity: '0.5', parents: [atA.id] }], used_up: [home.id] }))
      .rejects.toThrow(/Only bundles used for this receipt/)
    await expect(jobwork.createReceipt(admin, { ...base, vendor_id: ids.vendorA, received_on: '2099-01-01', outputs: [{ item_master_id: ids.outItem, quantity: '0.5', parents: [atA.id] }] }))
      .rejects.toThrow(/not a valid date/)
    expect(await q(`SELECT 1 FROM tracking_output_receipts WHERE vendor_id = $1`, [ids.vendorB])).toHaveLength(0)
  })

  it('links the receipt to the job work order and compares outputs with its output line', async () => {
    const [receipt] = (await jobwork.listReceipts(admin)).filter((r) => r.output_count === 2)
    expect((await jobwork.getReceiptDetail(admin, receipt.id)).warnings).toEqual(['No job work order is linked yet'])
    await jobwork.linkReceiptOrder(admin, receipt.id, ids.order)
    const detail = await jobwork.getReceiptDetail(admin, receipt.id)
    expect(detail.receipt.job_work_reference).toBe('JW-TEST-1')
    expect(detail.units.every((u) => u.job_work_output_item_id === ids.outputLine)).toBe(true)
    expect(detail.sources).toHaveLength(4)
    // The two outputs weigh 6.700; the order records 6.500.
    expect(detail.warnings).toEqual(['Outputs matched to JC00002 0.80 X 150 total 6.700, but the job work order records 6.500'])
  })
})

describe('Selling and splitting at the vendor', () => {
  it('a vendor pickup takes bundles without scanning and closes them at handover', async () => {
    const unit = (await q(`SELECT id FROM tracking_units WHERE purchase_line_id = $1 AND lifecycle_status = 'AT_VENDOR'`, [lines[6]]))[0]
    const pickup = await pickups.createPickup(admin, { company_id: ids.company, warehouse_id: ids.warehouse, customer_id: ids.customer, vendor_id: ids.vendorA })
    expect(pickup.vendor_name).toBe('Slitter A')
    const candidates = await pickups.vendorPickupCandidates(admin, pickup.id)
    expect(candidates.map((c) => c.unit_id)).toContain(unit.id)

    const elsewhere = (await q(`SELECT id FROM tracking_units WHERE purchase_line_id = $1`, [lines[7]]))[0]
    await expect(pickups.addPickupUnitById(admin, pickup.id, elsewhere.id, null)).rejects.toThrow(/is not at Slitter A/)
    await pickups.addPickupUnitById(admin, pickup.id, unit.id, null)
    expect((await status(unit.id)).lifecycle_status).toBe('AT_VENDOR')
    await expect(pickups.markPickupReady(admin, pickup.id, null)).rejects.toThrow(/no loading bay/)

    await expect(pickups.linkPickupSale(admin, pickup.id, ids.yardSale)).rejects.toThrow(/not a vendor direct sale/)
    await pickups.linkPickupSale(admin, pickup.id, ids.vendorSale)
    const detail = await pickups.getPickupDetail(admin, pickup.id)
    expect(detail.warnings).toEqual([])
    expect(detail.message).toContain('Collect from: Slitter A')

    await pickups.handOverPickup(admin, pickup.id, { collector_name: 'Ravi', vehicle_number: 'ts09 cd 5678' })
    expect((await status(unit.id)).lifecycle_status).toBe('PICKED_UP')
    expect((await one(`SELECT closed_reason FROM tracking_vendor_dispatch_units WHERE tracking_unit_id = $1 AND closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 1`, [unit.id])).closed_reason)
      .toMatch(/^Sold at the vendor on PU/)
  })

  it('a sales manager can sell at the vendor but cannot scan in the yard', async () => {
    const sales = actorFor('sales_manager')
    const pickup = await pickups.createPickup(sales, { company_id: ids.company, warehouse_id: ids.warehouse, customer_id: ids.customer, vendor_id: ids.vendorA })
    await expect(pickups.cancelPickup(sales, pickup.id, 'x')).rejects.toThrow(/Insufficient permissions/)
    await expect(jobwork.createDispatch(sales, { company_id: ids.company, warehouse_id: ids.warehouse, vendor_id: ids.vendorA })).rejects.toThrow(/Insufficient permissions/)
    const yard = await pickups.createPickup(sales, { company_id: ids.company, warehouse_id: ids.warehouse, customer_id: ids.customer })
    await expect(pickups.addPickupUnit(sales, yard.id, 'ST0000-000001', null)).rejects.toThrow(/Insufficient permissions/)
  })

  it('a bundle split at the vendor keeps both parts there, each with its share of the purchase line', async () => {
    const unit = (await q(`SELECT id, stock_tracking_id FROM tracking_units WHERE purchase_line_id = $1 AND lifecycle_status = 'AT_VENDOR'`, [lines[12]]))[0]
    const parts = await floor.splitUnit(admin, unit.id, [{ quantity: '0.300', weight_basis: 'weighed' }, { quantity: '0.700', weight_basis: 'weighed' }], 'Part sale at vendor')
    expect(parts.map((p) => p.lifecycle_status)).toEqual(['AT_VENDOR', 'AT_VENDOR'])
    expect(parts.map((p) => p.current_vendor_name)).toEqual(['Slitter A', 'Slitter A'])
    const shares = await q(`SELECT quantity::text FROM tracking_unit_origins WHERE tracking_unit_id = ANY($1::uuid[]) ORDER BY quantity`, [parts.map((p) => p.id)])
    expect(shares.map((s) => s.quantity)).toEqual(['0.300', '0.700'])
    const back = await jobwork.returnFromVendor(admin, parts[1].id, { location: 'A-01' })
    expect(back.lifecycle_status).toBe('IN_STOCK')
  })

  it('a pickup at the vendor that is cancelled leaves its bundles at the vendor', async () => {
    const part = (await q(`SELECT id FROM tracking_units WHERE purchase_line_id = $1 AND lifecycle_status = 'AT_VENDOR'`, [lines[12]]))[0]
    const pickup = await pickups.createPickup(admin, { company_id: ids.company, warehouse_id: ids.warehouse, customer_id: ids.customer, vendor_id: ids.vendorA })
    await pickups.addPickupUnitById(admin, pickup.id, part.id, null)
    await expect(jobwork.moveUnitsToVendor(admin, { unit_ids: [part.id], to_vendor_id: ids.vendorB, moved_on: todayText() })).rejects.toThrow(/on a vendor pickup/)
    await pickups.cancelPickup(admin, pickup.id, 'Customer changed mind')
    expect((await status(part.id)).lifecycle_status).toBe('AT_VENDOR')
  })
})

describe('Vendor stock', () => {
  it('lists bundles per vendor beside the book vendor balance and flags bundles above it', async () => {
    const stock = await jobwork.vendorStock(admin)
    const slitter = stock.find((s) => s.vendor_name === 'Slitter A')
    expect(slitter).toBeDefined()
    expect(slitter!.bundle_count).toBeGreaterThan(0)
    // The fixtures post no job work ledger rows, so the book shows nothing at the vendor.
    expect(slitter!.warnings.some((w) => w.includes('above the book vendor balance of 0.000'))).toBe(true)
    expect(stock.find((s) => s.vendor_name === 'Galvaniser B')?.units.map((u) => u.purchase_line_id)).toContain(lines[7])
  })

  it('shows another company nothing', async () => {
    const outsider = actorFor('company_manager', ids.otherCompany)
    expect(await jobwork.vendorStock(outsider)).toEqual([])
    expect(await jobwork.listDispatches(outsider)).toEqual([])
    expect(await jobwork.listReceipts(outsider)).toEqual([])
  })
})

describe('Nothing in Phase 4 touches existing data', () => {
  it('every flow above left all existing tables identical', async () => {
    expect(await existingDataFingerprint()).toEqual(fingerprintBefore)
  })

  it('made-from links are permanent and receipts and dispatches cannot be deleted', async () => {
    const link = await one(`SELECT id FROM tracking_unit_lineage LIMIT 1`)
    await expect(client.query(`DELETE FROM tracking_unit_lineage WHERE id = $1`, [link.id])).rejects.toThrow(/permanent/)
    await expect(client.query(`DELETE FROM tracking_output_receipts`)).rejects.toThrow(/cannot be deleted/)
    await expect(client.query(`DELETE FROM tracking_vendor_dispatches`)).rejects.toThrow(/cannot be deleted/)
    await expect(client.query(`UPDATE tracking_units SET quantity = quantity + 1 WHERE source_type = 'JOB_WORK_OUTPUT'`)).rejects.toThrow(/cannot be changed/)
  })

  it('a full backup restored over itself keeps every job work tracking record', async () => {
    const tables = ['tracking_vendor_dispatches', 'tracking_vendor_dispatch_units', 'tracking_vendor_moves', 'tracking_output_receipts', 'tracking_unit_lineage', 'tracking_units', 'tracking_unit_origins']
    const read = async () => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, (await q(`SELECT t::text AS v FROM "${t}" t ORDER BY 1`)).map((r) => r.v)])))
    const before = await read()
    const data = await backup.getAllTableData()
    const result = await backup.restoreFromBackup(data, { truncateFirst: true })
    expect(Object.entries(result.tableResults).filter(([, r]) => r.failed > 0)).toEqual([])
    expect(await read()).toEqual(before)
  })
})
