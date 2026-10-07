// delete_stock_ledger_rows() (migration 153) — the guarded replacement for
// the Item Ledger's admin "Delete Selected" action, which used to run a bare
// DELETE and twice silently corrupted stock (migrations 148 and 152). Runs
// against the real migrations on a throwaway Postgres; no production data.
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
async function makeBillWithLine(quantity: number) {
  seq += 1
  const code = `LD${seq}${Date.now().toString(36).slice(-4)}`.toUpperCase().slice(0, 10)
  const { rows: [company] } = await client.query(`INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [code])
  const { rows: [warehouse] } = await client.query(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id])
  const { rows: [supplier] } = await client.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [code])
  const { rows: [mt] } = await client.query(`INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`, [code])
  const { rows: [bill] } = await client.query(
    `INSERT INTO purchase_bills (supplier_id, company_id, warehouse_id, bill_number, bill_date, status)
     VALUES ($1, $2, $3, $4, '2025-01-31', 'active') RETURNING id`,
    [supplier.id, company.id, warehouse.id, `BILL-${code}`]
  )
  const { rows: [item] } = await client.query(
    `INSERT INTO purchase_bill_items (bill_id, material_type_id, quantity, unit, rate, amount)
     VALUES ($1, $2, $3, 'MT', 100, $4) RETURNING id, purchase_line_id`,
    [bill.id, mt.id, quantity, quantity * 100]
  )
  return { billId: bill.id as string, itemId: item.id as string, lineId: item.purchase_line_id as string }
}

async function ledgerRows(lineId: string) {
  const { rows } = await client.query(
    `SELECT id, entry_type, quantity FROM stock_ledger WHERE purchase_line_id = $1 ORDER BY created_at, entry_type DESC`,
    [lineId]
  )
  return rows as { id: string; entry_type: string; quantity: string }[]
}

async function lineNet(lineId: string) {
  const { rows: [r] } = await client.query(`SELECT COALESCE(SUM(quantity), 0) AS net FROM stock_ledger WHERE purchase_line_id = $1`, [lineId])
  return Number(r.net)
}

async function guardedDelete(ids: string[]) {
  const { rows: [r] } = await client.query(`SELECT delete_stock_ledger_rows($1::uuid[], NULL) AS n`, [ids])
  return Number(r.n)
}

describe('delete_stock_ledger_rows guard', () => {
  it('refuses deleting only the PURCHASE_CANCEL of a removed bill line (the CR0125-0075..77 case) and changes nothing', async () => {
    const { itemId, lineId } = await makeBillWithLine(3.48)
    await client.query(`DELETE FROM purchase_bill_items WHERE id = $1`, [itemId]) // posts PURCHASE_CANCEL
    const cancel = (await ledgerRows(lineId)).find((r) => r.entry_type === 'PURCHASE_CANCEL')!

    await expect(guardedDelete([cancel.id])).rejects.toThrow(/Cannot delete: line .* would be left at 3\.480 .* bill says 0\.000/)
    expect(await lineNet(lineId)).toBeCloseTo(0, 3)
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM stock_ledger_deletions WHERE stock_ledger_id = $1`, [cancel.id])
    expect(rows[0].n).toBe(0) // audit insert rolled back with the refusal
  })

  it('allows deleting an IN + CANCEL pair that nets to zero, and records both rows in the audit table', async () => {
    const { itemId, lineId } = await makeBillWithLine(2.5)
    await client.query(`DELETE FROM purchase_bill_items WHERE id = $1`, [itemId])
    const ids = (await ledgerRows(lineId)).map((r) => r.id)

    expect(await guardedDelete(ids)).toBe(2)
    expect(await ledgerRows(lineId)).toHaveLength(0)
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM stock_ledger_deletions WHERE stock_ledger_id = ANY($1::uuid[])`, [ids])
    expect(rows[0].n).toBe(2)
  })

  it('allows deleting a duplicated PURCHASE_IN when what remains matches the bill', async () => {
    const { billId, lineId } = await makeBillWithLine(1.2)
    const { rows: [dup] } = await client.query(
      `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, reference_type, reference_id, reference_number, entry_date, purchase_line_id)
       SELECT entry_type, company_id, warehouse_id, material_type_id, quantity, reference_type, reference_id, reference_number, entry_date, purchase_line_id
       FROM stock_ledger WHERE purchase_line_id = $1 RETURNING id`,
      [lineId]
    )
    expect(await lineNet(lineId)).toBeCloseTo(2.4, 3)

    expect(await guardedDelete([dup.id])).toBe(1)
    expect(await lineNet(lineId)).toBeCloseTo(1.2, 3)
    expect(billId).toBeTruthy()
  })

  it('refuses deleting the only PURCHASE_IN of a live bill line', async () => {
    const { lineId } = await makeBillWithLine(4)
    const [purchaseIn] = await ledgerRows(lineId)
    await expect(guardedDelete([purchaseIn.id])).rejects.toThrow(/Cannot delete/)
    expect(await lineNet(lineId)).toBeCloseTo(4, 3)
  })

  it('allows deleting rows whose reference document no longer exists anywhere (orphans)', async () => {
    const { billId, lineId } = await makeBillWithLine(1)
    const [purchaseIn] = await ledgerRows(lineId)
    // Simulate an orphan: point the row at a bill id that exists nowhere.
    await client.query(`UPDATE stock_ledger SET reference_id = uuid_generate_v4() WHERE id = $1`, [purchaseIn.id])
    expect(await guardedDelete([purchaseIn.id])).toBe(1)
    expect(billId).toBeTruthy()
  })
})
