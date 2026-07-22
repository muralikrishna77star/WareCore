#!/usr/bin/env node
/*
Script: Track the new `job_work_transfer_cancellations` and
`job_work_transfer_cancellation_items` tables (migration 061) in Hasura and
create their relationships.

Usage:
  node --env-file=.env.local scripts/hasura-track-job-work-transfer-cancellations.mjs
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
  'job_work_transfer_cancellations',
  'job_work_transfer_cancellation_items',
]

for (const table of tables) {
  console.log(`Tracking table: ${table}`)
  console.log(await callMetadata({
    type: 'pg_track_table',
    args: { source: 'warecore', table: { schema: 'public', name: table } },
  }))
}

console.log('Creating array relationship: job_work_transfer_cancellations.job_work_transfer_cancellation_items')
console.log(await callMetadata({
  type: 'pg_create_array_relationship',
  args: {
    source: 'warecore',
    table: { schema: 'public', name: 'job_work_transfer_cancellations' },
    name: 'job_work_transfer_cancellation_items',
    using: {
      foreign_key_constraint_on: {
        table: { schema: 'public', name: 'job_work_transfer_cancellation_items' },
        column: 'cancellation_id',
      },
    },
  },
}))

const objectRelationships = [
  { table: 'job_work_transfer_cancellation_items', name: 'job_work_transfer_cancellation', column: 'cancellation_id' },
  { table: 'job_work_transfer_cancellations', name: 'job_work_cancellation', column: 'job_work_cancellation_id' },
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
