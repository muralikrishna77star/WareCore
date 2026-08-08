// Spins up a throwaway, isolated embedded Postgres instance (same mechanism
// scripts/desktop/start.mjs uses for the offline desktop build — this repo
// already proves it can apply every migration from a blank database), runs
// every migration in supabase/migrations against it, and tears it down.
//
// Used by:
//  - `node scripts/test/run-migration-check.mjs` (manual "does the full
//    migration set still apply cleanly" check)
//  - the data-integrity vitest suite (tests/data-integrity/*.test.ts), which
//    needs a real Postgres to exercise reconciliation SQL against — decimal
//    arithmetic and set-based duplicate/negative-balance logic can't be
//    faithfully emulated in JS, per the assignment's "never use JavaScript
//    floating-point arithmetic as the authority for stock reconciliation".
//
// This never touches production. Each call creates a fresh data directory
// under the OS temp dir and deletes it on teardown.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import { runPendingMigrations } from '../desktop/migrate.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, '..', '..', 'supabase', 'migrations')

// FINDING (data-integrity audit, 2026-08-08): these migrations INSERT/UPDATE
// rows referencing hardcoded, real production UUIDs (specific companies,
// warehouses, job work orders identified by reference number like
// JW-MSA5JKMM-FEG0 or item CR00700's row ids) — they were one-off forensic
// repairs meant to run exactly once against the already-populated production
// database, never against a blank schema. Confirmed empirically: running the
// full migration set against a fresh embedded Postgres fails at exactly
// 063_restore_job_work_transfer_ledger.sql with a stock_ledger_company_id_fkey
// violation, because the company/warehouse rows it INSERTs against don't
// exist yet. This is a pre-existing repo condition (see
// docs/data-integrity/CURRENT_STATE_AUDIT.md §1), not something introduced
// here, and these migrations are NOT modified — per this package's rules,
// existing migrations are never altered. Skipping them here only affects
// this throwaway test database's schema baseline, so new Phase 1 objects
// (which don't depend on any of this backfilled data) can be verified
// against a representative, non-production database.
export const PRODUCTION_DATA_DEPENDENT_MIGRATIONS = new Set([
  '063_restore_job_work_transfer_ledger.sql',
  '064_fix_backfilled_transfer_ledger_timestamps.sql',
  '071_repair_vendor_direct_sale_duplicates.sql',
  '073_backfill_missing_2024_ledger_entries.sql',
  '077_backfill_missing_job_work_transfer_out.sql',
  '078_repair_jw_msa5jkmm_feg0_transfer.sql',
  '079_fix_078_transfer_out_date.sql',
  '080_fix_jw_msa5jkmm_feg0_vendor.sql',
  '082_redo_jw_msa5jkmm_feg0_repair.sql',
  '083_fix_082_transfer_out_date.sql',
  '084_repair_cr00700_duplicate_cancel.sql',
])

/**
 * @param {{ port?: number, log?: (msg: string) => void, skipProductionDataMigrations?: boolean }} [opts]
 *   skipProductionDataMigrations (default true): skip the migrations listed
 *   in PRODUCTION_DATA_DEPENDENT_MIGRATIONS, which cannot succeed against a
 *   blank database. Set false only to reproduce/confirm the failure itself.
 */
export async function startTestDb(opts = {}) {
  const port = opts.port ?? 55555 + Math.floor(Math.random() * 500)
  const log = opts.log ?? (() => {})
  const skipProductionDataMigrations = opts.skipProductionDataMigrations ?? true
  const dataDir = mkdtempSync(join(tmpdir(), 'warecore-test-pg-'))
  const user = 'warecore_test'
  const password = 'warecore_test'
  const database = 'warecore_test'

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port,
    user,
    password,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  })

  await pg.initialise()
  await pg.start()
  await pg.createDatabase(database)

  const connectionString = `postgres://${user}:${password}@127.0.0.1:${port}/${database}`

  const migrationResult = await runPendingMigrations({
    connectionString,
    migrationsDir,
    log,
    skipFilenames: skipProductionDataMigrations ? PRODUCTION_DATA_DEPENDENT_MIGRATIONS : undefined,
  })

  return {
    connectionString,
    migrationResult,
    async stop() {
      try {
        await pg.stop()
      } finally {
        rmSync(dataDir, { recursive: true, force: true })
      }
    },
  }
}
