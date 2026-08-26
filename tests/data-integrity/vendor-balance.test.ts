// Regression tests for vw_current_vendor_stock / fn_vendor_balance_as_of
// (supabase/migrations/087/090/123) — the canonical "how much stock does a
// job-work vendor currently hold" calculation, against a real, throwaway
// Postgres instance (scripts/test/testDb.mjs), never against production.
//
// Mandatory fixture (see the Item Stock Ledger bug report this migration
// fixes): Purchase 12.350, Job Work Out 3.970, Job Work Return 3.840 via an
// Output Materials line of the SAME item (no conversion) — expected
// warehouse balance 12.220, vendor balance 0.130, overall 12.350.
//
// Note: inserting a job_work_items row fires fn_job_work_item_to_ledger()'s
// INSERT branch, which posts that row's JOB_WORK_OUT automatically from
// quantity_sent — tests below never also insert JOB_WORK_OUT by hand (that
// would double-post it). quantity_received is left at 0 on insert since the
// trigger's INSERT branch doesn't act on it; only the row's *existence*
// with a matching material_type_id/material_size_id matters to the views
// under test here, which is why JOB_WORK_OUTPUT_IN is still posted by hand.
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
async function makeScope() {
  seq += 1
  const code = `V${seq}${Date.now().toString(36).slice(-4)}`.toUpperCase().slice(0, 10)
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
  const { rows: [vendor] } = await client.query(
    `INSERT INTO suppliers (name) VALUES ($1) RETURNING id`,
    [`${code}-VENDOR`]
  )
  return { companyId: company.id as string, warehouseId: warehouse.id as string, materialTypeId: materialType.id as string, vendorId: vendor.id as string }
}

async function makeJobWorkOrder(opts: { companyId: string; warehouseId: string; vendorId: string; dispatchDate: string }) {
  const { rows: [order] } = await client.query(
    `INSERT INTO job_work_orders (reference_number, vendor_id, company_id, warehouse_id, dispatch_date, status)
     VALUES ($1, $2, $3, $4, $5, 'dispatched') RETURNING id`,
    [`JW-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, opts.vendorId, opts.companyId, opts.warehouseId, opts.dispatchDate]
  )
  return order.id as string
}

// Fires fn_job_work_item_to_ledger()'s INSERT branch, which posts this
// line's JOB_WORK_OUT automatically — never insert JOB_WORK_OUT by hand
// alongside this helper.
async function makeJobWorkItem(opts: { jobWorkOrderId: string; materialTypeId: string; quantitySent: number }) {
  await client.query(
    `INSERT INTO job_work_items (job_work_order_id, material_type_id, quantity_sent, quantity_received, unit)
     VALUES ($1, $2, $3, 0, 'MT')`,
    [opts.jobWorkOrderId, opts.materialTypeId, opts.quantitySent]
  )
}

async function insertLedger(opts: {
  entryType: string
  quantity: number
  entryDate: string
  companyId: string
  warehouseId: string
  materialTypeId: string
  referenceId?: string | null
}) {
  await client.query(
    `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, entry_date, reference_type, reference_id)
     VALUES ($1,$2,$3,$4,$5,$6,'job_work',$7)`,
    [opts.entryType, opts.companyId, opts.warehouseId, opts.materialTypeId, opts.quantity, opts.entryDate, opts.referenceId ?? null]
  )
}

async function vendorStock(materialTypeId: string) {
  const { rows } = await client.query(
    `SELECT current_vendor_stock FROM vw_current_vendor_stock WHERE material_type_id = $1`,
    [materialTypeId]
  )
  return rows[0] ? Number(rows[0].current_vendor_stock) : 0
}

async function warehouseStock(materialTypeId: string) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(quantity), 0) AS total FROM stock_ledger WHERE material_type_id = $1`,
    [materialTypeId]
  )
  return Number(rows[0].total)
}

