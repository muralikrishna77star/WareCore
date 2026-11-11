#!/usr/bin/env node
/*
Script: Run a raw SQL file against the production Postgres database.

Since 2026-11-11 the web app talks to Neon directly (DIRECT_DB=true), so when
DATABASE_URL is set this connects straight to Postgres. Otherwise it falls
back to Hasura's /v2/query (run_sql) API, as before.

The whole file runs as one transaction either way (Hasura's run_sql did the
same), so a failing migration leaves nothing half-applied.

Usage:
  node --env-file=.env.local scripts/hasura-run-sql.mjs <path-to-sql-file>
*/

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const sqlFile = process.argv[2]
if (!sqlFile) {
  console.error('Usage: node --env-file=.env.local scripts/hasura-run-sql.mjs <path-to-sql-file>')
  process.exit(1)
}
const sql = readFileSync(sqlFile, 'utf-8')

if (process.env.DATABASE_URL) {
  const { Client } = createRequire(import.meta.url)('pg')
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    const out = await client.query(sql)
    await client.query('COMMIT')
    const last = Array.isArray(out) ? out[out.length - 1] : out
    console.log(JSON.stringify({ result_type: last.fields?.length ? 'TuplesOk' : 'CommandOk', rowCount: last.rowCount, rows: last.rows?.slice(0, 50) }, null, 2))
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error(JSON.stringify({ error: err.message, detail: err.detail, hint: err.hint, where: err.where }, null, 2))
    process.exitCode = 1
  } finally {
    await client.end()
  }
} else {
  const endpoint = process.env.HASURA_ENDPOINT
    || (process.env.NEXT_PUBLIC_HASURA_URL || '').replace('/v1/graphql', '')
  const adminSecret = process.env.HASURA_ADMIN_SECRET
  if (!endpoint || !adminSecret) {
    console.error('Set DATABASE_URL (direct), or HASURA_ENDPOINT/NEXT_PUBLIC_HASURA_URL + HASURA_ADMIN_SECRET.')
    process.exit(1)
  }
  const res = await fetch(new URL('/v2/query', endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': adminSecret },
    body: JSON.stringify({
      type: 'run_sql',
      args: { source: 'warecore', sql, cascade: false, read_only: false },
    }),
  })
  console.log(await res.text())
}
