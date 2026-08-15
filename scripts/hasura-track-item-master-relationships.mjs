/**
 * Tracks the `item_master` object relationship (via the `item_master_id` FK
 * column) on job_work_items, job_work_output_items, and transfer_items.
 *
 * purchase_bill_items and dispatch_items already had this relationship
 * tracked; these three tables didn't, which is why adding `item_master {
 * item_code }` to their GraphQL queries 500'd with "field 'item_master' not
 * found in type" until this ran.
 *
 * Run: node --env-file=.env.local scripts/hasura-track-item-master-relationships.mjs
 */

import { readFileSync } from 'node:fs'

const envPath = process.cwd() + '/.env.local'
const env = Object.fromEntries(
  readFileSync(envPath, 'utf-8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)

const METADATA_URL = (env.NEXT_PUBLIC_HASURA_URL || '').replace('/v1/graphql', '') + '/v1/metadata'
const ADMIN_SECRET = env.HASURA_ADMIN_SECRET

if (!METADATA_URL.startsWith('http') || !ADMIN_SECRET) {
  console.error('Missing NEXT_PUBLIC_HASURA_URL or HASURA_ADMIN_SECRET in .env.local')
  process.exit(1)
}

const tables = ['job_work_items', 'job_work_output_items', 'transfer_items']

for (const table of tables) {
  const res = await fetch(METADATA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': ADMIN_SECRET },
    body: JSON.stringify({
      type: 'pg_create_object_relationship',
      args: {
        source: 'warecore',
        table: { schema: 'public', name: table },
        name: 'item_master',
        using: { foreign_key_constraint_on: 'item_master_id' },
      },
    }),
  })
  const data = await res.json()
  if (data.code === 'already-exists' || data.message?.includes('already exists')) {
    console.log(`already exists: ${table}.item_master`)
  } else if (data.code || data.error) {
    console.error(`FAILED: ${table}.item_master ->`, data.error || data.code, data.message || '')
  } else {
    console.log(`created: ${table}.item_master`)
  }
}
