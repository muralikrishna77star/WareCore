// Phase 5 of QR tracking: offline scanning, stock counts, the dashboard and
// reports. Runs the real service against a throwaway Postgres with every
// migration applied.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { startTestDb } from '../../scripts/test/testDb.mjs'
import type { TrackingActor } from '@/lib/tracking/access'
import type { TrackingUnit } from '@/lib/tracking/constants'
import type { OfflineAction, OfflineActionType, OfflineActionPayload } from '@/lib/tracking/offlineShared'

let db: Awaited<ReturnType<typeof startTestDb>>
let client: pg.Client
let service: typeof import('@/lib/tracking/service')
let floor: typeof import('@/lib/tracking/floor')
let pickups: typeof import('@/lib/tracking/pickups')
let jobwork: typeof import('@/lib/tracking/jobwork')
let offline: typeof import('@/lib/tracking/offline')
let counts: typeof import('@/lib/tracking/counts')
let reports: typeof import('@/lib/tracking/reports')
let pool: typeof import('@/lib/localdb/pool')
let backup: typeof import('@/lib/backup/backup.service')

const ids: Record<string, string> = {}
let admin: TrackingActor
let fingerprintBefore: Record<string, string>
const DEVICE = 'phone-test-0001'

const q = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0]
const today = `(now() AT TIME ZONE 'Asia/Kolkata')::date`

