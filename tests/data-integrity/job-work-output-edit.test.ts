// Regression test for migration 136: editing a Job Work Order used to
// re-post a no-op JOB_WORK_CANCEL + JOB_WORK_OUTPUT_IN pair into
// stock_ledger for every existing output line on every save, even when
// nothing about that line changed — because edit_job_work_order() always
// issues a plain UPDATE for every output row present in the save payload,
// and fn_job_work_output_item_to_ledger()'s UPDATE branch had no guard
// against that. Found via JW-MTBHDLZV-H92K, where an output row edited
// twice produced duplicate-looking ledger entries that had to be deleted
// by hand. See supabase/migrations/136_fix_job_work_output_edit_duplicate_ledger.sql.
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

async function setupOrder() {
  const code = `JT${Date.now().toString(36).slice(-8)}`.toUpperCase()
  const { rows: [company] } = await client.query(
    `INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [code]
  )
  const { rows: [warehouse] } = await client.query(
    `INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id]
  )
  const { rows: [supplier] } = await client.query(
    `INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [code]
  )
  const { rows: [materialType] } = await client.query(
    `INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`, [code]
  )
  const { rows: [order] } = await client.query(
    `INSERT INTO job_work_orders (reference_number, vendor_id, company_id, warehouse_id, dispatch_date)
     VALUES ($1, $2, $3, $4, '2024-01-01') RETURNING id`,
    [`JW-${code}`, supplier.id, company.id, warehouse.id]
  )
  await client.query(
    `INSERT INTO job_work_items (job_work_order_id, material_type_id, quantity_sent, unit)
     VALUES ($1, $2, 5.000, 'MT')`,
    [order.id, materialType.id]
  )
  const { rows: [output] } = await client.query(
    `INSERT INTO job_work_output_items (job_work_order_id, material_type_id, quantity, unit)
     VALUES ($1, $2, 3.745, 'MT') RETURNING id`,
    [order.id, materialType.id]
  )
  return { orderId: order.id as string, outputId: output.id as string }
}

async function ledgerCounts(orderId: string) {
  const { rows } = await client.query(
    `SELECT entry_type, count(*)::int AS n, COALESCE(sum(quantity), 0)::numeric AS total
     FROM stock_ledger
     WHERE reference_type = 'job_work' AND reference_id = $1
       AND entry_type IN ('JOB_WORK_OUTPUT_IN', 'JOB_WORK_CANCEL')
     GROUP BY entry_type`,
    [orderId]
  )
  const byType: Record<string, { n: number; total: number }> = {}
  for (const r of rows) byType[r.entry_type] = { n: r.n, total: Number(r.total) }
  return byType
}

describe('fn_job_work_output_item_to_ledger — edit idempotency (migration 136)', () => {
  it('re-saving an output row with identical values posts nothing new', async () => {
    const { orderId, outputId } = await setupOrder()

    let counts = await ledgerCounts(orderId)
    expect(counts.JOB_WORK_OUTPUT_IN?.n).toBe(1)
    expect(counts.JOB_WORK_OUTPUT_IN?.total).toBe(3.745)
    expect(counts.JOB_WORK_CANCEL).toBeUndefined()

    // Exactly what edit_job_work_order() does on every save for every
    // existing output row: an unconditional UPDATE with the loaded values.
    await client.query(
      `UPDATE job_work_output_items
       SET material_type_id = material_type_id, material_size_id = material_size_id,
           size_label = size_label, quantity = quantity, unit = unit,
           received_date = received_date, updated_at = NOW()
       WHERE id = $1`,
      [outputId]
    )
    await client.query(
      `UPDATE job_work_output_items
       SET material_type_id = material_type_id, material_size_id = material_size_id,
           size_label = size_label, quantity = quantity, unit = unit,
           received_date = received_date, updated_at = NOW()
       WHERE id = $1`,
      [outputId]
    )

    counts = await ledgerCounts(orderId)
    expect(counts.JOB_WORK_OUTPUT_IN?.n).toBe(1)
    expect(counts.JOB_WORK_OUTPUT_IN?.total).toBe(3.745)
    expect(counts.JOB_WORK_CANCEL).toBeUndefined()
  })

  it('a real quantity change still reverses the old posting and reposts the new one', async () => {
    const { orderId, outputId } = await setupOrder()

    await client.query(`UPDATE job_work_output_items SET quantity = 4.500 WHERE id = $1`, [outputId])

    const counts = await ledgerCounts(orderId)
    expect(counts.JOB_WORK_OUTPUT_IN?.n).toBe(2) // original 3.745 + fresh 4.500
    expect(counts.JOB_WORK_CANCEL?.n).toBe(1) // reversal of the original 3.745
    expect(counts.JOB_WORK_OUTPUT_IN!.total + counts.JOB_WORK_CANCEL!.total).toBeCloseTo(4.500, 6)
  })
})
