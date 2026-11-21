// Which migrations run in which customer's database.
//
// Every migration in supabase/migrations runs in every customer's database,
// except one-off repairs of one customer's own rows. Those:
//  - start with the line   -- warecore-customer: <slug>   (e.g. bsm), and
//  - are also listed in scripts/desktop/productionDataMigrations.mjs, so a
//    fresh desktop install and the test harness skip them as well.
// The repairs written before multi-customer mode (all BSM's) have no
// marker: they are recorded as done in BSM's database and skipped for
// every new customer.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PRODUCTION_DATA_DEPENDENT_MIGRATIONS } from '../desktop/productionDataMigrations.mjs'

const MARKER = /^--\s*warecore-customer:\s*([a-z][a-z0-9-]*)\s*$/

/** @returns {Map<string, string>} filename -> the one customer slug it is for */
export function customerOnlyMigrations(migrationsDir) {
  const out = new Map()
  for (const f of readdirSync(migrationsDir).filter((n) => n.endsWith('.sql'))) {
    const firstLine = readFileSync(join(migrationsDir, f), 'utf-8').split(/\r?\n/, 1)[0]
    const m = MARKER.exec(firstLine)
    if (m) out.set(f, m[1])
  }
  return out
}

/** The migrations a given customer's database must never run. */
export function skipFilenamesFor(slug, migrationsDir) {
  const marked = customerOnlyMigrations(migrationsDir)
  const skip = new Set(PRODUCTION_DATA_DEPENDENT_MIGRATIONS)
  for (const [file, owner] of marked) {
    if (owner === slug) skip.delete(file)
    else skip.add(file)
  }
  return skip
}
