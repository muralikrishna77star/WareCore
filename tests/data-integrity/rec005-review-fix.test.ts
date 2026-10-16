// Migration 165: Review & Fix for REC-005 (negative company stock).
//  - fn_rec005_intercompany_proposals replays each purchase line per company
//    and proposes a transfer wherever one company drew stock the other held
//    (EXC-001146's coil swap between Sri Sai and DS Steel);
//  - fn_rec005_fix_intercompany posts those pairs and resolves the exception;
//  - fn_rec005_fix_output_item moves a mis-sized job work output back to its
//    job line's own size (EXC-000818), refusing when that would starve the
//    item it was booked under.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { startTestDb } from '../../scripts/test/testDb.mjs'

let db: Awaited<ReturnType<typeof startTestDb>>
let client: pg.Client

beforeAll(async () => {
  db = await startTestDb({})
  client = new pg.Client({ connectionString: db.connectionString })
  await client.connect()
}, 300_000)

afterAll(async () => {
  await client?.end()
  await db?.stop()
}, 60_000)

const one = async (sql: string, p: unknown[] = []) => (await client.query(sql, p)).rows[0]
const tag = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1000)}`.toUpperCase()

async function companyWithWarehouse(name: string) {
  const c = await one(`INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [name])
  const w = await one(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [c.id])
  return { id: c.id as string, wh: w.id as string }
}

