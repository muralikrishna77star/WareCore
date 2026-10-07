// Migration 157: a job work vendor transfer is reversed line by line
// (reverse_job_work_transfer_items()). Each reversed line's quantity goes
// back to its source line, the destination order is kept and deactivated
// once empty, and a line whose material has moved on (onward transfer,
// direct sale, return, output) is refused. Runs the real create/reverse
// functions and triggers on a throwaway Postgres; no production data.
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

/** Source order at vendor A with two lines, then transfer `qty` of each to vendor B. */
async function makeTransfer(qty: [number, number] = [1.5, 2.25]) {
  seq += 1
  const code = `RV${seq}${Date.now().toString(36).slice(-4)}`.toUpperCase().slice(0, 10)
  const { rows: [company] } = await client.query(`INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [code])
  const { rows: [warehouse] } = await client.query(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id])
  const { rows: [material] } = await client.query(`INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`, [code])
  const vendor = async (suffix: string) =>
    (await client.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`${code}-${suffix}`])).rows[0].id as string
  const vendorA = await vendor('A')
  const vendorB = await vendor('B')
  const vendorC = await vendor('C')
  const { rows: [source] } = await client.query(
    `INSERT INTO job_work_orders (reference_number, vendor_id, company_id, warehouse_id, dispatch_date, status)
     VALUES ($1, $2, $3, $4, '2025-02-01', 'dispatched') RETURNING id`,
    [`JW-SRC-${code}`, vendorA, company.id, warehouse.id]
  )
  const sourceItems: string[] = []
  for (const [i, line] of ['TEST-PL-001', 'TEST-PL-002'].entries()) {
    const { rows: [it] } = await client.query(
      `INSERT INTO job_work_items (purchase_line_id, job_work_order_id, material_type_id, quantity_sent, quantity_received, unit, job_line_id, item_name)
       VALUES ($1, $2, $3, 5, 0, 'MT', $4, $5) RETURNING id`,
      [line, source.id, material.id, `JL-${code}-${i + 1}`, `Item ${i + 1}`]
    )
    sourceItems.push(it.id)
  }
  const transferNumber = `JWT-${code}`
  const { rows: [created] } = await client.query(
    `SELECT create_job_work_transfer($1, $2, '2025-02-13', $3, $4, NULL, NULL, $5::jsonb, NULL) AS r`,
    [source.id, vendorB, `JW-DST-${code}`, transferNumber, JSON.stringify([
      { source_item_id: sourceItems[0], quantity: qty[0], job_line_id: `JL-${code}-T1` },
      { source_item_id: sourceItems[1], quantity: qty[1], job_line_id: `JL-${code}-T2` },
    ])]
  )
  expect(created.r.success).toBe(true)
  const { rows: [transfer] } = await client.query(`SELECT id FROM job_work_transfers WHERE transfer_number = $1`, [transferNumber])
  const { rows: tItems } = await client.query(
    `SELECT id, to_job_work_item_id, from_job_work_item_id FROM job_work_transfer_items WHERE job_work_transfer_id = $1 ORDER BY item_name`,
    [transfer.id]
  )
  return {
    code, companyId: company.id as string, warehouseId: warehouse.id as string, materialId: material.id as string,
    vendorC, sourceId: source.id as string, sourceItems, destId: created.r.to_job_work_order_id as string,
    transferId: transfer.id as string, transferNumber,
    tItemIds: tItems.map((r) => r.id as string), destItemIds: tItems.map((r) => r.to_job_work_item_id as string),
  }
}

type T = Awaited<ReturnType<typeof makeTransfer>>

async function reverse(t: T, itemIds: string[], notes: string | null = 'wrong vendor') {
  const { rows: [r] } = await client.query(`SELECT reverse_job_work_transfer_items($1, $2::uuid[], $3, NULL) AS r`, [t.transferId, itemIds, notes])
  return r.r as { success: boolean; error?: string; reversed?: number; destination_deactivated?: boolean }
}

async function preview(t: T) {
  const { rows: [r] } = await client.query(`SELECT preview_job_work_transfer_reversal($1) AS r`, [t.transferId])
  return r.r as { items: { id: string; blocked_reason: string | null; reversed_at: string | null }[] }
}

async function order(id: string) {
  const { rows: [o] } = await client.query(`SELECT status, completion_via FROM job_work_orders WHERE id = $1`, [id])
  return o as { status: string; completion_via: string | null }
}

async function transferredOut(itemId: string) {
  const { rows: [r] } = await client.query(`SELECT quantity_transferred_out AS q FROM job_work_items WHERE id = $1`, [itemId])
  return Number(r.q)
}

async function ledgerCount(orderId: string, entryType: string) {
  const { rows: [r] } = await client.query(
    `SELECT count(*)::int AS n FROM stock_ledger WHERE reference_type = 'job_work' AND reference_id = $1 AND entry_type = $2`,
    [orderId, entryType]
  )
  return r.n as number
}

/** REC-009 (items vs ledger per order) and REC-018 (vendor balances) for this company. */
async function integrityFindings(t: T) {
  const { rows } = await client.query(
    `SELECT fingerprint FROM fn_reconcile_rec_009($1, '2000-01-01', '2100-01-01')
     UNION ALL SELECT fingerprint FROM fn_reconcile_rec_018($1, '2000-01-01', '2100-01-01')`,
    [t.companyId]
  )
  return rows.map((r) => r.fingerprint as string)
}

describe('reverse_job_work_transfer_items (migration 157)', () => {
  it('reverses one line: quantity back on the source line, both ledger legs removed, destination stays active', async () => {
    const t = await makeTransfer()
    expect(await integrityFindings(t)).toEqual([])

    const res = await reverse(t, [t.tItemIds[0]])
    expect(res).toMatchObject({ success: true, reversed: 1, destination_deactivated: false })

    expect(await transferredOut(t.sourceItems[0])).toBeCloseTo(0, 3)
    expect(await transferredOut(t.sourceItems[1])).toBeCloseTo(2.25, 3)
    expect(await ledgerCount(t.sourceId, 'JOB_WORK_TRANSFER_OUT')).toBe(1)
    expect(await ledgerCount(t.destId, 'JOB_WORK_TRANSFER_IN')).toBe(1)
    expect((await order(t.destId)).status).toBe('dispatched')

    const p = await preview(t)
    expect(p.items.find((i) => i.id === t.tItemIds[0])!.reversed_at).not.toBeNull()
    expect(p.items.find((i) => i.id === t.tItemIds[1])!.blocked_reason).toBeNull()

    const { rows: audit } = await client.query(
      `SELECT count(*)::int AS n FROM stock_ledger_deletions WHERE ledger_row->>'reference_id' IN ($1, $2)`, [t.sourceId, t.destId]
    )
    expect(audit[0].n).toBe(2)
    expect(await integrityFindings(t)).toEqual([])
  })

  it('deactivates the destination order as "transfer_reversed" once its last line is reversed', async () => {
    const t = await makeTransfer()
    expect((await reverse(t, [t.tItemIds[0]])).success).toBe(true)
    const res = await reverse(t, [t.tItemIds[1]])
    expect(res).toMatchObject({ success: true, destination_deactivated: true })

    expect(await order(t.destId)).toEqual({ status: 'cancelled', completion_via: 'transfer_reversed' })
    expect(await order(t.sourceId)).toMatchObject({ status: 'dispatched' })
    expect(await ledgerCount(t.destId, 'JOB_WORK_TRANSFER_IN')).toBe(0)
    expect(await ledgerCount(t.sourceId, 'JOB_WORK_TRANSFER_OUT')).toBe(0)
    // The transfer and its lines stay as the record.
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM job_work_transfer_items WHERE job_work_transfer_id = $1 AND reversed_at IS NOT NULL`, [t.transferId])
    expect(rows[0].n).toBe(2)
    expect(await integrityFindings(t)).toEqual([])

    const again = await reverse(t, [t.tItemIds[0]])
    expect(again.success).toBe(false)
    expect(again.error).toMatch(/Already reversed on/)
  })

  it('refuses a line already transferred on to another vendor, until that onward transfer is reversed', async () => {
    const t = await makeTransfer()
    const { rows: [onward] } = await client.query(
      `SELECT create_job_work_transfer($1, $2, '2025-02-20', $3, $4, NULL, NULL, $5::jsonb, NULL) AS r`,
      [t.destId, t.vendorC, `JW-ONW-${t.code}`, `JWT-ONW-${t.code}`, JSON.stringify([{ source_item_id: t.destItemIds[0], quantity: 1 }])]
    )
    expect(onward.r.success).toBe(true)

    const res = await reverse(t, [t.tItemIds[0], t.tItemIds[1]])
    expect(res.success).toBe(false)
    expect(res.error).toContain('Nothing was reversed.')
    expect(res.error).toContain(`Already transferred on from ${t.code}-B to another vendor (JWT-ONW-${t.code} to ${t.code}-C). Reverse that transfer first.`)
    // All-or-nothing: the unblocked second line was not reversed either.
    expect(await transferredOut(t.sourceItems[1])).toBeCloseTo(2.25, 3)

    // The onward transfer itself is untouched by the attempt, and can be reversed first.
    const { rows: [ot] } = await client.query(`SELECT id FROM job_work_transfers WHERE transfer_number = $1`, [`JWT-ONW-${t.code}`])
    const { rows: [oti] } = await client.query(`SELECT id FROM job_work_transfer_items WHERE job_work_transfer_id = $1`, [ot.id])
    const { rows: [r1] } = await client.query(`SELECT reverse_job_work_transfer_items($1, ARRAY[$2]::uuid[], NULL, NULL) AS r`, [ot.id, oti.id])
    expect(r1.r).toMatchObject({ success: true, destination_deactivated: true })

    expect(await reverse(t, [t.tItemIds[0], t.tItemIds[1]])).toMatchObject({ success: true, destination_deactivated: true })
    expect(await integrityFindings(t)).toEqual([])
  })

  it('refuses a line sold directly from the vendor while the sale stands, and allows it once the sale is cancelled', async () => {
    const t = await makeTransfer()
    const { rows: [customer] } = await client.query(`INSERT INTO customers (name) VALUES ($1) RETURNING id`, [`${t.code}-CUST`])
    const { rows: [sale] } = await client.query(
      `INSERT INTO dispatch_orders (invoice_number, customer_id, company_id, warehouse_id, dispatch_date, is_vendor_direct, source_job_work_order_id)
       VALUES ($1, $2, $3, $4, '2025-02-25', true, $5) RETURNING id`,
      [`INV-${t.code}`, customer.id, t.companyId, t.warehouseId, t.destId]
    )
    await client.query(
      `INSERT INTO dispatch_items (dispatch_order_id, material_type_id, quantity, unit, source_job_work_item_id) VALUES ($1, $2, 1, 'MT', $3)`,
      [sale.id, t.materialId, t.destItemIds[1]]
    )

    const p = await preview(t)
    expect(p.items.find((i) => i.id === t.tItemIds[1])!.blocked_reason)
      .toBe(`Already sold directly from ${t.code}-B (INV-${t.code} dated 25-Feb-2025). This line cannot be reversed while that sale stands.`)
    expect(p.items.find((i) => i.id === t.tItemIds[0])!.blocked_reason).toBeNull()
    expect((await reverse(t, [t.tItemIds[1]])).success).toBe(false)

    // The sale also booked a virtual return on the line; the real cancellation undoes both.
    const { rows: [cancelled] } = await client.query(`SELECT cancel_dispatch_order($1, 'test') AS r`, [sale.id])
    expect(cancelled.r.success).toBe(true)
    expect((await preview(t)).items.find((i) => i.id === t.tItemIds[1])!.blocked_reason).toBeNull()
  })

  it('refuses a line with material already returned from the new vendor', async () => {
    const t = await makeTransfer()
    await client.query(`UPDATE job_work_items SET quantity_received = 0.5, received_date = '2025-03-01' WHERE id = $1`, [t.destItemIds[0]])
    const res = await reverse(t, [t.tItemIds[0]])
    expect(res.success).toBe(false)
    expect(res.error).toContain(`0.500 of this line has already been returned or sold from ${t.code}-B, so it cannot be reversed.`)
  })

  it('Delete Order explains the transfer instead of failing, before and after reversal', async () => {
    const t = await makeTransfer()
    const del = async (id: string) =>
      (await client.query(`SELECT delete_job_work_order($1::uuid, NULL) AS r`, [id])).rows[0].r as { success: boolean; error?: string }

    expect((await del(t.destId)).error).toBe(
      `This order was created by transfer ${t.transferNumber}, which moved the material here from order JW-SRC-${t.code} (${t.code}-A), so it cannot be deleted. ` +
      `To undo the transfer, open Job Work Transfers and use Reverse on ${t.transferNumber} — the material goes back to JW-SRC-${t.code} line by line, and once every line is reversed this order is deactivated.`
    )
    expect((await del(t.sourceId)).error).toBe(
      `Material from this order has been transferred to another vendor (${t.transferNumber} to order JW-DST-${t.code} / ${t.code}-B), and transfers are kept as a permanent record, so this order cannot be deleted. ` +
      'To bring the material back, open Job Work Transfers and use Reverse.'
    )

    await reverse(t, t.tItemIds)
    expect((await del(t.destId)).error).toBe(
      `This order was created by transfer ${t.transferNumber} and that transfer has been fully reversed. The order is kept as a record of the reversal and cannot be deleted.`
    )
    expect((await del(t.sourceId)).error).toBe(
      `Material from this order has been transferred to another vendor (${t.transferNumber} to order JW-DST-${t.code} / ${t.code}-B, reversed), and transfers are kept as a permanent record, so this order cannot be deleted.`
    )
  })

  it('the old delete_job_work_transfer() no longer deletes anything', async () => {
    const t = await makeTransfer()
    const { rows: [r] } = await client.query(`SELECT delete_job_work_transfer($1, NULL) AS r`, [t.transferId])
    expect(r.r.success).toBe(false)
    expect(r.r.error).toMatch(/use Reverse/i)
    expect(await order(t.destId)).toMatchObject({ status: 'dispatched' })
  })
})
