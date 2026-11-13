// Sales returns (migration 173) against a real, throwaway Postgres — the
// actual production functions/triggers: create_sale_return(),
// cancel_sale_return(), the return guards on dispatch_items/dispatch_orders,
// and the REC-002 return check. The point of most of these is that stock is
// never posted twice and a sale can never be returned more than it sold.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
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
async function makeSale(lines: number[] = [5, 3]) {
  seq += 1
  const code = `SR${seq}${Date.now().toString(36).slice(-4)}`.toUpperCase().slice(0, 10)
  const { rows: [company] } = await client.query(`INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [code])
  const { rows: [warehouse] } = await client.query(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id])
  const { rows: [customer] } = await client.query(`INSERT INTO customers (name) VALUES ($1) RETURNING id`, [code])
  const { rows: [mt] } = await client.query(`INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`, [code])
  const { rows: [order] } = await client.query(
    `INSERT INTO dispatch_orders (invoice_number, customer_id, company_id, warehouse_id, dispatch_date, status)
     VALUES ($1, $2, $3, $4, '2026-06-01', 'active') RETURNING id`,
    [`INV-${code}`, customer.id, company.id, warehouse.id]
  )
  const itemIds: string[] = []
  for (const [i, qty] of lines.entries()) {
    const { rows: [item] } = await client.query(
      `INSERT INTO dispatch_items (dispatch_order_id, material_type_id, quantity, unit, rate, amount, taxable_value, total_with_tax, purchase_line_id, sale_line_id)
       VALUES ($1, $2, $3, 'MT', 100, $4, $4, $5, $6, $7) RETURNING id`,
      [order.id, mt.id, qty, qty * 100, qty * 118, `PL-${code}-${i}`, `SL-${code}-${i}`]
    )
    itemIds.push(item.id)
  }
  return { orderId: order.id as string, itemIds, warehouseId: warehouse.id as string, materialTypeId: mt.id as string }
}

type Line = { dispatch_item_id: string; quantity: number }
async function createReturn(orderId: string, items: Line[], opts: { id?: string; date?: string } = {}) {
  const id = opts.id ?? randomUUID()
  const { rows: [r] } = await client.query(
    `SELECT create_sale_return($1, $2, $3::date, 'Damaged', NULL, $4::jsonb, NULL) AS res`,
    [id, orderId, opts.date ?? '2026-06-10', JSON.stringify(items)]
  )
  return { id, res: r.res as { success: boolean; error?: string; return_number?: string; already_saved?: boolean } }
}

async function warehouseStock(warehouseId: string) {
  const { rows: [r] } = await client.query(`SELECT COALESCE(SUM(quantity), 0)::numeric AS q FROM stock_ledger WHERE warehouse_id = $1`, [warehouseId])
  return Number(r.q)
}

async function returnLedgerRows(returnId: string) {
  const { rows } = await client.query(
    `SELECT entry_type, quantity::numeric AS quantity, purchase_line_id, sale_return_item_id FROM stock_ledger
     WHERE reference_type = 'sale_return' AND reference_id = $1 ORDER BY quantity`, [returnId])
  return rows
}

async function rec002ForReturn(returnId: string) {
  const { rows } = await client.query(
    `SELECT * FROM fn_reconcile_rec_002(NULL, '2015-01-01', '2099-12-31') WHERE source_document_type = 'sale_return' AND source_document_id = $1`, [returnId])
  return rows
}

describe('Sales returns', () => {
  it('a partial return posts exactly one SALE_RETURN_IN per line, tagged with the sale line\'s purchase line', async () => {
    const s = await makeSale([5, 3])
    expect(await warehouseStock(s.warehouseId)).toBeCloseTo(-8, 3)

    const { id, res } = await createReturn(s.orderId, [{ dispatch_item_id: s.itemIds[0], quantity: 2 }])
    expect(res.success).toBe(true)
    expect(res.return_number).toMatch(/^SR-0626-\d{4}$/)

    const rows = await returnLedgerRows(id)
    expect(rows).toHaveLength(1)
    expect(rows[0].entry_type).toBe('SALE_RETURN_IN')
    expect(Number(rows[0].quantity)).toBeCloseTo(2, 3)
    expect(rows[0].purchase_line_id).toMatch(/-0$/)
    expect(await warehouseStock(s.warehouseId)).toBeCloseTo(-6, 3)

    const { rows: [line] } = await client.query(`SELECT amount::numeric, total_with_tax::numeric, sale_line_id FROM sale_return_items WHERE sale_return_id = $1`, [id])
    expect(Number(line.amount)).toBeCloseTo(200, 2)
    expect(Number(line.total_with_tax)).toBeCloseTo(236, 2)
    expect(line.sale_line_id).toMatch(/^SL-/)
    expect(await rec002ForReturn(id)).toHaveLength(0)
  })

  it('a full return brings the whole sale back to zero', async () => {
    const s = await makeSale([5, 3])
    const { res } = await createReturn(s.orderId, [
      { dispatch_item_id: s.itemIds[0], quantity: 5 },
      { dispatch_item_id: s.itemIds[1], quantity: 3 },
    ])
    expect(res.success).toBe(true)
    expect(await warehouseStock(s.warehouseId)).toBeCloseTo(0, 3)
  })

  it('re-sending the same return (double click / retry) does not post stock twice', async () => {
    const s = await makeSale([5])
    const id = randomUUID()
    const first = await createReturn(s.orderId, [{ dispatch_item_id: s.itemIds[0], quantity: 2 }], { id })
    const second = await createReturn(s.orderId, [{ dispatch_item_id: s.itemIds[0], quantity: 2 }], { id })
    expect(first.res.success).toBe(true)
    expect(second.res.success).toBe(true)
    expect(second.res.already_saved).toBe(true)
    expect(second.res.return_number).toBe(first.res.return_number)
    expect(await returnLedgerRows(id)).toHaveLength(1)
    expect(await warehouseStock(s.warehouseId)).toBeCloseTo(-3, 3)
  })

  it('cannot return more than was sold, across several returns', async () => {
    const s = await makeSale([5])
    expect((await createReturn(s.orderId, [{ dispatch_item_id: s.itemIds[0], quantity: 3 }])).res.success).toBe(true)
    await expect(createReturn(s.orderId, [{ dispatch_item_id: s.itemIds[0], quantity: 2.5 }])).rejects.toThrow(/at most 2/)
    expect((await createReturn(s.orderId, [{ dispatch_item_id: s.itemIds[0], quantity: 2 }])).res.success).toBe(true)
    await expect(createReturn(s.orderId, [{ dispatch_item_id: s.itemIds[0], quantity: 0.001 }])).rejects.toThrow(/at most 0/)
    expect(await warehouseStock(s.warehouseId)).toBeCloseTo(0, 3)
  })

  it('a failed return leaves nothing behind (no header, no lines, no stock)', async () => {
    const s = await makeSale([5, 3])
    const { id } = await createReturn(s.orderId, [{ dispatch_item_id: s.itemIds[1], quantity: 1 }]).catch(() => ({ id: '' }))
    expect(id).not.toBe('')
    const bad = randomUUID()
    await expect(createReturn(s.orderId, [
      { dispatch_item_id: s.itemIds[0], quantity: 1 },
      { dispatch_item_id: s.itemIds[1], quantity: 9 },
    ], { id: bad })).rejects.toThrow(/Cannot return/)
    const { rows } = await client.query(`SELECT 1 FROM sale_returns WHERE id = $1`, [bad])
    expect(rows).toHaveLength(0)
    expect(await returnLedgerRows(bad)).toHaveLength(0)
    expect(await warehouseStock(s.warehouseId)).toBeCloseTo(-7, 3)
  })

  it('rejects a line from another sale, a duplicated line, a zero quantity and a date before the sale', async () => {
    const a = await makeSale([5])
    const b = await makeSale([5])
    await expect(createReturn(a.orderId, [{ dispatch_item_id: b.itemIds[0], quantity: 1 }])).rejects.toThrow(/not part of sale/)
    expect((await createReturn(a.orderId, [
      { dispatch_item_id: a.itemIds[0], quantity: 1 },
      { dispatch_item_id: a.itemIds[0], quantity: 1 },
    ])).res.error).toMatch(/appears twice/)
    await expect(createReturn(a.orderId, [{ dispatch_item_id: a.itemIds[0], quantity: 0 }])).rejects.toThrow(/greater than zero/)
    expect((await createReturn(a.orderId, [{ dispatch_item_id: a.itemIds[0], quantity: 1 }], { date: '2026-05-31' })).res.error).toMatch(/before the sale date/)
  })

  it('a second ledger row for the same return line is refused by the database', async () => {
    const s = await makeSale([5])
    const { id } = await createReturn(s.orderId, [{ dispatch_item_id: s.itemIds[0], quantity: 1 }])
    await expect(client.query(
      `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, reference_type, reference_id, entry_date, sale_return_item_id)
       SELECT entry_type, company_id, warehouse_id, material_type_id, quantity, reference_type, reference_id, entry_date, sale_return_item_id
       FROM stock_ledger WHERE reference_type = 'sale_return' AND reference_id = $1`, [id]
    )).rejects.toThrow(/uq_stock_ledger_sale_return_item/)
  })

  it('cancelling a return removes its stock (archived) and frees the quantity to be returned again', async () => {
    const s = await makeSale([5])
    const { id } = await createReturn(s.orderId, [{ dispatch_item_id: s.itemIds[0], quantity: 5 }])
    expect(await warehouseStock(s.warehouseId)).toBeCloseTo(0, 3)

    const { rows: [c] } = await client.query(`SELECT cancel_sale_return($1, 'wrong qty', NULL) AS res`, [id])
    expect(c.res.success).toBe(true)
    expect(await returnLedgerRows(id)).toHaveLength(0)
    expect(await warehouseStock(s.warehouseId)).toBeCloseTo(-5, 3)
    const { rows: archived } = await client.query(`SELECT 1 FROM stock_ledger_deletions WHERE ledger_row->>'reference_id' = $1`, [id])
    expect(archived).toHaveLength(1)

    const { rows: [again] } = await client.query(`SELECT cancel_sale_return($1, NULL, NULL) AS res`, [id])
    expect(again.res.success).toBe(false)
    expect(await warehouseStock(s.warehouseId)).toBeCloseTo(-5, 3)

    expect((await createReturn(s.orderId, [{ dispatch_item_id: s.itemIds[0], quantity: 4 }])).res.success).toBe(true)
    expect(await warehouseStock(s.warehouseId)).toBeCloseTo(-1, 3)
    expect(await rec002ForReturn(id)).toHaveLength(0)
  })

  it('a cancelled return cannot be re-activated, and an active return\'s lines cannot be changed or deleted', async () => {
    const s = await makeSale([5])
    const { id } = await createReturn(s.orderId, [{ dispatch_item_id: s.itemIds[0], quantity: 2 }])
    await expect(client.query(`UPDATE sale_return_items SET quantity = 4 WHERE sale_return_id = $1`, [id])).rejects.toThrow(/cannot be changed/)
    await expect(client.query(`DELETE FROM sale_return_items WHERE sale_return_id = $1`, [id])).rejects.toThrow(/cannot be removed/)
    await expect(client.query(`DELETE FROM sale_returns WHERE id = $1`, [id])).rejects.toThrow(/cannot be deleted/)
    await expect(client.query(`UPDATE sale_returns SET return_date = '2026-06-20' WHERE id = $1`, [id])).rejects.toThrow(/cannot be changed/)
    await expect(client.query(`UPDATE sale_returns SET status = 'cancelled' WHERE id = $1`, [id])).rejects.toThrow(/cancel_sale_return/)

    await client.query(`SELECT cancel_sale_return($1, NULL, NULL)`, [id])
    await expect(client.query(`UPDATE sale_returns SET status = 'active' WHERE id = $1`, [id])).rejects.toThrow(/re-activated/)
  })

  it('a sale with an active return cannot be edited, cancelled or have its lines removed', async () => {
    const s = await makeSale([5, 3])
    const { id } = await createReturn(s.orderId, [{ dispatch_item_id: s.itemIds[0], quantity: 2 }])

    await expect(client.query(
      `SELECT edit_dispatch_order($1, 'X', '2026-06-01', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'active', 8, 800, '[]'::jsonb)`, [s.orderId]
    )).rejects.toThrow(/customer return/)
    await expect(client.query(`SELECT cancel_dispatch_order($1, NULL)`, [s.orderId])).rejects.toThrow(/customer return/)
    await expect(client.query(`DELETE FROM dispatch_items WHERE id = $1`, [s.itemIds[0]])).rejects.toThrow(/customer return/)
    await expect(client.query(`UPDATE dispatch_items SET quantity = 1 WHERE id = $1`, [s.itemIds[0]])).rejects.toThrow(/customer return/)
    // Nothing moved: sale still -8, return still +2.
    expect(await warehouseStock(s.warehouseId)).toBeCloseTo(-6, 3)

    // Once the return is cancelled the sale can be cancelled as before.
    await client.query(`SELECT cancel_sale_return($1, NULL, NULL)`, [id])
    const { rows: [c] } = await client.query(`SELECT cancel_dispatch_order($1, NULL) AS res`, [s.orderId])
    expect(c.res.success).toBe(true)
    expect(await warehouseStock(s.warehouseId)).toBeCloseTo(0, 3)
  })

  it('no returns against a cancelled sale', async () => {
    const s = await makeSale([5])
    await client.query(`SELECT cancel_dispatch_order($1, NULL)`, [s.orderId])
    expect((await createReturn(s.orderId, [{ dispatch_item_id: s.itemIds[0], quantity: 1 }])).res.error).toMatch(/active sale/)
  })

  it('REC-002 flags a return line whose ledger row was removed behind its back', async () => {
    const s = await makeSale([5])
    const { id } = await createReturn(s.orderId, [{ dispatch_item_id: s.itemIds[0], quantity: 2 }])
    await client.query(`DELETE FROM stock_ledger WHERE reference_type = 'sale_return' AND reference_id = $1`, [id])
    const flagged = await rec002ForReturn(id)
    expect(flagged).toHaveLength(1)
    expect(Number(flagged[0].difference)).toBeCloseTo(2, 3)
  })

  it('restoring a backup of return lines does not post stock (no posting trigger)', async () => {
    const s = await makeSale([5, 3])
    const { id } = await createReturn(s.orderId, [{ dispatch_item_id: s.itemIds[0], quantity: 2 }])
    const before = await warehouseStock(s.warehouseId)
    // Simulate a restore re-inserting a line row as-is (restore inserts
    // tables in order, with triggers live).
    await client.query(
      `INSERT INTO sale_return_items (sale_return_id, dispatch_item_id, material_type_id, quantity, unit)
       VALUES ($1, $2, $3, 1, 'MT')`, [id, s.itemIds[1], s.materialTypeId])
    expect(await warehouseStock(s.warehouseId)).toBeCloseTo(before, 3)
    expect(await returnLedgerRows(id)).toHaveLength(1)
  })
})
