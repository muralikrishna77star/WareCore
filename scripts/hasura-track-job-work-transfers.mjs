#!/usr/bin/env node
/*
Script: Track the new `job_work_transfers` and `job_work_transfer_items`
tables (migration 056) in Hasura and create their relationships.

Usage:
  node --env-file=.env.local scripts/hasura-track-job-work-transfers.mjs
*/

const endpoint = process.env.HASURA_ENDPOINT
  || (process.env.NEXT_PUBLIC_HASURA_URL || '').replace('/v1/graphql', '')
const adminSecret = process.env.HASURA_ADMIN_SECRET

if (!endpoint || !adminSecret) {
  console.error('Missing HASURA_ENDPOINT/NEXT_PUBLIC_HASURA_URL or HASURA_ADMIN_SECRET environment variables.')
  process.exit(1)
}

async function callMetadata(body) {
  const res = await fetch(new URL('/v1/metadata', endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': adminSecret },
    body: JSON.stringify(body),
  })
  return res.json()
}

const tables = [
  'job_work_transfers',
  'job_work_transfer_items',
]

for (const table of tables) {
  console.log(`Tracking table: ${table}`)
  console.log(await callMetadata({
    type: 'pg_track_table',
    args: { source: 'warecore', table: { schema: 'public', name: table } },
  }))
}

console.log('Creating array relationship: job_work_transfers.job_work_transfer_items')
console.log(await callMetadata({
  type: 'pg_create_array_relationship',
  args: {
    source: 'warecore',
    table: { schema: 'public', name: 'job_work_transfers' },
    name: 'job_work_transfer_items',
    using: {
      foreign_key_constraint_on: {
        table: { schema: 'public', name: 'job_work_transfer_items' },
        column: 'job_work_transfer_id',
      },
    },
  },
}))

const objectRelationships = [
  { table: 'job_work_transfers', name: 'from_job_work_order', column: 'from_job_work_order_id' },
  { table: 'job_work_transfers', name: 'to_job_work_order', column: 'to_job_work_order_id' },
  { table: 'job_work_transfers', name: 'from_vendor', column: 'from_vendor_id' },
  { table: 'job_work_transfers', name: 'to_vendor', column: 'to_vendor_id' },
  { table: 'job_work_transfer_items', name: 'job_work_transfer', column: 'job_work_transfer_id' },
]

for (const rel of objectRelationships) {
  console.log(`Creating object relationship: ${rel.table}.${rel.name} (${rel.column})`)
  console.log(await callMetadata({
    type: 'pg_create_object_relationship',
    args: {
      source: 'warecore',
      table: { schema: 'public', name: rel.table },
      name: rel.name,
      using: { foreign_key_constraint_on: rel.column },
    },
  }))
}
