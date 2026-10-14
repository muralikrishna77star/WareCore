// Migration 164: when Edit Order re-points a job work line at another
// purchase line / material / size, its JOB_WORK_OUT rows move with it.
// JW-MTYAKT99-C8GE's line JW-1212-0020 was moved from OT0324-0003
// (OTH00046) to OT0324-0001 (OTH00032) but its dispatch row kept the old
// tag, so OTH00046's Item Stock Ledger showed OTH00032's dispatch.
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
  const code = `RT${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 1000)}`.toUpperCase()
  const company = await one(`INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [code])
  const wh = await one(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id])
  const vendor = await one(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [code])
  const mt = await one(`INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`, [code])
  const sizeA = await one(`INSERT INTO material_sizes (material_type_id, size_label) VALUES ($1, 'Over width') RETURNING id`, [mt.id])
  const sizeB = await one(`INSERT INTO material_sizes (material_type_id, size_label) VALUES ($1, 'Scrap') RETURNING id`, [mt.id])
  const order = await one(
    `INSERT INTO job_work_orders (reference_number, vendor_id, company_id, warehouse_id, dispatch_date)
     VALUES ($1, $2, $3, $4, '2024-12-12') RETURNING id`, [`JW-${code}`, vendor.id, company.id, wh.id])
  const addLine = (jobLine: string, pl: string, size: { id: string }, label: string, qty: number) => one(
    `INSERT INTO job_work_items (job_work_order_id, job_line_id, purchase_line_id, material_type_id, material_size_id, size_label, quantity_sent, unit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'MT') RETURNING id`, [order.id, jobLine, pl, mt.id, size.id, label, qty])
  return { mt, sizeA, sizeB, order, addLine }
}

async function outByLine(orderId: string) {
  const { rows } = await client.query(
    `SELECT purchase_line_id AS pl, size_label AS size, SUM(quantity)::numeric AS q, count(*)::int AS n
     FROM stock_ledger WHERE reference_id = $1 AND entry_type = 'JOB_WORK_OUT'
     GROUP BY 1, 2 ORDER BY 1, 2`, [orderId])
  return rows.map((r) => ({ pl: r.pl, size: r.size, q: Number(r.q), n: r.n }))
}

describe('fn_job_work_item_to_ledger — line re-pointed by Edit Order (migration 164)', () => {
  it('moves the dispatch row to the new purchase line in place', async () => {
    const s = await setup()
    const line = await s.addLine('JW-L1', 'PL-PAINT', s.sizeA, 'Over width', 0.6)
    await client.query(`UPDATE job_work_items SET purchase_line_id = 'PL-MIXED' WHERE id = $1`, [line.id])
    expect(await outByLine(s.order.id)).toEqual([{ pl: 'PL-MIXED', size: 'Over width', q: -0.6, n: 1 }])
  })

  it('moves material size too, together with a Qty Sent change in the same save', async () => {
    const s = await setup()
    const line = await s.addLine('JW-L1', 'PL-1', s.sizeA, 'Over width', 0.6)
    await client.query(
      `UPDATE job_work_items SET purchase_line_id = 'PL-2', material_size_id = $2, size_label = 'Scrap', quantity_sent = 0.7 WHERE id = $1`,
      [line.id, s.sizeB.id])
    const rows = await outByLine(s.order.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ pl: 'PL-2', size: 'Scrap' })
    expect(rows[0].q).toBeCloseTo(-0.7, 6)
  })

  it('reverses and re-posts when another line of the order shares the old purchase line', async () => {
    const s = await setup()
    await s.addLine('JW-L1', 'PL-SCRAP', s.sizeA, 'Over width', 5.292)
    const moved = await s.addLine('JW-L2', 'PL-SCRAP', s.sizeA, 'Over width', 0.238)
    await client.query(`UPDATE job_work_items SET purchase_line_id = 'PL-OTHER' WHERE id = $1`, [moved.id])
    const rows = await outByLine(s.order.id)
    expect(rows.find((r) => r.pl === 'PL-SCRAP')!.q).toBeCloseTo(-5.292, 6)
    expect(rows.find((r) => r.pl === 'PL-OTHER')!.q).toBeCloseTo(-0.238, 6)
  })

  it('refuses once the line has a return recorded, and leaves everything unchanged', async () => {
    const s = await setup()
    const line = await s.addLine('JW-L1', 'PL-1', s.sizeA, 'Over width', 0.6)
    await client.query(`UPDATE job_work_items SET quantity_received = 0.2 WHERE id = $1`, [line.id])
    await expect(client.query(`UPDATE job_work_items SET purchase_line_id = 'PL-2' WHERE id = $1`, [line.id]))
      .rejects.toThrow(/already has material returned.*can't be changed/)
    expect((await one(`SELECT purchase_line_id FROM job_work_items WHERE id = $1`, [line.id])).purchase_line_id).toBe('PL-1')
  })

  it('an Edit Order save that changes nothing posts nothing', async () => {
    const s = await setup()
    const line = await s.addLine('JW-L1', 'PL-1', s.sizeA, 'Over width', 0.6)
    await client.query(
      `UPDATE job_work_items SET purchase_line_id = purchase_line_id, material_size_id = material_size_id, quantity_sent = quantity_sent WHERE id = $1`,
      [line.id])
    expect(await outByLine(s.order.id)).toEqual([{ pl: 'PL-1', size: 'Over width', q: -0.6, n: 1 }])
  })
})
