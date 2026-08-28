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

  // REGRESSION (migration 126): edit_dispatch_order()'s vendor-direct-sale
  // cleanup DELETE keyed on the row value (purchase_line_id,
  // sub_purchase_line_id) — but sub_purchase_line_id is NULL on
  // effectively every dispatch item, and Postgres treats (x, NULL) =
  // (y, NULL) as UNKNOWN (never TRUE), so the DELETE silently matched
  // nothing. Every edit of a vendor-direct-sale order therefore left its
  // previous "Vendor direct sale — virtual return" stock_ledger row
  // behind — a duplicate if the line was unchanged, an orphan overstating
  // a DIFFERENT item's vendor balance if the line's material/size changed
  // or was removed. Found via GI00148 showing an impossible -2.730
  // "Balance at Vendor".
  describe('vendor-direct-sale edit (migration 126)', () => {
    async function makeVendorDirectFixtures() {
      seq += 1
      const code = `VD${seq}${Date.now().toString(36).slice(-4)}`.toUpperCase().slice(0, 10)
      const { rows: [company] } = await client.query(`INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [code])
      const { rows: [warehouse] } = await client.query(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id])
      const { rows: [customer] } = await client.query(`INSERT INTO customers (name) VALUES ($1) RETURNING id`, [code])
      const { rows: [vendor] } = await client.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`${code}-VENDOR`])
      const { rows: [materialTypeA] } = await client.query(`INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`, [`${code}A`])
      const { rows: [materialTypeB] } = await client.query(`INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`, [`${code}B`])
      const { rows: [order] } = await client.query(
        `INSERT INTO job_work_orders (reference_number, vendor_id, company_id, warehouse_id, dispatch_date, status)
         VALUES ($1, $2, $3, $4, '2024-06-01', 'dispatched') RETURNING id`,
        [`JW-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, vendor.id, company.id, warehouse.id]
      )
      return {
        companyId: company.id as string, warehouseId: warehouse.id as string, customerId: customer.id as string,
        jobWorkOrderId: order.id as string, materialTypeAId: materialTypeA.id as string, materialTypeBId: materialTypeB.id as string,
      }
    }

    async function makeVendorDirectDispatch(
      f: Awaited<ReturnType<typeof makeVendorDirectFixtures>>,
      purchaseLineId: string, materialTypeId: string, quantity: number
    ) {
      const invoiceNumber = `INV-VD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const { rows: [order] } = await client.query(
        `INSERT INTO dispatch_orders (invoice_number, customer_id, company_id, warehouse_id, dispatch_date, status, is_vendor_direct, source_job_work_order_id)
         VALUES ($1, $2, $3, $4, '2024-06-05', 'active', true, $5) RETURNING id`,
        [invoiceNumber, f.customerId, f.companyId, f.warehouseId, f.jobWorkOrderId]
      )
      await client.query(
        `INSERT INTO dispatch_items (dispatch_order_id, material_type_id, purchase_line_id, quantity, unit, rate, amount)
         VALUES ($1, $2, $3, $4, 'tons', 150, $5)`,
        [order.id, materialTypeId, purchaseLineId, quantity, quantity * 150]
      )
      return order.id as string
    }

    async function editDispatch(orderId: string, items: { materialTypeId: string; purchaseLineId: string; quantity: number }[]) {
      const { rows: [order] } = await client.query(`SELECT * FROM dispatch_orders WHERE id = $1`, [orderId])
      const itemsJson = JSON.stringify(items.map((i) => ({
        material_type_id: i.materialTypeId, purchase_line_id: i.purchaseLineId,
        quantity: i.quantity, unit: 'tons', rate: 150, amount: i.quantity * 150,
      })))
      const { rows: [result] } = await client.query(
        `SELECT edit_dispatch_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) AS r`,
        [orderId, order.invoice_number, order.dispatch_date, order.vehicle_number, order.driver_name, order.notes,
         order.company_id, order.warehouse_id, order.customer_id, order.sale_ref_id, order.status,
         items.reduce((s, i) => s + i.quantity, 0), items.reduce((s, i) => s + i.quantity * 150, 0), itemsJson]
      )
      return result.r
    }

    async function virtualReturns(jobWorkOrderId: string) {
      const { rows } = await client.query(
        `SELECT purchase_line_id, quantity, material_type_id FROM stock_ledger
         WHERE reference_type = 'job_work' AND reference_id = $1 AND notes = 'Vendor direct sale — virtual return'
         ORDER BY purchase_line_id`,
        [jobWorkOrderId]
      )
      return rows
    }

    it('re-saving an unchanged line does not duplicate the virtual-return row', async () => {
      const f = await makeVendorDirectFixtures()
      const orderId = await makeVendorDirectDispatch(f, 'PL-0001', f.materialTypeAId, 3.024)
      expect(await virtualReturns(f.jobWorkOrderId)).toHaveLength(1)

      const result = await editDispatch(orderId, [{ materialTypeId: f.materialTypeAId, purchaseLineId: 'PL-0001', quantity: 3.024 }])
      expect(result.success).toBe(true)

      const returns = await virtualReturns(f.jobWorkOrderId)
      expect(returns).toHaveLength(1)
      expect(Number(returns[0].quantity)).toBeCloseTo(3.024, 3)
    })

    it('editing a line to a different material leaves no orphaned virtual-return row for the old material', async () => {
      const f = await makeVendorDirectFixtures()
      const orderId = await makeVendorDirectDispatch(f, 'PL-0002', f.materialTypeAId, 2.730)
      expect(await virtualReturns(f.jobWorkOrderId)).toHaveLength(1)

      // Corrected to a different material under the same purchase line
      // reference (the real-world case: the wrong item was picked at
      // entry time, then fixed via Edit Order).
      const result = await editDispatch(orderId, [{ materialTypeId: f.materialTypeBId, purchaseLineId: 'PL-0002', quantity: 2.730 }])
      expect(result.success).toBe(true)

      const returns = await virtualReturns(f.jobWorkOrderId)
      expect(returns).toHaveLength(1)
      expect(returns[0].material_type_id).toBe(f.materialTypeBId)
    })

    it('removing a vendor-direct line entirely leaves no orphaned virtual-return row', async () => {
      const f = await makeVendorDirectFixtures()
      const orderId = await makeVendorDirectDispatch(f, 'PL-0003', f.materialTypeAId, 2.210)
      expect(await virtualReturns(f.jobWorkOrderId)).toHaveLength(1)

      const result = await editDispatch(orderId, [])
      expect(result.success).toBe(true)
      expect(await virtualReturns(f.jobWorkOrderId)).toHaveLength(0)
    })
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
