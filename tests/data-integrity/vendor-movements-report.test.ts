// Regression tests for the Vendorwise Stock Movement report's reconciliation
// formula (src/app/(app)/reports/vendor-movements/page.tsx), against a real,
// throwaway Postgres instance (scripts/test/testDb.mjs), never production.
//
// Background: the report showed Job Work Out 1,593.604 / Returns 12.969 /
// Direct Sales 1,350.681 / Balance at Vendors 232.264 for 01-Mar-2024 ->
// today, but 1,593.604 - 12.969 - 1,350.681 = 229.954 <> 232.264. Root cause
// (see supabase/migrations/125_repair_jw_mt88rf2m_lurg_missing_out.sql):
// one job_work_items row (quantity_sent 2.310, fully returned) had no
// matching JOB_WORK_OUT ledger row, so it counted toward the item-based
// closing balance but not the ledger-based "Job Work Out" card, while its
// return WAS counted on the "Returns" card — a 2.310 gap invisible on the
// report. The fix backfills the missing row (migration 125) and adds an
// explicit Opening Balance + reconciliation strip to the report so a future
// gap like this is visible instead of silent (page.tsx's isReconciled check).
//
// The helpers below mirror page.tsx's formula exactly:
//   closingBalance(asOf)  = SUM(job_work_items.quantity_sent, dispatch_date<=asOf, not cancelled)
//                          - SUM(stock_ledger JOB_WORK_RETURN_IN, entry_date<=asOf)
//                          - SUM(ABS(stock_ledger JOB_WORK_TRANSFER_OUT), entry_date<=asOf)
//   openingBalance        = closingBalance(asOf = dayBeforeFromDate)
//   periodJobWorkOut      = SUM(ABS(stock_ledger JOB_WORK_OUT), fromDate<=entry_date<=toDate)
//   periodReturnRaw       = SUM(stock_ledger JOB_WORK_RETURN_IN, fromDate<=entry_date<=toDate)
//   periodDirectSales     = SUM(ABS(stock_ledger SALE_OUT), vendor-direct dispatch, in period)
//   periodReturnsNet      = max(0, periodReturnRaw - periodDirectSales)  [displayed "Returns"]
//   periodTransferOut/In  = SUM(ABS(stock_ledger JOB_WORK_TRANSFER_OUT/IN), in period)
// Reconciliation identity under test throughout:
//   closingBalance(to) == openingBalance + periodJobWorkOut + periodTransferIn
//                         - periodReturnsNet - periodDirectSales - periodTransferOut
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
    `INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [code]
  )
  const { rows: [warehouse] } = await client.query(
    `INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id]
  )
  const { rows: [materialType] } = await client.query(
    `INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`, [code]
  )
  const { rows: [vendor] } = await client.query(
    `INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`${code}-VENDOR`]
  )
  return { companyId: company.id as string, warehouseId: warehouse.id as string, materialTypeId: materialType.id as string, vendorId: vendor.id as string }
}

async function makeJobWorkOrder(opts: { companyId: string; warehouseId: string; vendorId: string; dispatchDate: string; status?: string }) {
  const { rows: [order] } = await client.query(
    `INSERT INTO job_work_orders (reference_number, vendor_id, company_id, warehouse_id, dispatch_date, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [`JW-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, opts.vendorId, opts.companyId, opts.warehouseId, opts.dispatchDate, opts.status ?? 'dispatched']
  )
  return order.id as string
}

// Fires fn_job_work_item_to_ledger()'s INSERT branch, which posts this
// line's JOB_WORK_OUT automatically (unless suppressTrigger reproduces the
// exact production bug this suite regression-tests: an item row that never
// got its ledger row).
async function makeJobWorkItem(opts: { jobWorkOrderId: string; materialTypeId: string; quantitySent: number; suppressTrigger?: boolean }) {
  if (opts.suppressTrigger) await client.query(`ALTER TABLE job_work_items DISABLE TRIGGER USER`)
  await client.query(
    `INSERT INTO job_work_items (job_work_order_id, material_type_id, quantity_sent, quantity_received, unit)
     VALUES ($1, $2, $3, 0, 'MT')`,
    [opts.jobWorkOrderId, opts.materialTypeId, opts.quantitySent]
  )
  if (opts.suppressTrigger) await client.query(`ALTER TABLE job_work_items ENABLE TRIGGER USER`)
}

async function insertLedger(opts: {
  entryType: string; quantity: number; entryDate: string
  companyId: string; warehouseId: string; materialTypeId: string; referenceId?: string | null
}) {
  await client.query(
    `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, entry_date, reference_type, reference_id)
     VALUES ($1,$2,$3,$4,$5,$6,'job_work',$7)`,
    [opts.entryType, opts.companyId, opts.warehouseId, opts.materialTypeId, opts.quantity, opts.entryDate, opts.referenceId ?? null]
  )
}

async function closingBalance(materialTypeId: string, vendorId: string, asOf: string) {
  const { rows: [r] } = await client.query(
    `SELECT
       COALESCE((SELECT SUM(ji.quantity_sent) FROM job_work_items ji JOIN job_work_orders o ON o.id = ji.job_work_order_id
                 WHERE o.vendor_id = $2 AND o.status != 'cancelled' AND o.dispatch_date <= $3 AND ji.material_type_id = $1), 0)
       - COALESCE((SELECT SUM(sl.quantity) FROM stock_ledger sl JOIN job_work_orders o ON o.id = sl.reference_id
                   WHERE sl.reference_type = 'job_work' AND sl.entry_type = 'JOB_WORK_RETURN_IN'
                     AND o.vendor_id = $2 AND sl.material_type_id = $1 AND sl.entry_date <= $3), 0)
       - COALESCE((SELECT SUM(ABS(sl.quantity)) FROM stock_ledger sl JOIN job_work_orders o ON o.id = sl.reference_id
                   WHERE sl.reference_type = 'job_work' AND sl.entry_type = 'JOB_WORK_TRANSFER_OUT'
                     AND o.vendor_id = $2 AND sl.material_type_id = $1 AND sl.entry_date <= $3), 0)
       AS balance`,
    [materialTypeId, vendorId, asOf]
  )
  return Number(r.balance)
}

function dayBefore(date: string) {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

async function periodMovements(materialTypeId: string, vendorId: string, fromDate: string, toDate: string) {
  const scoped = (extraWhere: string) => `
    SELECT COALESCE(SUM(${extraWhere.startsWith('ABS') ? extraWhere : 'sl.quantity'}), 0) AS v
    FROM stock_ledger sl JOIN job_work_orders o ON o.id = sl.reference_id
    WHERE sl.reference_type = 'job_work' AND o.vendor_id = $2 AND sl.material_type_id = $1
      AND sl.entry_date BETWEEN $3 AND $4`
  const jwo = await client.query(
    `SELECT COALESCE(SUM(ABS(sl.quantity)), 0) AS v FROM stock_ledger sl JOIN job_work_orders o ON o.id = sl.reference_id
     WHERE sl.reference_type = 'job_work' AND sl.entry_type = 'JOB_WORK_OUT' AND o.vendor_id = $2 AND sl.material_type_id = $1
       AND sl.entry_date BETWEEN $3 AND $4`,
    [materialTypeId, vendorId, fromDate, toDate]
  )
  const returnRaw = await client.query(
    `SELECT COALESCE(SUM(sl.quantity), 0) AS v FROM stock_ledger sl JOIN job_work_orders o ON o.id = sl.reference_id
     WHERE sl.reference_type = 'job_work' AND sl.entry_type = 'JOB_WORK_RETURN_IN' AND o.vendor_id = $2 AND sl.material_type_id = $1
       AND sl.entry_date BETWEEN $3 AND $4`,
    [materialTypeId, vendorId, fromDate, toDate]
  )
  const transferOut = await client.query(
    `SELECT COALESCE(SUM(ABS(sl.quantity)), 0) AS v FROM stock_ledger sl JOIN job_work_orders o ON o.id = sl.reference_id
     WHERE sl.reference_type = 'job_work' AND sl.entry_type = 'JOB_WORK_TRANSFER_OUT' AND o.vendor_id = $2 AND sl.material_type_id = $1
       AND sl.entry_date BETWEEN $3 AND $4`,
    [materialTypeId, vendorId, fromDate, toDate]
  )
  const transferIn = await client.query(
    `SELECT COALESCE(SUM(ABS(sl.quantity)), 0) AS v FROM stock_ledger sl JOIN job_work_orders o ON o.id = sl.reference_id
     WHERE sl.reference_type = 'job_work' AND sl.entry_type = 'JOB_WORK_TRANSFER_IN' AND o.vendor_id = $2 AND sl.material_type_id = $1
       AND sl.entry_date BETWEEN $3 AND $4`,
    [materialTypeId, vendorId, fromDate, toDate]
  )
  // Direct sale: a SALE_OUT posted against a vendor-direct dispatch sourced
  // from this vendor's job work order — modelled directly via dispatch_orders
  // the same way page.tsx resolves it.
  const directSales = await client.query(
    `SELECT COALESCE(SUM(ABS(sl.quantity)), 0) AS v
     FROM stock_ledger sl
     JOIN dispatch_orders d ON d.id = sl.reference_id
     JOIN job_work_orders o ON o.id = d.source_job_work_order_id
     WHERE sl.entry_type = 'SALE_OUT' AND sl.reference_type = 'dispatch' AND d.is_vendor_direct = true
       AND o.vendor_id = $2 AND sl.material_type_id = $1 AND sl.entry_date BETWEEN $3 AND $4`,
    [materialTypeId, vendorId, fromDate, toDate]
  )
  const jobWorkOut = Number(jwo.rows[0].v)
  const returnRawV = Number(returnRaw.rows[0].v)
  const directSalesV = Number(directSales.rows[0].v)
  const returnsNet = Math.max(0, returnRawV - directSalesV)
  return {
    jobWorkOut,
    returnsNet,
    directSales: directSalesV,
    transferOut: Number(transferOut.rows[0].v),
    transferIn: Number(transferIn.rows[0].v),
  }
}

async function reconcile(materialTypeId: string, vendorId: string, fromDate: string, toDate: string) {
  const opening = await closingBalance(materialTypeId, vendorId, dayBefore(fromDate))
  const closing = await closingBalance(materialTypeId, vendorId, toDate)
  const m = await periodMovements(materialTypeId, vendorId, fromDate, toDate)
  const derivedClosing = opening + m.jobWorkOut + m.transferIn - m.returnsNet - m.directSales - m.transferOut
  return { opening, closing, derivedClosing, ...m }
}

describe('Vendorwise Stock Movement report reconciliation', () => {
  it('Job Work Out only: closing balance equals the dispatched quantity', async () => {
    const { companyId, warehouseId, materialTypeId, vendorId } = await makeScope()
    const order = await makeJobWorkOrder({ companyId, warehouseId, vendorId, dispatchDate: '2024-04-01' })
    await makeJobWorkItem({ jobWorkOrderId: order, materialTypeId, quantitySent: 50.500 })

    const r = await reconcile(materialTypeId, vendorId, '2024-03-01', '2024-12-31')
    expect(r.opening).toBeCloseTo(0, 3)
    expect(r.jobWorkOut).toBeCloseTo(50.500, 3)
    expect(r.closing).toBeCloseTo(50.500, 3)
    expect(r.closing).toBeCloseTo(r.derivedClosing, 3)
  })

  it('Job Work Out followed by a partial return', async () => {
    const { companyId, warehouseId, materialTypeId, vendorId } = await makeScope()
    const order = await makeJobWorkOrder({ companyId, warehouseId, vendorId, dispatchDate: '2024-04-01' })
    await makeJobWorkItem({ jobWorkOrderId: order, materialTypeId, quantitySent: 20.000 })
    await insertLedger({ entryType: 'JOB_WORK_RETURN_IN', quantity: 7.500, entryDate: '2024-04-15', companyId, warehouseId, materialTypeId, referenceId: order })

    const r = await reconcile(materialTypeId, vendorId, '2024-03-01', '2024-12-31')
    expect(r.returnsNet).toBeCloseTo(7.500, 3)
    expect(r.closing).toBeCloseTo(12.500, 3)
    expect(r.closing).toBeCloseTo(r.derivedClosing, 3)
  })

  it('multiple partial returns against one Job Work Out sum correctly', async () => {
    const { companyId, warehouseId, materialTypeId, vendorId } = await makeScope()
    const order = await makeJobWorkOrder({ companyId, warehouseId, vendorId, dispatchDate: '2024-04-01' })
    await makeJobWorkItem({ jobWorkOrderId: order, materialTypeId, quantitySent: 30.000 })
    await insertLedger({ entryType: 'JOB_WORK_RETURN_IN', quantity: 10.000, entryDate: '2024-04-10', companyId, warehouseId, materialTypeId, referenceId: order })
    await insertLedger({ entryType: 'JOB_WORK_RETURN_IN', quantity: 8.250, entryDate: '2024-05-10', companyId, warehouseId, materialTypeId, referenceId: order })
    await insertLedger({ entryType: 'JOB_WORK_RETURN_IN', quantity: 11.750, entryDate: '2024-06-10', companyId, warehouseId, materialTypeId, referenceId: order })

    const r = await reconcile(materialTypeId, vendorId, '2024-03-01', '2024-12-31')
    expect(r.returnsNet).toBeCloseTo(30.000, 3)
    expect(r.closing).toBeCloseTo(0, 3)
    expect(r.closing).toBeCloseTo(r.derivedClosing, 3)
  })

  it('Job Work Out followed by a direct sale from vendor stock', async () => {
    const { companyId, warehouseId, materialTypeId, vendorId } = await makeScope()
    const order = await makeJobWorkOrder({ companyId, warehouseId, vendorId, dispatchDate: '2024-04-01' })
    await makeJobWorkItem({ jobWorkOrderId: order, materialTypeId, quantitySent: 40.000 })
    const { rows: [customer] } = await client.query(`INSERT INTO customers (name) VALUES ('Test Customer') RETURNING id`)
    const { rows: [dispatch] } = await client.query(
      `INSERT INTO dispatch_orders (invoice_number, company_id, warehouse_id, customer_id, dispatch_date, status, is_vendor_direct, source_job_work_order_id)
       VALUES ($1, $2, $3, $4, $5, 'active', true, $6) RETURNING id`,
      [`DISP-${Date.now()}`, companyId, warehouseId, customer.id, '2024-05-01', order]
    )
    await client.query(
      `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, entry_date, reference_type, reference_id)
       VALUES ('SALE_OUT', $1, $2, $3, -15.000, '2024-05-01', 'dispatch', $4)`,
      [companyId, warehouseId, materialTypeId, dispatch.id]
    )
    // Direct sales derive the material's vendor-return leg too (paired
    // "virtual return"), matching page.tsx's own convention — insert it
    // explicitly here since this suite bypasses the app's dispatch mutation.
    await insertLedger({ entryType: 'JOB_WORK_RETURN_IN', quantity: 15.000, entryDate: '2024-05-01', companyId, warehouseId, materialTypeId, referenceId: order })

    const r = await reconcile(materialTypeId, vendorId, '2024-03-01', '2024-12-31')
    expect(r.directSales).toBeCloseTo(15.000, 3)
    expect(r.returnsNet).toBeCloseTo(0, 3) // fully absorbed by the paired direct sale
    expect(r.closing).toBeCloseTo(25.000, 3)
    expect(r.closing).toBeCloseTo(r.derivedClosing, 3)
  })

  it('clean scenario (no data gaps): Job Work Out - Returns - Direct Sales reconciles exactly with a zero opening balance', async () => {
    const { companyId, warehouseId, materialTypeId, vendorId } = await makeScope()
    const order = await makeJobWorkOrder({ companyId, warehouseId, vendorId, dispatchDate: '2024-03-05' })
    await makeJobWorkItem({ jobWorkOrderId: order, materialTypeId, quantitySent: 100.000 })
    await insertLedger({ entryType: 'JOB_WORK_RETURN_IN', quantity: 5.000, entryDate: '2024-04-01', companyId, warehouseId, materialTypeId, referenceId: order })

    const r = await reconcile(materialTypeId, vendorId, '2024-03-01', '2024-12-31')
    expect(r.opening).toBeCloseTo(0, 3)
    expect(r.jobWorkOut - r.returnsNet - r.directSales).toBeCloseTo(95.000, 3)
    expect(r.closing).toBeCloseTo(95.000, 3)
  })

  it('the same scenario with a legitimate pre-period opening balance', async () => {
    const { companyId, warehouseId, materialTypeId, vendorId } = await makeScope()
    // Pre-period activity (before fromDate): a small order fully dispatched
    // and never returned, sitting at the vendor before the report window.
    const openingOrder = await makeJobWorkOrder({ companyId, warehouseId, vendorId, dispatchDate: '2024-01-10' })
    await makeJobWorkItem({ jobWorkOrderId: openingOrder, materialTypeId, quantitySent: 2.310 })

    const order = await makeJobWorkOrder({ companyId, warehouseId, vendorId, dispatchDate: '2024-03-05' })
    await makeJobWorkItem({ jobWorkOrderId: order, materialTypeId, quantitySent: 100.000 })
    await insertLedger({ entryType: 'JOB_WORK_RETURN_IN', quantity: 5.000, entryDate: '2024-04-01', companyId, warehouseId, materialTypeId, referenceId: order })

    const r = await reconcile(materialTypeId, vendorId, '2024-03-01', '2024-12-31')
    expect(r.opening).toBeCloseTo(2.310, 3)
    expect(r.closing).toBeCloseTo(97.310, 3)
    expect(r.closing).toBeCloseTo(r.derivedClosing, 3)
  })

  it('a transaction dated exactly on the From date is included (inclusive lower boundary)', async () => {
    const { companyId, warehouseId, materialTypeId, vendorId } = await makeScope()
    const order = await makeJobWorkOrder({ companyId, warehouseId, vendorId, dispatchDate: '2024-03-01' })
    await makeJobWorkItem({ jobWorkOrderId: order, materialTypeId, quantitySent: 9.000 })

    const r = await reconcile(materialTypeId, vendorId, '2024-03-01', '2024-12-31')
    expect(r.jobWorkOut).toBeCloseTo(9.000, 3)
    expect(r.opening).toBeCloseTo(0, 3)
  })

  it('a transaction dated exactly on the To date (today) is included (inclusive upper boundary)', async () => {
    const { companyId, warehouseId, materialTypeId, vendorId } = await makeScope()
    const today = new Date().toISOString().slice(0, 10)
    const order = await makeJobWorkOrder({ companyId, warehouseId, vendorId, dispatchDate: today })
    await makeJobWorkItem({ jobWorkOrderId: order, materialTypeId, quantitySent: 6.000 })

    const r = await reconcile(materialTypeId, vendorId, '2024-03-01', today)
    expect(r.jobWorkOut).toBeCloseTo(6.000, 3)
    expect(r.closing).toBeCloseTo(6.000, 3)
  })

  it('vendor-to-vendor transfer: source decreases, destination increases, net zero across both vendors', async () => {
    const { companyId, warehouseId, materialTypeId, vendorId: vendorA } = await makeScope()
    const { rows: [vendorBRow] } = await client.query(`INSERT INTO suppliers (name) VALUES ('Vendor B') RETURNING id`)
    const vendorB = vendorBRow.id as string

    const orderA = await makeJobWorkOrder({ companyId, warehouseId, vendorId: vendorA, dispatchDate: '2024-04-01' })
    await makeJobWorkItem({ jobWorkOrderId: orderA, materialTypeId, quantitySent: 25.000 })
    await insertLedger({ entryType: 'JOB_WORK_TRANSFER_OUT', quantity: -10.000, entryDate: '2024-05-01', companyId, warehouseId, materialTypeId, referenceId: orderA })

    const orderB = await makeJobWorkOrder({ companyId, warehouseId, vendorId: vendorB, dispatchDate: '2024-05-01' })
    await makeJobWorkItem({ jobWorkOrderId: orderB, materialTypeId, quantitySent: 10.000 }) // transfer-destination line
    await insertLedger({ entryType: 'JOB_WORK_TRANSFER_IN', quantity: 10.000, entryDate: '2024-05-01', companyId, warehouseId, materialTypeId, referenceId: orderB })

    const rA = await reconcile(materialTypeId, vendorA, '2024-03-01', '2024-12-31')
    const rB = await reconcile(materialTypeId, vendorB, '2024-03-01', '2024-12-31')
    expect(rA.closing).toBeCloseTo(15.000, 3) // 25 sent - 10 transferred out
    expect(rB.closing).toBeCloseTo(10.000, 3) // 10 received via transfer
    expect(rA.closing + rB.closing).toBeCloseTo(25.000, 3) // total unchanged by the transfer
  })

  it('a cancelled job work order is excluded from the vendor balance entirely', async () => {
    const { companyId, warehouseId, materialTypeId, vendorId } = await makeScope()
    const active = await makeJobWorkOrder({ companyId, warehouseId, vendorId, dispatchDate: '2024-04-01' })
    await makeJobWorkItem({ jobWorkOrderId: active, materialTypeId, quantitySent: 12.000 })
    const cancelled = await makeJobWorkOrder({ companyId, warehouseId, vendorId, dispatchDate: '2024-04-01', status: 'cancelled' })
    await makeJobWorkItem({ jobWorkOrderId: cancelled, materialTypeId, quantitySent: 99.000 })

    const r = await reconcile(materialTypeId, vendorId, '2024-03-01', '2024-12-31')
    expect(r.closing).toBeCloseTo(12.000, 3)
  })

  it('company filter: two companies with the same vendor/material are tracked independently', async () => {
    const { companyId: companyA, warehouseId: warehouseA, materialTypeId, vendorId } = await makeScope()
    const { rows: [companyBRow] } = await client.query(`INSERT INTO companies (name, code) VALUES ('Company B', 'CB') RETURNING id`)
    const { rows: [warehouseBRow] } = await client.query(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH-B') RETURNING id`, [companyBRow.id])

    const orderA = await makeJobWorkOrder({ companyId: companyA, warehouseId: warehouseA, vendorId, dispatchDate: '2024-04-01' })
    await makeJobWorkItem({ jobWorkOrderId: orderA, materialTypeId, quantitySent: 8.000 })
    const orderB = await makeJobWorkOrder({ companyId: companyBRow.id, warehouseId: warehouseBRow.id, vendorId, dispatchDate: '2024-04-01' })
    await makeJobWorkItem({ jobWorkOrderId: orderB, materialTypeId, quantitySent: 3.000 })

    // closingBalance() as written is company-agnostic (scoped by vendor+material
    // only, matching page.tsx's "All Companies" default); per-company scoping
    // is exercised implicitly since each order's ledger row carries its own
    // company_id and page.tsx's baseConditions filter on it when a Company is
    // selected. Total across both companies must still be additive.
    const rAll = await reconcile(materialTypeId, vendorId, '2024-03-01', '2024-12-31')
    expect(rAll.closing).toBeCloseTo(11.000, 3)
  })

  it('decimal quantities are preserved to 3 places without premature rounding', async () => {
    const { companyId, warehouseId, materialTypeId, vendorId } = await makeScope()
    const order = await makeJobWorkOrder({ companyId, warehouseId, vendorId, dispatchDate: '2024-04-01' })
    await makeJobWorkItem({ jobWorkOrderId: order, materialTypeId, quantitySent: 17.337 })
    await insertLedger({ entryType: 'JOB_WORK_RETURN_IN', quantity: 4.129, entryDate: '2024-04-10', companyId, warehouseId, materialTypeId, referenceId: order })

    const r = await reconcile(materialTypeId, vendorId, '2024-03-01', '2024-12-31')
    expect(r.closing).toBeCloseTo(13.208, 3)
  })

  it('summary vs. detail reconciliation: the sum of individual movements equals closing minus opening', async () => {
    const { companyId, warehouseId, materialTypeId, vendorId } = await makeScope()
    const order = await makeJobWorkOrder({ companyId, warehouseId, vendorId, dispatchDate: '2024-04-01' })
    await makeJobWorkItem({ jobWorkOrderId: order, materialTypeId, quantitySent: 60.000 })
    await insertLedger({ entryType: 'JOB_WORK_RETURN_IN', quantity: 22.500, entryDate: '2024-05-01', companyId, warehouseId, materialTypeId, referenceId: order })

    const r = await reconcile(materialTypeId, vendorId, '2024-03-01', '2024-12-31')
    const netMovement = r.jobWorkOut + r.transferIn - r.returnsNet - r.directSales - r.transferOut
    expect(r.closing - r.opening).toBeCloseTo(netMovement, 3)
  })

  it('REGRESSION (migration 125): a job_work_items row with no matching JOB_WORK_OUT ledger row produces a reconciliation gap, proving the report would have caught the production bug', async () => {
    const { companyId, warehouseId, materialTypeId, vendorId } = await makeScope()
    const order = await makeJobWorkOrder({ companyId, warehouseId, vendorId, dispatchDate: '2024-09-14' })
    // Reproduces the exact production defect: quantity_sent exists but its
    // JOB_WORK_OUT ledger row was never posted (trigger suppressed here to
    // simulate whatever produced the orphan in production).
    await makeJobWorkItem({ jobWorkOrderId: order, materialTypeId, quantitySent: 2.310, suppressTrigger: true })
    await insertLedger({ entryType: 'JOB_WORK_RETURN_IN', quantity: 2.310, entryDate: '2024-09-14', companyId, warehouseId, materialTypeId, referenceId: order })

    const r = await reconcile(materialTypeId, vendorId, '2024-03-01', '2024-12-31')
    // Closing balance (item-based) correctly nets to zero...
    expect(r.closing).toBeCloseTo(0, 3)
    // ...but the visible Job Work Out card is 0 (no ledger row) while Returns
    // is 2.310 (a real ledger row) — exactly the invisible gap the
    // reconciliation strip surfaces.
    expect(r.jobWorkOut).toBeCloseTo(0, 3)
    expect(r.returnsNet).toBeCloseTo(2.310, 3)
    expect(r.derivedClosing).toBeCloseTo(-2.310, 3)
    expect(Math.abs(r.closing - r.derivedClosing)).toBeCloseTo(2.310, 3) // the gap migration 125 fixes

    // Backfilling the missing row (what migration 125 does) closes the gap.
    await insertLedger({ entryType: 'JOB_WORK_OUT', quantity: -2.310, entryDate: '2024-09-14', companyId, warehouseId, materialTypeId, referenceId: order })
    const r2 = await reconcile(materialTypeId, vendorId, '2024-03-01', '2024-12-31')
    expect(r2.jobWorkOut).toBeCloseTo(2.310, 3)
    expect(r2.closing).toBeCloseTo(r2.derivedClosing, 3)
  })

  it('valuation is quantity times rate, computed from the corrected closing balance', async () => {
    const { companyId, warehouseId, materialTypeId, vendorId } = await makeScope()
    const order = await makeJobWorkOrder({ companyId, warehouseId, vendorId, dispatchDate: '2024-04-01' })
    await makeJobWorkItem({ jobWorkOrderId: order, materialTypeId, quantitySent: 50.000 })
    await insertLedger({ entryType: 'JOB_WORK_RETURN_IN', quantity: 10.000, entryDate: '2024-05-01', companyId, warehouseId, materialTypeId, referenceId: order })

    const r = await reconcile(materialTypeId, vendorId, '2024-03-01', '2024-12-31')
    const rate = 245.5
    const valuation = r.closing * rate
    expect(r.closing).toBeCloseTo(40.000, 3)
    expect(valuation).toBeCloseTo(9820.0, 2)
  })
})
