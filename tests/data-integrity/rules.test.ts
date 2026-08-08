// Integration tests for the Phase 1 reconciliation rule functions
// (supabase/migrations/088_data_integrity_rule_functions.sql) against a
// real, throwaway Postgres instance (scripts/test/testDb.mjs) — never
// against production, and never using real production row IDs (per the
// assignment's rules 9/10/11). All company/warehouse/material/item ids
// below are freshly generated inside this throwaway database.
//
// One shared database for the whole file (beforeAll/afterAll) because
// spinning one up is expensive (fresh initdb + ~79 migrations, several
// minutes) — each test uses its own uniquely-coded company so tests don't
// interfere with each other's scan scope.
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
async function makeCompanyAndWarehouse() {
  seq += 1
  const code = `T${seq}${Date.now().toString(36).slice(-4)}`.toUpperCase().slice(0, 10)
  const { rows: [company] } = await client.query(
    `INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`,
    [code]
  )
  const { rows: [warehouse] } = await client.query(
    `INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`,
    [company.id]
  )
  const { rows: [materialType] } = await client.query(
    `INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`,
    [code]
  )
  return { companyId: company.id as string, warehouseId: warehouse.id as string, materialTypeId: materialType.id as string }
}

async function insertLedger(opts: {
  entryType: string
  quantity: number
  entryDate: string
  companyId: string
  warehouseId: string
  materialTypeId: string
  purchaseLineId?: string | null
  referenceType?: string | null
  referenceId?: string | null
  referenceNumber?: string | null
  notes?: string | null
}) {
  await client.query(
    `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, entry_date, purchase_line_id, reference_type, reference_id, reference_number, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      opts.entryType, opts.companyId, opts.warehouseId, opts.materialTypeId, opts.quantity, opts.entryDate,
      opts.purchaseLineId ?? null, opts.referenceType ?? null, opts.referenceId ?? null, opts.referenceNumber ?? null, opts.notes ?? null,
    ]
  )
}

describe('REC-001 exact duplicate ledger event', () => {
  it('flags the CR00700 pattern (two identical PURCHASE_CANCEL rows, ~3 minutes apart) as CONFIRMED/HIGH severity', async () => {
    const { companyId, warehouseId, materialTypeId } = await makeCompanyAndWarehouse()
    await insertLedger({ entryType: 'PURCHASE_IN', quantity: 3.71, entryDate: '2024-07-12', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-0001' })
    await client.query(
      `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, entry_date, purchase_line_id, notes, created_at)
       VALUES ('PURCHASE_CANCEL',$1,$2,$3,-3.71,'2024-07-12','SYN-0001','Item removed from bill', TIMESTAMP '2026-08-03 05:45:11')`,
      [companyId, warehouseId, materialTypeId]
    )
    await client.query(
      `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, entry_date, purchase_line_id, notes, created_at)
       VALUES ('PURCHASE_CANCEL',$1,$2,$3,-3.71,'2024-07-12','SYN-0001','Item removed from bill', TIMESTAMP '2026-08-03 05:47:54')`,
      [companyId, warehouseId, materialTypeId]
    )

    const { rows } = await client.query(
      `SELECT * FROM fn_reconcile_rec_001($1, '2024-01-01', '2026-12-31')`,
      [companyId]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].severity).toBe('HIGH')
    expect(rows[0].evidence.confidence).toBe('CONFIRMED')
    expect(rows[0].evidence.dup_count).toBe(2)
  })

  it('does not flag two identical rows created weeks apart as high confidence', async () => {
    const { companyId, warehouseId, materialTypeId } = await makeCompanyAndWarehouse()
    await client.query(
      `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, entry_date, purchase_line_id, created_at)
       VALUES ('PURCHASE_IN',$1,$2,$3,5.0,'2024-01-10','SYN-0002', TIMESTAMP '2024-01-10 09:00:00')`,
      [companyId, warehouseId, materialTypeId]
    )
    await client.query(
      `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, entry_date, purchase_line_id, created_at)
       VALUES ('PURCHASE_IN',$1,$2,$3,5.0,'2024-01-10','SYN-0002', TIMESTAMP '2024-03-15 09:00:00')`,
      [companyId, warehouseId, materialTypeId]
    )
    const { rows } = await client.query(`SELECT * FROM fn_reconcile_rec_001($1, '2024-01-01', '2026-12-31')`, [companyId])
    expect(rows).toHaveLength(1)
    expect(rows[0].evidence.confidence).toBe('REVIEW_REQUIRED')
    expect(rows[0].severity).toBe('LOW')
  })

  it('does not flag a single, non-duplicated event', async () => {
    const { companyId, warehouseId, materialTypeId } = await makeCompanyAndWarehouse()
    await insertLedger({ entryType: 'PURCHASE_IN', quantity: 4.2, entryDate: '2024-02-01', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-0003' })
    const { rows } = await client.query(`SELECT * FROM fn_reconcile_rec_001($1, '2024-01-01', '2026-12-31')`, [companyId])
    expect(rows).toHaveLength(0)
  })
})

describe('REC-005 negative warehouse stock', () => {
  it('flags the CR00700-shaped scenario (net -0.460, real chronological dip to -3.710)', async () => {
    const { companyId, warehouseId, materialTypeId } = await makeCompanyAndWarehouse()
    await insertLedger({ entryType: 'PURCHASE_IN', quantity: 3.71, entryDate: '2024-07-12', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-0004' })
    await insertLedger({ entryType: 'PURCHASE_CANCEL', quantity: -3.71, entryDate: '2024-07-12', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-0004' })
    await insertLedger({ entryType: 'PURCHASE_CANCEL', quantity: -3.71, entryDate: '2024-07-12', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-0004' })
    await insertLedger({ entryType: 'PURCHASE_IN', quantity: 3.25, entryDate: '2024-07-16', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-0005' })

    const { rows } = await client.query(`SELECT * FROM fn_reconcile_rec_005($1, '2024-01-01', '2026-12-31')`, [companyId])
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].evidence.minimum_balance)).toBeCloseTo(-3.71, 3)
    expect(Number(rows[0].evidence.current_balance)).toBeCloseTo(-0.46, 3)
    expect(rows[0].severity).toBe('CRITICAL')
  })

  it('does not flag stock that stays non-negative throughout', async () => {
    const { companyId, warehouseId, materialTypeId } = await makeCompanyAndWarehouse()
    await insertLedger({ entryType: 'PURCHASE_IN', quantity: 10, entryDate: '2024-01-01', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-0006' })
    await insertLedger({ entryType: 'SALE_OUT', quantity: -4, entryDate: '2024-01-05', companyId, warehouseId, materialTypeId })
    const { rows } = await client.query(`SELECT * FROM fn_reconcile_rec_005($1, '2024-01-01', '2026-12-31')`, [companyId])
    expect(rows).toHaveLength(0)
  })
})

describe('REC-007 reversal mismatch', () => {
  it('flags a purchase line where cancelled quantity exceeds purchased quantity', async () => {
    const { companyId, warehouseId, materialTypeId } = await makeCompanyAndWarehouse()
    await insertLedger({ entryType: 'PURCHASE_IN', quantity: 3.71, entryDate: '2024-07-12', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-0007' })
    await insertLedger({ entryType: 'PURCHASE_CANCEL', quantity: -3.71, entryDate: '2024-07-12', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-0007' })
    await insertLedger({ entryType: 'PURCHASE_CANCEL', quantity: -3.71, entryDate: '2024-07-12', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-0007' })
    const { rows } = await client.query(`SELECT * FROM fn_reconcile_rec_007($1, '2024-01-01', '2026-12-31')`, [companyId])
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].expected_value)).toBeCloseTo(3.71, 3)
    expect(Number(rows[0].actual_value)).toBeCloseTo(7.42, 3)
  })

  it('does not flag a normal single cancellation', async () => {
    const { companyId, warehouseId, materialTypeId } = await makeCompanyAndWarehouse()
    await insertLedger({ entryType: 'PURCHASE_IN', quantity: 5, entryDate: '2024-01-01', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-0008' })
    await insertLedger({ entryType: 'PURCHASE_CANCEL', quantity: -5, entryDate: '2024-01-01', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-0008' })
    const { rows } = await client.query(`SELECT * FROM fn_reconcile_rec_007($1, '2024-01-01', '2026-12-31')`, [companyId])
    expect(rows).toHaveLength(0)
  })
})

describe('REC-008 transfer pair mismatch', () => {
  it('flags a transfer with a missing TRANSFER_IN leg', async () => {
    const { companyId, warehouseId, materialTypeId } = await makeCompanyAndWarehouse()
    const { warehouseId: warehouseId2 } = await makeCompanyAndWarehouse()
    const { rows: [transfer] } = await client.query(
      `INSERT INTO transfers (reference_number, from_company_id, from_warehouse_id, to_company_id, to_warehouse_id, transfer_date, status)
       VALUES ('SYN-TR-0001', $1, $2, $1, $3, '2024-05-01', 'completed') RETURNING id`,
      [companyId, warehouseId, warehouseId2]
    )
    // fn_transfer_item_to_ledger() posts BOTH legs automatically the moment
    // transfer_items is inserted — to simulate the "missing IN leg" defect,
    // delete the auto-posted TRANSFER_IN row afterward rather than skipping
    // an insert (there's nothing to skip; the trigger already did it).
    await client.query(
      `INSERT INTO transfer_items (transfer_id, material_type_id, quantity) VALUES ($1, $2, 6.5)`,
      [transfer.id, materialTypeId]
    )
    await client.query(`DELETE FROM stock_ledger WHERE reference_type = 'transfer' AND reference_id = $1 AND entry_type = 'TRANSFER_IN'`, [transfer.id])

    const { rows } = await client.query(`SELECT * FROM fn_reconcile_rec_008($1, '2024-01-01', '2026-12-31')`, [companyId])
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].evidence.out_qty)).toBeCloseTo(6.5, 3)
    expect(Number(rows[0].evidence.in_qty)).toBe(0)
  })

  it('does not flag a complete, matching transfer pair', async () => {
    const { companyId, warehouseId, materialTypeId } = await makeCompanyAndWarehouse()
    const { warehouseId: warehouseId2 } = await makeCompanyAndWarehouse()
    const { rows: [transfer] } = await client.query(
      `INSERT INTO transfers (reference_number, from_company_id, from_warehouse_id, to_company_id, to_warehouse_id, transfer_date, status)
       VALUES ('SYN-TR-0002', $1, $2, $1, $3, '2024-05-02', 'completed') RETURNING id`,
      [companyId, warehouseId, warehouseId2]
    )
    // The trigger posts both legs automatically on insert — nothing else to do.
    await client.query(`INSERT INTO transfer_items (transfer_id, material_type_id, quantity) VALUES ($1, $2, 2.0)`, [transfer.id, materialTypeId])
    const { rows } = await client.query(`SELECT * FROM fn_reconcile_rec_008($1, '2024-01-01', '2026-12-31')`, [companyId])
    expect(rows).toHaveLength(0)
  })
})

describe('REC-013 zero-stock validation', () => {
  it('does NOT flag a genuinely clean zero-balance item (acceptance criterion: zero stock is not automatically a defect)', async () => {
    const { companyId, warehouseId, materialTypeId } = await makeCompanyAndWarehouse()
    await insertLedger({ entryType: 'PURCHASE_IN', quantity: 8, entryDate: '2024-01-01', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-0009' })
    await insertLedger({ entryType: 'SALE_OUT', quantity: -8, entryDate: '2024-01-10', companyId, warehouseId, materialTypeId })
    const { rows } = await client.query(`SELECT * FROM fn_reconcile_rec_013($1, '2024-01-01', '2026-12-31')`, [companyId])
    expect(rows).toHaveLength(0)
  })

  it('flags a zero-balance item whose zero was produced by a duplicate ledger pair', async () => {
    const { companyId, warehouseId, materialTypeId } = await makeCompanyAndWarehouse()
    await insertLedger({ entryType: 'PURCHASE_IN', quantity: 5, entryDate: '2024-01-01', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-0010' })
    await insertLedger({ entryType: 'SALE_OUT', quantity: -5, entryDate: '2024-01-05', companyId, warehouseId, materialTypeId, referenceType: 'dispatch', referenceId: companyId, purchaseLineId: 'SYN-0010' })
    await insertLedger({ entryType: 'SALE_OUT', quantity: -5, entryDate: '2024-01-05', companyId, warehouseId, materialTypeId, referenceType: 'dispatch', referenceId: companyId, purchaseLineId: 'SYN-0010' })
    await insertLedger({ entryType: 'PURCHASE_IN', quantity: 5, entryDate: '2024-01-06', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-0011' })
    const { rows } = await client.query(`SELECT * FROM fn_reconcile_rec_013($1, '2024-01-01', '2026-12-31')`, [companyId])
    expect(rows).toHaveLength(1)
    expect(rows[0].severity).toBe('LOW')
  })
})

describe('REC-014 report equation mismatch', () => {
  it('never fires on a normal set of movements (canonical functions self-consistent)', async () => {
    const { companyId, warehouseId, materialTypeId } = await makeCompanyAndWarehouse()
    await insertLedger({ entryType: 'PURCHASE_IN', quantity: 3.71, entryDate: '2024-07-12', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-0012' })
    await insertLedger({ entryType: 'PURCHASE_CANCEL', quantity: -3.71, entryDate: '2024-07-12', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-0012' })
    await insertLedger({ entryType: 'PURCHASE_IN', quantity: 3.25, entryDate: '2024-07-16', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-0013' })
    const { rows } = await client.query(`SELECT * FROM fn_reconcile_rec_014($1, '2024-01-01', '2026-12-31')`, [companyId])
    expect(rows).toHaveLength(0)
  })
})

describe('canonical layer (087) — CR00700 regression, full end-to-end shape', () => {
  it('vw_current_warehouse_stock and fn_stock_movement_history agree, and reflect the real defect exactly', async () => {
    const { companyId, warehouseId, materialTypeId } = await makeCompanyAndWarehouse()
    await insertLedger({ entryType: 'PURCHASE_IN', quantity: 3.71, entryDate: '2024-07-12', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-CR-A' })
    await insertLedger({ entryType: 'PURCHASE_CANCEL', quantity: -3.71, entryDate: '2024-07-12', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-CR-A' })
    await insertLedger({ entryType: 'PURCHASE_CANCEL', quantity: -3.71, entryDate: '2024-07-12', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-CR-A' })
    await insertLedger({ entryType: 'PURCHASE_IN', quantity: 3.25, entryDate: '2024-07-16', companyId, warehouseId, materialTypeId, purchaseLineId: 'SYN-CR-B' })

    const { rows: viewRows } = await client.query(
      `SELECT current_stock FROM vw_current_warehouse_stock WHERE company_id = $1`, [companyId]
    )
    expect(Number(viewRows[0].current_stock)).toBeCloseTo(-0.46, 3)

    const { rows: [balance] } = await client.query(
      `SELECT fn_stock_balance_as_of($1, NULL, $2, $3, '2026-12-31') AS bal`,
      [materialTypeId, companyId, warehouseId]
    )
    expect(Number(balance.bal)).toBeCloseTo(-0.46, 3)

    // Both REC-001 (duplicate) and REC-005 (negative stock) must independently
    // catch this — the whole point of layering rules instead of relying on one.
    const { rows: dup } = await client.query(`SELECT * FROM fn_reconcile_rec_001($1, '2024-01-01', '2026-12-31')`, [companyId])
    const { rows: neg } = await client.query(`SELECT * FROM fn_reconcile_rec_005($1, '2024-01-01', '2026-12-31')`, [companyId])
    expect(dup.length).toBeGreaterThanOrEqual(1)
    expect(neg.length).toBeGreaterThanOrEqual(1)
  })
})

async function makeJobWorkOrder(companyId: string, warehouseId: string) {
  const { rows: [vendor] } = await client.query(`INSERT INTO suppliers (name) VALUES ('Vendor') RETURNING id`)
  const { rows: [order] } = await client.query(
    `INSERT INTO job_work_orders (reference_number, vendor_id, company_id, warehouse_id, dispatch_date, status)
     VALUES ($1, $2, $3, $4, '2024-06-01', 'dispatched') RETURNING id`,
    [`SYN-JW-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, vendor.id, companyId, warehouseId]
  )
  return { vendorId: vendor.id as string, orderId: order.id as string }
}

