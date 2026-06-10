#!/usr/bin/env node
/*
Script: Track the new `job_work_output_items` table (migration 036) in Hasura
and create its object relationships, mirroring the relationships already
present on `job_work_items`.

Usage:
  node --env-file=.env.local scripts/hasura-track-job-work-output-items.mjs
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

console.log('Tracking table: job_work_output_items')
console.log(await callMetadata({
  type: 'pg_track_table',
  args: { source: 'warecore', table: { schema: 'public', name: 'job_work_output_items' } },
}))

const relationships = [
  { name: 'job_work_order', column: 'job_work_order_id' },
  { name: 'job_work_orders', column: 'job_work_order_id' },
  { name: 'material_type', column: 'material_type_id' },
  { name: 'material_types', column: 'material_type_id' },
  { name: 'material_size', column: 'material_size_id' },
  { name: 'material_sizes', column: 'material_size_id' },
]

for (const rel of relationships) {
  console.log(`Creating object relationship: ${rel.name} (${rel.column})`)
  console.log(await callMetadata({
    type: 'pg_create_object_relationship',
    args: {
      source: 'warecore',
      table: { schema: 'public', name: 'job_work_output_items' },
      name: rel.name,
      using: { foreign_key_constraint_on: rel.column },
    },
  }))
}
