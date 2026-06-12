#!/usr/bin/env node
/*
Script: Track the new `job_work_cancellations`, `job_work_cancellation_items`
and `job_work_cancellation_output_items` tables (migration 039) in Hasura
and create their relationships.

Usage:
  node --env-file=.env.local scripts/hasura-track-job-work-cancellations.mjs
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
  'job_work_cancellations',
  'job_work_cancellation_items',
  'job_work_cancellation_output_items',
]

for (const table of tables) {
  console.log(`Tracking table: ${table}`)
  console.log(await callMetadata({
    type: 'pg_track_table',
    args: { source: 'warecore', table: { schema: 'public', name: table } },
  }))
}

const arrayRelationships = [
  { table: 'job_work_cancellations', name: 'job_work_cancellation_items', childTable: 'job_work_cancellation_items', column: 'cancellation_id' },
  { table: 'job_work_cancellations', name: 'job_work_cancellation_output_items', childTable: 'job_work_cancellation_output_items', column: 'cancellation_id' },
]

for (const rel of arrayRelationships) {
  console.log(`Creating array relationship: ${rel.table}.${rel.name}`)
  console.log(await callMetadata({
    type: 'pg_create_array_relationship',
    args: {
      source: 'warecore',
      table: { schema: 'public', name: rel.table },
      name: rel.name,
      using: {
        foreign_key_constraint_on: {
          table: { schema: 'public', name: rel.childTable },
          column: rel.column,
        },
      },
    },
  }))
}

const objectRelationships = [
  { table: 'job_work_cancellation_items', name: 'job_work_cancellation', column: 'cancellation_id' },
  { table: 'job_work_cancellation_output_items', name: 'job_work_cancellation', column: 'cancellation_id' },
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
