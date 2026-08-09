// Integration tests for staging a batch: buildStageInsertScript()'s
// atomicity, and the duplicate-file-hash lookup the create-batch route
// relies on. Same LOCAL_MODE embedded-Postgres pattern as
// tests/purchaseImport/commit.test.ts and tests/data-integrity/*.test.ts.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { startTestDb } from '../../scripts/test/testDb.mjs'
import { resolveRowIndependent } from '../../src/lib/purchaseImport/resolve'
import { buildStageInsertScript, type StagedRowInput } from '../../src/lib/purchaseImport/buildStageInsertScript'
import type { MasterDataSnapshot, ParsedRow } from '../../src/lib/purchaseImport/types'

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

async function seedMasterData(code: string) {
  const { rows: [company] } = await client.query(`INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [code])
  const { rows: [warehouse] } = await client.query(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id])
  const { rows: [supplier] } = await client.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`${code}-supplier`])
  const { rows: [materialType] } = await client.query(
    `INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'tons') RETURNING id`, [code]
  )
  const snapshot: MasterDataSnapshot = {
    companies: [{ id: company.id, name: code, code }],
    warehouses: [{ id: warehouse.id, name: 'WH', company_id: company.id }],
    suppliers: [{ id: supplier.id, name: `${code}-supplier` }],
    materialTypes: [{ id: materialType.id, code, description: code, unit: 'tons' }],
    materialSizes: [],
    taxRates: [],
    existingBillNumbers: [],
    existingLineIds: [],
  }
  return snapshot
}

function row(snapshot: MasterDataSnapshot, overrides: Partial<ParsedRow> = {}, rowNumber = 2): ParsedRow {
  return {
    rowNumber,
    company: snapshot.companies[0].name, warehouse: snapshot.warehouses[0].name, supplier: snapshot.suppliers[0].name,
    billDate: '2024-04-15', billDateRaw: '2024-04-15', billRef: '',
    materialType: snapshot.materialTypes[0].code, size: '',
    quantity: 10, quantityRaw: '10',
    unit: '', rate: 55000, rateRaw: '55000',
    taxRate: '', lineNotes: '', billNotes: '',
    ...overrides,
  }
}

describe('staging a batch', () => {
  it('creates a batch and its rows atomically, correctly persisting is_valid and multi-field validation_errors', async () => {
    const snapshot = await seedMasterData('BAT1')
    const goodRow = row(snapshot, {}, 2)
    const badRow = row(snapshot, { company: 'Nonexistent Co', quantity: 0, quantityRaw: '0' }, 3)

    const staged: StagedRowInput[] = [
      { rowNumber: 2, parsedRow: goodRow, resolution: resolveRowIndependent(goodRow, snapshot) },
      { rowNumber: 3, parsedRow: badRow, resolution: resolveRowIndependent(badRow, snapshot) },
    ]

    const batchId = randomUUID()
    await client.query(
      buildStageInsertScript({ id: batchId, fileName: 'test.xlsx', fileHash: 'hash-bat1', fileSizeBytes: 100, rowCount: 2, createdBy: null }, staged)
    )

    const { rows: batchRows } = await client.query(`SELECT * FROM purchase_import_batches WHERE id = $1`, [batchId])
    expect(batchRows).toHaveLength(1)
    expect(batchRows[0].status).toBe('STAGED')
    expect(batchRows[0].row_count).toBe(2)

    const { rows: stagingRows } = await client.query(`SELECT * FROM purchase_import_rows WHERE batch_id = $1 ORDER BY row_number`, [batchId])
    expect(stagingRows).toHaveLength(2)
    expect(stagingRows[0].is_valid).toBe(true)
    expect(stagingRows[0].validation_errors).toEqual([])
    expect(stagingRows[1].is_valid).toBe(false)
    // Both the bad Company AND the bad Quantity should be reported — the
    // whole point of resolveRowIndependent() over the bail-early resolver.
    const columns = stagingRows[1].validation_errors.map((e: { column?: string }) => e.column)
    expect(columns).toContain('Company')
    expect(columns).toContain('Quantity')
  })

  it('the duplicate-file-hash lookup finds a prior batch with the same hash regardless of its status', async () => {
    const snapshot = await seedMasterData('BAT2')
    const r = row(snapshot, {}, 2)
    const staged: StagedRowInput[] = [{ rowNumber: 2, parsedRow: r, resolution: resolveRowIndependent(r, snapshot) }]

    const firstBatchId = randomUUID()
    await client.query(
      buildStageInsertScript({ id: firstBatchId, fileName: 'dup.xlsx', fileHash: 'shared-hash', fileSizeBytes: 50, rowCount: 1, createdBy: null }, staged)
    )
    // Simulate the first batch having already been imported.
    await client.query(`UPDATE purchase_import_batches SET status = 'IMPORTED' WHERE id = $1`, [firstBatchId])

    const { rows: matches } = await client.query(
      `SELECT id, batch_number, status FROM purchase_import_batches WHERE file_hash = $1 ORDER BY created_at DESC`,
      ['shared-hash']
    )
    expect(matches).toHaveLength(1)
    expect(matches[0].id).toBe(firstBatchId)
    expect(matches[0].status).toBe('IMPORTED') // the case that matters most — re-uploading an already-imported file must be caught
  })

  it('records duplicate_of_batch_id when a duplicate upload is explicitly confirmed', async () => {
    const snapshot = await seedMasterData('BAT3')
    const r = row(snapshot, {}, 2)
    const staged: StagedRowInput[] = [{ rowNumber: 2, parsedRow: r, resolution: resolveRowIndependent(r, snapshot) }]

    const firstBatchId = randomUUID()
    await client.query(buildStageInsertScript({ id: firstBatchId, fileName: 'a.xlsx', fileHash: 'hash-bat3', fileSizeBytes: 1, rowCount: 1, createdBy: null }, staged))

    const secondBatchId = randomUUID()
    await client.query(
      buildStageInsertScript({ id: secondBatchId, fileName: 'a.xlsx', fileHash: 'hash-bat3', fileSizeBytes: 1, rowCount: 1, createdBy: null, duplicateOfBatchId: firstBatchId }, staged)
    )

    const { rows } = await client.query(`SELECT duplicate_of_batch_id FROM purchase_import_batches WHERE id = $1`, [secondBatchId])
    expect(rows[0].duplicate_of_batch_id).toBe(firstBatchId)
  })
})

describe('deleting a batch', () => {
  it('deleting a STAGED batch cascades to remove its staging rows too', async () => {
    const snapshot = await seedMasterData('BAT4')
    const r = row(snapshot, {}, 2)
    const staged: StagedRowInput[] = [{ rowNumber: 2, parsedRow: r, resolution: resolveRowIndependent(r, snapshot) }]
    const batchId = randomUUID()
    await client.query(buildStageInsertScript({ id: batchId, fileName: 'bad.xlsx', fileHash: 'hash-bat4', fileSizeBytes: 1, rowCount: 1, createdBy: null }, staged))

    // Mirrors the route: DELETE ... WHERE id = $1 AND status <> 'IMPORTED'.
    await client.query(`DELETE FROM purchase_import_batches WHERE id = $1 AND status <> 'IMPORTED'`, [batchId])

    const { rows: batches } = await client.query(`SELECT id FROM purchase_import_batches WHERE id = $1`, [batchId])
    expect(batches).toHaveLength(0)
    const { rows: stagingRows } = await client.query(`SELECT id FROM purchase_import_rows WHERE batch_id = $1`, [batchId])
    expect(stagingRows).toHaveLength(0) // ON DELETE CASCADE
  })

  it('deleting a CANCELLED batch also works', async () => {
    const snapshot = await seedMasterData('BAT5')
    const r = row(snapshot, {}, 2)
    const staged: StagedRowInput[] = [{ rowNumber: 2, parsedRow: r, resolution: resolveRowIndependent(r, snapshot) }]
    const batchId = randomUUID()
    await client.query(buildStageInsertScript({ id: batchId, fileName: 'x.xlsx', fileHash: 'hash-bat5', fileSizeBytes: 1, rowCount: 1, createdBy: null }, staged))
    await client.query(`UPDATE purchase_import_batches SET status = 'CANCELLED' WHERE id = $1`, [batchId])

    await client.query(`DELETE FROM purchase_import_batches WHERE id = $1 AND status <> 'IMPORTED'`, [batchId])

    const { rows } = await client.query(`SELECT id FROM purchase_import_batches WHERE id = $1`, [batchId])
    expect(rows).toHaveLength(0)
  })

  it('the guard clause never deletes an IMPORTED batch, even if somehow invoked directly', async () => {
    const snapshot = await seedMasterData('BAT6')
    const r = row(snapshot, {}, 2)
    const staged: StagedRowInput[] = [{ rowNumber: 2, parsedRow: r, resolution: resolveRowIndependent(r, snapshot) }]
    const batchId = randomUUID()
    await client.query(buildStageInsertScript({ id: batchId, fileName: 'y.xlsx', fileHash: 'hash-bat6', fileSizeBytes: 1, rowCount: 1, createdBy: null }, staged))
    await client.query(`UPDATE purchase_import_batches SET status = 'IMPORTED' WHERE id = $1`, [batchId])

    // Same guarded DELETE the route runs — must be a no-op for an IMPORTED batch.
    await client.query(`DELETE FROM purchase_import_batches WHERE id = $1 AND status <> 'IMPORTED'`, [batchId])

    const { rows } = await client.query(`SELECT id, status FROM purchase_import_batches WHERE id = $1`, [batchId])
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('IMPORTED')
  })
})
