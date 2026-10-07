// Migration 156: Delete Order on a job work order that a transfer still
// points at returns a plain-language message (which transfer, which screen)
// instead of the raw job_work_transfers foreign-key error. Runs against the
// real migrations on a throwaway Postgres; no production data.
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
async function makeTransferPair() {
  seq += 1
  const code = `DT${seq}${Date.now().toString(36).slice(-4)}`.toUpperCase().slice(0, 10)
  const { rows: [company] } = await client.query(`INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [code])
  const { rows: [warehouse] } = await client.query(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id])
  const { rows: [fromVendor] } = await client.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`${code}-FROM`])
  const { rows: [toVendor] } = await client.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`${code}-TO`])
  const makeOrder = async (ref: string, vendorId: string) => {
    const { rows: [o] } = await client.query(
      `INSERT INTO job_work_orders (reference_number, vendor_id, company_id, warehouse_id, dispatch_date, status)
       VALUES ($1, $2, $3, $4, '2025-02-13', 'dispatched') RETURNING id`,
      [ref, vendorId, company.id, warehouse.id]
    )
    return o.id as string
  }
  const source = await makeOrder(`JW-SRC-${code}`, fromVendor.id)
  const dest = await makeOrder(`JW-DST-${code}`, toVendor.id)
  const transferNumber = `JWT-${code}`
  await client.query(
    `INSERT INTO job_work_transfers (transfer_number, transfer_date, from_job_work_order_id, from_vendor_id, to_job_work_order_id, to_vendor_id)
     VALUES ($1, '2025-02-13', $2, $3, $4, $5)`,
    [transferNumber, source, fromVendor.id, dest, toVendor.id]
  )
  return { code, source, dest, transferNumber }
}

async function deleteOrder(id: string) {
  const { rows: [r] } = await client.query(`SELECT delete_job_work_order($1::uuid, NULL) AS res`, [id])
  return r.res as { success: boolean; error?: string }
}

async function exists(id: string) {
  const { rows } = await client.query(`SELECT 1 FROM job_work_orders WHERE id = $1`, [id])
  return rows.length === 1
}

describe('delete_job_work_order transfer message (migration 156)', () => {
  it('on an order created by a transfer: names the transfer and the source order, deletes nothing', async () => {
    const t = await makeTransferPair()
    const res = await deleteOrder(t.dest)
    expect(res.success).toBe(false)
    // Exact wording is migration 157's (it now points at Reverse) — see reverseJobWorkTransfer.test.ts.
    expect(res.error).toContain(`This order was created by transfer ${t.transferNumber}, which moved the material here from order JW-SRC-${t.code} (${t.code}-FROM)`)
    expect(res.error).not.toMatch(/foreign key|constraint/i)
    expect(await exists(t.dest)).toBe(true)
    const { rows } = await client.query(`SELECT 1 FROM job_work_cancellations WHERE original_order_id = $1`, [t.dest])
    expect(rows).toHaveLength(0) // no archive row left behind
  })

  it('on the source order of a transfer: says to delete the transfer first, deletes nothing', async () => {
    const t = await makeTransferPair()
    const res = await deleteOrder(t.source)
    expect(res.success).toBe(false)
    expect(res.error).toContain(`Material from this order has been transferred to another vendor (${t.transferNumber} to order JW-DST-${t.code} / ${t.code}-TO)`)
    expect(await exists(t.source)).toBe(true)
  })

  it('still deletes an order with no transfers', async () => {
    const t = await makeTransferPair()
    await client.query(`DELETE FROM job_work_transfers WHERE transfer_number = $1`, [t.transferNumber])
    expect(await deleteOrder(t.dest)).toEqual({ success: true })
    expect(await exists(t.dest)).toBe(false)
  })
})
