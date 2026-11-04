// Migration 171: Edit Order can't change the quantity on a received transfer
// line. Lowering it moved only the destination side, leaving the source order
// and the transfer at the old quantity (JWT-1126-0007).
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
// Vendor A holds 10 of a purchase line, then transfers 6 to vendor B.
async function makeTransfer() {
  seq += 1
  const code = `TL${seq}${Date.now().toString(36).slice(-4)}`.toUpperCase().slice(0, 10)
  const { rows: [company] } = await client.query(`INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [code])
  const { rows: [warehouse] } = await client.query(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id])
  const { rows: [material] } = await client.query(`INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`, [code])
  const { rows: [vendorA] } = await client.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`${code}-A`])
  const { rows: [vendorB] } = await client.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`${code}-B`])
  const { rows: [item] } = await client.query(
    `INSERT INTO item_master (item_code, item_name, material_type_id, unit, is_active) VALUES ($1, $1, $2, 'MT', true) RETURNING id`,
    [code, material.id]
  )
  const { rows: [bill] } = await client.query(
    `INSERT INTO purchase_bills (supplier_id, company_id, warehouse_id, bill_number, bill_date, status)
     VALUES ($1, $2, $3, $4, '2025-01-31', 'active') RETURNING id`,
    [vendorA.id, company.id, warehouse.id, `BILL-${code}`]
  )
  const { rows: [billLine] } = await client.query(
    `INSERT INTO purchase_bill_items (bill_id, material_type_id, quantity, unit, rate, amount)
     VALUES ($1, $2, 20, 'MT', 100, 2000) RETURNING purchase_line_id`,
    [bill.id, material.id]
  )
  const { rows: [source] } = await client.query(
    `INSERT INTO job_work_orders (reference_number, vendor_id, company_id, warehouse_id, dispatch_date)
     VALUES ($1, $2, $3, $4, '2025-02-05') RETURNING id`,
    [`JW-TL-${code}`, vendorA.id, company.id, warehouse.id]
  )
  const { rows: [sourceLine] } = await client.query(
    `INSERT INTO job_work_items (purchase_line_id, job_line_id, job_work_order_id, item_master_id, material_type_id, quantity_sent, quantity_received, unit)
     VALUES ($1, 'JL-S', $2, $3, $4, 10, 0, 'MT') RETURNING id`,
    [billLine.purchase_line_id, source.id, item.id, material.id]
  )
  const { rows: [{ r }] } = await client.query(
    `SELECT create_job_work_transfer($1, $2, '2025-02-10', $3, $4, NULL, NULL, $5::jsonb, NULL) AS r`,
    [source.id, vendorB.id, `JW-TLD-${code}`, `JWT-${code}`,
      JSON.stringify([{ source_item_id: sourceLine.id, job_line_id: 'JL-D', quantity: 6 }])]
  )
  expect(r.success).toBe(true)
  const orderId = r.to_job_work_order_id as string
  const { rows: [line] } = await client.query(`SELECT id FROM job_work_items WHERE job_work_order_id = $1`, [orderId])
  const { rows: [ti] } = await client.query(`SELECT id FROM job_work_transfer_items WHERE to_job_work_item_id = $1`, [line.id])
  return {
    orderId, lineId: line.id as string, transferItemId: ti.id as string, pl: billLine.purchase_line_id as string,
    companyId: company.id as string, warehouseId: warehouse.id as string, vendorId: vendorB.id as string,
    itemId: item.id as string, materialTypeId: material.id as string,
  }
}

type Scope = Awaited<ReturnType<typeof makeTransfer>>

// The same call /api/jobwork/[id]/save-edit makes.
function saveEdit(s: Scope, line: { sent: number; notes?: string; pl?: string; itemId?: string }) {
  const input = [{
    id: s.lineId, purchase_line_id: line.pl ?? s.pl, job_line_id: 'JL-D', item_master_id: line.itemId ?? s.itemId, material_type_id: s.materialTypeId,
    quantity_sent: line.sent, quantity_received: 0, unit: 'MT', notes: line.notes ?? null,
  }]
  return client.query(
    `SELECT edit_job_work_order($1, $2, $3, $4, '2025-02-10', NULL, NULL, NULL, $5::jsonb, '[]'::jsonb, '{}'::uuid[], '{}'::uuid[]) AS r`,
    [s.orderId, s.companyId, s.warehouseId, s.vendorId, JSON.stringify(input)]
  )
}

async function savedQty(s: Scope) {
  const { rows: [r] } = await client.query(`SELECT quantity_sent::float AS q FROM job_work_items WHERE id = $1`, [s.lineId])
  return r.q as number
}

async function netLedger(s: Scope) {
  const { rows: [r] } = await client.query(`SELECT SUM(quantity)::float AS q FROM stock_ledger WHERE purchase_line_id = $1`, [s.pl])
  return r.q as number
}

describe('received transfer line quantity lock (migration 171)', () => {
  it('refuses lowering or raising the quantity, and changes nothing', async () => {
    const s = await makeTransfer()
    const before = await netLedger(s)
    await expect(saveEdit(s, { sent: 4 })).rejects.toThrow(/JL-D was received by transfer.*Reverse Transfer/)
    await expect(saveEdit(s, { sent: 7 })).rejects.toThrow(/JL-D was received by transfer.*Reverse Transfer/)
    expect(await savedQty(s)).toBe(6)
    expect(await netLedger(s)).toBe(before)
  })

  it('refuses re-pointing the line to another purchase line or item (migration 172)', async () => {
    const s = await makeTransfer()
    const before = await netLedger(s)
    const { rows: [other] } = await client.query(
      `INSERT INTO item_master (item_code, item_name, material_type_id, unit, is_active)
       VALUES ($1, $1, $2, 'MT', true) RETURNING id`,
      [`O${Date.now().toString(36).slice(-6)}`.toUpperCase(), s.materialTypeId]
    )
    await expect(saveEdit(s, { sent: 6, pl: 'OTHER-PL' })).rejects.toThrow(/JL-D was received by transfer.*item or purchase line/)
    await expect(saveEdit(s, { sent: 6, itemId: other.id })).rejects.toThrow(/JL-D was received by transfer.*item or purchase line/)
    const { rows: [line] } = await client.query(`SELECT purchase_line_id, item_master_id FROM job_work_items WHERE id = $1`, [s.lineId])
    expect(line.purchase_line_id).toBe(s.pl)
    expect(line.item_master_id).toBe(s.itemId)
    expect(await netLedger(s)).toBe(before)
  })

  it('still saves other changes when the quantity is unchanged', async () => {
    const s = await makeTransfer()
    const { rows: [{ r }] } = await saveEdit(s, { sent: 6, notes: 'checked' })
    expect(r.success).toBe(true)
    const { rows: [line] } = await client.query(`SELECT notes FROM job_work_items WHERE id = $1`, [s.lineId])
    expect(line.notes).toBe('checked')
    expect(await savedQty(s)).toBe(6)
  })

  it('the reversal block no longer sends the user to Edit Order', async () => {
    const s = await makeTransfer()
    await client.query(`UPDATE job_work_items SET quantity_sent = 5 WHERE id = $1`, [s.lineId])
    const { rows: [{ msg }] } = await client.query(`SELECT job_work_transfer_item_reversal_block($1) AS msg`, [s.transferItemId])
    expect(msg).toMatch(/doesn't match the transfer/)
    expect(msg).not.toMatch(/Edit Order/)
  })
})