describe('vw_current_vendor_stock — same-material Job Work Output In (123)', () => {
  it('mandatory fixture: Purchase 12.350, Job Work Out 3.970, same-item Output In 3.840 → warehouse 12.220, vendor 0.130, overall 12.350', async () => {
    const { companyId, warehouseId, materialTypeId, vendorId } = await makeScope()
    const order = await makeJobWorkOrder({ companyId, warehouseId, vendorId, dispatchDate: '2024-09-04' })
    // The order's own input line (auto-posts JOB_WORK_OUT -3.970) is what
    // makes the later JOB_WORK_OUTPUT_IN row a same-material return.
    await makeJobWorkItem({ jobWorkOrderId: order, materialTypeId, quantitySent: 3.970 })

    await insertLedger({ entryType: 'PURCHASE_IN', quantity: 12.350, entryDate: '2024-08-01', companyId, warehouseId, materialTypeId })
    await insertLedger({ entryType: 'JOB_WORK_OUTPUT_IN', quantity: 3.840, entryDate: '2024-09-12', companyId, warehouseId, materialTypeId, referenceId: order })

    const warehouse = await warehouseStock(materialTypeId)
    const vendor = await vendorStock(materialTypeId)
    expect(warehouse).toBeCloseTo(12.220, 3)
    expect(vendor).toBeCloseTo(0.130, 3)
    expect(warehouse + vendor).toBeCloseTo(12.350, 3)
  })

  it('a genuinely different output item is NOT swept into the input item\'s vendor balance', async () => {
    const { companyId, warehouseId, materialTypeId, vendorId } = await makeScope()
    const { rows: [outputMaterialType] } = await client.query(
      `INSERT INTO material_types (code, description, unit) VALUES ('OUT-CONV', 'Converted Output', 'MT') RETURNING id`
    )
    const order = await makeJobWorkOrder({ companyId, warehouseId, vendorId, dispatchDate: '2024-09-04' })
    // Input line is the raw material; the order never has an input line for
    // the converted output's material — a genuine conversion, not a return.
    await makeJobWorkItem({ jobWorkOrderId: order, materialTypeId, quantitySent: 5.0 })

    await insertLedger({ entryType: 'JOB_WORK_OUTPUT_IN', quantity: 4.5, entryDate: '2024-09-12', companyId, warehouseId, materialTypeId: outputMaterialType.id, referenceId: order })

    // The raw material sent out is still fully with the vendor — the
    // conversion output doesn't reduce it.
    expect(await vendorStock(materialTypeId)).toBeCloseTo(5.0, 3)
    // The converted output item was never sent to a vendor at all, so it
    // must never show a vendor balance of its own.
    expect(await vendorStock(outputMaterialType.id)).toBeCloseTo(0, 3)
  })

  it('multiple partial same-item returns net down to zero after the full quantity comes back', async () => {
    const { companyId, warehouseId, materialTypeId, vendorId } = await makeScope()
    const order = await makeJobWorkOrder({ companyId, warehouseId, vendorId, dispatchDate: '2024-06-01' })
    await makeJobWorkItem({ jobWorkOrderId: order, materialTypeId, quantitySent: 10.0 })

    await insertLedger({ entryType: 'JOB_WORK_OUTPUT_IN', quantity: 4.0, entryDate: '2024-06-10', companyId, warehouseId, materialTypeId, referenceId: order })
    expect(await vendorStock(materialTypeId)).toBeCloseTo(6.0, 3)

    await insertLedger({ entryType: 'JOB_WORK_OUTPUT_IN', quantity: 6.0, entryDate: '2024-06-20', companyId, warehouseId, materialTypeId, referenceId: order })
    expect(await vendorStock(materialTypeId)).toBeCloseTo(0, 3)
  })

  it('two vendors holding the same material are tracked independently', async () => {
    const { companyId, warehouseId, materialTypeId, vendorId: vendorA } = await makeScope()
    const { rows: [vendorBRow] } = await client.query(`INSERT INTO suppliers (name) VALUES ('Vendor B') RETURNING id`)
    const vendorB = vendorBRow.id as string

    const orderA = await makeJobWorkOrder({ companyId, warehouseId, vendorId: vendorA, dispatchDate: '2024-05-01' })
    await makeJobWorkItem({ jobWorkOrderId: orderA, materialTypeId, quantitySent: 2.0 })

    const orderB = await makeJobWorkOrder({ companyId, warehouseId, vendorId: vendorB, dispatchDate: '2024-05-02' })
    await makeJobWorkItem({ jobWorkOrderId: orderB, materialTypeId, quantitySent: 7.0 })

    const { rows } = await client.query(
      `SELECT vendor_id, current_vendor_stock FROM vw_current_vendor_stock WHERE material_type_id = $1 ORDER BY current_vendor_stock`,
      [materialTypeId]
    )
    expect(rows).toHaveLength(2)
    expect(Number(rows.find((r) => r.vendor_id === vendorA)?.current_vendor_stock)).toBeCloseTo(2.0, 3)
    expect(Number(rows.find((r) => r.vendor_id === vendorB)?.current_vendor_stock)).toBeCloseTo(7.0, 3)
  })
})

describe('fn_vendor_balance_as_of (123)', () => {
  it('matches vw_current_vendor_stock at a point in time and reflects backdated same-item returns', async () => {
    const { companyId, warehouseId, materialTypeId, vendorId } = await makeScope()
    const order = await makeJobWorkOrder({ companyId, warehouseId, vendorId, dispatchDate: '2024-07-01' })
    await makeJobWorkItem({ jobWorkOrderId: order, materialTypeId, quantitySent: 8.0 })

    await insertLedger({ entryType: 'JOB_WORK_OUTPUT_IN', quantity: 3.0, entryDate: '2024-07-10', companyId, warehouseId, materialTypeId, referenceId: order })

    const asOfBeforeReturn = await client.query(
      `SELECT fn_vendor_balance_as_of($1::uuid, NULL, $2::uuid, '2024-07-05'::date) AS bal`,
      [materialTypeId, companyId]
    )
    expect(Number(asOfBeforeReturn.rows[0].bal)).toBeCloseTo(8.0, 3)

    const asOfAfterReturn = await client.query(
      `SELECT fn_vendor_balance_as_of($1::uuid, NULL, $2::uuid, '2024-07-31'::date) AS bal`,
      [materialTypeId, companyId]
    )
    expect(Number(asOfAfterReturn.rows[0].bal)).toBeCloseTo(5.0, 3)
    expect(Number(asOfAfterReturn.rows[0].bal)).toBeCloseTo(await vendorStock(materialTypeId), 3)
  })
})
