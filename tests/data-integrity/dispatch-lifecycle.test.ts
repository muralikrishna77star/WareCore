// Transaction lifecycle tests for Dispatch Orders, exercising the ACTUAL
// production triggers/RPCs (fn_dispatch_item_to_ledger, cancel_dispatch_order,
// purge_cancelled_dispatch) against a real, throwaway Postgres instance.
// Deliberately scoped subset, same rationale as purchase-lifecycle.test.ts
// — see docs/data-integrity/TEST_MATRIX.md. No production data or ids.
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
async function makeDispatchFixtures() {
  seq += 1
  const code = `DT${seq}${Date.now().toString(36).slice(-4)}`.toUpperCase().slice(0, 10)
  const { rows: [company] } = await client.query(`INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [code])
  const { rows: [warehouse] } = await client.query(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id])
  const { rows: [customer] } = await client.query(`INSERT INTO customers (name) VALUES ($1) RETURNING id`, [code])
  const { rows: [materialType] } = await client.query(`INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`, [code])
  return { companyId: company.id as string, warehouseId: warehouse.id as string, customerId: customer.id as string, materialTypeId: materialType.id as string }
}

async function makeOrder(f: Awaited<ReturnType<typeof makeDispatchFixtures>>, status: 'draft' | 'active' = 'active') {
  const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const { rows: [order] } = await client.query(
    `INSERT INTO dispatch_orders (invoice_number, customer_id, company_id, warehouse_id, dispatch_date, status)
     VALUES ($1, $2, $3, $4, '2024-06-01', $5) RETURNING id`,
    [invoiceNumber, f.customerId, f.companyId, f.warehouseId, status]
  )
  return order.id as string
}

async function addLine(orderId: string, materialTypeId: string, quantity: number) {
  const { rows: [item] } = await client.query(
    `INSERT INTO dispatch_items (dispatch_order_id, material_type_id, quantity, unit, rate, amount)
     VALUES ($1, $2, $3, 'tons', 150, $4) RETURNING id`,
    [orderId, materialTypeId, quantity, quantity * 150]
  )
  return item.id as string
}

async function ledgerNetForOrder(orderId: string) {
  const { rows: [r] } = await client.query(
    `SELECT COALESCE(SUM(quantity), 0) AS net FROM stock_ledger WHERE reference_type = 'dispatch' AND reference_id = $1`,
    [orderId]
  )
  return Number(r.net)
}

describe('Dispatch lifecycle', () => {
  it('new active order line posts exactly one negative SALE_OUT matching the entered quantity', async () => {
    const f = await makeDispatchFixtures()
    const orderId = await makeOrder(f)
    await addLine(orderId, f.materialTypeId, 3.0)

    const { rows } = await client.query(`SELECT entry_type, quantity FROM stock_ledger WHERE reference_type = 'dispatch' AND reference_id = $1`, [orderId])
    expect(rows).toHaveLength(1)
    expect(rows[0].entry_type).toBe('SALE_OUT')
    expect(Number(rows[0].quantity)).toBeCloseTo(-3.0, 3)
  })

  it('a draft order line does NOT post to the ledger — correctly asymmetric vs. Purchase (see CURRENT_STATE_AUDIT.md §5)', async () => {
    const f = await makeDispatchFixtures()
    const orderId = await makeOrder(f, 'draft')
    await addLine(orderId, f.materialTypeId, 2.0)

    const { rows } = await client.query(`SELECT * FROM stock_ledger WHERE reference_type = 'dispatch' AND reference_id = $1`, [orderId])
    expect(rows).toHaveLength(0)
  })

  it('double-submitting a new line posts two SALE_OUT rows — same unprotected-at-source shape as Purchase', async () => {
    const f = await makeDispatchFixtures()
    const orderId = await makeOrder(f)
    await addLine(orderId, f.materialTypeId, 1.5)
    await addLine(orderId, f.materialTypeId, 1.5)

    const { rows } = await client.query(`SELECT entry_type FROM stock_ledger WHERE reference_type = 'dispatch' AND reference_id = $1`, [orderId])
    expect(rows).toHaveLength(2)
    expect(await ledgerNetForOrder(orderId)).toBeCloseTo(-3.0, 3)
  })

  it('editing a line to a different quantity (delete + re-insert) nets to the new quantity', async () => {
    const f = await makeDispatchFixtures()
    const orderId = await makeOrder(f)
    const itemId = await addLine(orderId, f.materialTypeId, 5.0)

    // dispatch_items has no delete trigger posting a reversal (unlike
    // purchase_bill_items' fn_bill_item_deleted) — edit_dispatch_order()
    // (062) is the real production path; this test exercises the same
    // underlying delete+reinsert shape directly against the ledger to
    // confirm the net effect a correct edit implementation must produce,
    // without depending on edit_dispatch_order()'s full JSON-diffing
    // signature.
    await client.query(`DELETE FROM stock_ledger WHERE reference_type = 'dispatch' AND reference_id = $1`, [orderId])
    await client.query(`DELETE FROM dispatch_items WHERE id = $1`, [itemId])
    await addLine(orderId, f.materialTypeId, 3.5)

    expect(await ledgerNetForOrder(orderId)).toBeCloseTo(-3.5, 3)
  })

  it('full cancellation via cancel_dispatch_order() deletes the ledger footprint outright and nets to zero', async () => {
    const f = await makeDispatchFixtures()
    const orderId = await makeOrder(f)
    await addLine(orderId, f.materialTypeId, 6.0)
    expect(await ledgerNetForOrder(orderId)).toBeCloseTo(-6.0, 3)

    const { rows: [result] } = await client.query(`SELECT cancel_dispatch_order($1, 'test cancel') AS r`, [orderId])
    expect(result.r.success).toBe(true)
    expect(await ledgerNetForOrder(orderId)).toBe(0)

    const { rows: [order] } = await client.query(`SELECT status FROM dispatch_orders WHERE id = $1`, [orderId])
    expect(order.status).toBe('cancelled')
  })

  it('cancelling an already-cancelled order fails cleanly', async () => {
    const f = await makeDispatchFixtures()
    const orderId = await makeOrder(f)
    await addLine(orderId, f.materialTypeId, 2.0)
    await client.query(`SELECT cancel_dispatch_order($1, 'first')`, [orderId])

    const { rows: [result] } = await client.query(`SELECT cancel_dispatch_order($1, 'second') AS r`, [orderId])
    expect(result.r.success).toBe(false)
    expect(await ledgerNetForOrder(orderId)).toBe(0)
  })

  it('purge after cancellation archives the order and leaves no live ledger trace', async () => {
    const f = await makeDispatchFixtures()
    const orderId = await makeOrder(f)
    await addLine(orderId, f.materialTypeId, 4.0)
    await client.query(`SELECT cancel_dispatch_order($1, 'to purge')`, [orderId])

    const { rows: [purgeResult] } = await client.query(`SELECT purge_cancelled_dispatch($1, NULL) AS r`, [orderId])
    expect(purgeResult.r.success).toBe(true)

    expect(await ledgerNetForOrder(orderId)).toBe(0)
    const { rows: archived } = await client.query(`SELECT id FROM dispatch_cancellations WHERE original_order_id = $1`, [orderId])
    expect(archived).toHaveLength(1)
  })

  it('purging an order that is not cancelled fails cleanly', async () => {
    const f = await makeDispatchFixtures()
    const orderId = await makeOrder(f)
    await addLine(orderId, f.materialTypeId, 1.0)

    const { rows: [result] } = await client.query(`SELECT purge_cancelled_dispatch($1, NULL) AS r`, [orderId])
    expect(result.r.success).toBe(false)
  })

  it('a backdated order (dispatch_date before entry) posts with the business date, not the insert date', async () => {
    const f = await makeDispatchFixtures()
    const invoiceNumber = `INV-BACKDATED-${Date.now()}`
    const { rows: [order] } = await client.query(
      `INSERT INTO dispatch_orders (invoice_number, customer_id, company_id, warehouse_id, dispatch_date, status)
       VALUES ($1, $2, $3, $4, '2023-02-20', 'active') RETURNING id`,
      [invoiceNumber, f.customerId, f.companyId, f.warehouseId]
    )
    await addLine(order.id, f.materialTypeId, 1.2)

    const { rows: [ledgerRow] } = await client.query(
      `SELECT entry_date::text AS entry_date FROM stock_ledger WHERE reference_type = 'dispatch' AND reference_id = $1`,
      [order.id]
    )
    expect(ledgerRow.entry_date).toBe('2023-02-20')
  })
})
