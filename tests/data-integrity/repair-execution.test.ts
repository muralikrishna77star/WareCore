// Integration test for fn_repair_archive_duplicate_ledger_row()
// (supabase/migrations/091_repair_archive_duplicate_ledger_row.sql), Stage
// D's pilot repair execution function, against a real throwaway Postgres
// instance — decimal ledger arithmetic and set-based duplicate detection
// can't be faithfully emulated in JS (see engine.test.ts's header for the
// same rationale). The function is invoked as a single top-level statement
// (`SELECT * FROM fn_repair_archive_duplicate_ledger_row($1, $2)`), so it
// never exercises the already-fixed runSqlLocal multi-statement bug that
// engine.ts's script-building path had to work around — nothing here
// depends on that fix.
//
// See docs/data-integrity/REPAIR_GOVERNANCE.md for the governance rules
// this function must uphold: a single reviewed/typed function (never
// per-request SQL), maker-checker, and check-then-commit-or-rollback in one
// transaction (the repair only commits if a fresh re-run of the originating
// rule confirms it no longer fires).
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

async function makeUser(namePrefix: string): Promise<string> {
  const { rows: [authUser] } = await client.query(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`)
  await client.query(
    `INSERT INTO user_profiles (id, full_name, email, password_hash, role) VALUES ($1, $2, $3, 'x', 'admin')`,
    [authUser.id, namePrefix, `${namePrefix}-${authUser.id}@test.local`]
  )
  return authUser.id as string
}

async function setRepairExecutionEnabled(enabled: boolean) {
  await client.query(`UPDATE reconciliation_settings SET repair_execution_enabled = $1 WHERE id = TRUE`, [enabled])
}

// Seeds a CONFIRMED REC-001 duplicate pair for `code` (two PURCHASE_CANCEL
// rows against one PURCHASE_IN, created back-to-back so they land inside
// REC-001's 1-hour CONFIRMED window), runs a real scan to create the
// persisted exception, and drives a repair_batches row through
// DRAFT->PENDING_APPROVAL->APPROVED with two different users (maker-checker)
// — everything short of flipping to EXECUTING, which each test does itself
// right before calling the function under test.
async function seedApprovedBatch(code: string, extraDuplicates = 0) {
  const { companyId, warehouseId, materialTypeId } = await makeCompanyAndWarehouse(code)
  await client.query(
    `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, entry_date, purchase_line_id)
     VALUES ('PURCHASE_IN', $1, $2, $3, 5.0, '2024-01-01', $4)`,
    [companyId, warehouseId, materialTypeId, code]
  )
  const { rows: [kept] } = await client.query(
    `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, entry_date, purchase_line_id)
     VALUES ('PURCHASE_CANCEL', $1, $2, $3, -5.0, '2024-01-01', $4) RETURNING id`,
    [companyId, warehouseId, materialTypeId, code]
  )
  const duplicateIds: string[] = []
  for (let i = 0; i < 1 + extraDuplicates; i++) {
    const { rows: [dup] } = await client.query(
      `INSERT INTO stock_ledger (entry_type, company_id, warehouse_id, material_type_id, quantity, entry_date, purchase_line_id)
       VALUES ('PURCHASE_CANCEL', $1, $2, $3, -5.0, '2024-01-01', $4) RETURNING id`,
      [companyId, warehouseId, materialTypeId, code]
    )
    duplicateIds.push(dup.id as string)
  }

  const scan = await runReconciliation({ runType: 'MANUAL', scopeType: 'COMPANY', companyId, fromDate: '2024-01-01', toDate: '2026-12-31' })
  expect(scan.status).toBe('COMPLETED_WITH_EXCEPTIONS')

  const { rows: [exception] } = await client.query(
    `SELECT e.* FROM reconciliation_exceptions e JOIN reconciliation_rules r ON r.id = e.rule_id
     WHERE r.rule_code = 'REC-001' AND e.company_id = $1`,
    [companyId]
  )
  expect(exception).toBeTruthy()
  expect(exception.evidence.confidence).toBe('CONFIRMED')

  const requestedBy = await makeUser(`req-${code}`)
  const approvedBy = await makeUser(`app-${code}`)

  const { rows: [batch] } = await client.query(
    `INSERT INTO repair_batches (exception_id, proposed_action, proposal, before_snapshot, status, requested_by, requested_at)
     VALUES ($1, 'ARCHIVE_DUPLICATE_LEDGER_ROW', '{}'::jsonb, '{}'::jsonb, 'PENDING_APPROVAL', $2, NOW()) RETURNING id`,
    [exception.id, requestedBy]
  )
  await client.query(`UPDATE repair_batches SET status = 'APPROVED', approved_by = $2, approved_at = NOW() WHERE id = $1`, [batch.id, approvedBy])

  return {
    companyId,
    exception,
    batchId: batch.id as string,
    keptId: kept.id as string,
    duplicateIds,
    requestedBy,
    approvedBy,
  }
}

async function execute(batchId: string, executedBy: string) {
  await client.query(`UPDATE repair_batches SET status = 'EXECUTING' WHERE id = $1`, [batchId])
  return client.query(`SELECT * FROM fn_repair_archive_duplicate_ledger_row($1, $2)`, [batchId, executedBy])
}

describe('fn_repair_archive_duplicate_ledger_row()', () => {
  it('archives the later duplicate, keeps the earliest, writes an audit row, and the exception auto-resolves after a rescan', async () => {
    const { exception, batchId, keptId, duplicateIds } = await seedApprovedBatch('RPR1')
    await setRepairExecutionEnabled(true)
    const executedBy = await makeUser('exec-RPR1')

    const { rows: [result] } = await execute(batchId, executedBy)
    expect(result.status).toBe('EXECUTED')
    expect(result.executed_by).toBe(executedBy)
    expect(result.execution_result.kept_ledger_id).toBe(keptId)
    expect(result.execution_result.archived_ledger_ids).toEqual(duplicateIds)
    expect(result.execution_result.archived_count).toBe(1)

    const { rows: remaining } = await client.query(`SELECT id FROM stock_ledger WHERE id = ANY($1)`, [[keptId, ...duplicateIds]])
    expect(remaining.map((r) => r.id)).toEqual([keptId])

    const { rows: auditRows } = await client.query(`SELECT * FROM repair_audit_rows WHERE repair_batch_id = $1`, [batchId])
    expect(auditRows).toHaveLength(1)
    expect(auditRows[0].action).toBe('ARCHIVE')
    expect(auditRows[0].table_name).toBe('stock_ledger')
    expect(auditRows[0].record_id).toBe(duplicateIds[0])
    expect(auditRows[0].before_image.id).toBe(duplicateIds[0])
    expect(auditRows[0].after_image).toBeNull()

    // Not asserting the overall run status here (other tests' unrelated
    // exceptions may also be detectable by this same full scan) — what
    // matters is that THIS exception, specifically, closed.
    await runReconciliation({ runType: 'POST_REPAIR', scopeType: 'FULL', companyId: null, fromDate: '2000-01-01', toDate: '2026-12-31' })
    const { rows: [after] } = await client.query(`SELECT status, resolution_notes FROM reconciliation_exceptions WHERE id = $1`, [exception.id])
    expect(after.status).toBe('RESOLVED')
    expect(after.resolution_notes).toMatch(/Auto-resolved/)
  })

  it('archives every duplicate but the earliest when 3+ rows share the fingerprint', async () => {
    const { batchId, keptId, duplicateIds } = await seedApprovedBatch('RPR2', 2)
    await setRepairExecutionEnabled(true)
    const executedBy = await makeUser('exec-RPR2')

    const { rows: [result] } = await execute(batchId, executedBy)
    expect(result.status).toBe('EXECUTED')
    expect(duplicateIds).toHaveLength(3)
    expect(result.execution_result.archived_count).toBe(duplicateIds.length)

    const { rows: remaining } = await client.query(`SELECT id FROM stock_ledger WHERE id = ANY($1)`, [[keptId, ...duplicateIds]])
    expect(remaining.map((r) => r.id)).toEqual([keptId])

    const { rows: auditRows } = await client.query(`SELECT record_id FROM repair_audit_rows WHERE repair_batch_id = $1 ORDER BY created_at`, [batchId])
    expect(auditRows.map((r) => r.record_id)).toEqual(duplicateIds)
  })

  it('refuses to execute when repair_execution_enabled is FALSE, and changes nothing', async () => {
    const { batchId, duplicateIds } = await seedApprovedBatch('RPR3')
    await setRepairExecutionEnabled(false)
    const executedBy = await makeUser('exec-RPR3')

    await expect(execute(batchId, executedBy)).rejects.toThrow(/disabled/)

    const { rows } = await client.query(`SELECT id FROM stock_ledger WHERE id = $1`, [duplicateIds[0]])
    expect(rows).toHaveLength(1)
    const { rows: auditRows } = await client.query(`SELECT * FROM repair_audit_rows WHERE repair_batch_id = $1`, [batchId])
    expect(auditRows).toHaveLength(0)
  })

  it('refuses to run against a batch that is not in EXECUTING status', async () => {
    const { batchId } = await seedApprovedBatch('RPR4')
    await setRepairExecutionEnabled(true)
    const executedBy = await makeUser('exec-RPR4')

    // Deliberately skip the EXECUTING flip this time.
    await expect(
      client.query(`SELECT * FROM fn_repair_archive_duplicate_ledger_row($1, $2)`, [batchId, executedBy])
    ).rejects.toThrow(/must be EXECUTING/)
  })

  it('refuses a batch whose proposed_action is not ARCHIVE_DUPLICATE_LEDGER_ROW', async () => {
    const { batchId } = await seedApprovedBatch('RPR5')
    await setRepairExecutionEnabled(true)
    const executedBy = await makeUser('exec-RPR5')
    await client.query(`UPDATE repair_batches SET proposed_action = 'CORRECT_METADATA' WHERE id = $1`, [batchId])

    await expect(execute(batchId, executedBy)).rejects.toThrow(/only executes ARCHIVE_DUPLICATE_LEDGER_ROW/)
  })

  it('refuses when the fingerprint no longer detects a duplicate (already fixed out-of-band), and changes nothing', async () => {
    const { batchId, duplicateIds, keptId } = await seedApprovedBatch('RPR6')
    await setRepairExecutionEnabled(true)
    const executedBy = await makeUser('exec-RPR6')

    // Someone already deleted the duplicate by hand before this batch executed.
    await client.query(`DELETE FROM stock_ledger WHERE id = $1`, [duplicateIds[0]])

    await expect(execute(batchId, executedBy)).rejects.toThrow(/no longer detects/)

    const { rows } = await client.query(`SELECT id FROM stock_ledger WHERE id = $1`, [keptId])
    expect(rows).toHaveLength(1)
    const { rows: auditRows } = await client.query(`SELECT * FROM repair_audit_rows WHERE repair_batch_id = $1`, [batchId])
    expect(auditRows).toHaveLength(0)
  })

  it('the maker-checker CHECK constraint rejects approved_by = requested_by directly at the DB level', async () => {
    const { companyId } = await makeCompanyAndWarehouse('RPR7')
    const { rows: [rule] } = await client.query(`SELECT id FROM reconciliation_rules WHERE rule_code = 'REC-001'`)
    const { rows: [exception] } = await client.query(
      `INSERT INTO reconciliation_exceptions (rule_id, fingerprint, status, severity, company_id, summary)
       VALUES ($1, 'REC-001|TEST|RPR7', 'OPEN', 'HIGH', $2, 'test fixture') RETURNING id`,
      [rule.id, companyId]
    )
    const same = await makeUser('same-user-RPR7')
    const { rows: [batch] } = await client.query(
      `INSERT INTO repair_batches (exception_id, proposed_action, proposal, before_snapshot, status, requested_by, requested_at)
       VALUES ($1, 'ARCHIVE_DUPLICATE_LEDGER_ROW', '{}'::jsonb, '{}'::jsonb, 'PENDING_APPROVAL', $2, NOW()) RETURNING id`,
      [exception.id, same]
    )

    await expect(
      client.query(`UPDATE repair_batches SET approved_by = $2 WHERE id = $1`, [batch.id, same])
    ).rejects.toThrow(/chk_repair_batches_maker_checker/)
  })
})