async function existingDataFingerprint() {
  const tables = (await q(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE 'tracking\\_%' AND tablename <> 'schema_migrations' ORDER BY 1`)).map((r) => r.tablename)
  const out: Record<string, string> = {}
  for (const table of tables) {
    const row = await one(`SELECT count(*)::text || ':' || md5(coalesce(string_agg(x.v, '|' ORDER BY x.v), '')) AS f FROM (SELECT t::text AS v FROM "${table}" t) x`)
    out[table] = row.f
  }
  return out
}

const actorFor = (role: string, companyId: string | null = ids.company, userId = ids.user): TrackingActor => ({
  userId, role, companyId, warehouseId: null, allCompanies: role === 'admin' || role === 'developer',
})

let lineSeq = 0
async function newLine(quantity: number) {
  lineSeq += 1
  const row = await one(
    `INSERT INTO purchase_bill_items (bill_id, material_type_id, item_master_id, purchase_line_id, quantity, unit, rate, amount)
     VALUES ($1, $2, $3, $4, $5, 'MT', 100, 1000) RETURNING purchase_line_id`,
    [ids.bill, ids.material, ids.item, `P5${String(lineSeq).padStart(4, '0')}-0001`, quantity])
  return row.purchase_line_id as string
}

const lines: string[] = []
let nextLine = 0
/** A fresh labelled bundle, one per purchase line made in beforeAll. */
async function labelled(): Promise<TrackingUnit> {
  const [unit] = await service.createUnits(admin, lines[nextLine++], null)
  return unit
}
async function stocked(location = 'A-01'): Promise<TrackingUnit> {
  return floor.placeUnit(admin, (await labelled()).id, location)
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
/** A short pause, so a scan dated "now" is in the past by the time it is sent. */
const pause = () => new Promise((resolve) => setTimeout(resolve, 20))
function act(action: OfflineActionType, payload: OfflineActionPayload, scannedAt = new Date().toISOString(), actorId = ids.user): OfflineAction {
  return { id: randomUUID(), action, scanned_at: scannedAt, warehouse_id: ids.warehouse, actor_id: actorId, payload }
}
const sync = (actions: OfflineAction[], actor = admin, device = DEVICE) => offline.syncOfflineActions(actor, device, actions)
const unitRow = (id: string) => one(
  `SELECT u.lifecycle_status, l.code AS location FROM tracking_units u LEFT JOIN tracking_locations l ON l.id = u.current_location_id WHERE u.id = $1`, [id])

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
  offline = await import('@/lib/tracking/offline')
  counts = await import('@/lib/tracking/counts')
  reports = await import('@/lib/tracking/reports')
  pool = await import('@/lib/localdb/pool')
  backup = await import('@/lib/backup/backup.service')

  ids.company = (await one(`INSERT INTO companies (name, code) VALUES ('Yard Co', 'YC') RETURNING id`)).id
  ids.otherCompany = (await one(`INSERT INTO companies (name, code) VALUES ('Other Co', 'OC') RETURNING id`)).id
  ids.warehouse = (await one(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'Main Yard') RETURNING id`, [ids.company])).id
  ids.otherWarehouse = (await one(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'Other Yard') RETURNING id`, [ids.otherCompany])).id
  ids.supplier = (await one(`INSERT INTO suppliers (name) VALUES ('Coil Mill') RETURNING id`)).id
  ids.vendor = (await one(`INSERT INTO suppliers (name) VALUES ('Slitter A') RETURNING id`)).id
  ids.material = (await one(`INSERT INTO material_types (code, description, unit) VALUES ('YC', 'Yard steel', 'MT') RETURNING id`)).id
  ids.item = (await one(`INSERT INTO item_master (item_code, item_name, material_type_id) VALUES ('YC00001', 'HR coil', $1) RETURNING id`, [ids.material])).id
  ids.customer = (await one(`INSERT INTO customers (name) VALUES ('Acme Fabricators') RETURNING id`)).id
  ids.user = (await one(
    `INSERT INTO user_profiles (full_name, role, email, password_hash, is_active) VALUES ('Admin', 'admin', $1, 'x', true) RETURNING id`,
    [`${randomUUID()}@test.local`])).id
  ids.otherUser = (await one(
    `INSERT INTO user_profiles (full_name, role, email, password_hash, is_active) VALUES ('Yard Hand', 'billing_staff', $1, 'x', true) RETURNING id`,
    [`${randomUUID()}@test.local`])).id
  admin = actorFor('admin', null)

  await service.setFeatureFlag(admin, ids.company, null, true)
  ids.bill = (await one(
    `INSERT INTO purchase_bills (supplier_id, company_id, warehouse_id, bill_number, bill_date, status)
     VALUES ($1, $2, $3, 'YARD-BILL-1', ${today}, 'active') RETURNING id`, [ids.supplier, ids.company, ids.warehouse])).id
  for (let i = 0; i < 30; i += 1) lines.push(await newLine(2))

  await floor.createLocation(admin, { company_id: ids.company, warehouse_id: ids.warehouse, code: 'A-01' })
  await floor.createLocation(admin, { company_id: ids.company, warehouse_id: ids.warehouse, code: 'B-01' })
  await floor.createLocation(admin, { company_id: ids.company, warehouse_id: ids.warehouse, code: 'C-01' })
  await floor.createLocation(admin, { company_id: ids.company, warehouse_id: ids.warehouse, code: 'D-01' })

  fingerprintBefore = await existingDataFingerprint()
}, 300_000)

afterAll(async () => {
  await pool?.closePool()
  await client?.end()
  await db?.stop()
}, 60_000)

describe('Offline scans', () => {
  it('applies a saved put-away, dated at the scan time and linked to its record', async () => {
    const unit = await labelled()
    const scannedAt = minutesAgo(0.2)
    const action = act('PLACE', { code: unit.qr_reference, location: 'A-01' }, scannedAt)
    const [result] = await sync([action])
    expect(result).toEqual({ id: action.id, outcome: 'APPLIED', reason: null, recorded: true })
    expect(await unitRow(unit.id)).toEqual({ lifecycle_status: 'IN_STOCK', location: 'A-01' })
    const event = await one(`SELECT offline_action_id::text, occurred_at FROM tracking_events WHERE tracking_unit_id = $1 AND event_type = 'PUT_AWAY'`, [unit.id])
    expect(event.offline_action_id).toBe(action.id)
    const created = await one(`SELECT occurred_at FROM tracking_events WHERE tracking_unit_id = $1 AND event_type = 'UNIT_CREATED'`, [unit.id])
    // Never before the label was made, so the history reads in order.
    expect(new Date(event.occurred_at).getTime()).toBe(Math.max(Date.parse(scannedAt), new Date(created.occurred_at).getTime()))
    const record = await one(`SELECT outcome, device_id, tracking_unit_id::text, received_at >= scanned_at AS later FROM tracking_offline_actions WHERE id = $1`, [action.id])
    expect(record).toEqual({ outcome: 'APPLIED', device_id: DEVICE, tracking_unit_id: unit.id, later: true })
  })

  it('applies a scan sent twice, or from two tabs at once, only once', async () => {
    const unit = await stocked('A-01')
    const action = act('PLACE', { code: unit.stock_tracking_id, location: 'B-01' })
    const [first] = await sync([action])
    const [again] = await sync([action])
    expect(again).toEqual(first)

    const parallel = act('PLACE', { code: unit.stock_tracking_id, location: 'C-01' })
    const both = await Promise.all([sync([parallel]), sync([parallel])])
    expect(both[0]).toEqual(both[1])
    expect((await one(`SELECT count(*)::int AS n FROM tracking_events WHERE offline_action_id = $1`, [parallel.id])).n).toBe(1)
    expect((await one(`SELECT count(*)::int AS n FROM tracking_offline_actions WHERE id = $1`, [parallel.id])).n).toBe(1)
    expect((await unitRow(unit.id)).location).toBe('C-01')
  })

  it('applies saved scans in the order they were scanned, and a phone never conflicts with itself', async () => {
    const unit = await stocked('A-01')
    const t0 = Date.now() + 2
    const at = (ms: number) => new Date(t0 + ms).toISOString()
    const actions = [
      act('PLACE', { code: unit.qr_reference, location: 'B-01' }, at(1)),
      act('PLACE', { code: unit.qr_reference, location: 'D-01' }, at(2)),
      act('PLACE', { code: unit.qr_reference, location: 'C-01' }, at(3)),
    ]
    await pause()
    const results = await sync(actions)
    expect(results.map((r) => r.outcome)).toEqual(['APPLIED', 'APPLIED', 'APPLIED'])
    expect((await unitRow(unit.id)).location).toBe('C-01')
    const moves = await q(`SELECT details ->> 'to_location' AS to FROM tracking_events WHERE tracking_unit_id = $1 AND event_type = 'MOVED' ORDER BY occurred_at`, [unit.id])
    expect(moves.map((m) => m.to)).toEqual(['B-01', 'D-01', 'C-01'])
  })

  it('refuses a scan when someone else changed the bundle after it was scanned, and changes nothing', async () => {
    const unit = await stocked('A-01')
    await pause()
    const action = act('PLACE', { code: unit.qr_reference, location: 'B-01' })
    await pause()
    await floor.placeUnit(admin, unit.id, 'C-01')
    const [result] = await sync([action])
    expect(result.outcome).toBe('REFUSED')
    expect(result.reason).toMatch(new RegExp(`Bundle ${unit.stock_tracking_id} was changed \\(moved\\) at .*, after this scan at`))
    expect((await unitRow(unit.id)).location).toBe('C-01')
    expect((await one(`SELECT count(*)::int AS n FROM tracking_events WHERE offline_action_id = $1`, [action.id])).n).toBe(0)
    expect((await one(`SELECT outcome, refusal_reason FROM tracking_offline_actions WHERE id = $1`, [action.id])).refusal_reason).toBe(result.reason)
  })

  it('refuses in exactly the cases an online scan is refused, with the same words', async () => {
    const unit = await stocked('A-01')
    const pickup = await pickups.createPickup(admin, { company_id: ids.company, warehouse_id: ids.warehouse, customer_id: ids.customer })
    await pickups.addPickupUnit(admin, pickup.id, unit.qr_reference, null)
    const online = await floor.placeUnit(admin, unit.id, 'B-01').then(() => '', (err: Error) => err.message)
    expect(online).toMatch(/cannot be moved/)
    const [result] = await sync([act('PLACE', { code: unit.qr_reference, location: 'B-01' }, minutesAgo(0))])
    expect(result).toMatchObject({ outcome: 'REFUSED', reason: online })

    const inactiveOnline = await floor.placeUnit(admin, (await stocked('A-01')).id, 'NOPE-9').then(() => '', (err: Error) => err.message)
    const [unknownPlace] = await sync([act('PLACE', { code: (await stocked('A-01')).qr_reference, location: 'NOPE-9' }, minutesAgo(0))])
    expect(unknownPlace.reason).toBe(inactiveOnline)
  })

  it('refuses unknown labels, a phone clock far ahead, and steps from a person who can no longer scan', async () => {
    const [unknown] = await sync([act('PLACE', { code: 'ST9999-999999', location: 'A-01' })])
    expect(unknown).toMatchObject({ outcome: 'REFUSED', recorded: true, reason: 'ST9999-999999 is not a tracked bundle you can see' })

    const unit = await stocked('A-01')
    const [ahead] = await sync([act('PLACE', { code: unit.qr_reference, location: 'B-01' }, new Date(Date.now() + 15 * 60_000).toISOString())])
    expect(ahead.reason).toMatch(/phone clock is more than 10 minutes ahead/)
    expect((await unitRow(unit.id)).location).toBe('A-01')

    const sales = actorFor('sales_manager')
    const [noRight] = await sync([act('PLACE', { code: unit.qr_reference, location: 'B-01' })], sales)
    expect(noRight).toMatchObject({ outcome: 'REFUSED', reason: 'You no longer have permission to scan', recorded: true })

    const outsider = actorFor('warehouse_manager', ids.otherCompany)
    const [noAccess] = await sync([act('PLACE', { code: unit.qr_reference, location: 'B-01' })], outsider)
    expect(noAccess.reason).toBe('You no longer have access to this warehouse')
  })

  it('never sends one person\'s scans under another person\'s sign-in, and keeps no record of them', async () => {
    const unit = await stocked('A-01')
    await pause()
    const theirs = act('PLACE', { code: unit.qr_reference, location: 'B-01' }, new Date().toISOString(), ids.otherUser)
    await expect(sync([theirs])).rejects.toThrow(/saved by another person/)
    expect(await one(`SELECT id FROM tracking_offline_actions WHERE id = $1`, [theirs.id])).toBeUndefined()

    const yardHand = actorFor('billing_staff', ids.company, ids.otherUser)
    const [applied] = await sync([theirs], yardHand)
    expect(applied.outcome).toBe('APPLIED')
    // The same id sent later by someone else does not reveal or reuse that record.
    const [reuse] = await sync([{ ...theirs, actor_id: ids.user }])
    expect(reuse).toMatchObject({ outcome: 'REFUSED', recorded: false })
  })

  it('takes a bundle back from the vendor when it is scanned onto a yard location', async () => {
    const unit = await stocked('A-01')
    const dispatch = await jobwork.createDispatch(admin, { company_id: ids.company, warehouse_id: ids.warehouse, vendor_id: ids.vendor, vehicle_number: 'TS09 AB 1234' })
    await jobwork.addDispatchUnit(admin, dispatch.id, unit.qr_reference)
    await jobwork.sendDispatch(admin, dispatch.id, {})
    const [result] = await sync([act('PLACE', { code: unit.qr_reference, location: 'B-01' }, minutesAgo(0))])
    expect(result.outcome).toBe('APPLIED')
    expect(await unitRow(unit.id)).toEqual({ lifecycle_status: 'IN_STOCK', location: 'B-01' })
    expect((await one(`SELECT event_type FROM tracking_events WHERE tracking_unit_id = $1 ORDER BY occurred_at DESC LIMIT 1`, [unit.id])).event_type).toBe('RETURNED_FROM_VENDOR')
  })

  it('scans bundles onto an open pickup and an open vendor dispatch', async () => {
    const forPickup = await stocked('A-01')
    const forDispatch = await stocked('A-01')
    const pickup = await pickups.createPickup(admin, { company_id: ids.company, warehouse_id: ids.warehouse, customer_id: ids.customer })
    const dispatch = await jobwork.createDispatch(admin, { company_id: ids.company, warehouse_id: ids.warehouse, vendor_id: ids.vendor, vehicle_number: 'TS09 AB 1234' })
    const pick = act('ADD_TO_PICKUP', { code: forPickup.qr_reference, pickup_id: pickup.id })
    const load = act('ADD_TO_DISPATCH', { code: forDispatch.stock_tracking_id, dispatch_id: dispatch.id })
    expect((await sync([pick, load])).map((r) => r.outcome)).toEqual(['APPLIED', 'APPLIED'])
    expect((await unitRow(forPickup.id)).lifecycle_status).toBe('ON_PICKUP')
    expect((await one(`SELECT offline_action_id::text FROM tracking_pickup_events WHERE pickup_id = $1 AND event_type = 'UNIT_ADDED'`, [pickup.id])).offline_action_id).toBe(pick.id)
    expect((await one(`SELECT count(*)::int AS n FROM tracking_vendor_dispatch_units WHERE dispatch_id = $1`, [dispatch.id])).n).toBe(1)

    const [closed] = await sync([act('ADD_TO_PICKUP', { code: forDispatch.qr_reference, pickup_id: randomUUID() })])
    expect(closed.reason).toBe('That pickup was not found')
  })

  it('refuses every step while tracking is switched off for the warehouse', async () => {
    const unit = await stocked('A-01')
    await service.setFeatureFlag(admin, ids.company, null, false)
    try {
      const [result] = await sync([act('PLACE', { code: unit.qr_reference, location: 'B-01' }, minutesAgo(0))])
      expect(result.reason).toBe('QR tracking is switched off for this warehouse')
    } finally {
      await service.setFeatureFlag(admin, ids.company, null, true)
    }
  })
})

describe('What the phone keeps', () => {
  it('holds this warehouse\'s live bundles, locations, open pickups, dispatches and the person\'s open counts, and nothing priced', async () => {
    const snapshot = await offline.offlineSnapshot(admin, ids.warehouse)
    expect(snapshot.user_id).toBe(ids.user)
    expect(snapshot.warehouse?.id).toBe(ids.warehouse)
    expect(snapshot.warehouses.map((w) => w.name)).toEqual(['Main Yard'])
    expect(snapshot.locations.map((l) => l.code)).toEqual(['A-01', 'B-01', 'C-01', 'D-01'])
    expect(snapshot.units.length).toBeGreaterThan(5)
    expect(snapshot.units.every((u) => !['PICKED_UP', 'PROCESSED', 'SPLIT'].includes(u.lifecycle_status))).toBe(true)
    expect(Object.keys(snapshot.units[0]).sort()).toEqual(
      ['current_vendor_name', 'id', 'item_code', 'item_name', 'lifecycle_status', 'location_code', 'qr_reference', 'quantity', 'size_label', 'stock_tracking_id', 'unit'])
    expect(snapshot.pickups.length).toBeGreaterThan(0)
    expect(snapshot.dispatches.length).toBeGreaterThan(0)
    await expect(offline.offlineSnapshot(actorFor('sales_manager'), ids.warehouse)).rejects.toThrow(/Insufficient permissions/)
    const outsider = await offline.offlineSnapshot(actorFor('warehouse_manager', ids.otherCompany), ids.warehouse)
    expect(outsider.warehouse).toBeNull()
    expect(outsider.units).toEqual([])
  })
})

describe('Location stock counts', () => {
  it('lists what was found, found elsewhere, not found and unknown, and changes no bundle', async () => {
    const here = await stocked('D-01')
    const missing = await stocked('D-01')
    const elsewhere = await stocked('B-01')
    const countId = randomUUID()
    const results = await sync([
      act('COUNT_START', { count_id: countId, location: 'D-01' }, minutesAgo(4)),
      act('COUNT_SCAN', { count_id: countId, code: here.qr_reference }, minutesAgo(3)),
      act('COUNT_SCAN', { count_id: countId, code: here.stock_tracking_id }, minutesAgo(3)),
      act('COUNT_SCAN', { count_id: countId, code: elsewhere.qr_reference }, minutesAgo(2)),
      act('COUNT_SCAN', { count_id: countId, code: 'junk label' }, minutesAgo(2)),
    ])
    expect(results.map((r) => r.outcome)).toEqual(['APPLIED', 'APPLIED', 'APPLIED', 'APPLIED', 'APPLIED'])
    const [again] = await sync([act('COUNT_START', { count_id: randomUUID(), location: 'D-01' })])
    expect(again.reason).toMatch(/^Stock count SC[0-9]{4}-[0-9]{4} is already open on D-01$/)

    const before = await q(`SELECT id, lifecycle_status, current_location_id FROM tracking_units ORDER BY id`)
    const [submitted] = await sync([act('COUNT_SUBMIT', { count_id: countId }, minutesAgo(1))])
    expect(submitted.outcome).toBe('APPLIED')
    expect(await q(`SELECT id, lifecycle_status, current_location_id FROM tracking_units ORDER BY id`)).toEqual(before)

    const { count, lines: rows } = await counts.getCountDetail(admin, countId)
    expect(count.status).toBe('SUBMITTED')
    expect(count.count_no).toMatch(/^SC[0-9]{4}-[0-9]{4}$/)
    const outcomeOf = (unitId: string) => rows.find((r) => r.tracking_unit_id === unitId)?.outcome
    expect(outcomeOf(here.id)).toBe('FOUND')
    expect(outcomeOf(missing.id)).toBe('NOT_FOUND')
    expect(outcomeOf(elsewhere.id)).toBe('FOUND_ELSEWHERE')
    expect(rows.find((r) => r.scanned_code === 'JUNK LABEL')?.outcome).toBe('UNKNOWN_LABEL')
    expect(rows.filter((r) => r.tracking_unit_id === here.id)).toHaveLength(1)
    expect(count).toMatchObject({ differences: 3, undecided: 3 })
    expect((await one(`SELECT count(*)::int AS n FROM tracking_events WHERE event_type = 'COUNTED' AND tracking_unit_id = $1`, [here.id])).n).toBe(1)
    ids.count = countId
  })

  it('lets only a manager decide, once, and closes the count when every difference is decided', async () => {
    const { lines: rows } = await counts.getCountDetail(admin, ids.count)
    const notFound = rows.find((r) => r.outcome === 'NOT_FOUND')!
    const elsewhere = rows.find((r) => r.outcome === 'FOUND_ELSEWHERE')!
    const unknown = rows.find((r) => r.outcome === 'UNKNOWN_LABEL')!

    await expect(counts.decideCountLine(actorFor('billing_staff'), ids.count, notFound.id, 'MARKED_MISSING', null)).rejects.toThrow(/Insufficient permissions/)
    await expect(counts.decideCountLine(admin, ids.count, notFound.id, 'MOVED_HERE', null)).rejects.toThrow(/Choose what to do/)

    await counts.decideCountLine(admin, ids.count, notFound.id, 'MARKED_MISSING', 'checked twice')
    expect((await unitRow(notFound.tracking_unit_id!)).lifecycle_status).toBe('MISSING')
    await expect(counts.decideCountLine(admin, ids.count, notFound.id, 'IGNORED', null)).rejects.toThrow(/already decided/)

    await counts.decideCountLine(admin, ids.count, elsewhere.id, 'MOVED_HERE', null)
    expect(await unitRow(elsewhere.tracking_unit_id!)).toEqual({ lifecycle_status: 'IN_STOCK', location: 'D-01' })

    const { count } = await counts.decideCountLine(admin, ids.count, unknown.id, 'IGNORED', 'old sticker')
    expect(count.status).toBe('CLOSED')
    await expect(client.query(`UPDATE tracking_stock_count_lines SET decision_note = 'x' WHERE id = $1`, [unknown.id])).rejects.toThrow(/permanent/)
    await expect(client.query(`DELETE FROM tracking_stock_counts WHERE id = $1`, [ids.count])).rejects.toThrow(/cannot be deleted/)
  })

  it('refuses a decision when the bundle has changed since the count', async () => {
    const gone = await stocked('C-01')
    const countId = randomUUID()
    await sync([act('COUNT_START', { count_id: countId, location: 'C-01' }), act('COUNT_SUBMIT', { count_id: countId })])
    const { lines: rows } = await counts.getCountDetail(admin, countId)
    const line = rows.find((r) => r.tracking_unit_id === gone.id)!
    await floor.placeUnit(admin, gone.id, 'A-01')
    await expect(counts.decideCountLine(admin, countId, line.id, 'MARKED_MISSING', null)).rejects.toThrow(/has changed since the count/)
    expect((await unitRow(gone.id)).lifecycle_status).toBe('IN_STOCK')
  })

  it('closes a count with no differences at once, and cancels an open count only with a reason', async () => {
    const empty = randomUUID()
    await sync([act('COUNT_START', { count_id: empty, location: 'B-01' })])
    await expect(counts.cancelCount(admin, empty, ' ')).rejects.toThrow(/reason is required/)
    expect((await counts.cancelCount(admin, empty, 'wrong rack')).count.status).toBe('CANCELLED')

    await floor.createLocation(admin, { company_id: ids.company, warehouse_id: ids.warehouse, code: 'E-01' })
    const only = await stocked('E-01')
    const clean = randomUUID()
    await sync([
      act('COUNT_START', { count_id: clean, location: 'E-01' }),
      act('COUNT_SCAN', { count_id: clean, code: only.qr_reference }),
      act('COUNT_SUBMIT', { count_id: clean }),
    ])
    expect((await counts.getCountDetail(admin, clean)).count.status).toBe('CLOSED')
  })
})

describe('Sync problems', () => {
  it('lists refused scans for managers to review once, and keeps the record permanent', async () => {
    const problems = await offline.listSyncProblems(admin, 'open')
    expect(problems.length).toBeGreaterThan(3)
    const first = problems[0]
    expect(first.reviewed_at).toBeNull()
    await expect(offline.reviewSyncProblem(actorFor('billing_staff'), first.id, 'seen')).rejects.toThrow(/Insufficient permissions/)
    const reviewed = await offline.reviewSyncProblem(admin, first.id, 'Moved by hand')
    expect(reviewed.review_note).toBe('Moved by hand')
    await expect(offline.reviewSyncProblem(admin, first.id, 'again')).rejects.toThrow(/already reviewed/)
    expect((await offline.listSyncProblems(admin, 'open')).some((p) => p.id === first.id)).toBe(false)
    await expect(client.query(`UPDATE tracking_offline_actions SET refusal_reason = 'edited' WHERE id = $1`, [first.id])).rejects.toThrow(/permanent/)
    await expect(client.query(`DELETE FROM tracking_offline_actions WHERE id = $1`, [first.id])).rejects.toThrow(/cannot be deleted/)
    await expect(client.query(`UPDATE tracking_offline_actions SET review_note = 'changed' WHERE id = $1`, [first.id])).rejects.toThrow(/permanent/)
    // A warehouse merge may still move a reviewed record to the surviving warehouse.
    await client.query(`UPDATE tracking_offline_actions SET warehouse_id = $2 WHERE id = $1`, [first.id, ids.otherWarehouse])
    await client.query(`UPDATE tracking_offline_actions SET warehouse_id = $2 WHERE id = $1`, [first.id, ids.warehouse])
    expect(await offline.listSyncProblems(actorFor('warehouse_manager', ids.otherCompany), 'all')).toEqual([])
  })
})

describe('Dashboard and reports', () => {
  it('Tracked vs Book shows the Stock Statement closing balance beside the labelled weight', async () => {
    const report = await reports.runTrackingReport(admin, 'tracked-vs-book', {})
    const row = report.rows.find((r) => r.warehouse === 'Main Yard' && r.item === 'Yard steel')!
    const book = await one(`SELECT SUM(quantity)::numeric(15,3)::text AS q FROM stock_ledger WHERE warehouse_id = $1 AND material_type_id = $2`, [ids.warehouse, ids.material])
    const tracked = await one(
      `SELECT SUM(quantity)::numeric(15,3)::text AS q, count(*)::int AS n FROM tracking_units
        WHERE warehouse_id = $1 AND status = 'ACTIVE' AND lifecycle_status IN ('LABELLED', 'IN_STOCK', 'ON_HOLD', 'ON_PICKUP', 'READY')`, [ids.warehouse])
    expect(row.book).toBe(book.q)
    expect(row.book_new).toBe(book.q)
    expect(row.tracked).toBe(tracked.q)
    expect(row.bundles).toBe(tracked.n)
    expect(row.untracked).toBe((Number(book.q) - Number(tracked.q)).toFixed(3))
  })

  it('Stock by Location and Ageing list the yard bundles', async () => {
    const byLocation = await reports.runTrackingReport(admin, 'stock-by-location', { warehouse_id: ids.warehouse })
    const total = byLocation.rows.reduce((sum, r) => sum + Number(r.bundles), 0)
    const yard = await one(`SELECT count(*)::int AS n FROM tracking_units WHERE status = 'ACTIVE' AND lifecycle_status IN ('LABELLED', 'IN_STOCK', 'ON_HOLD', 'ON_PICKUP', 'READY')`)
    expect(total).toBe(yard.n)
    const ageing = await reports.runTrackingReport(admin, 'ageing', { place: 'yard' })
    expect(ageing.rows).toHaveLength(yard.n)
    expect(ageing.rows.every((r) => r.band === '0 to 30 days' && String(r.href).startsWith('/tracking/units/'))).toBe(true)
  })

  it('Movement History marks offline scans and when they reached the server', async () => {
    const report = await reports.runTrackingReport(admin, 'movements', {})
    const offlineRows = report.rows.filter((r) => r.offline === 'Yes')
    expect(offlineRows.length).toBeGreaterThan(5)
    expect(offlineRows.every((r) => r.synced_at)).toBe(true)
    expect(report.rows.some((r) => r.step === 'Seen on a stock count')).toBe(true)
    await expect(reports.runTrackingReport(admin, 'movements', { from: '2026-02-01', to: '2026-01-01' })).rejects.toThrow(/From date is after/)
  })

  it('Pickups and Exceptions list the open problems with links', async () => {
    const pickupReport = await reports.runTrackingReport(admin, 'pickups', {})
    expect(pickupReport.rows.length).toBeGreaterThan(0)
    const exceptions = await reports.runTrackingReport(admin, 'exceptions', {})
    const kinds = new Set(exceptions.rows.map((r) => r.problem))
    expect(kinds.has('Missing')).toBe(true)
    expect(kinds.has('Refused offline scan')).toBe(true)
    expect(exceptions.rows.some((r) => r.problem === 'Refused offline scan' && /^Put away or move: /.test(String(r.detail)))).toBe(true)
  })

  it('the dashboard adds up the same figures, and another company sees none of them', async () => {
    const figures = await reports.dashboardFigures(admin, { warehouse_id: ids.warehouse })
    expect(figures.enabled).toBe(true)
    const inStock = await one(`SELECT count(*)::int AS n FROM tracking_units WHERE status = 'ACTIVE' AND lifecycle_status = 'IN_STOCK'`)
    expect(figures.statuses.find((s) => s.status === 'IN_STOCK')?.bundles).toBe(inStock.n)
    expect(figures.syncProblems).toBe((await offline.listSyncProblems(admin, 'open')).length)
    expect(figures.share.percent).not.toBeNull()
    expect(figures.warnings.some((w) => w.kind === 'Missing')).toBe(true)

    const outsider = actorFor('company_manager', ids.otherCompany)
    const theirs = await reports.dashboardFigures(outsider, {})
    expect(theirs).toMatchObject({ enabled: false, statuses: [], vendors: [], syncProblems: 0 })
    for (const key of ['stock-by-location', 'tracked-vs-book', 'ageing', 'movements', 'pickups', 'exceptions'] as const) {
      expect((await reports.runTrackingReport(outsider, key, {})).rows).toEqual([])
    }
  })
})

describe('Nothing in Phase 5 touches existing data', () => {
  it('every flow above left all existing tables identical', async () => {
    expect(await existingDataFingerprint()).toEqual(fingerprintBefore)
  })

  it('a full backup restored over itself keeps every offline scan and stock count record', async () => {
    const tables = ['tracking_offline_actions', 'tracking_stock_counts', 'tracking_stock_count_lines', 'tracking_events', 'tracking_pickup_events']
    const read = async () => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, (await q(`SELECT t::text AS v FROM "${t}" t ORDER BY 1`)).map((r) => r.v)])))
    const before = await read()
    const data = await backup.getAllTableData()
    const result = await backup.restoreFromBackup(data, { truncateFirst: true })
    expect(Object.entries(result.tableResults).filter(([, r]) => r.failed > 0)).toEqual([])
    expect(await read()).toEqual(before)
  })
})
