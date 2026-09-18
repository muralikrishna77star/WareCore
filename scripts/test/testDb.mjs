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

import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { createServer } from 'node:net'
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
  // Found while adding tests/data-integrity/vendor-movements-report.test.ts
  // (2026-08-27): four more one-off forensic repairs added after this list
  // was last updated, same shape as the ones above (hardcoded production
  // UUIDs for companies/vendors/orders that don't exist in a blank schema).
  // Confirmed via a full from-scratch migration run that this set (plus the
  // ones above) is exactly what's needed for every migration to apply
  // cleanly to a fresh embedded Postgres — re-verify with the same method
  // (run scripts/test/run-migration-check.mjs, or startTestDb with
  // skipProductionDataMigrations: false) if a new repair migration is added.
  '113_repair_gi00069_dedicated_transfer_order.sql',
  '119_repair_missing_transfer_jwt_0826_0012.sql',
  '121_backfill_intercompany_stock_sharing.sql',
  '122_correct_cr0524_0065_misattribution.sql',
  '124_fix_jwt_0826_0012_qty_sent_corruption.sql',
  // Found while verifying migration 136 (2026-09-02): same shape as the
  // ones above, added after this list was last updated.
  '133_backfill_intercompany_stock_sharing_reverse.sql',
  '137_repair_jw_mtbes07o_sbt8_noop_ledger_pairs.sql',
  // Added 2026-09-08: same shape (production-only row ids / one-off repairs).
  '139_repair_ga00190_ga00193_output_size_mixup.sql',
  '140_backfill_intercompany_stock_sharing_oct_nov_2024.sql',
  '143_repair_11_open_rec005_exceptions_sep_2026.sql',
  '144_repair_cr1224_intercompany_purchase_lines.sql',
])

/** The postmaster's own PID, which Postgres writes as line 1 of postmaster.pid. */
function readPostmasterPid(dataDir) {
  try {
    const lines = readFileSync(join(dataDir, 'postmaster.pid'), 'utf8').split(String.fromCharCode(10))
    const pid = Number(lines[0].trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means it exists but isn't ours to signal — still alive.
    return err?.code === 'EPERM'
  }
}

/**
 * Removes warecore-test-pg-* directories left by earlier runs whose postmaster
 * is gone. pg.stop() does not reliably reap the postmaster on Windows, and a
 * run killed with Ctrl+C never calls stop() at all, so these accumulate: one
 * session reached 70 orphaned postgres processes and 44 directories totalling
 * 642 MB, which slowed the whole suite by roughly 6x. Directories whose
 * postmaster is still alive are left strictly alone.
 */
function sweepStaleDataDirs(log) {
  let removed = 0
  let entries = []
  try {
    entries = readdirSync(tmpdir()).filter(n => n.startsWith('warecore-test-pg-'))
  } catch {
    return 0
  }
  for (const name of entries) {
    const dir = join(tmpdir(), name)
    const pid = readPostmasterPid(dir)
    if (pid && processAlive(pid)) continue
    try {
      rmSync(dir, { recursive: true, force: true })
      removed++
    } catch {
      // Held open by something else — leave it for the next sweep.
    }
  }
  if (removed) log(`startTestDb: swept ${removed} stale test data director${removed === 1 ? 'y' : 'ies'}`)
  return removed
}

/** Resolves true only if nothing is already bound to this port on loopback. */
function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, '127.0.0.1')
  })
}

/**
 * Picks a port nothing is listening on. Each test file starts its own
 * cluster from a 500-wide random range, and on Windows the harness leaks
 * postmasters (pg.stop() does not reliably reap them), so that range fills
 * up and collisions become routine. A colliding postgres exits with
 * "could not create any TCP/IP sockets" and embedded-postgres rejects with
 * literally `undefined`, which vitest reports as "Unknown Error: undefined"
 * against a whole test file — a failure that names neither a port nor a
 * cause. Probing first also avoids paying for an initdb per doomed attempt.
 */
async function findFreePort(attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    const port = 55555 + Math.floor(Math.random() * 5000)
    if (await portIsFree(port)) return port
  }
  throw new Error('startTestDb: no free port found for the embedded Postgres instance')
}

/**
 * @param {{ port?: number, log?: (msg: string) => void, skipProductionDataMigrations?: boolean }} [opts]
 *   skipProductionDataMigrations (default true): skip the migrations listed
 *   in PRODUCTION_DATA_DEPENDENT_MIGRATIONS, which cannot succeed against a
 *   blank database. Set false only to reproduce/confirm the failure itself.
 */
export async function startTestDb(opts = {}) {
  const log = opts.log ?? (() => {})
  const skipProductionDataMigrations = opts.skipProductionDataMigrations ?? true
  const user = 'warecore_test'
  const password = 'warecore_test'
  const database = 'warecore_test'

  sweepStaleDataDirs(log)

  // findFreePort() removes the common collision; the retry below still
  // covers the race between probing a port and postgres binding it.
  const attempts = opts.port ? 1 : 5
  let pg, dataDir, port, lastErr

  for (let attempt = 0; attempt < attempts; attempt++) {
    port = opts.port ?? await findFreePort()
    dataDir = mkdtempSync(join(tmpdir(), 'warecore-test-pg-'))
    pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      port,
      user,
      password,
      persistent: false,
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
    })
    try {
      await pg.initialise()
      await pg.start()
      lastErr = undefined
      break
    } catch (err) {
      lastErr = err ?? new Error(`embedded postgres failed to start on port ${port}`)
      try { await pg.stop() } catch { /* not running */ }
      rmSync(dataDir, { recursive: true, force: true })
      log(`startTestDb: port ${port} unusable, retrying (${attempt + 1}/${attempts})`)
    }
  }
  if (lastErr) throw lastErr

  await pg.createDatabase(database)

  const connectionString = `postgres://${user}:${password}@127.0.0.1:${port}/${database}`

  const migrationResult = await runPendingMigrations({
    connectionString,
    migrationsDir,
    log,
    skipFilenames: skipProductionDataMigrations ? PRODUCTION_DATA_DEPENDENT_MIGRATIONS : undefined,
  })

  // Captured while the cluster is definitely up: pg.stop() removes the file,
  // so this is the only chance to learn which process to verify is gone.
  const postmasterPid = readPostmasterPid(dataDir)

  return {
    connectionString,
    migrationResult,
    async stop() {
      try {
        await pg.stop()
      } catch {
        // Fall through to the force-kill below rather than leaving it running.
      }
      // pg.stop() reports success on Windows even when the postmaster is still
      // alive, which is how these leak. Verify, and terminate it ourselves.
      if (postmasterPid && processAlive(postmasterPid)) {
        try {
          process.kill(postmasterPid, 'SIGKILL')
        } catch {
          // Already gone between the check and the signal.
        }
      }
      // Windows can hold the data directory briefly after the process dies.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          rmSync(dataDir, { recursive: true, force: true })
          return
        } catch {
          await new Promise(r => setTimeout(r, 200))
        }
      }
      // Still locked — the next run's sweep will collect it.
    },
  }
}
