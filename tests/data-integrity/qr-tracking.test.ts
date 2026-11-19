// QR tracking must never disturb stock. Runs the real service and API routes
// against a throwaway Postgres with every migration applied.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { NextRequest } from 'next/server'
import pg from 'pg'
import { startTestDb } from '../../scripts/test/testDb.mjs'
import type { TrackingActor } from '@/lib/tracking/access'

type Service = typeof import('@/lib/tracking/service')

let db: Awaited<ReturnType<typeof startTestDb>>
let client: pg.Client
let service: Service
let pool: typeof import('@/lib/localdb/pool')
let backup: typeof import('@/lib/backup/backup.service')

const JWT_SECRET = 'tracking-test-secret'
const ids: Record<string, string> = {}
let admin: TrackingActor

const q = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0]

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

async function newLine(quantity = 10, received: number | null = null, billId = ids.bill) {
  lineSeq += 1
  const row = await one(
    `INSERT INTO purchase_bill_items (bill_id, material_type_id, item_master_id, purchase_line_id, quantity, received_quantity, unit, rate, amount)
     VALUES ($1, $2, $3, $4, $5, $6, 'MT', 100, 1000) RETURNING purchase_line_id, id`,
    [billId, ids.material, ids.item, `QR1126-${String(lineSeq).padStart(4, '0')}`, quantity, received])
  return row.purchase_line_id as string
}

const actorFor = (role: string, companyId: string | null, warehouseId: string | null = null): TrackingActor => ({
  userId: ids.user, role, companyId, warehouseId, allCompanies: role === 'admin' || role === 'developer',
})

async function makeUser(role: string, companyId: string | null, warehouseId: string | null = null, active = true) {
  const row = await one(
    `INSERT INTO user_profiles (full_name, role, company_id, warehouse_id, email, password_hash, is_active)
     VALUES ($1, $2, $3, $4, $5, 'x', $6) RETURNING id`,
    [`Test ${role}`, role, companyId, warehouseId, `${randomUUID()}@test.local`, active])
  return row.id as string
}

function requestAs(userId: string | null, role: string, path: string, method = 'GET', body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (userId) headers.cookie = `wc_session=${jwt.sign({ userId, email: 'a@b.c', role, fullName: 'T' }, JWT_SECRET, { algorithm: 'HS256' })}`
  return new NextRequest(`http://localhost/api/tracking/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}

const noParams = { params: Promise.resolve({}) } as never

beforeAll(async () => {
  db = await startTestDb({})
  client = new pg.Client({ connectionString: db.connectionString })
  await client.connect()
  process.env.DATABASE_URL = db.connectionString
  process.env.DIRECT_DB = 'true'
  process.env.JWT_SECRET = JWT_SECRET
  process.env.NEXT_PUBLIC_TRACKING_ENABLED = 'true'
  service = await import('@/lib/tracking/service')
  pool = await import('@/lib/localdb/pool')
  backup = await import('@/lib/backup/backup.service')

  ids.company = (await one(`INSERT INTO companies (name, code) VALUES ('QR Co', 'QR') RETURNING id`)).id
  ids.otherCompany = (await one(`INSERT INTO companies (name, code) VALUES ('Other Co', 'OT') RETURNING id`)).id
  ids.warehouse = (await one(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'Main') RETURNING id`, [ids.company])).id
  ids.warehouse2 = (await one(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'Second') RETURNING id`, [ids.company])).id
  ids.otherWarehouse = (await one(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'Far') RETURNING id`, [ids.otherCompany])).id
  ids.supplier = (await one(`INSERT INTO suppliers (name) VALUES ('QR Supplier') RETURNING id`)).id
  ids.material = (await one(`INSERT INTO material_types (code, description, unit) VALUES ('QR', 'QR steel', 'MT') RETURNING id`)).id
  ids.item = (await one(`INSERT INTO item_master (item_code, item_name, material_type_id) VALUES ('QR00001', 'QR coil', $1) RETURNING id`, [ids.material])).id
  ids.user = await makeUser('admin', null)
  ids.bill = (await one(
    `INSERT INTO purchase_bills (supplier_id, company_id, warehouse_id, bill_number, bill_date, status)
     VALUES ($1, $2, $3, 'QR-BILL-1', (now() AT TIME ZONE 'Asia/Kolkata')::date, 'active') RETURNING id`, [ids.supplier, ids.company, ids.warehouse])).id
  ids.otherBill = (await one(
    `INSERT INTO purchase_bills (supplier_id, company_id, warehouse_id, bill_number, bill_date, status)
     VALUES ($1, $2, $3, 'QR-BILL-2', (now() AT TIME ZONE 'Asia/Kolkata')::date, 'active') RETURNING id`, [ids.supplier, ids.otherCompany, ids.otherWarehouse])).id
  admin = actorFor('admin', null)
}, 300_000)