describe('REC-018 unbalanced vendor-held stock', () => {
  it('does not flag a vendor whose ledger and job_work_items balances agree', async () => {
    const { companyId, warehouseId, materialTypeId } = await makeCompanyAndWarehouse()
    const { vendorId, orderId } = await makeJobWorkOrder(companyId, warehouseId)
    // fn_job_work_item_to_ledger() auto-posts JOB_WORK_OUT on insert — the
    // ledger and job_work_items.quantity_sent start in agreement by
    // construction, same as the transfer-pair trigger discovered earlier.
    await client.query(
      `INSERT INTO job_work_items (job_work_order_id, material_type_id, quantity_sent) VALUES ($1, $2, 12.0)`,
      [orderId, materialTypeId]
    )
    const { rows } = await client.query(`SELECT * FROM fn_reconcile_rec_018($1, '2024-01-01', '2026-12-31')`, [companyId])
    const relevant = rows.filter((r: { source_document_id: string }) => r.source_document_id === vendorId)
    expect(relevant).toHaveLength(0)
  })

  it('flags a vendor where the ledger was edited directly without updating job_work_items (the /api/stock/ledger-entries admin-delete scenario)', async () => {
    const { companyId, warehouseId, materialTypeId } = await makeCompanyAndWarehouse()
    const { vendorId, orderId } = await makeJobWorkOrder(companyId, warehouseId)
    await client.query(
      `INSERT INTO job_work_items (job_work_order_id, material_type_id, quantity_sent) VALUES ($1, $2, 9.5)`,
      [orderId, materialTypeId]
    )
    // Simulate an admin directly deleting the ledger row via
    // /api/stock/ledger-entries (a real, supported capability in this app)
    // without touching job_work_items — job_work_items still says 9.5 is
    // held at the vendor; the ledger now says 0.
    await client.query(`DELETE FROM stock_ledger WHERE reference_type = 'job_work' AND reference_id = $1 AND entry_type = 'JOB_WORK_OUT'`, [orderId])

    const { rows } = await client.query(`SELECT * FROM fn_reconcile_rec_018($1, '2024-01-01', '2026-12-31')`, [companyId])
    const relevant = rows.filter((r: { source_document_id: string }) => r.source_document_id === vendorId)
    expect(relevant).toHaveLength(1)
    expect(Number(relevant[0].evidence.source_balance)).toBeCloseTo(9.5, 3)
    expect(Number(relevant[0].evidence.ledger_balance)).toBe(0)
  })
})
