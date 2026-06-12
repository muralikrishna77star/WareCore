#!/usr/bin/env node
/*
Script: Add the missing array relationship `job_work_output_items` on
`job_work_orders`, pointing at job_work_output_items.job_work_order_id.

The table itself was already tracked (with object relationships back to
job_work_orders), but the reverse array relationship on job_work_orders
was never created — causing GetJobWorkOrderForEdit to fail with
"field 'job_work_output_items' not found in type: 'job_work_orders'".

Usage:
  node --env-file=.env.local scripts/hasura-track-jwo-output-relationship.mjs
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

console.log('Creating array relationship: job_work_orders.job_work_output_items')
console.log(await callMetadata({
  type: 'pg_create_array_relationship',
  args: {
    source: 'warecore',
    table: { schema: 'public', name: 'job_work_orders' },
    name: 'job_work_output_items',
    using: {
      foreign_key_constraint_on: {
        column: 'job_work_order_id',
        table: { schema: 'public', name: 'job_work_output_items' },
      },
    },
  },
}))
