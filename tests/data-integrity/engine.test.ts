// Integration test for src/lib/dataIntegrity/engine.ts's runReconciliation()
// against a real, throwaway Postgres instance, using the app's existing
// LOCAL_MODE path (src/lib/localdb/sql.ts) instead of a real Hasura
// endpoint — LOCAL_MODE and DATABASE_URL must be set BEFORE engine.ts (or
// anything importing hasuraRunSql) is first imported, since LOCAL_MODE is
// read once at module load time. This is why the import is dynamic and
// deferred to inside beforeAll, not a static top-of-file import.
//
// This suite exists because two real bugs shipped to production undetected
// by rules.test.ts, which only calls the SQL functions directly and never
// exercises the engine/upsert layer:
//  1. A redundant BEGIN;/COMMIT; wrapper discarded the RETURNING result
//     Hasura's run_sql needs, crashing the API response (fixed in commit
//     b524d40).
//  2. IGNORED exceptions silently flipped back to REOPENED on the very
//     next full scan, because the upsert's CASE treated IGNORED the same
//     as RESOLVED (found investigating REC-005's real production data,
//     fixed the same session).
// See docs/data-integrity/TEST_MATRIX.md's "API/engine integration tests"
// section for the fuller account.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { startTestDb } from '../../scripts/test/testDb.mjs'

let db: Awaited<ReturnType<typeof startTestDb>>
let client: pg.Client
let runReconciliation: typeof import('../../src/lib/dataIntegrity/engine').runReconciliation

beforeAll(async () => {
  db = await startTestDb({})
  client = new pg.Client({ connectionString: db.connectionString })
  await client.connect()

  process.env.LOCAL_MODE = 'true'
  process.env.DATABASE_URL = db.connectionString
  ;({ runReconciliation } = await import('../../src/lib/dataIntegrity/engine'))
}, 300_000)

afterAll(async () => {
  // Close the LOCAL_MODE pg.Pool (src/lib/localdb/pool.ts) BEFORE the
  // throwaway Postgres instance stops — otherwise its dangling connection
  // surfaces as an unhandled ECONNRESET when the instance shuts down.
  const { closePool } = await import('../../src/lib/localdb/pool')
  await closePool()
  await client?.end()
  await db?.stop()
}, 60_000)

async function makeCompanyAndWarehouse(code: string) {
  const { rows: [company] } = await client.query(`INSERT INTO companies (name, code) VALUES ($1, $1) RETURNING id`, [code])
  const { rows: [warehouse] } = await client.query(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id])
  const { rows: [materialType] } = await client.query(`INSERT INTO material_types (code, description, unit) VALUES ($1, $1, 'MT') RETURNING id`, [code])
  return { companyId: company.id as string, warehouseId: warehouse.id as string, materialTypeId: materialType.id as string }
}

