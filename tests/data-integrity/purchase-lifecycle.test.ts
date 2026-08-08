// Transaction lifecycle tests for Purchase Bills, exercising the ACTUAL
// production triggers/RPCs (fn_bill_item_to_ledger, fn_bill_item_deleted,
// cancel_purchase_bill, purge_cancelled_bill) against a real, throwaway
// Postgres instance — not the reconciliation rules themselves, but the
// source posting behavior those rules exist to catch drift from. This is
// the "would have caught CR00700 at the source" half of the test matrix
// (see docs/data-integrity/TEST_MATRIX.md) — a deliberately-scoped subset
// of the assignment's full lifecycle matrix (new/draft/double-submit/edit/
// remove/cancel/purge), not the complete 17-scenario x 4-type grid.
//
// No production data or ids — every row is created fresh per test.
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
async function makeBillFixtures() {
  seq += 1
  const code = `PT${seq}${Date.now().toString(36).slice(-4)}`.toUpperCase().slice(0, 10)
  const { rows: [company] } = await client.query(`INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [code])
  const { rows: [warehouse] } = await client.query(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id])
  const { rows: [supplier] } = await client.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [code])
  const { rows: [materialType] } = await client.query(`INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`, [code])
  return { companyId: company.id as string, warehouseId: warehouse.id as string, supplierId: supplier.id as string, materialTypeId: materialType.id as string }
}

async function makeBill(f: Awaited<ReturnType<typeof makeBillFixtures>>, status: 'draft' | 'active' = 'active') {
  const billNumber = `BILL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const { rows: [bill] } = await client.query(
    `INSERT INTO purchase_bills (supplier_id, company_id, warehouse_id, bill_number, bill_date, status)
     VALUES ($1, $2, $3, $4, '2024-06-01', $5) RETURNING id`,
    [f.supplierId, f.companyId, f.warehouseId, billNumber, status]
  )
  return bill.id as string
}

async function addLine(billId: string, materialTypeId: string, quantity: number) {
  const { rows: [item] } = await client.query(
    `INSERT INTO purchase_bill_items (bill_id, material_type_id, quantity, unit, rate, amount)
     VALUES ($1, $2, $3, 'tons', 100, $4) RETURNING id, purchase_line_id`,
    [billId, materialTypeId, quantity, quantity * 100]
  )
  return { itemId: item.id as string, purchaseLineId: item.purchase_line_id as string }
}

async function ledgerNetForBill(billId: string) {
  const { rows: [r] } = await client.query(
    `SELECT COALESCE(SUM(quantity), 0) AS net FROM stock_ledger WHERE reference_type = 'purchase_bill' AND reference_id = $1`,
    [billId]
  )
  return Number(r.net)
}

describe('Purchase lifecycle', () => {
  it('new bill line posts exactly one PURCHASE_IN matching the entered quantity', async () => {
    const f = await makeBillFixtures()
    const billId = await makeBill(f)
    await addLine(billId, f.materialTypeId, 5.5)

    const { rows } = await client.query(`SELECT entry_type, quantity FROM stock_ledger WHERE reference_type = 'purchase_bill' AND reference_id = $1`, [billId])
    expect(rows).toHaveLength(1)
    expect(rows[0].entry_type).toBe('PURCHASE_IN')
    expect(Number(rows[0].quantity)).toBeCloseTo(5.5, 3)
  })

  it('a draft bill line still posts to the ledger — a real, known asymmetry vs. dispatch (see CURRENT_STATE_AUDIT.md §5)', async () => {
    // fn_bill_item_to_ledger() has no draft-skip check, unlike
    // fn_dispatch_item_to_ledger(). This test documents the CURRENT
    // behavior (it posts) rather than asserting a fix that doesn't exist —
    // catching this honestly is more valuable than a green test that
    // silently assumes a check exists.
    const f = await makeBillFixtures()
    const billId = await makeBill(f, 'draft')
    await addLine(billId, f.materialTypeId, 3.0)

    const { rows } = await client.query(`SELECT entry_type FROM stock_ledger WHERE reference_type = 'purchase_bill' AND reference_id = $1`, [billId])
    expect(rows).toHaveLength(1)
    expect(rows[0].entry_type).toBe('PURCHASE_IN')
  })

  it('double-submitting a NEW line posts two PURCHASE_IN rows, and REC-001 does NOT catch it — a real, documented gap, distinct from the CR00700 shape', async () => {
    const f = await makeBillFixtures()
    const billId = await makeBill(f)
    // Simulates a UI double-click / duplicate mutation submitting the same
    // conceptual line twice — there is no idempotency key on
    // purchase_bill_items (see ARCHITECTURE.md's Phase 2 section), so
    // nothing stops this at the database level today.
    await addLine(billId, f.materialTypeId, 4.0)
    await addLine(billId, f.materialTypeId, 4.0)

    const { rows } = await client.query(`SELECT entry_type, quantity, purchase_line_id FROM stock_ledger WHERE reference_type = 'purchase_bill' AND reference_id = $1`, [billId])
    expect(rows).toHaveLength(2)
    expect(rows.every((r: { entry_type: string }) => r.entry_type === 'PURCHASE_IN')).toBe(true)
    // Each INSERT into purchase_bill_items gets its own auto-generated
    // purchase_line_id (generate_purchase_line_id(), migration 020) — the
    // two rows are structurally distinct lines, not two postings of the
    // same line. That's exactly why REC-001, which groups by
    // purchase_line_id among other identity columns, does NOT flag this:
    expect(rows[0].purchase_line_id).not.toBe(rows[1].purchase_line_id)
    const { rows: dup } = await client.query(`SELECT * FROM fn_reconcile_rec_001($1, '2024-01-01', '2026-12-31')`, [f.companyId])
    expect(dup).toHaveLength(0)
    // This is the CR00700 shape's mirror image: CR00700 was one line
    // double-CANCELLED (same purchase_line_id both times, caught by
    // REC-001); this is two lines each created once (different
    // purchase_line_id, not caught). See RULE_CATALOGUE.md's REC-001
    // section and REC-016 (duplicate source business identifier,
    // catalogued but not implemented) for the intended coverage of this
    // exact gap — matching on bill + material + quantity + near-identical
    // timestamp instead of purchase_line_id.
  })

  it('editing a line without changing quantity (delete + re-insert same qty) nets to the original quantity, not zero or double', async () => {
    const f = await makeBillFixtures()
    const billId = await makeBill(f)
    const { itemId } = await addLine(billId, f.materialTypeId, 7.25)

    // Mirrors /api/bills/[id]/save-edit's actual approach: DELETE the
    // removed line (fires fn_bill_item_deleted -> PURCHASE_CANCEL), then
    // INSERT the replacement (fires fn_bill_item_to_ledger -> PURCHASE_IN).
    await client.query(`DELETE FROM purchase_bill_items WHERE id = $1`, [itemId])
    await addLine(billId, f.materialTypeId, 7.25)

    expect(await ledgerNetForBill(billId)).toBeCloseTo(7.25, 3)
    const { rows } = await client.query(`SELECT entry_type FROM stock_ledger WHERE reference_type = 'purchase_bill' AND reference_id = $1 ORDER BY created_at`, [billId])
    expect(rows.map((r: { entry_type: string }) => r.entry_type)).toEqual(['PURCHASE_IN', 'PURCHASE_CANCEL', 'PURCHASE_IN'])
  })

  it('editing a line to a different quantity nets to the new quantity', async () => {
    const f = await makeBillFixtures()
    const billId = await makeBill(f)
    const { itemId } = await addLine(billId, f.materialTypeId, 10.0)

    await client.query(`DELETE FROM purchase_bill_items WHERE id = $1`, [itemId])
    await addLine(billId, f.materialTypeId, 6.5)

    expect(await ledgerNetForBill(billId)).toBeCloseTo(6.5, 3)
  })

  it('removing one line (no re-add) nets that line to zero, leaving other lines untouched', async () => {
    const f = await makeBillFixtures()
    const billId = await makeBill(f)
    const { itemId: keepId } = await addLine(billId, f.materialTypeId, 2.0)
    const { itemId: removeId } = await addLine(billId, f.materialTypeId, 3.0)
    void keepId

    await client.query(`DELETE FROM purchase_bill_items WHERE id = $1`, [removeId])

    expect(await ledgerNetForBill(billId)).toBeCloseTo(2.0, 3)
  })

  it('full cancellation via cancel_purchase_bill() deletes the ledger footprint outright and nets to zero', async () => {
    const f = await makeBillFixtures()
    const billId = await makeBill(f)
    await addLine(billId, f.materialTypeId, 8.0)
    expect(await ledgerNetForBill(billId)).toBeCloseTo(8.0, 3)

    const { rows: [result] } = await client.query(`SELECT cancel_purchase_bill($1, 'test cancel') AS r`, [billId])
    expect(result.r.success).toBe(true)
    expect(await ledgerNetForBill(billId)).toBe(0)

    const { rows: [bill] } = await client.query(`SELECT status FROM purchase_bills WHERE id = $1`, [billId])
    expect(bill.status).toBe('cancelled')
  })

  it('cancelling an already-cancelled bill fails cleanly (no double-cancel, no duplicate ledger effect)', async () => {
    const f = await makeBillFixtures()
    const billId = await makeBill(f)
    await addLine(billId, f.materialTypeId, 5.0)
    await client.query(`SELECT cancel_purchase_bill($1, 'first cancel')`, [billId])

    const { rows: [result] } = await client.query(`SELECT cancel_purchase_bill($1, 'second cancel') AS r`, [billId])
    expect(result.r.success).toBe(false)
    // This is exactly the accounting invariant REC-007 would independently
    // catch if the RPC's own guard ever regressed — belt and suspenders.
    expect(await ledgerNetForBill(billId)).toBe(0)
  })

  it('purge after cancellation archives the bill and leaves no live ledger trace', async () => {
    const f = await makeBillFixtures()
    const billId = await makeBill(f)
    await addLine(billId, f.materialTypeId, 4.5)
    await client.query(`SELECT cancel_purchase_bill($1, 'to purge')`, [billId])

    const { rows: [purgeResult] } = await client.query(`SELECT purge_cancelled_bill($1, NULL) AS r`, [billId])
    expect(purgeResult.r.success).toBe(true)

    expect(await ledgerNetForBill(billId)).toBe(0)
    const { rows: archived } = await client.query(`SELECT id FROM purchase_cancellations WHERE original_bill_id = $1`, [billId])
    expect(archived).toHaveLength(1)
  })

  it('purging a bill that is not cancelled fails cleanly', async () => {
    const f = await makeBillFixtures()
    const billId = await makeBill(f)
    await addLine(billId, f.materialTypeId, 1.0)

    const { rows: [result] } = await client.query(`SELECT purge_cancelled_bill($1, NULL) AS r`, [billId])
    expect(result.r.success).toBe(false)
  })

  it('a backdated bill (bill_date before entry) posts with the business date, not the insert date', async () => {
    const f = await makeBillFixtures()
    const billNumber = `BILL-BACKDATED-${Date.now()}`
    const { rows: [bill] } = await client.query(
      `INSERT INTO purchase_bills (supplier_id, company_id, warehouse_id, bill_number, bill_date, status)
       VALUES ($1, $2, $3, $4, '2023-01-15', 'active') RETURNING id`,
      [f.supplierId, f.companyId, f.warehouseId, billNumber]
    )
    await addLine(bill.id, f.materialTypeId, 2.5)

    // Cast to text in SQL rather than comparing the driver's JS Date object
    // — node-pg returns DATE columns as local-timezone Date objects, and
    // .toISOString() on that shifts across a UTC day boundary for any
    // timezone ahead of UTC (a display artifact, not a data bug).
    const { rows: [ledgerRow] } = await client.query(
      `SELECT entry_date::text AS entry_date FROM stock_ledger WHERE reference_type = 'purchase_bill' AND reference_id = $1`,
      [bill.id]
    )
    expect(ledgerRow.entry_date).toBe('2023-01-15')
  })
})
