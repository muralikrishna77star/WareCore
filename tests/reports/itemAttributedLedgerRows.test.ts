// Migration 162: fn_item_attributed_ledger_rows() — when two items share a
// material + size (HR00028 "HR Channel 2.50 inches" / HR00116 "HRPO 2.50
// inches"), each item's Item Stock Ledger must show only its own rows, not
// the combination's whole stock. Runs the real triggers on a throwaway
// Postgres; no production data.
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

async function balanceOf(itemId: string) {
  const { rows: [r] } = await client.query(
    `SELECT COALESCE(SUM(sl.quantity), 0) AS bal, count(*) FILTER (WHERE a.shared)::int AS shared
     FROM fn_item_attributed_ledger_rows($1) a JOIN stock_ledger sl ON sl.id = a.ledger_id`,
    [itemId]
  )
  return { balance: Number(r.bal), shared: r.shared as number }
}

describe('fn_item_attributed_ledger_rows (migration 162)', () => {
  it('splits a shared material + size between its items by what each purchase line was bought as', async () => {
    const one = async (sql: string, p: unknown[] = []) => (await client.query(sql, p)).rows[0]
    const company = await one(`INSERT INTO companies (name, code) VALUES ('Attr Co', 'ATR') RETURNING id`)
    const wh = await one(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id])
    const supplier = await one(`INSERT INTO suppliers (name) VALUES ('Attr Supplier') RETURNING id`)
    const customer = await one(`INSERT INTO customers (name) VALUES ('Attr Customer') RETURNING id`)
    const mt = await one(`INSERT INTO material_types (code, description, unit) VALUES ('AT', 'Attr Steel', 'MT') RETURNING id`)
    const size = await one(`INSERT INTO material_sizes (material_type_id, size_label) VALUES ($1, '2.50 inches') RETURNING id`, [mt.id])
    const channel = await one(`INSERT INTO item_master (item_code, item_name, material_type_id, material_size_id, unit, is_active) VALUES ('AT00001', 'Channel 2.50 inches', $1, $2, 'MT', true) RETURNING id`, [mt.id, size.id])
    const hrpo = await one(`INSERT INTO item_master (item_code, item_name, material_type_id, material_size_id, unit, is_active) VALUES ('AT00002', 'HRPO 2.50 inches', $1, $2, 'MT', true) RETURNING id`, [mt.id, size.id])

    const bill = await one(
      `INSERT INTO purchase_bills (supplier_id, company_id, warehouse_id, bill_number, bill_date, status) VALUES ($1, $2, $3, '0225-9901', '2025-02-03', 'active') RETURNING id`,
      [supplier.id, company.id, wh.id])
    // Bought as HRPO: 0.553 + 1.750; bought as Channel: 0.400.
    for (const [line, qty, item] of [['AT0225-0001', 0.553, hrpo.id], ['AT0225-0002', 1.75, hrpo.id], ['AT0225-0003', 0.4, channel.id]] as const) {
      await client.query(
        `INSERT INTO purchase_bill_items (bill_id, material_type_id, material_size_id, size_label, item_master_id, quantity, unit, rate, amount, purchase_line_id)
         VALUES ($1, $2, $3, '2.50 inches', $4, $5, 'MT', 100, $6, $7)`,
        [bill.id, mt.id, size.id, item, qty, qty * 100, line])
    }
    // A sale of HRPO stock against its purchase line, and a sale with no line
    // that records the Channel item on the sale itself.
    const sale1 = await one(`INSERT INTO dispatch_orders (invoice_number, customer_id, company_id, warehouse_id, dispatch_date, status) VALUES ('0225-9911', $1, $2, $3, '2025-02-14', 'active') RETURNING id`, [customer.id, company.id, wh.id])
    await client.query(`INSERT INTO dispatch_items (dispatch_order_id, material_type_id, material_size_id, item_master_id, purchase_line_id, quantity, unit, rate, amount) VALUES ($1, $2, $3, $4, 'AT0225-0001', 0.344, 'MT', 120, 41.28)`, [sale1.id, mt.id, size.id, hrpo.id])
    const sale2 = await one(`INSERT INTO dispatch_orders (invoice_number, customer_id, company_id, warehouse_id, dispatch_date, status) VALUES ('0225-9912', $1, $2, $3, '2025-02-15', 'active') RETURNING id`, [customer.id, company.id, wh.id])
    await client.query(`INSERT INTO dispatch_items (dispatch_order_id, material_type_id, material_size_id, item_master_id, quantity, unit, rate, amount) VALUES ($1, $2, $3, $4, 0.1, 'MT', 120, 12)`, [sale2.id, mt.id, size.id, channel.id])
    // A ledger row that records no item anywhere.
    await client.query(`INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, material_size_id, quantity, entry_date, reference_type) VALUES ('ADJUSTMENT_IN', $1, $2, $3, $4, 0.05, '2025-02-20', 'adjustment')`, [company.id, wh.id, mt.id, size.id])

    const h = await balanceOf(hrpo.id)
    const c = await balanceOf(channel.id)
    expect(h.balance).toBeCloseTo(0.553 + 1.75 - 0.344 + 0.05, 3) // own rows + the shared adjustment
    expect(c.balance).toBeCloseTo(0.4 - 0.1 + 0.05, 3)
    expect(h.shared).toBe(1)
    expect(c.shared).toBe(1)

    // Before 162 each would have shown the combination's whole stock.
    const { rows: [all] } = await client.query(`SELECT SUM(quantity) AS q FROM stock_ledger WHERE material_type_id = $1 AND material_size_id = $2`, [mt.id, size.id])
    expect(h.balance + c.balance - 0.05).toBeCloseTo(Number(all.q), 3) // the shared row counted once overall
  })
})
