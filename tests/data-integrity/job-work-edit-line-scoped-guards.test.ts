// Migration 168: Edit Order / Update Return Quantities only checks the
// lines a save actually changes. A problem left on another line of the same
// order — produced more than it was sent, or its purchase bill re-dated after
// the dispatch — must not stop returns being recorded for a different line.
// Runs against a real, throwaway Postgres instance (scripts/test/testDb.mjs).
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

let seq = 0
// Dispatched 05-Feb-2025: JL-A sends 10 of a real purchase line (billed
// 31-Jan-2025), JL-B sends 5 of TEST-PL-B. Nothing returned yet.
async function makeOrder() {
  seq += 1
  const code = `LS${seq}${Date.now().toString(36).slice(-4)}`.toUpperCase().slice(0, 10)
  const { rows: [company] } = await client.query(`INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [code])
  const { rows: [warehouse] } = await client.query(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id])
  const { rows: [material] } = await client.query(`INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`, [code])
  const { rows: [vendor] } = await client.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`${code}-VENDOR`])
  const { rows: [item] } = await client.query(
    `INSERT INTO item_master (item_code, item_name, material_type_id, unit, is_active) VALUES ($1, $1, $2, 'MT', true) RETURNING id`,
    [code, material.id]
  )
  const { rows: [bill] } = await client.query(
    `INSERT INTO purchase_bills (supplier_id, company_id, warehouse_id, bill_number, bill_date, status)
     VALUES ($1, $2, $3, $4, '2025-01-31', 'active') RETURNING id`,
    [vendor.id, company.id, warehouse.id, `BILL-${code}`]
  )
  const { rows: [billLine] } = await client.query(
    `INSERT INTO purchase_bill_items (bill_id, material_type_id, quantity, unit, rate, amount)
     VALUES ($1, $2, 20, 'MT', 100, 2000) RETURNING purchase_line_id`,
    [bill.id, material.id]
  )
  const { rows: [order] } = await client.query(
    `INSERT INTO job_work_orders (reference_number, vendor_id, company_id, warehouse_id, dispatch_date)
     VALUES ($1, $2, $3, $4, '2025-02-05') RETURNING id`,
    [`JW-LS-${code}`, vendor.id, company.id, warehouse.id]
  )
  const insertLine = async (pl: string, jobLine: string, sent: number) => {
    const { rows: [r] } = await client.query(
      `INSERT INTO job_work_items (purchase_line_id, job_line_id, job_work_order_id, item_master_id, material_type_id, quantity_sent, quantity_received, unit)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 'MT') RETURNING id`,
      [pl, jobLine, order.id, item.id, material.id, sent]
    )
    return r.id as string
  }
  const lineA = await insertLine(billLine.purchase_line_id, 'JL-A', 10)
  const lineB = await insertLine('TEST-PL-B', 'JL-B', 5)
  return {
    orderId: order.id as string, billId: bill.id as string, plA: billLine.purchase_line_id as string,
    lineA, lineB, companyId: company.id as string, warehouseId: warehouse.id as string,
    vendorId: vendor.id as string, itemId: item.id as string, materialTypeId: material.id as string,
  }
}

type Scope = Awaited<ReturnType<typeof makeOrder>>

async function addOutputDirect(s: Scope, jobLine: string, qty: number) {
  const { rows: [o] } = await client.query(
    `INSERT INTO job_work_output_items (job_work_order_id, item_master_id, material_type_id, quantity, unit, source_job_line_id, received_date)
     VALUES ($1, $2, $3, $4, 'MT', $5, '2025-02-10') RETURNING id`,
    [s.orderId, s.itemId, s.materialTypeId, qty, jobLine]
  )
  return o.id as string
}

async function currentOutputs(s: Scope) {
  const { rows } = await client.query(
    `SELECT id, quantity::float AS quantity, source_job_line_id FROM job_work_output_items WHERE job_work_order_id = $1 ORDER BY created_at`,
    [s.orderId]
  )
  return rows.map(r => ({
    id: r.id, item_master_id: s.itemId, material_type_id: s.materialTypeId, quantity: r.quantity,
    unit: 'MT', source_job_line_id: r.source_job_line_id, received_date: '2025-02-10',
  }))
}

// The same call /api/jobwork/[id]/save-edit makes: every current row as
// loaded, plus `newOutputs`, with optional overrides on JL-A.
async function saveEdit(s: Scope, newOutputs: { jobLine: string; qty: number }[], lineA: { sent?: number; notes?: string } = {}) {
  const outputs = [
    ...await currentOutputs(s),
    ...newOutputs.map(o => ({
      id: null, item_master_id: s.itemId, material_type_id: s.materialTypeId, quantity: o.qty,
      unit: 'MT', source_job_line_id: o.jobLine, received_date: '2025-02-10',
    })),
  ]
  const returned = (jl: string) => outputs.filter(o => o.source_job_line_id === jl).reduce((t, o) => t + o.quantity, 0)
  const input = [
    { id: s.lineA, purchase_line_id: s.plA, job_line_id: 'JL-A', item_master_id: s.itemId, material_type_id: s.materialTypeId,
      quantity_sent: lineA.sent ?? 10, quantity_received: returned('JL-A'), unit: 'MT', notes: lineA.notes ?? null },
    { id: s.lineB, purchase_line_id: 'TEST-PL-B', job_line_id: 'JL-B', item_master_id: s.itemId, material_type_id: s.materialTypeId,
      quantity_sent: 5, quantity_received: returned('JL-B'), unit: 'MT' },
  ]
  return client.query(
    `SELECT edit_job_work_order($1, $2, $3, $4, '2025-02-05', NULL, NULL, NULL, $5::jsonb, $6::jsonb, '{}'::uuid[], '{}'::uuid[]) AS r`,
    [s.orderId, s.companyId, s.warehouseId, s.vendorId, JSON.stringify(input), JSON.stringify(outputs)]
  )
}

async function received(id: string) {
  const { rows: [r] } = await client.query(`SELECT quantity_received::float AS q FROM job_work_items WHERE id = $1`, [id])
  return r.q as number
}

describe('edit_job_work_order — guards scoped to the lines a save changes (migration 168)', () => {
  it('records JL-B returns twice while JL-A is over-produced, and still refuses a change to JL-A', async () => {
    const s = await makeOrder()
    // JL-A: 10.5 produced against 10 sent, entered before the guard existed.
    await addOutputDirect(s, 'JL-A', 10.5)

    const first = await saveEdit(s, [{ jobLine: 'JL-B', qty: 2 }])
    expect(first.rows[0].r).toEqual({ success: true })
    const second = await saveEdit(s, [{ jobLine: 'JL-B', qty: 1.5 }])
    expect(second.rows[0].r).toEqual({ success: true })
    expect(await received(s.lineB)).toBeCloseTo(3.5, 6)

    const { rows: [{ inB }] } = await client.query(
      `SELECT COALESCE(sum(quantity), 0)::float AS "inB" FROM stock_ledger
       WHERE reference_type = 'job_work' AND reference_id = $1 AND entry_type = 'JOB_WORK_OUTPUT_IN' AND purchase_line_id = 'TEST-PL-B'`,
      [s.orderId]
    )
    expect(inB).toBeCloseTo(3.5, 6)

    // Changing JL-A itself is still held to the check.
    await expect(saveEdit(s, [], { sent: 9 })).rejects.toThrow(/Qty Consumed for JL-A \(9\.000\) is less than .* \(10\.500\)/)
  })

  it('a purchase bill re-dated after the dispatch blocks only a new pick of that line, not returns or notes on it', async () => {
    const s = await makeOrder()
    await client.query(`UPDATE purchase_bills SET bill_date = '2025-03-01' WHERE id = $1`, [s.billId])

    const r = await saveEdit(s, [{ jobLine: 'JL-B', qty: 1 }, { jobLine: 'JL-A', qty: 4 }], { notes: 'checked' })
    expect(r.rows[0].r).toEqual({ success: true })
    expect(await received(s.lineA)).toBeCloseTo(4, 6)

    await expect(client.query(
      `INSERT INTO job_work_items (purchase_line_id, job_line_id, job_work_order_id, item_master_id, material_type_id, quantity_sent, quantity_received, unit)
       VALUES ($1, 'JL-C', $2, $3, $4, 1, 0, 'MT')`,
      [s.plA, s.orderId, s.itemId, s.materialTypeId]
    )).rejects.toThrow(/before purchase line .* was invoiced/)
  })
})
