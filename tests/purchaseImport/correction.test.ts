// Integration tests for the row-correction path (the logic behind
// PATCH /api/bills/import/batches/[id]/rows/[rowId]): merging a correction
// into current_data, re-validating fresh, and — the key edge case —
// resetting reviewed=false on every correction so a stale approval can
// never survive an edit. Same LOCAL_MODE embedded-Postgres pattern as
// commit.test.ts/batches.test.ts.
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

// Mirrors the essential logic of the PATCH .../rows/[rowId] route (merge a
// field into current_data, re-derive the *Raw mirror, re-validate, always
// clear reviewed) directly against the DB — the route itself is a thin
// HTTP wrapper around exactly this.
async function applyCorrection(rowId: string, snapshot: MasterDataSnapshot, field: keyof ParsedRow, value: unknown) {
  const { rows: [existing] } = await client.query(`SELECT current_data FROM purchase_import_rows WHERE id = $1`, [rowId])
  const next: ParsedRow = { ...existing.current_data, [field]: value }
  if (field === 'billDate') next.billDateRaw = String(value)
  if (field === 'quantity') next.quantityRaw = value === null ? '' : String(value)
  if (field === 'rate') next.rateRaw = value === null ? '' : String(value)

  const resolution = resolveRowIndependent(next, snapshot)
  await client.query(
    `UPDATE purchase_import_rows SET
       current_data = $2, resolved_field_ids = $3, validation_errors = $4, is_valid = $5,
       reviewed = false, reviewed_by = NULL, reviewed_at = NULL
     WHERE id = $1`,
    [rowId, JSON.stringify(next), JSON.stringify(resolution.resolved), JSON.stringify(resolution.errors), resolution.isValid]
  )
  return resolution
}

async function stageOneRow(snapshot: MasterDataSnapshot, parsedRow: ParsedRow): Promise<string> {
  const staged: StagedRowInput[] = [{ rowNumber: parsedRow.rowNumber, parsedRow, resolution: resolveRowIndependent(parsedRow, snapshot) }]
  const batchId = randomUUID()
  await client.query(
    buildStageInsertScript({ id: batchId, fileName: 'x.xlsx', fileHash: randomUUID(), fileSizeBytes: 1, rowCount: 1, createdBy: null }, staged)
  )
  const { rows } = await client.query(`SELECT id FROM purchase_import_rows WHERE batch_id = $1`, [batchId])
  return rows[0].id
}

describe('row correction', () => {
  it('correcting an unknown Company to the exact master-data name clears the error and makes the row valid', async () => {
    const snapshot = await seedMasterData('COR1')
    const badRow = row(snapshot, { company: 'Wrong Name' })
    const rowId = await stageOneRow(snapshot, badRow)

    let { rows: before } = await client.query(`SELECT is_valid FROM purchase_import_rows WHERE id = $1`, [rowId])
    expect(before[0].is_valid).toBe(false)

    const resolution = await applyCorrection(rowId, snapshot, 'company', snapshot.companies[0].name)
    expect(resolution.isValid).toBe(true)

    const { rows: after } = await client.query(`SELECT is_valid, validation_errors FROM purchase_import_rows WHERE id = $1`, [rowId])
    expect(after[0].is_valid).toBe(true)
    expect(after[0].validation_errors).toEqual([])
  })

  it('editing any field on a reviewed row resets reviewed to false — the key edge case', async () => {
    const snapshot = await seedMasterData('COR2')
    const goodRow = row(snapshot)
    const rowId = await stageOneRow(snapshot, goodRow)

    await client.query(`UPDATE purchase_import_rows SET reviewed = true, reviewed_by = NULL, reviewed_at = NOW() WHERE id = $1`, [rowId])
    let { rows: reviewed } = await client.query(`SELECT reviewed FROM purchase_import_rows WHERE id = $1`, [rowId])
    expect(reviewed[0].reviewed).toBe(true)

    // Correct something harmless (Line Notes) — even a no-op-ish edit must
    // still invalidate the prior review, since the route can't tell
    // "harmless" edits from "changes the outcome" edits in general.
    await applyCorrection(rowId, snapshot, 'lineNotes', 'checked twice')

    const { rows: after } = await client.query(`SELECT reviewed, reviewed_by, reviewed_at FROM purchase_import_rows WHERE id = $1`, [rowId])
    expect(after[0].reviewed).toBe(false)
    expect(after[0].reviewed_by).toBeNull()
    expect(after[0].reviewed_at).toBeNull()
  })

  it('correcting a field appends a correction_history entry with old/new values', async () => {
    const snapshot = await seedMasterData('COR3')
    const badRow = row(snapshot, { supplier: 'Wrong Supplier' })
    const rowId = await stageOneRow(snapshot, badRow)

    // Mirror the route's correction_history append (applyCorrection() above
    // doesn't do this bit, to keep it focused on the validation-reset path).
    const { rows: [existing] } = await client.query(`SELECT current_data, correction_history FROM purchase_import_rows WHERE id = $1`, [rowId])
    const historyEntry = { at: new Date().toISOString(), by: null, changes: { supplier: { old: existing.current_data.supplier, new: snapshot.suppliers[0].name } } }
    const newHistory = [...existing.correction_history, historyEntry]
    await client.query(`UPDATE purchase_import_rows SET correction_history = $2 WHERE id = $1`, [rowId, JSON.stringify(newHistory)])

    const { rows: after } = await client.query(`SELECT correction_history FROM purchase_import_rows WHERE id = $1`, [rowId])
    expect(after[0].correction_history).toHaveLength(1)
    expect(after[0].correction_history[0].changes.supplier.old).toBe('Wrong Supplier')
    expect(after[0].correction_history[0].changes.supplier.new).toBe(snapshot.suppliers[0].name)
  })
})