afterAll(async () => {
  await pool?.closePool()
  await client?.end()
  await db?.stop()
}, 60_000)

describe('Tracking is off until someone switches it on', () => {
  it('refuses to label a line while the company has no switch set', async () => {
    const line = await newLine()
    await expect(service.createUnits(admin, line, null)).rejects.toThrow(/switched off/)
    expect((await service.listEligibleLines(admin)).length).toBe(0)
  })

  it('lines saved before go-live are not offered and cannot be labelled', async () => {
    const before = await newLine()
    await client.query(`UPDATE purchase_bill_items SET created_at = now() - interval '1 day' WHERE purchase_line_id = $1`, [before])
    await service.setFeatureFlag(admin, ids.company, null, true)
    expect((await service.listEligibleLines(admin)).map((l) => l.purchase_line_id)).not.toContain(before)
    await expect(service.createUnits(admin, before, null)).rejects.toThrow(/before QR tracking started/)
  })

  it('a warehouse can be switched off on its own, then follow its company again', async () => {
    const line = await newLine()
    await service.setFeatureFlag(admin, ids.company, ids.warehouse, false)
    await expect(service.createUnits(admin, line, null)).rejects.toThrow(/switched off/)
    await service.setFeatureFlag(admin, ids.company, ids.warehouse, null)
    expect((await service.createUnits(admin, line, null))).toHaveLength(1)
  })

  it('every route answers Not Found when the whole-app switch is off', async () => {
    const { GET } = await import('@/app/api/tracking/units/route')
    process.env.NEXT_PUBLIC_TRACKING_ENABLED = 'false'
    try {
      expect((await GET(requestAs(ids.user, 'admin', 'units'), noParams)).status).toBe(404)
    } finally {
      process.env.NEXT_PUBLIC_TRACKING_ENABLED = 'true'
    }
  })
})

