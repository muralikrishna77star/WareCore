// Migration 161: rows of a staged purchase import batch can be skipped.
// Skipped rows don't have to be valid or reviewed, never become bill lines,
// and the rest of the batch still imports all-or-nothing. Unit tests for
// selectRowsForImport() plus an end-to-end run against the real schema on a
// throwaway Postgres (same technique as finalImport.test.ts).
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { startTestDb } from '../../scripts/test/testDb.mjs'
import { resolveImport, resolveRowIndependent } from '../../src/lib/purchaseImport/resolve'
import { buildInsertScript } from '../../src/lib/purchaseImport/buildInsertScript'
import { buildStageInsertScript, type StagedRowInput } from '../../src/lib/purchaseImport/buildStageInsertScript'
import { selectRowsForImport, type StagingRowRecord } from '../../src/lib/purchaseImport/db'
import type { MasterDataSnapshot, ParsedRow } from '../../src/lib/purchaseImport/types'

function stagingRow(overrides: Partial<StagingRowRecord>): StagingRowRecord {
  return {
    id: randomUUID(), batch_id: 'b', row_number: 2,
    raw_data: {} as ParsedRow, current_data: {} as ParsedRow,
    resolved_field_ids: null, validation_errors: [], is_valid: true, reviewed: true,
    reviewed_by: null, reviewed_at: null, correction_history: [], created_at: '', updated_at: '',
    purchase_bill_id: null, purchase_bill_number: null,
    excluded: false, excluded_by: null, excluded_at: null, exclusion_reason: null,
    ...overrides,
  }
}

describe('selectRowsForImport()', () => {
  it('an invalid, unreviewed row no longer blocks the import once it is skipped', () => {
    const rows = [stagingRow({}), stagingRow({ is_valid: false, reviewed: false, excluded: true })]
    const r = selectRowsForImport(rows)
    expect(r.included).toHaveLength(1)
    expect(r.skipped).toHaveLength(1)
    expect(r.readyToImport).toBe(true)
  })

  it('the rows that are not skipped must still all be valid and reviewed', () => {
    const r = selectRowsForImport([stagingRow({}), stagingRow({ reviewed: false })])
    expect(r.readyToImport).toBe(false)
    expect(r.notReady).toHaveLength(1)
  })

  it('a batch whose every row is skipped is not importable', () => {
    expect(selectRowsForImport([stagingRow({ excluded: true })]).readyToImport).toBe(false)
  })
})

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

describe('import with skipped rows (against the real schema)', () => {
  it('imports only the rows that are not skipped; a bill whose rows are all skipped is never created', async () => {
    const code = 'SKP1'
    const { rows: [company] } = await client.query(`INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [code])
    const { rows: [warehouse] } = await client.query(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id])
    const { rows: [supplier] } = await client.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`${code}-supplier`])
    const { rows: [materialType] } = await client.query(`INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'tons') RETURNING id`, [code])
    const snapshot: MasterDataSnapshot = {
      companies: [{ id: company.id, name: code, code }],
      warehouses: [{ id: warehouse.id, name: 'WH', company_id: company.id }],
      suppliers: [{ id: supplier.id, name: `${code}-supplier` }],
      materialTypes: [{ id: materialType.id, code, description: code, unit: 'tons' }],
      materialSizes: [], taxRates: [], existingBillNumbers: [], existingLineIds: [], itemMaster: [],
    }
    const base: ParsedRow = {
      rowNumber: 2, company: code, warehouse: 'WH', supplier: `${code}-supplier`,
      billDate: '2024-11-15', billDateRaw: '2024-11-15', billRef: '', materialType: code, size: '',
      quantity: 10, quantityRaw: '10', unit: '', rate: 55000, rateRaw: '55000', taxRate: '', lineNotes: '', billNotes: '',
    }
    const parsed: ParsedRow[] = [
      { ...base, rowNumber: 2 },                                                       // bill A, line 1 — imported
      { ...base, rowNumber: 3, quantity: 4, quantityRaw: '4' },                         // bill A, line 2 — skipped
      { ...base, rowNumber: 4, billDate: '2024-11-20', billDateRaw: '2024-11-20' },     // bill B — skipped
      { ...base, rowNumber: 5, supplier: 'No Such Supplier' },                          // invalid — skipped
    ]
    const staged: StagedRowInput[] = parsed.map((r) => ({ rowNumber: r.rowNumber, parsedRow: r, resolution: resolveRowIndependent(r, snapshot) }))
    const batchId = randomUUID()
    await client.query(buildStageInsertScript({ id: batchId, fileName: 'skip.xlsx', fileHash: randomUUID(), fileSizeBytes: 1, rowCount: parsed.length, createdBy: null }, staged))
    await client.query(`UPDATE purchase_import_rows SET reviewed = true, reviewed_at = NOW() WHERE batch_id = $1 AND is_valid`, [batchId])
    // Same statement the exclude route runs.
    await client.query(
      `UPDATE purchase_import_rows SET excluded = true, excluded_at = NOW(), exclusion_reason = 'Not ours'
       WHERE batch_id = $1 AND row_number IN (3, 4, 5)`,
      [batchId]
    )

    const { rows: dbRows } = await client.query(`SELECT * FROM purchase_import_rows WHERE batch_id = $1 ORDER BY row_number`, [batchId])
    const records = dbRows.map((r) => stagingRow({ id: r.id, row_number: r.row_number, current_data: r.current_data, is_valid: r.is_valid, reviewed: r.reviewed, excluded: r.excluded }))
    const { included, skipped, readyToImport } = selectRowsForImport(records)
    expect(readyToImport).toBe(true)
    expect(skipped.map((r) => r.row_number)).toEqual([3, 4, 5])

    const { bills, errors } = resolveImport(included.map((r) => r.current_data), snapshot)
    expect(errors).toHaveLength(0)
    expect(bills).toHaveLength(1)
    expect(bills[0].lines.map((l) => l.rowNumber)).toEqual([2])

    const billsWithIds = bills.map((b) => ({ ...b, id: randomUUID() }))
    await client.query(buildInsertScript(billsWithIds, null))
    const { rows: lines } = await client.query(
      `SELECT quantity FROM purchase_bill_items WHERE bill_id = $1`, [billsWithIds[0].id]
    )
    expect(lines.map((l) => Number(l.quantity))).toEqual([10])
    const { rows: billsOnB } = await client.query(
      `SELECT count(*)::int AS n FROM purchase_bills WHERE supplier_id = $1 AND bill_date = '2024-11-20'`, [supplier.id]
    )
    expect(billsOnB[0].n).toBe(0)
  })
})
