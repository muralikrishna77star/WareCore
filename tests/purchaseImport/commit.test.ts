// Integration test for the commit path's atomicity and its interaction
// with the real ledger trigger chain — against a real throwaway Postgres
// instance, same pattern as tests/data-integrity/*.test.ts
// (scripts/test/testDb.mjs). Exercises buildInsertScript() (extracted from
// src/app/api/bills/import/commit/route.ts specifically so it's testable
// without going through the Next.js request/session layer) the same way
// the real route does: as one multi-statement script sent as a single
// query, relying on Postgres's simple-query-protocol implicit transaction
// (see src/lib/dataIntegrity/engine.ts's header comment for the same
// mechanism).
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { startTestDb } from '../../scripts/test/testDb.mjs'
import { resolveImport } from '../../src/lib/purchaseImport/resolve'
import { buildInsertScript } from '../../src/lib/purchaseImport/buildInsertScript'
import type { MasterDataSnapshot, ParsedRow, ResolvedBill } from '../../src/lib/purchaseImport/types'

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
  const { rows: [size] } = await client.query(
    `INSERT INTO material_sizes (material_type_id, size_label) VALUES ($1, '1.40x1080') RETURNING id`, [materialType.id]
  )

  const snapshot: MasterDataSnapshot = {
    companies: [{ id: company.id, name: code, code }],
    warehouses: [{ id: warehouse.id, name: 'WH', company_id: company.id }],
    suppliers: [{ id: supplier.id, name: `${code}-supplier` }],
    materialTypes: [{ id: materialType.id, code, description: code, unit: 'tons' }],
    materialSizes: [{ id: size.id, material_type_id: materialType.id, size_label: '1.40x1080' }],
    taxRates: [],
    existingBillNumbers: [],
    existingLineIds: [],
  }
  return { company, warehouse, supplier, materialType, size, snapshot }
}

function row(snapshot: MasterDataSnapshot, overrides: Partial<ParsedRow> = {}, rowNumber = 2): ParsedRow {
  return {
    rowNumber,
    company: snapshot.companies[0].name, warehouse: snapshot.warehouses[0].name, supplier: snapshot.suppliers[0].name,
    billDate: '2024-04-15', billDateRaw: '2024-04-15', billRef: '',
    materialType: snapshot.materialTypes[0].code, size: snapshot.materialSizes[0].size_label,
    quantity: 10, quantityRaw: '10',
    unit: '', rate: 55000, rateRaw: '55000',
    taxRate: '', lineNotes: '', billNotes: '',
    ...overrides,
  }
}

function withIds(bills: ResolvedBill[]): (ResolvedBill & { id: string })[] {
  return bills.map((b) => ({ ...b, id: randomUUID() }))
}

describe('bulk import commit — atomicity and ledger effect', () => {
  it('inserts the bill and its items, and the existing PURCHASE_IN trigger posts to stock_ledger with the right quantity', async () => {
    const { snapshot } = await seedMasterData('IMP1')
    const { bills, errors } = resolveImport([row(snapshot)], snapshot)
    expect(errors).toHaveLength(0)

    const billsWithIds = withIds(bills)
    await client.query(buildInsertScript(billsWithIds))

    const { rows: billRows } = await client.query(`SELECT * FROM purchase_bills WHERE id = $1`, [billsWithIds[0].id])
    expect(billRows).toHaveLength(1)
    expect(billRows[0].status).toBe('active')
    expect(Number(billRows[0].total_quantity)).toBe(10)

    const { rows: itemRows } = await client.query(`SELECT * FROM purchase_bill_items WHERE bill_id = $1`, [billsWithIds[0].id])
    expect(itemRows).toHaveLength(1)
    expect(itemRows[0].purchase_line_id).toBe(billsWithIds[0].lines[0].purchaseLineId)

    const { rows: ledgerRows } = await client.query(
      `SELECT * FROM stock_ledger WHERE reference_type = 'purchase_bill' AND reference_id = $1 AND entry_type = 'PURCHASE_IN'`,
      [billsWithIds[0].id]
    )
    expect(ledgerRows).toHaveLength(1)
    expect(Number(ledgerRows[0].quantity)).toBe(10)
  })

  it('rolls back the ENTIRE script — including otherwise-valid bills — if any statement fails', async () => {
    const { snapshot } = await seedMasterData('IMP2')
    const { bills, errors } = resolveImport([row(snapshot, {}, 2), row(snapshot, { billDate: '2024-05-01', billDateRaw: '2024-05-01' }, 3)], snapshot)
    expect(errors).toHaveLength(0)
    expect(bills).toHaveLength(2)

    const billsWithIds = withIds(bills)
    // Corrupt the second bill's only line so the INSERT violates
    // purchase_bill_items' CHECK (quantity > 0) constraint — simulating a
    // DB-level failure that TS-side validation didn't catch.
    billsWithIds[1].lines[0].quantity = -1

    await expect(client.query(buildInsertScript(billsWithIds))).rejects.toThrow()

    const { rows } = await client.query(`SELECT id FROM purchase_bills WHERE id = ANY($1)`, [billsWithIds.map((b) => b.id)])
    expect(rows).toHaveLength(0) // neither bill committed, not even the valid first one

    const { rows: ledgerRows } = await client.query(
      `SELECT id FROM stock_ledger WHERE reference_type = 'purchase_bill' AND reference_id = ANY($1)`,
      [billsWithIds.map((b) => b.id)]
    )
    expect(ledgerRows).toHaveLength(0)
  })
})
