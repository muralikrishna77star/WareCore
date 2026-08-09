// Integration tests for the staging workflow's final-import step (the logic
// behind POST /api/bills/import/batches/[id]/import): extends
// commit.test.ts's exact atomicity-proof technique to also cover the
// appended batch-status-flip statement, plus the staleness scenario that
// motivates re-fetching a FRESH master-data snapshot at commit time instead
// of trusting whatever was cached at staging time.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { startTestDb } from '../../scripts/test/testDb.mjs'
import { resolveImport, resolveRowIndependent } from '../../src/lib/purchaseImport/resolve'
import { buildInsertScript } from '../../src/lib/purchaseImport/buildInsertScript'
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
  return { company, warehouse, supplier, materialType, snapshot }
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

// Stages a batch with every row already valid+reviewed — i.e. in the state
// the "Import" button requires — and returns the batch id + staged rows.
async function stageReadyBatch(snapshot: MasterDataSnapshot, rows: ParsedRow[]): Promise<string> {
  const staged: StagedRowInput[] = rows.map((r) => ({ rowNumber: r.rowNumber, parsedRow: r, resolution: resolveRowIndependent(r, snapshot) }))
  const batchId = randomUUID()
  await client.query(
    buildStageInsertScript({ id: batchId, fileName: 'x.xlsx', fileHash: randomUUID(), fileSizeBytes: 1, rowCount: rows.length, createdBy: null }, staged)
  )
  await client.query(`UPDATE purchase_import_rows SET reviewed = true, reviewed_at = NOW() WHERE batch_id = $1`, [batchId])
  return batchId
}

describe('final import — happy path', () => {
  it('reconstructs ParsedRow[] from staged rows, inserts bills, and flips the batch to IMPORTED in one atomic script', async () => {
    const { snapshot } = await seedMasterData('FIN1')
    const batchId = await stageReadyBatch(snapshot, [row(snapshot)])

    const { rows: staged } = await client.query(`SELECT current_data FROM purchase_import_rows WHERE batch_id = $1 ORDER BY row_number`, [batchId])
    const parsedRows: ParsedRow[] = staged.map((r) => r.current_data)
    const { bills, errors } = resolveImport(parsedRows, snapshot)
    expect(errors).toHaveLength(0)

    const billsWithIds = bills.map((b) => ({ ...b, id: randomUUID() }))
    const insertScript = buildInsertScript(billsWithIds, null)
    const batchUpdateSql = `UPDATE purchase_import_batches SET status = 'IMPORTED', imported_at = NOW() WHERE id = '${batchId}'::uuid AND status = 'STAGED';`
    await client.query(`${insertScript}\n${batchUpdateSql}`)

    const { rows: billRows } = await client.query(`SELECT id FROM purchase_bills WHERE id = $1`, [billsWithIds[0].id])
    expect(billRows).toHaveLength(1)

    const { rows: batchRows } = await client.query(`SELECT status, imported_at FROM purchase_import_batches WHERE id = $1`, [batchId])
    expect(batchRows[0].status).toBe('IMPORTED')
    expect(batchRows[0].imported_at).not.toBeNull()
  })
})

describe('final import — atomicity holds across bills AND the batch status flip', () => {
  it('rolls back everything — including the batch status flip — if any statement in the script fails', async () => {
    const { snapshot } = await seedMasterData('FIN2')
    const batchId = await stageReadyBatch(snapshot, [row(snapshot, {}, 2), row(snapshot, { billDate: '2024-05-01', billDateRaw: '2024-05-01' }, 3)])

    const { rows: staged } = await client.query(`SELECT current_data FROM purchase_import_rows WHERE batch_id = $1 ORDER BY row_number`, [batchId])
    const parsedRows: ParsedRow[] = staged.map((r) => r.current_data)
    const { bills, errors } = resolveImport(parsedRows, snapshot)
    expect(errors).toHaveLength(0)
    expect(bills).toHaveLength(2)

    const billsWithIds = bills.map((b) => ({ ...b, id: randomUUID() }))
    // Same defense-in-depth technique as commit.test.ts: corrupt a value
    // AFTER app-level validation already passed, to prove the DB-level
    // transaction — not just the TS validation — is what guarantees
    // all-or-nothing.
    billsWithIds[1].lines[0].quantity = -1

    const insertScript = buildInsertScript(billsWithIds, null)
    const batchUpdateSql = `UPDATE purchase_import_batches SET status = 'IMPORTED', imported_at = NOW() WHERE id = '${batchId}'::uuid AND status = 'STAGED';`
    await expect(client.query(`${insertScript}\n${batchUpdateSql}`)).rejects.toThrow()

    const { rows: billRows } = await client.query(`SELECT id FROM purchase_bills WHERE id = ANY($1)`, [billsWithIds.map((b) => b.id)])
    expect(billRows).toHaveLength(0) // neither bill committed, not even the valid first one

    const { rows: batchRows } = await client.query(`SELECT status, imported_at FROM purchase_import_batches WHERE id = $1`, [batchId])
    expect(batchRows[0].status).toBe('STAGED') // the appended UPDATE rolled back too — proves it was in the SAME atomic script
    expect(batchRows[0].imported_at).toBeNull()
  })
})

describe('final import — staleness guard', () => {
  it('a fresh resolveImport() catches a master-data change made after staging, even though the row was valid+reviewed at staging time', async () => {
    const { snapshot, supplier } = await seedMasterData('FIN3')
    const batchId = await stageReadyBatch(snapshot, [row(snapshot)])

    // Master data changes AFTER staging: the supplier the row resolved
    // against is deactivated (and, for this in-memory test, simply removed
    // from the "fresh" snapshot the final-import step would fetch).
    await client.query(`UPDATE suppliers SET is_active = false WHERE id = $1`, [supplier.id])
    const freshSnapshot: MasterDataSnapshot = { ...snapshot, suppliers: [] }

    const { rows: staged } = await client.query(`SELECT current_data FROM purchase_import_rows WHERE batch_id = $1`, [batchId])
    const parsedRows: ParsedRow[] = staged.map((r) => r.current_data)

    // The row itself is still marked valid+reviewed in purchase_import_rows
    // from staging time — final import must not trust that.
    const { rows: stillMarkedValid } = await client.query(`SELECT is_valid, reviewed FROM purchase_import_rows WHERE batch_id = $1`, [batchId])
    expect(stillMarkedValid[0].is_valid).toBe(true)
    expect(stillMarkedValid[0].reviewed).toBe(true)

    const { bills, errors } = resolveImport(parsedRows, freshSnapshot)
    expect(bills).toHaveLength(0)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].message).toMatch(/Unknown supplier/)

    // The route's recovery path: re-validate the affected row against the
    // fresh snapshot and persist the corrected state, unmarking reviewed.
    const resolution = resolveRowIndependent(parsedRows[0], freshSnapshot)
    expect(resolution.isValid).toBe(false)
  })
})
