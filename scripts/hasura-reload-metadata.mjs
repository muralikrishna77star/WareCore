#!/usr/bin/env node
/*
Script: Reload Hasura metadata so newly added Postgres columns
(job_work_items.job_line_id, job_work_output_items.source_job_line_id)
are picked up by the GraphQL schema.

Usage:
  node --env-file=.env.local scripts/hasura-reload-metadata.mjs
*/

const endpoint = process.env.HASURA_ENDPOINT
  || (process.env.NEXT_PUBLIC_HASURA_URL || '').replace('/v1/graphql', '')
const adminSecret = process.env.HASURA_ADMIN_SECRET

if (!endpoint || !adminSecret) {
  console.error('Missing HASURA_ENDPOINT/NEXT_PUBLIC_HASURA_URL or HASURA_ADMIN_SECRET environment variables.')
  process.exit(1)
}

const res = await fetch(new URL('/v1/metadata', endpoint), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': adminSecret },
  body: JSON.stringify({ type: 'reload_metadata', args: {} }),
})
console.log(await res.text())