describe('Creating units', () => {
  it('blank bundles give one unit for the whole line', async () => {
    const line = await newLine(4.5)
    const [unit, ...rest] = await service.createUnits(admin, line, null)
    expect(rest).toHaveLength(0)
    expect(unit.quantity).toBe('4.500')
    expect(unit.weight_basis).toBe('whole_line')
    expect(unit.stock_tracking_id).toMatch(/^ST\d{4}-\d{6}$/)
    expect(unit.qr_reference).toMatch(/^WC1-[0-9A-HJKMNP-TV-Z]{16}$/)
  })

  it('uses the received quantity when one was recorded', async () => {
    const line = await newLine(10, 9.75)
    expect((await service.createUnits(admin, line, null))[0].quantity).toBe('9.750')
  })

  it('splits 10.000 into 3 bundles exactly', async () => {
    const line = await newLine(10)
    const units = await service.createUnits(admin, line, [
      { quantity: '3.333', weight_basis: 'estimated' },
      { quantity: '3.333', weight_basis: 'estimated' },
      { quantity: '3.334', weight_basis: 'weighed' },
    ])
    expect(units.map((u) => u.quantity)).toEqual(['3.333', '3.333', '3.334'])
    expect(units.map((u) => `${u.bundle_no}/${u.bundle_count}`)).toEqual(['1/3', '2/3', '3/3'])
    expect(new Set(units.map((u) => u.qr_reference)).size).toBe(3)
    const origins = await q(`SELECT o.quantity::text FROM tracking_unit_origins o JOIN tracking_units u ON u.id = o.tracking_unit_id WHERE u.purchase_line_id = $1`, [line])
    expect(origins.map((o) => o.quantity).sort()).toEqual(['3.333', '3.333', '3.334'])
  })

  it('refuses bundles that do not add up, and leaves nothing behind', async () => {
    const line = await newLine(10)
    await expect(service.createUnits(admin, line, [{ quantity: '5', weight_basis: 'weighed' }, { quantity: '4.999', weight_basis: 'weighed' }])).rejects.toThrow(/total 9\.999/)
    expect(await q(`SELECT 1 FROM tracking_units WHERE purchase_line_id = $1`, [line])).toHaveLength(0)
  })

  it('refuses bad weights', async () => {
    const line = await newLine(10)
    for (const quantity of ['0', '-10', '10.0001', 'ten', '1e1']) {
      await expect(service.createUnits(admin, line, [{ quantity, weight_basis: 'weighed' }])).rejects.toThrow(/weight above zero/)
    }
    await expect(service.createUnits(admin, line, [{ quantity: '10', weight_basis: 'guess' }])).rejects.toThrow(/weighed or estimated/)
  })

  it('two people labelling one line at the same moment produce one set of units', async () => {
    const line = await newLine(6)
    const results = await Promise.allSettled([service.createUnits(admin, line, null), service.createUnits(admin, line, null)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await q(`SELECT 1 FROM tracking_units WHERE purchase_line_id = $1 AND status = 'ACTIVE'`, [line])).toHaveLength(1)
  })

  it('labelling different lines at once never reuses a tracking ID', async () => {
    const lines = await Promise.all(Array.from({ length: 8 }, () => newLine(2)))
    const units = (await Promise.all(lines.map((line) => service.createUnits(admin, line, null)))).flat()
    expect(new Set(units.map((u) => u.stock_tracking_id)).size).toBe(8)
  })

  it('refuses a line on a cancelled bill', async () => {
    const bill = (await one(
      `INSERT INTO purchase_bills (supplier_id, company_id, warehouse_id, bill_number, bill_date, status)
       VALUES ($1, $2, $3, 'QR-BILL-C', (now() AT TIME ZONE 'Asia/Kolkata')::date, 'active') RETURNING id`, [ids.supplier, ids.company, ids.warehouse])).id
    const line = await newLine(1, null, bill)
    await client.query(`UPDATE purchase_bills SET status = 'cancelled' WHERE id = $1`, [bill])
    await expect(service.createUnits(admin, line, null)).rejects.toThrow(/not on an active bill/)
  })
})

describe('Nothing in tracking touches existing data', () => {
  it('create, print, reprint, test print, scan and void leave every existing table identical', async () => {
    const line = await newLine(8)
    const printer = await one(`INSERT INTO tracking_printers (company_id, warehouse_id, name) VALUES ($1, $2, 'Dock') RETURNING id`, [ids.company, ids.warehouse])
    ids.printer = printer.id
    const before = await existingDataFingerprint()
    const lineIdsBefore = await q(`SELECT purchase_line_id FROM purchase_bill_items ORDER BY 1`)

    const [a, b] = await service.createUnits(admin, line, [{ quantity: '4', weight_basis: 'weighed' }, { quantity: '4', weight_basis: 'weighed' }])
    const first = await service.requestPrint(admin, a.id, printer.id, null)
    expect(first.jobType).toBe('ORIGINAL')
    expect(first.zpl).toContain(a.qr_reference)
    await service.setPrintStatus(admin, first.jobId, 'sent')
    await service.setPrintStatus(admin, first.jobId, 'confirmed')
    const again = await service.requestPrint(admin, a.id, printer.id, 'Label damaged')
    expect(again.jobType).toBe('REPRINT')
    expect(again.zpl).toContain(a.qr_reference)
    await service.setPrintStatus(admin, again.jobId, 'failed')
    const test = await service.requestTestPrint(admin, printer.id)
    expect(test.zpl).toContain('TEST-NOT-STOCK')
    await service.lookupCode(admin, a.qr_reference)
    await service.lookupCode(admin, b.stock_tracking_id)
    await service.lookupCode(admin, 'TEST-NOT-STOCK')
    await service.voidUnit(admin, b.id, 'Wrong weight')

    expect(await existingDataFingerprint()).toEqual(before)
    expect(await q(`SELECT purchase_line_id FROM purchase_bill_items ORDER BY 1`)).toEqual(lineIdsBefore)
  })

  it('printing creates no unit, and a reprint keeps the same QR and tracking ID', async () => {
    const line = await newLine(3)
    const [unit] = await service.createUnits(admin, line, null)
    const count = async () => (await one(`SELECT count(*)::int AS n FROM tracking_units`)).n
    const before = await count()
    const job = await service.requestPrint(admin, unit.id, ids.printer, null)
    await service.setPrintStatus(admin, job.jobId, 'sent')
    await service.requestPrint(admin, unit.id, ids.printer, 'Smudged')
    expect(await count()).toBe(before)
    const row = await one(`SELECT qr_reference, stock_tracking_id FROM tracking_units WHERE id = $1`, [unit.id])
    expect(row).toEqual({ qr_reference: unit.qr_reference, stock_tracking_id: unit.stock_tracking_id })
  })

  it('a reprint needs a reason, and a role allowed to reprint', async () => {
    const line = await newLine(3)
    const [unit] = await service.createUnits(admin, line, null)
    const job = await service.requestPrint(admin, unit.id, ids.printer, null)
    await service.setPrintStatus(admin, job.jobId, 'sent')
    await expect(service.requestPrint(admin, unit.id, ids.printer, '  ')).rejects.toThrow(/reason is required/)
    await expect(service.requestPrint(actorFor('billing_staff', ids.company), unit.id, ids.printer, 'Damaged')).rejects.toThrow(/cannot reprint/)
  })

  it('a voided label cannot be printed and scans with a Do Not Use warning', async () => {
    const line = await newLine(3)
    const [unit] = await service.createUnits(admin, line, null)
    await service.voidUnit(admin, unit.id, 'Mislabelled')
    await expect(service.requestPrint(admin, unit.id, ids.printer, null)).rejects.toThrow(/voided label/)
    const result = await service.lookupCode(admin, unit.qr_reference)
    expect(result.kind === 'found' && result.warnings[0]).toMatch(/Do not use.*Mislabelled/)
  })

  it('after a void the line can be labelled again with new IDs', async () => {
    const line = await newLine(3)
    const [old] = await service.createUnits(admin, line, null)
    await service.voidUnit(admin, old.id, 'Weight wrong')
    const [fresh] = await service.createUnits(admin, line, null)
    expect(fresh.qr_reference).not.toBe(old.qr_reference)
    expect(fresh.stock_tracking_id).not.toBe(old.stock_tracking_id)
  })

  it('a scan warns when the purchase changes after labelling', async () => {
    const line = await newLine(5)
    const [unit] = await service.createUnits(admin, line, null)
    await client.query(`UPDATE purchase_bill_items SET received_quantity = 4 WHERE purchase_line_id = $1`, [line])
    let result = await service.lookupCode(admin, unit.qr_reference)
    expect(result.kind === 'found' && result.warnings.join()).toMatch(/now 4\.000 MT/)

    await client.query(`DELETE FROM purchase_bill_items WHERE purchase_line_id = $1`, [line])
    result = await service.lookupCode(admin, unit.qr_reference)
    expect(result.kind === 'found' && result.warnings.join()).toMatch(/no longer exists/)
  })

  it('a labelled purchase line can still be edited, deleted and its bill cancelled', async () => {
    const line = await newLine(2)
    await service.createUnits(admin, line, null)
    await client.query(`DELETE FROM purchase_bill_items WHERE purchase_line_id = $1`, [line])
    expect(await q(`SELECT 1 FROM purchase_bill_items WHERE purchase_line_id = $1`, [line])).toHaveLength(0)
  })
})

describe('Records are permanent', () => {
  it('history cannot be changed or deleted', async () => {
    const event = await one(`SELECT id FROM tracking_events LIMIT 1`)
    await expect(client.query(`UPDATE tracking_events SET details = '{}' WHERE id = $1`, [event.id])).rejects.toThrow(/permanent/)
    await expect(client.query(`DELETE FROM tracking_events WHERE id = $1`, [event.id])).rejects.toThrow(/permanent/)
  })

  it('a unit cannot be deleted, re-weighed or brought back from void', async () => {
    const line = await newLine(2)
    const [unit] = await service.createUnits(admin, line, null)
    await expect(client.query(`DELETE FROM tracking_units WHERE id = $1`, [unit.id])).rejects.toThrow(/cannot be deleted/)
    await expect(client.query(`UPDATE tracking_units SET quantity = 1 WHERE id = $1`, [unit.id])).rejects.toThrow(/cannot be changed/)
    await expect(client.query(`UPDATE tracking_units SET qr_reference = 'WC1-0000000000000000' WHERE id = $1`, [unit.id])).rejects.toThrow(/cannot be changed/)
    await service.voidUnit(admin, unit.id, 'Test')
    await expect(client.query(`UPDATE tracking_units SET status = 'ACTIVE', voided_at = NULL WHERE id = $1`, [unit.id])).rejects.toThrow(/cannot be made active/)
  })

  it('a full backup restored over itself keeps tracking data and history unchanged', async () => {
    const tracked = ['tracking_feature_flags', 'tracking_printers', 'tracking_label_templates', 'tracking_units', 'tracking_unit_origins', 'tracking_events', 'tracking_print_jobs']
    const read = async () => Object.fromEntries(await Promise.all(tracked.map(async (t) => [t, (await q(`SELECT t::text AS v FROM "${t}" t ORDER BY 1`)).map((r) => r.v)])))
    const before = await read()
    const ledgerBefore = await q(`SELECT id, quantity::text FROM stock_ledger ORDER BY id`)
    const data = await backup.getAllTableData()
    for (const table of tracked) expect(data[table]?.length, table).toBe(before[table].length)

    const result = await backup.restoreFromBackup(data, { truncateFirst: true })
    expect(Object.entries(result.tableResults).filter(([, r]) => r.failed > 0)).toEqual([])
    expect(await read()).toEqual(before)
    expect(await q(`SELECT id, quantity::text FROM stock_ledger ORDER BY id`)).toEqual(ledgerBefore)
  })
})

describe('Access', () => {
  it('another company cannot see, label or scan this company\'s units', async () => {
    const line = await newLine(2)
    const [unit] = await service.createUnits(admin, line, null)
    const outsider = actorFor('company_manager', ids.otherCompany)
    expect(await service.listUnits(outsider)).toHaveLength(0)
    expect(await service.listEligibleLines(outsider)).toHaveLength(0)
    await expect(service.getUnitDetail(outsider, unit.id)).rejects.toThrow(/not found/)
    await expect(service.voidUnit(outsider, unit.id, 'x')).rejects.toThrow(/not found/)
    await expect(service.createUnits(outsider, await newLine(1), null)).rejects.toThrow(/not found/)
    expect(await service.lookupCode(outsider, unit.qr_reference)).toEqual({ kind: 'other_company' })
  })

  it('anyone below admin with no company on their profile can reach nothing', async () => {
    const unassigned = actorFor('company_manager', null)
    expect(await service.listUnits(unassigned)).toHaveLength(0)
    expect(await service.listEligibleLines(unassigned)).toHaveLength(0)
  })

  it('a warehouse manager is limited to their own warehouse, and needs one assigned', async () => {
    expect((await service.listUnits(actorFor('warehouse_manager', ids.company, ids.warehouse))).length).toBeGreaterThan(0)
    expect(await service.listUnits(actorFor('warehouse_manager', ids.company, ids.warehouse2))).toHaveLength(0)
    expect(await service.listUnits(actorFor('warehouse_manager', ids.company, null))).toHaveLength(0)
  })

  it('routes enforce sign-in, role and active users', async () => {
    const units = await import('@/app/api/tracking/units/route')
    const settings = await import('@/app/api/tracking/settings/route')
    const sales = await makeUser('sales_manager', ids.company)
    const inactive = await makeUser('admin', null, null, false)

    expect((await units.GET(requestAs(null, '', 'units'), noParams)).status).toBe(401)
    expect((await units.GET(requestAs(inactive, 'admin', 'units'), noParams)).status).toBe(401)
    expect((await units.GET(requestAs(sales, 'sales_manager', 'units'), noParams)).status).toBe(200)
    expect((await units.POST(requestAs(sales, 'sales_manager', 'units', 'POST', { purchase_line_id: 'X' }), noParams)).status).toBe(403)
    expect((await settings.GET(requestAs(sales, 'sales_manager', 'settings'), noParams)).status).toBe(403)
  })

  it('the role on the profile wins over a role claimed in the session cookie', async () => {
    const settings = await import('@/app/api/tracking/settings/route')
    const sales = await makeUser('sales_manager', ids.company)
    expect((await settings.GET(requestAs(sales, 'admin', 'settings'), noParams)).status).toBe(403)
  })

  it('the general data connection refuses tracking tables', async () => {
    const { POST } = await import('@/app/api/graphql/route')
    const cookie = `wc_session=${jwt.sign({ userId: ids.user, email: 'a@b.c', role: 'admin', fullName: 'T' }, JWT_SECRET, { algorithm: 'HS256' })}`
    const res = await POST(new NextRequest('http://localhost/api/graphql', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ query: 'query Peek { tracking_units { qr_reference } }' }),
    }))
    expect(res.status).toBe(403)
  })
})

