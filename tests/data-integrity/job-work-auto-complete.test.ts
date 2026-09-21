// Migration 149: a job work order closes itself ("completed") as soon as
// nothing is left at the vendor, and records how it closed in
// completion_via — driven by stock_ledger triggers, so direct sales,
// returns and transfers all count, not just Edit Order saves. Runs against
// a real, throwaway Postgres instance (scripts/test/testDb.mjs).
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
async function makeOrder(opts: { quantitySent?: number; status?: string } = {}) {
  seq += 1
  const code = `AC${seq}${Date.now().toString(36).slice(-4)}`.toUpperCase().slice(0, 10)
  const { rows: [company] } = await client.query(`INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [code])
  const { rows: [warehouse] } = await client.query(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id])
  const { rows: [material] } = await client.query(`INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`, [code])
  const { rows: [vendor] } = await client.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`${code}-VENDOR`])
  const { rows: [order] } = await client.query(
    `INSERT INTO job_work_orders (reference_number, vendor_id, company_id, warehouse_id, dispatch_date, status)
     VALUES ($1, $2, $3, $4, '2024-07-24', $5) RETURNING id`,
    [`JW-AC-${code}`, vendor.id, company.id, warehouse.id, opts.status ?? 'dispatched']
  )
  // fn_job_work_item_to_ledger() posts this line's JOB_WORK_OUT.
  await client.query(
    `INSERT INTO job_work_items (purchase_line_id, job_work_order_id, material_type_id, quantity_sent, quantity_received, unit)
     VALUES ('TEST-PL-001', $1, $2, $3, 0, 'MT')`,
    [order.id, material.id, opts.quantitySent ?? 2]
  )
  return { orderId: order.id as string, companyId: company.id as string, warehouseId: warehouse.id as string, materialTypeId: material.id as string }
}

type Scope = Awaited<ReturnType<typeof makeOrder>>

async function post(scope: Scope, entryType: string, quantity: number, entryDate: string, notes: string | null = null) {
  const { rows: [row] } = await client.query(
    `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, entry_date, reference_type, reference_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, 'job_work', $7, $8) RETURNING id`,
    [entryType, scope.companyId, scope.warehouseId, scope.materialTypeId, quantity, entryDate, scope.orderId, notes]
  )
  return row.id as string
}

async function orderState(orderId: string) {
  const { rows: [o] } = await client.query(
    `SELECT status, completion_via, to_char(actual_return_date, 'YYYY-MM-DD') AS actual_return_date FROM job_work_orders WHERE id = $1`,
    [orderId]
  )
  return o as { status: string; completion_via: string | null; actual_return_date: string | null }
}

const VIRTUAL = 'Vendor direct sale — virtual return'

describe('job work order auto-completion (migration 149)', () => {
  it('completes as "sold_direct" once direct sales use up everything at the vendor', async () => {
    const scope = await makeOrder({ quantitySent: 2.186 })
    expect(await orderState(scope.orderId)).toMatchObject({ status: 'dispatched', completion_via: null })

    await post(scope, 'JOB_WORK_RETURN_IN', 1.2, '2024-07-25', VIRTUAL)
    expect((await orderState(scope.orderId)).status).toBe('dispatched') // line rule: nothing received on the line yet

    await post(scope, 'JOB_WORK_RETURN_IN', 0.986, '2024-08-12', VIRTUAL)
    expect(await orderState(scope.orderId)).toEqual({ status: 'completed', completion_via: 'sold_direct', actual_return_date: '2024-08-12' })
  })

  it('reopens when the last direct sale is cancelled', async () => {
    const scope = await makeOrder({ quantitySent: 1 })
    const saleLeg = await post(scope, 'JOB_WORK_RETURN_IN', 1, '2024-08-01', VIRTUAL)
    expect((await orderState(scope.orderId)).status).toBe('completed')

    await client.query(`DELETE FROM stock_ledger WHERE id = $1`, [saleLeg])
    expect(await orderState(scope.orderId)).toEqual({ status: 'dispatched', completion_via: null, actual_return_date: null })
  })

  it('records every way the material left the vendor', async () => {
    const scope = await makeOrder({ quantitySent: 3 })
    await post(scope, 'JOB_WORK_RETURN_IN', 1, '2024-08-01')
    expect((await orderState(scope.orderId)).status).not.toBe('completed')
    await post(scope, 'JOB_WORK_RETURN_IN', 1, '2024-08-02', VIRTUAL)
    await post(scope, 'JOB_WORK_TRANSFER_OUT', -1, '2024-08-03', 'Vendor transfer — sent to new vendor')
    expect(await orderState(scope.orderId)).toEqual({
      status: 'completed', completion_via: 'sold_direct,returned,transferred', actual_return_date: '2024-08-03',
    })
  })

  it('does not complete while any quantity is still at the vendor', async () => {
    const scope = await makeOrder({ quantitySent: 2 })
    await post(scope, 'JOB_WORK_RETURN_IN', 1.99, '2024-08-01', VIRTUAL)
    expect((await orderState(scope.orderId)).status).not.toBe('completed')
  })

  it("overrides Edit Order's line-only status with the shared rule", async () => {
    const scope = await makeOrder({ quantitySent: 1 })
    await post(scope, 'JOB_WORK_RETURN_IN', 1, '2024-08-01', VIRTUAL)
    // edit_job_work_order() ends with a plain status UPDATE from the line rule.
    await client.query(`UPDATE job_work_orders SET status = 'partial_return', actual_return_date = NULL WHERE id = $1`, [scope.orderId])
    expect(await orderState(scope.orderId)).toEqual({ status: 'completed', completion_via: 'sold_direct', actual_return_date: '2024-08-01' })
  })

  it('leaves cancelled orders alone', async () => {
    const scope = await makeOrder({ quantitySent: 1, status: 'cancelled' })
    await post(scope, 'JOB_WORK_RETURN_IN', 1, '2024-08-01', VIRTUAL)
    expect((await orderState(scope.orderId)).status).toBe('cancelled')
  })
})