describe('runReconciliation() end-to-end', () => {
  it('a full scan actually completes (not FAILED) and persists exceptions', async () => {
    const { companyId, warehouseId, materialTypeId } = await makeCompanyAndWarehouse('ENG1')
    await client.query(
      `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, entry_date, purchase_line_id)
       VALUES ('PURCHASE_IN', $1, $2, $3, 3.71, '2024-07-12', 'ENG-A'),
              ('PURCHASE_CANCEL', $1, $2, $3, -3.71, '2024-07-12', 'ENG-A'),
              ('PURCHASE_CANCEL', $1, $2, $3, -3.71, '2024-07-12', 'ENG-A')`,
      [companyId, warehouseId, materialTypeId]
    )
    const result = await runReconciliation({
      runType: 'MANUAL', scopeType: 'COMPANY', companyId, fromDate: '2024-01-01', toDate: '2026-12-31',
    })
    expect(result.status).toBe('COMPLETED_WITH_EXCEPTIONS')
    expect(result.exceptionsFound).toBeGreaterThan(0)

    const { rows } = await client.query(`SELECT status FROM reconciliation_runs WHERE id = $1`, [result.runId])
    expect(rows[0].status).toBe('COMPLETED_WITH_EXCEPTIONS')
  })

  it('an IGNORED exception stays IGNORED across a later full scan that still detects the same pattern — the exact regression found in production', async () => {
    const { companyId, warehouseId, materialTypeId } = await makeCompanyAndWarehouse('ENG2')
    const { rows: [warehouseB] } = await client.query(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH-B') RETURNING id`, [companyId])
    // A permanent, intentional-shaped split: purchase in warehouse A,
    // job-work-out from warehouse B, company-wide net zero. REC-005 is
    // scoped company-wide now (see RULE_CATALOGUE.md), so this alone won't
    // trigger it — use a genuine, persistent company-wide deficit instead,
    // which by construction the rule will detect on every single scan for
    // as long as the underlying rows exist (nothing "fixes" it between scans).
    await client.query(
      `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, entry_date, purchase_line_id)
       VALUES ('PURCHASE_IN', $1, $2, $3, 5.0, '2024-01-01', 'ENG-B'),
              ('JOB_WORK_OUT', $1, $4, $3, -8.0, '2024-01-02', 'ENG-B')`,
      [companyId, warehouseId, materialTypeId, warehouseB.id]
    )

    const first = await runReconciliation({
      runType: 'MANUAL', scopeType: 'FULL', companyId: null, fromDate: '2024-01-01', toDate: '2026-12-31',
    })
    expect(first.status).toBe('COMPLETED_WITH_EXCEPTIONS')

    const { rows: [exception] } = await client.query(
      `SELECT e.id FROM reconciliation_exceptions e JOIN reconciliation_rules r ON r.id = e.rule_id
       WHERE r.rule_code = 'REC-005' AND e.company_id = $1`,
      [companyId]
    )
    expect(exception).toBeTruthy()

    // A human confirms this specific pattern is fine and ignores it.
    await client.query(`UPDATE reconciliation_exceptions SET status = 'IGNORED', resolution_notes = 'confirmed fine' WHERE id = $1`, [exception.id])

    // The underlying rows never changed, so the rule detects the exact
    // same pattern again on the next full scan.
    const second = await runReconciliation({
      runType: 'MANUAL', scopeType: 'FULL', companyId: null, fromDate: '2024-01-01', toDate: '2026-12-31',
    })
    expect(second.status).toBe('COMPLETED_WITH_EXCEPTIONS')

    const { rows: [after] } = await client.query(`SELECT status, occurrence_count FROM reconciliation_exceptions WHERE id = $1`, [exception.id])
    expect(after.status).toBe('IGNORED')
    expect(Number(after.occurrence_count)).toBeGreaterThan(1)
  })

  it('auto-resolves an exception whose fingerprint stops appearing in a full scan', async () => {
    const { companyId, warehouseId, materialTypeId } = await makeCompanyAndWarehouse('ENG3')
    // REC-001 (duplicate detection) genuinely stops firing once a
    // duplicate is removed — unlike REC-005, which permanently remembers
    // any historical negative dip even after the data is "fixed" (that's
    // correct rule behavior, not a bug — see the assignment's explicit
    // "never hide a negative chronological balance" requirement). This is
    // why REC-001 is the right rule to prove auto-resolve with.
    await client.query(
      `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, entry_date, purchase_line_id)
       VALUES ('PURCHASE_IN', $1, $2, $3, 5.0, '2024-01-01', 'ENG-C')`,
      [companyId, warehouseId, materialTypeId]
    )
    const { rows: [dup] } = await client.query(
      `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, entry_date, purchase_line_id)
       VALUES ('PURCHASE_CANCEL', $1, $2, $3, -5.0, '2024-01-01', 'ENG-C') RETURNING id`,
      [companyId, warehouseId, materialTypeId]
    )
    await client.query(
      `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, entry_date, purchase_line_id)
       VALUES ('PURCHASE_CANCEL', $1, $2, $3, -5.0, '2024-01-01', 'ENG-C')`,
      [companyId, warehouseId, materialTypeId]
    )
    const duplicateRowId = dup.id as string

    const first = await runReconciliation({ runType: 'MANUAL', scopeType: 'FULL', companyId: null, fromDate: '2024-01-01', toDate: '2026-12-31' })
    expect(first.status).toBe('COMPLETED_WITH_EXCEPTIONS')
    const { rows: [before] } = await client.query(
      `SELECT e.id, e.status FROM reconciliation_exceptions e JOIN reconciliation_rules r ON r.id = e.rule_id
       WHERE r.rule_code = 'REC-001' AND e.company_id = $1`,
      [companyId]
    )
    expect(before.status).toBe('OPEN')

    // Remove the duplicate — the fingerprint's underlying candidate
    // genuinely stops existing (count(*) > 1 no longer holds).
    await client.query(`DELETE FROM stock_ledger WHERE id = $1`, [duplicateRowId])

    // Not asserting second.status here: other tests in this shared database
    // (see the file header) may leave their own still-valid, unrelated
    // exceptions detectable by the same full scan — what this test actually
    // verifies is that THIS specific exception, and only this one, closed.
    await runReconciliation({ runType: 'MANUAL', scopeType: 'FULL', companyId: null, fromDate: '2024-01-01', toDate: '2026-12-31' })

    const { rows: [after] } = await client.query(`SELECT status, resolution_notes FROM reconciliation_exceptions WHERE id = $1`, [before.id])
    expect(after.status).toBe('RESOLVED')
    expect(after.resolution_notes).toMatch(/Auto-resolved/)
  })
})