describe('Warehouse merge', () => {
  it('moves tracking rows to the surviving warehouse', async () => {
    const merge = await import('@/app/api/warehouses/merge/route')
    const source = (await one(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'Merge me') RETURNING id`, [ids.company])).id
    const bill = (await one(
      `INSERT INTO purchase_bills (supplier_id, company_id, warehouse_id, bill_number, bill_date, status)
       VALUES ($1, $2, $3, 'QR-BILL-M', (now() AT TIME ZONE 'Asia/Kolkata')::date, 'active') RETURNING id`, [ids.supplier, ids.company, source])).id
    const [unit] = await service.createUnits(admin, await newLine(1, null, bill), null)
    await service.setFeatureFlag(admin, ids.company, source, true)
    await service.setFeatureFlag(admin, ids.company, ids.warehouse2, true)

    const cookie = `wc_session=${jwt.sign({ userId: ids.user, email: 'a@b.c', role: 'admin', fullName: 'T' }, JWT_SECRET, { algorithm: 'HS256' })}`
    const res = await merge.POST(new NextRequest('http://localhost/api/warehouses/merge', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ sourceId: source, targetId: ids.warehouse2 }),
    }))
    expect(res.status).toBe(200)
    expect((await one(`SELECT warehouse_id FROM tracking_units WHERE id = $1`, [unit.id])).warehouse_id).toBe(ids.warehouse2)
    expect(await q(`SELECT 1 FROM tracking_feature_flags WHERE warehouse_id = $1`, [source])).toHaveLength(0)
  })
})
