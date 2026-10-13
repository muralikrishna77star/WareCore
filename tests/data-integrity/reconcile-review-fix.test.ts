// Migration 163: Item-by-Item Reconciliation causes + Review & Fix repairs.
//  - vw_job_work_vendor_movements charges a cross-item output only to its
//    own source job line (JW-MUO2DCII-2FSX charged all of GA 1 X 150's
//    outputs to GA 1 X 164);
//  - a job work output / return can't be dated before the order was sent;
//  - fn_reconcile_fix_output_received_date moves a mis-dated output and
//    leaves one ledger row on the right date;
//  - fn_reconcile_fix_align_pair_timestamp lines up a vendor direct sale's
//    two legs.
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

async function setup() {
  const code = `RF${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 1000)}`.toUpperCase()
  const company = await one(`INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [code])
  const wh = await one(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id])
  const vendor = await one(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [code])
  const mt = await one(`INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`, [code])
  const s150 = await one(`INSERT INTO material_sizes (material_type_id, size_label) VALUES ($1, '1 X 150') RETURNING id`, [mt.id])
  const s164 = await one(`INSERT INTO material_sizes (material_type_id, size_label) VALUES ($1, '1 X 164') RETURNING id`, [mt.id])
  const order = await one(
    `INSERT INTO job_work_orders (reference_number, vendor_id, company_id, warehouse_id, dispatch_date)
     VALUES ($1, $2, $3, $4, '2025-02-18') RETURNING id`, [`JW-${code}`, vendor.id, company.id, wh.id])
  return { code, company, wh, vendor, mt, s150, s164, order }
}

async function vendorBalance(mtId: string, sizeId: string) {
  const r = await one(
    `SELECT COALESCE(SUM(vendor_delta), 0) AS b FROM vw_job_work_vendor_movements WHERE material_type_id = $1 AND material_size_id = $2`,
    [mtId, sizeId])
  return Number(r.b)
}

describe('vw_job_work_vendor_movements — cross-item outputs (migration 163)', () => {
  it('charges each output row to its own source job line, not to any cross-item line on the order', async () => {
    const { mt, s150, s164, order } = await setup()
    // Two 1 X 150 lines and one 1 X 164 line go out.
    for (const [line, pl, size, label, qty] of [
      ['JW-L1', 'PL-150-A', s150.id, '1 X 150', 1.84],
      ['JW-L2', 'PL-150-B', s150.id, '1 X 150', 1.35],
      ['JW-L3', 'PL-164-A', s164.id, '1 X 164', 1.33],
    ] as const) {
      await client.query(
        `INSERT INTO job_work_items (job_work_order_id, job_line_id, purchase_line_id, material_type_id, material_size_id, size_label, quantity_sent, unit)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'MT')`, [order.id, line, pl, mt.id, size, label, qty])
    }
    // JOB_WORK_OUT rows, as the create flow posts them.
    for (const [pl, size, label, qty] of [['PL-150-A', s150.id, '1 X 150', 1.84], ['PL-150-B', s150.id, '1 X 150', 1.35], ['PL-164-A', s164.id, '1 X 164', 1.33]] as const) {
      await client.query(
        `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, material_size_id, size_label, quantity, reference_type, reference_id, reference_number, entry_date, purchase_line_id)
         SELECT 'JOB_WORK_OUT', company_id, warehouse_id, $2, $3, $4, -$5::numeric, 'job_work', id, reference_number, dispatch_date, $6 FROM job_work_orders WHERE id = $1
           AND NOT EXISTS (SELECT 1 FROM stock_ledger WHERE reference_id = $1 AND entry_type = 'JOB_WORK_OUT' AND purchase_line_id = $6)`,
        [order.id, mt.id, size, label, qty, pl])
    }
    // All outputs come back as 1 X 150: one per 1 X 150 line, and one from
    // the 1 X 164 line (a genuine conversion).
    for (const [src, qty] of [['JW-L1', 1.457], ['JW-L2', 1.0], ['JW-L3', 1.0]] as const) {
      await client.query(
        `INSERT INTO job_work_output_items (job_work_order_id, material_type_id, material_size_id, size_label, quantity, unit, source_job_line_id, received_date)
         VALUES ($1, $2, $3, '1 X 150', $4, 'MT', $5, '2025-03-05')`, [order.id, mt.id, s150.id, qty, src])
    }

    expect(await vendorBalance(mt.id, s150.id)).toBeCloseTo(1.84 + 1.35 - 1.457 - 1.0, 3) // 0.733
    expect(await vendorBalance(mt.id, s164.id)).toBeCloseTo(1.33 - 1.0, 3) // 0.330
  })
})

describe('received date guard (migration 163)', () => {
  it('rejects an output dated before the job work was sent, and accepts one after', async () => {
    const { mt, s150, order } = await setup()
    await expect(client.query(
      `INSERT INTO job_work_output_items (job_work_order_id, material_type_id, material_size_id, size_label, quantity, unit, received_date)
       VALUES ($1, $2, $3, '1 X 150', 1, 'MT', '2024-02-14')`, [order.id, mt.id, s150.id]
    )).rejects.toThrow(/before job work .* was sent to the vendor on 18-Feb-2025/)
    await client.query(
      `INSERT INTO job_work_output_items (job_work_order_id, material_type_id, material_size_id, size_label, quantity, unit, received_date)
       VALUES ($1, $2, $3, '1 X 150', 1, 'MT', '2025-02-19')`, [order.id, mt.id, s150.id])
  })
})

describe('fn_reconcile_fix_output_received_date (migration 163)', () => {
  it('moves a mis-dated output to the corrected date, leaving one ledger row there', async () => {
    const { mt, s150, order } = await setup()
    await client.query(
      `INSERT INTO job_work_items (job_work_order_id, job_line_id, purchase_line_id, material_type_id, material_size_id, size_label, quantity_sent, unit)
       VALUES ($1, 'JW-D1', 'PL-D1', $2, $3, '1 X 150', 3.08, 'MT')`, [order.id, mt.id, s150.id])
    // Saved before the guard existed: bypass it to recreate that state.
    await client.query(`ALTER TABLE job_work_output_items DISABLE TRIGGER trg_job_work_output_items_received_after_dispatch`)
    const out = await one(
      `INSERT INTO job_work_output_items (job_work_order_id, material_type_id, material_size_id, size_label, quantity, unit, source_job_line_id, received_date)
       VALUES ($1, $2, $3, '1 X 150', 1.96, 'MT', 'JW-D1', '2024-02-14') RETURNING id`, [order.id, mt.id, s150.id])
    await client.query(`ALTER TABLE job_work_output_items ENABLE TRIGGER trg_job_work_output_items_received_after_dispatch`)

    // A date before dispatch is refused, nothing changes.
    await expect(client.query(`SELECT fn_reconcile_fix_output_received_date($1, '2025-01-01', NULL, NULL)`, [out.id]))
      .rejects.toThrow(/Nothing was changed/)

    const summary = (await one(`SELECT fn_reconcile_fix_output_received_date($1, '2025-02-20', NULL, NULL) AS s`, [out.id])).s
    expect(summary).toMatch(/14-Feb-2024 to 20-Feb-2025/)

    const { rows } = await client.query(
      `SELECT entry_type, entry_date::text AS d, quantity::numeric AS q FROM stock_ledger
       WHERE reference_id = $1 AND entry_type IN ('JOB_WORK_OUTPUT_IN', 'JOB_WORK_CANCEL')`, [order.id])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ entry_type: 'JOB_WORK_OUTPUT_IN', d: '2025-02-20' })
    expect(Number(rows[0].q)).toBeCloseTo(1.96, 3)
    expect((await one(`SELECT received_date::text AS d FROM job_work_output_items WHERE id = $1`, [out.id])).d).toBe('2025-02-20')
    expect((await one(`SELECT count(*)::int AS n FROM stock_reconcile_fix_log WHERE params->>'output_item_id' = $1`, [out.id])).n).toBe(1)

    // Running it again is refused — the line is no longer mis-dated.
    await expect(client.query(`SELECT fn_reconcile_fix_output_received_date($1, '2025-02-21', NULL, NULL)`, [out.id]))
      .rejects.toThrow(/already dated on or after/)
  })
})

describe('fn_reconcile_fix_align_pair_timestamp (migration 163)', () => {
  it('gives a vendor direct sale\'s later leg the earlier leg\'s timestamp, and refuses unrelated rows', async () => {
    const { company, wh, mt, s150, order } = await setup()
    const ins = (type: string, qty: number, refType: string, notes: string | null, createdAt: string) => one(
      `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, material_size_id, size_label, quantity, reference_type, reference_id, reference_number, entry_date, notes, created_at, purchase_line_id)
       VALUES ($1, $2, $3, $4, $5, '1 X 150', $6, $7, $8, 'REF', '2025-01-09', $9, $10, 'PL-X') RETURNING id`,
      [type, company.id, wh.id, mt.id, s150.id, qty, refType, order.id, notes, createdAt])
    const sale = await ins('SALE_OUT', -4.17, 'dispatch', null, '2026-09-25T10:18:05Z')
    const ret = await ins('JOB_WORK_RETURN_IN', 4.17, 'job_work', 'Vendor direct sale — virtual return', '2026-10-10T08:22:39Z')
    const realReturn = await ins('JOB_WORK_RETURN_IN', 4.17, 'job_work', null, '2026-10-11T08:00:00Z')

    await expect(client.query(`SELECT fn_reconcile_fix_align_pair_timestamp($1, $2, NULL, NULL)`, [realReturn.id, sale.id]))
      .rejects.toThrow(/real return from the vendor/)

    await client.query(`SELECT fn_reconcile_fix_align_pair_timestamp($1, $2, NULL, NULL)`, [ret.id, sale.id])
    const { rows } = await client.query(`SELECT id, created_at FROM stock_ledger WHERE id IN ($1, $2)`, [ret.id, sale.id])
    expect(rows[0].created_at.toISOString()).toBe('2026-09-25T10:18:05.000Z')
    expect(rows[1].created_at.toISOString()).toBe('2026-09-25T10:18:05.000Z')
  })
})
