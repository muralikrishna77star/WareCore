#!/usr/bin/env node
/*
Script: Run a raw SQL file against the Postgres database behind Hasura,
via Hasura's /v2/query (run_sql) API.

Usage:
  node --env-file=.env.local scripts/hasura-run-sql.mjs <path-to-sql-file>
*/

import { readFileSync } from 'node:fs'

const endpoint = process.env.HASURA_ENDPOINT
  || (process.env.NEXT_PUBLIC_HASURA_URL || '').replace('/v1/graphql', '')
const adminSecret = process.env.HASURA_ADMIN_SECRET
const sqlFile = process.argv[2]

if (!endpoint || !adminSecret) {
  console.error('Missing HASURA_ENDPOINT/NEXT_PUBLIC_HASURA_URL or HASURA_ADMIN_SECRET environment variables.')
  process.exit(1)
}
if (!sqlFile) {
  console.error('Usage: node --env-file=.env.local scripts/hasura-run-sql.mjs <path-to-sql-file>')
  process.exit(1)
}

const sql = readFileSync(sqlFile, 'utf-8')

const res = await fetch(new URL('/v2/query', endpoint), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': adminSecret },
  body: JSON.stringify({
    type: 'run_sql',
    args: { source: 'warecore', sql, cascade: false, read_only: false },
  }),
})
console.log(await res.text())
