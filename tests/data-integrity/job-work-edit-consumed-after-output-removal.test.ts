// Migration 166: Edit Order removing an Output Materials row and lowering
// the Job Line's Qty Consumed by the same amount in one save. The old
// per-line guard compared the new Qty Sent with the line's stored
// quantity_received — still counting the output row this save had just
// deleted — and refused it; a refused save also kept the deletions it had
// already made. Runs against a real, throwaway Postgres instance
// (scripts/test/testDb.mjs).
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
// Sent 10 on job line JL-1, produced 6 + 4 — fully returned.
async function makeOrder() {
  seq += 1
  const code = `EC${seq}${Date.now().toString(36).slice(-4)}`.toUpperCase().slice(0, 10)
  const { rows: [company] } = await client.query(`INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [code])
  const { rows: [warehouse] } = await client.query(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id])
  const { rows: [material] } = await client.query(`INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`, [code])
  const { rows: [vendor] } = await client.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`${code}-VENDOR`])
  const { rows: [item] } = await client.query(
    `INSERT INTO item_master (item_code, item_name, material_type_id, unit, is_active) VALUES ($1, $1, $2, 'MT', true) RETURNING id`,
    [code, material.id]
  )
  const { rows: [order] } = await client.query(
    `INSERT INTO job_work_orders (reference_number, vendor_id, company_id, warehouse_id, dispatch_date)
     VALUES ($1, $2, $3, $4, '2024-07-24') RETURNING id`,
    [`JW-EC-${code}`, vendor.id, company.id, warehouse.id]
  )
  const { rows: [input] } = await client.query(
    `INSERT INTO job_work_items (purchase_line_id, job_line_id, job_work_order_id, item_master_id, material_type_id, quantity_sent, quantity_received, unit)
     VALUES ('TEST-PL-001', 'JL-1', $1, $2, $3, 10, 0, 'MT') RETURNING id`,
    [order.id, item.id, material.id]
  )
  const outputIds: string[] = []
  for (const qty of [6, 4]) {
    const { rows: [o] } = await client.query(
      `INSERT INTO job_work_output_items (job_work_order_id, item_master_id, material_type_id, quantity, unit, source_job_line_id, received_date)
       VALUES ($1, $2, $3, $4, 'MT', 'JL-1', '2024-08-01') RETURNING id`,
      [order.id, item.id, material.id, qty]
    )
    outputIds.push(o.id)
  }
  await client.query(`UPDATE job_work_items SET quantity_received = 10 WHERE id = $1`, [input.id])
  return {
    orderId: order.id as string, inputId: input.id as string, outputIds,
    companyId: company.id as string, warehouseId: warehouse.id as string, vendorId: vendor.id as string,
    itemId: item.id as string, materialTypeId: material.id as string,
  }
}

type Scope = Awaited<ReturnType<typeof makeOrder>>

// The same call /api/jobwork/[id]/save-edit makes: keep output #1 (6),
// delete output #2 (4), Qty Consumed set to `sent`.
function saveEdit(s: Scope, sent: number) {
  const input = [{
    id: s.inputId, purchase_line_id: 'TEST-PL-001', job_line_id: 'JL-1', item_master_id: s.itemId,
    material_type_id: s.materialTypeId, quantity_sent: sent, quantity_received: 6, unit: 'MT',
  }]
  const output = [{
    id: s.outputIds[0], item_master_id: s.itemId, material_type_id: s.materialTypeId,
    quantity: 6, unit: 'MT', source_job_line_id: 'JL-1', received_date: '2024-08-01',
  }]
  return client.query(
    `SELECT edit_job_work_order($1, $2, $3, $4, '2024-07-24', NULL, NULL, NULL, $5::jsonb, $6::jsonb, '{}'::uuid[], $7::uuid[]) AS r`,
    [s.orderId, s.companyId, s.warehouseId, s.vendorId, JSON.stringify(input), JSON.stringify(output), [s.outputIds[1]]]
  )
}

async function state(s: Scope) {
  const { rows: [line] } = await client.query(`SELECT quantity_sent::float AS sent, quantity_received::float AS received FROM job_work_items WHERE id = $1`, [s.inputId])
  const { rows: [{ n }] } = await client.query(`SELECT count(*)::int AS n FROM job_work_output_items WHERE job_work_order_id = $1`, [s.orderId])
  const { rows: [{ out }] } = await client.query(
    `SELECT COALESCE(sum(quantity), 0)::float AS out FROM stock_ledger
     WHERE reference_type = 'job_work' AND reference_id = $1 AND entry_type = 'JOB_WORK_OUT'`,
    [s.orderId]
  )
  return { sent: line.sent, received: line.received, outputRows: n, dispatchedNet: out }
}

describe('edit_job_work_order — Qty Consumed after removing output (migration 166)', () => {
  it('removing a 4.000 output and lowering Qty Consumed 10 → 6 saves, and 4.000 goes back to stock', async () => {
    const s = await makeOrder()
    expect((await state(s)).dispatchedNet).toBeCloseTo(-10, 6)

    const { rows: [{ r }] } = await saveEdit(s, 6)
    expect(r).toEqual({ success: true })
    const after = await state(s)
    expect(after).toMatchObject({ sent: 6, received: 6, outputRows: 1 })
    expect(after.dispatchedNet).toBeCloseTo(-6, 6)

    // Migration 167: the removed output's reversal is tagged with the same
    // purchase line as the JOB_WORK_OUTPUT_IN it reverses.
    const { rows: tags } = await client.query(
      `SELECT entry_type, purchase_line_id, quantity::float AS qty FROM stock_ledger
       WHERE reference_type = 'job_work' AND reference_id = $1 AND entry_type IN ('JOB_WORK_OUTPUT_IN', 'JOB_WORK_CANCEL')
       ORDER BY entry_type, quantity`,
      [s.orderId]
    )
    expect(tags).toEqual([
      { entry_type: 'JOB_WORK_CANCEL', purchase_line_id: 'TEST-PL-001', qty: -4 },
      { entry_type: 'JOB_WORK_OUTPUT_IN', purchase_line_id: 'TEST-PL-001', qty: 4 },
      { entry_type: 'JOB_WORK_OUTPUT_IN', purchase_line_id: 'TEST-PL-001', qty: 6 },
    ])
  })

  it('refuses Qty Consumed below what is still produced against the line, and saves nothing', async () => {
    const s = await makeOrder()
    const before = await state(s)

    await expect(saveEdit(s, 5)).rejects.toThrow(/Qty Consumed for JL-1 \(5\.000\) is less than .* \(6\.000\)/)
    expect(await state(s)).toEqual(before) // output #2 not deleted, Qty Sent still 10
  })

  it('still counts an output row added elsewhere after the tab loaded', async () => {
    const s = await makeOrder()
    // Another tab records 0.5 more against JL-1 — this save never saw it.
    await client.query(
      `INSERT INTO job_work_output_items (job_work_order_id, item_master_id, material_type_id, quantity, unit, source_job_line_id, received_date)
       VALUES ($1, $2, $3, 0.5, 'MT', 'JL-1', '2024-08-02')`,
      [s.orderId, s.itemId, s.materialTypeId]
    )
    await expect(saveEdit(s, 6)).rejects.toThrow(/less than .* \(6\.500\)/)
  })
})
