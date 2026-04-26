#!/usr/bin/env node
/**
 * WareCore Dev Seed Script
 * ========================
 * Applies supabase/seed-dev.sql to the database and creates
 * a preview admin user with a bcrypt-hashed password.
 *
 * Usage:
 *   npm run seed:dev
 *
 * Requirements:
 *   - Docker must be running with the warecore-postgres container, OR
 *   - POSTGRES_* env vars must point to a live database
 *
 * Preview login after seeding:
 *   Email:    admin@preview.dev
 *   Password: Preview123!
 */

import { createRequire } from 'module'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync, spawnSync } from 'child_process'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// ── Load .env.local (optional – falls back to docker defaults) ───────────────
const envPath = resolve(ROOT, '.env.local')
if (existsSync(envPath)) {
  const envLines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of envLines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const val = trimmed.slice(idx + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
}

// ── Config ───────────────────────────────────────────────────────────────────
const HASURA_URL    = process.env.NEXT_PUBLIC_HASURA_URL || 'http://localhost:8080/v1/graphql'
const HASURA_SECRET = process.env.HASURA_ADMIN_SECRET    || 'warecore_admin_secret_dev'
const HASURA_SQL_URL = HASURA_URL.replace('/v1/graphql', '/v2/query')

const PG_CONTAINER  = process.env.PG_CONTAINER  || 'warecore-postgres'
const PG_USER       = process.env.PG_USER       || 'warecore'
const PG_DB         = process.env.PG_DB         || 'warecore'

const PREVIEW_EMAIL    = 'admin@preview.dev'
const PREVIEW_PASSWORD = 'Preview123!'
const PREVIEW_NAME     = 'Preview Admin'
const PREVIEW_ROLE     = 'admin'

// ── Helpers ──────────────────────────────────────────────────────────────────
function log(msg) { console.log(`\x1b[36m[seed:dev]\x1b[0m ${msg}`) }
function ok(msg)  { console.log(`\x1b[32m[seed:dev]\x1b[0m ${msg}`) }
function err(msg) { console.error(`\x1b[31m[seed:dev]\x1b[0m ${msg}`) }

/** Run SQL via Hasura's admin run_sql endpoint */
async function runSqlViaHasura(sql) {
  const res = await fetch(HASURA_SQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': HASURA_SECRET,
    },
    body: JSON.stringify({ type: 'run_sql', args: { sql, cascade: false, read_only: false } }),
  })
  const json = await res.json()
  if (!res.ok || json.errors) {
    throw new Error(JSON.stringify(json.errors || json))
  }
  return json
}

/** Run SQL via docker exec psql (fallback / offline) */
function runSqlViaDocker(sql) {
  const result = spawnSync('docker', ['exec', '-i', PG_CONTAINER, 'psql', '-U', PG_USER, '-d', PG_DB], {
    input: sql,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || 'psql exited with non-zero status')
  }
  return result.stdout
}

/** Check if Hasura is reachable */
async function hasuraReachable() {
  try {
    const res = await fetch(HASURA_URL.replace('/v1/graphql', '/healthz'), { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

/** Check if docker container is running */
function dockerContainerRunning(name) {
  try {
    const out = execSync(`docker inspect -f "{{.State.Running}}" ${name} 2>nul`, { encoding: 'utf-8' }).trim()
    return out === 'true'
  } catch {
    return false
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log()
  log('Starting WareCore dev seed...')
  console.log()

  // 1. Load seed SQL
  const seedSql = readFileSync(resolve(ROOT, 'supabase/seed-dev.sql'), 'utf-8')

  // 2. Generate bcrypt hash for preview user password
  const bcrypt = require('bcryptjs')
  log(`Hashing password for ${PREVIEW_EMAIL}...`)
  const passwordHash = await bcrypt.hash(PREVIEW_PASSWORD, 10)

  // 3. User insert SQL (appended after seed)
  const userSql = `
INSERT INTO user_profiles (full_name, email, password_hash, role, is_active)
VALUES ('${PREVIEW_NAME}', '${PREVIEW_EMAIL}', '${passwordHash}', '${PREVIEW_ROLE}', true)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role          = EXCLUDED.role,
  is_active     = EXCLUDED.is_active,
  updated_at    = NOW();
`

  const fullSql = seedSql + '\n' + userSql

  // 4. Apply SQL (try Hasura first, then docker)
  const useHasura = await hasuraReachable()

  if (useHasura) {
    log('Applying seed via Hasura admin API...')
    try {
      await runSqlViaHasura(fullSql)
      ok('Seed applied via Hasura.')
    } catch (e) {
      err(`Hasura run_sql failed: ${e.message}`)
      process.exit(1)
    }
  } else if (dockerContainerRunning(PG_CONTAINER)) {
    log(`Applying seed via docker exec (container: ${PG_CONTAINER})...`)
    try {
      runSqlViaDocker(fullSql)
      ok('Seed applied via docker exec psql.')
    } catch (e) {
      err(`docker exec psql failed: ${e.message}`)
      process.exit(1)
    }
  } else {
    err('Cannot connect: Hasura is unreachable and docker container is not running.')
    err('Start the stack first:  docker-compose up -d')
    process.exit(1)
  }

  // 5. Done
  console.log()
  console.log('─'.repeat(50))
  ok('Dev seed complete!')
  console.log()
  console.log('  Preview login credentials:')
  console.log(`    Email:    \x1b[33m${PREVIEW_EMAIL}\x1b[0m`)
  console.log(`    Password: \x1b[33m${PREVIEW_PASSWORD}\x1b[0m`)
  console.log()
  console.log('  App URL:     http://localhost:3000')
  console.log('  Hasura:      http://localhost:8080')
  console.log('─'.repeat(50))
  console.log()
}

main().catch(e => { err(e.message); process.exit(1) })
