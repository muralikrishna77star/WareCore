// Migration 160: a stock-affecting date with a mistyped year (0025 for
// 2025, as on sale 0225-0851 / CR00180) is rejected with a message asking
// the user to check the year, instead of silently sorting the transaction
// 2,000 years early. Runs against the real migrations on a throwaway
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

let seq = 0
async function fixtures() {
  seq += 1
  const code = `BD${seq}${Date.now().toString(36).slice(-4)}`.toUpperCase().slice(0, 10)
  const { rows: [company] } = await client.query(`INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [code])
  const { rows: [warehouse] } = await client.query(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id])
  const { rows: [customer] } = await client.query(`INSERT INTO customers (name) VALUES ($1) RETURNING id`, [code])
  const { rows: [material] } = await client.query(`INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`, [code])
  return { code, companyId: company.id as string, warehouseId: warehouse.id as string, customerId: customer.id as string, materialId: material.id as string }
}

const insertSale = (f: Awaited<ReturnType<typeof fixtures>>, date: string) =>
  client.query(
    `INSERT INTO dispatch_orders (invoice_number, customer_id, company_id, warehouse_id, dispatch_date, status)
     VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
    [`INV-${f.code}-${date}`, f.customerId, f.companyId, f.warehouseId, date]
  )

describe('business date guard (migration 160)', () => {
  it('rejects a sale dated in year 0025 with a check-the-year message', async () => {
    const f = await fixtures()
    await expect(insertSale(f, '0025-02-11')).rejects.toThrow(
      /The sale date 11-Feb-0025 looks mistyped — please check the year\. Dates must be between 01-Jan-2015 and /
    )
  })

  it('rejects a far-future year, and the same mistake made by editing an existing sale', async () => {
    const f = await fixtures()
    await expect(insertSale(f, '2205-02-11')).rejects.toThrow(/looks mistyped/)
    const { rows: [sale] } = await insertSale(f, '2025-02-11')
    await expect(client.query(`UPDATE dispatch_orders SET dispatch_date = '0025-02-11' WHERE id = $1`, [sale.id]))
      .rejects.toThrow(/The sale date 11-Feb-0025 looks mistyped/)
  })

  it('accepts ordinary back-dated entries', async () => {
    const f = await fixtures()
    await expect(insertSale(f, '2024-04-01')).resolves.toBeTruthy()
  })

  it('guards ledger rows posted directly as well', async () => {
    const f = await fixtures()
    await expect(client.query(
      `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, entry_date, reference_type)
       VALUES ('ADJUSTMENT_IN', $1, $2, $3, 1, '0024-12-09', 'adjustment')`,
      [f.companyId, f.warehouseId, f.materialId]
    )).rejects.toThrow(/The transaction date 09-Dec-0024 looks mistyped/)
  })
})