async function post(type: string, co: { id: string; wh: string }, mt: string, size: string, label: string, qty: number,
  date: string, pl: string | null, ref: string, refType = 'manual', createdAt = `${date}T10:00:00Z`) {
  return one(
    `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, material_size_id, size_label, quantity, reference_type, reference_number, entry_date, purchase_line_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [type, co.id, co.wh, mt, size, label, qty, refType, ref, date, pl, createdAt])
}

async function openException(companyId: string, mt: string, size: string) {
  return one(
    `INSERT INTO reconciliation_exceptions (rule_id, fingerprint, severity, company_id, material_type_id, material_size_id, summary)
     SELECT id, $1, 'CRITICAL', $2, $3, $4, 'Stock went negative company-wide' FROM reconciliation_rules WHERE rule_code = 'REC-005'
     RETURNING id`, [`REC-005|${companyId}|${mt}|${size}|${tag()}`, companyId, mt, size])
}

const minBal = async (c: string, mt: string, s: string) =>
  Number((await one(`SELECT fn_rec005_scope_min_balance($1, $2, $3) AS m`, [c, mt, s])).m)

describe('REC-005 inter-company transfers (migration 165)', () => {
  it('reproduces the 0.90 X 120.50 coil swap: proposes the 5 transfers and leaves both companies non-negative', async () => {
    const t = tag()
    const ds = await companyWithWarehouse(`DS${t}`)
    const ss = await companyWithWarehouse(`SS${t}`)
    const mt = (await one(`INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`, [`CR${t}`])).id
    const s = (await one(`INSERT INTO material_sizes (material_type_id, size_label) VALUES ($1, '0.90 X 120.50') RETURNING id`, [mt])).id
    const L = '0.90 X 120.50'
    // DS buys 4 coils; SS buys 2 of its own.
    for (const [pl, q] of [['D15', 1.34], ['D16', 1.34], ['D17', 1.1], ['D18', 1.1]] as const) await post('PURCHASE_IN', ds, mt, s, L, q, '2024-09-20', pl, 'B-DS')
    for (const pl of ['S25', 'S26']) await post('PURCHASE_IN', ss, mt, s, L, 1.1, '2024-10-29', pl, 'B-SS')
    // SS sends DS's D17/D18 to job work; D17 sold from the vendor, D18 comes back as output into SS.
    await post('JOB_WORK_OUT', ss, mt, s, L, -1.1, '2024-10-29', 'D17', 'JW-ISM5')
    await post('JOB_WORK_OUT', ss, mt, s, L, -1.1, '2024-10-29', 'D18', 'JW-ISM5')
    await post('JOB_WORK_RETURN_IN', ss, mt, s, L, 1.08, '2024-11-07', 'D17', 'JW-ISM5', 'manual', '2024-11-07T10:00:00Z')
    await post('SALE_OUT', ss, mt, s, L, -1.08, '2024-11-07', 'D17', '1124-0470', 'manual', '2024-11-07T10:00:00Z')
    await post('JOB_WORK_OUTPUT_IN', ss, mt, s, L, 1.1, '2024-11-15', 'D18', 'JW-ISM5')
    // DS sells its own coils, SS's S25/S26, and 0.800 of D18 (which is now in SS).
    await post('SALE_OUT', ds, mt, s, L, -1.34, '2024-10-17', 'D15', '1024-0446')
    await post('SALE_OUT', ds, mt, s, L, -1.1, '2024-11-13', 'S25', '1124-0482')
    await post('SALE_OUT', ds, mt, s, L, -1.1, '2024-11-13', 'S26', '1124-0482')
    await post('SALE_OUT', ds, mt, s, L, -0.8, '2025-02-07', 'D18', '0225-0849')
    await post('SALE_OUT', ds, mt, s, L, -1.34, '2025-02-17', 'D16', '0225-0883')

    expect(await minBal(ds.id, mt, s)).toBeCloseTo(-0.8, 3)

    const { rows } = await client.query(
      `SELECT purchase_line_id AS pl, (from_company_id = $3) AS from_ds, quantity::numeric AS q, entry_date::text AS d
       FROM fn_rec005_intercompany_proposals($1, $2) ORDER BY entry_date, purchase_line_id`, [mt, s, ds.id])
    expect(rows.map((r) => [r.pl, r.from_ds, Number(r.q), r.d])).toEqual([
      ['D17', true, 1.1, '2024-10-29'],
      ['D18', true, 1.1, '2024-10-29'],
      ['S25', false, 1.1, '2024-11-13'],
      ['S26', false, 1.1, '2024-11-13'],
      ['D18', false, 0.8, '2025-02-07'],
    ])

    const exc = await openException(ds.id, mt, s)
    const summary = (await one(`SELECT fn_rec005_fix_intercompany($1, NULL) AS s`, [exc.id])).s
    expect(summary).toMatch(/Recorded 5 inter-company transfer/)
    expect(summary).toMatch(/marked resolved/)
    expect(await minBal(ds.id, mt, s)).toBeGreaterThanOrEqual(0)
    expect(await minBal(ss.id, mt, s)).toBeGreaterThanOrEqual(0)
    expect((await one(`SELECT status FROM reconciliation_exceptions WHERE id = $1`, [exc.id])).status).toBe('RESOLVED')

    // Nothing left to propose; a second attempt is refused.
    expect((await client.query(`SELECT * FROM fn_rec005_intercompany_proposals($1, $2)`, [mt, s])).rows).toHaveLength(0)
    const exc2 = await openException(ds.id, mt, s)
    await expect(client.query(`SELECT fn_rec005_fix_intercompany($1, NULL)`, [exc2.id])).rejects.toThrow(/Nothing was changed/)
  })
})

describe('REC-005 mis-sized job work output (migration 165)', () => {
  async function scenario(sellOutputItem: number) {
    const t = tag()
    const co = await companyWithWarehouse(`GA${t}`)
    const vendor = await one(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`V${t}`])
    const mt = (await one(`INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`, [`GA${t}`])).id
    const s164 = (await one(`INSERT INTO material_sizes (material_type_id, size_label) VALUES ($1, '1 X 164') RETURNING id`, [mt])).id
    const s150 = (await one(`INSERT INTO material_sizes (material_type_id, size_label) VALUES ($1, '1 X 150') RETURNING id`, [mt])).id
    const i164 = (await one(`INSERT INTO item_master (item_code, item_name, material_type_id, material_size_id, unit, is_active) VALUES ($1, 'GA 1 X 164', $2, $3, 'MT', true) RETURNING id`, [`I164${t}`, mt, s164])).id
    const i150 = (await one(`INSERT INTO item_master (item_code, item_name, material_type_id, material_size_id, unit, is_active) VALUES ($1, 'GA 1 X 150', $2, $3, 'MT', true) RETURNING id`, [`I150${t}`, mt, s150])).id
    await post('PURCHASE_IN', co, mt, s164, '1 X 164', 1.33, '2025-02-18', 'GA-0009', 'B1')
    const order = await one(
      `INSERT INTO job_work_orders (reference_number, vendor_id, company_id, warehouse_id, dispatch_date) VALUES ($1, $2, $3, $4, '2025-02-18') RETURNING id`,
      [`JW-${t}`, vendor.id, co.id, co.wh])
    await client.query(
      `INSERT INTO job_work_items (job_work_order_id, job_line_id, purchase_line_id, item_master_id, material_type_id, material_size_id, size_label, quantity_sent, unit)
       VALUES ($1, 'JW-1802-0007', 'GA-0009', $2, $3, $4, '1 X 164', 1.33, 'MT')`, [order.id, i164, mt, s164])
    const out = await one(
      `INSERT INTO job_work_output_items (job_work_order_id, item_master_id, material_type_id, material_size_id, size_label, quantity, unit, source_job_line_id, received_date)
       VALUES ($1, $2, $3, $4, '1 X 150', 1.0, 'MT', 'JW-1802-0007', '2025-03-05') RETURNING id`, [order.id, i150, mt, s150])
    await post('SALE_OUT', co, mt, s164, '1 X 164', -0.98, '2025-03-06', 'GA-0009', '0325-1046')
    if (sellOutputItem) await post('SALE_OUT', co, mt, s150, '1 X 150', -sellOutputItem, '2025-03-07', null, '0325-1050')
    return { co, mt, s164, s150, out, exc: await openException(co.id, mt, s164) }
  }

  it('changes the output to the job line\'s size and resolves the exception', async () => {
    const { co, mt, s164, s150, out, exc } = await scenario(0)
    expect(await minBal(co.id, mt, s164)).toBeCloseTo(-0.98, 3)
    const proposals = (await client.query(`SELECT * FROM fn_rec005_output_item_proposals($1, $2, $3)`, [co.id, mt, s164])).rows
    expect(proposals.map((p) => p.output_item_id)).toEqual([out.id])

    const summary = (await one(`SELECT fn_rec005_fix_output_item($1, $2, NULL) AS s`, [exc.id, out.id])).s
    expect(summary).toMatch(/marked resolved/)
    expect(await minBal(co.id, mt, s164)).toBeGreaterThanOrEqual(0)
    expect(await minBal(co.id, mt, s150)).toBeGreaterThanOrEqual(0)
    expect((await one(`SELECT material_size_id FROM job_work_output_items WHERE id = $1`, [out.id])).material_size_id).toBe(s164)
  })

  it('refuses when the output\'s current item has since been sold, and changes nothing', async () => {
    const { co, mt, s150, out, exc } = await scenario(0.5)
    await expect(client.query(`SELECT fn_rec005_fix_output_item($1, $2, NULL)`, [exc.id, out.id]))
      .rejects.toThrow(/has been sold or used since/)
    expect((await one(`SELECT material_size_id FROM job_work_output_items WHERE id = $1`, [out.id])).material_size_id).toBe(s150)
    expect(await minBal(co.id, mt, s150)).toBeGreaterThanOrEqual(0)
  })
})
