#!/usr/bin/env node
/*
Script: Track `item_groups` table in Hasura and create object relationship from `item_master`.

Usage:
  Set environment variables and run:

  HASURA_ENDPOINT="https://your-hasura.example.com" \
  HASURA_ADMIN_SECRET="youradminsecret" \
  node scripts/hasura-track-item-groups.mjs

This script will:
  - Track the `item_groups` table (schema: public)
  - Ensure `item_master` is tracked (no-op if already tracked)
  - Create an object relationship `item_group` on `item_master` using `item_group_id`

It uses Hasura Metadata API v1 (`/v1/metadata`).
*/

const endpoint = process.env.HASURA_ENDPOINT
const adminSecret = process.env.HASURA_ADMIN_SECRET

if (!endpoint || !adminSecret) {
  console.error('Missing HASURA_ENDPOINT or HASURA_ADMIN_SECRET environment variables.')
  console.error('Example: HASURA_ENDPOINT="https://..." HASURA_ADMIN_SECRET="..." node scripts/hasura-track-item-groups.mjs')
  process.exit(1)
}

const fetchOptions = (body) => ({
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-hasura-admin-secret': adminSecret,
  },
  body: JSON.stringify(body),
})

async function callMetadata(body) {
  const res = await fetch(new URL('/v1/metadata', endpoint), fetchOptions(body))
  const txt = await res.text()
  try { return JSON.parse(txt) } catch (e) { return txt }
}

async function main() {
  console.log('Tracking table: item_groups')
  const trackItemGroups = {
    type: 'pg_track_table',
    args: {
      source: 'default',
      table: { schema: 'public', name: 'item_groups' },
    },
  }

  const resp1 = await callMetadata(trackItemGroups)
  console.log('track_item_groups response:', resp1)

  console.log('Tracking table: item_master (safe to call even if tracked)')
  const trackItemMaster = {
    type: 'pg_track_table',
    args: { source: 'default', table: { schema: 'public', name: 'item_master' } },
  }
  const resp2 = await callMetadata(trackItemMaster)
  console.log('track_item_master response:', resp2)

  console.log('Creating object relationship `item_group` on item_master using item_group_id')
  const createRel = {
    type: 'pg_create_object_relationship',
    args: {
      source: 'default',
      table: { schema: 'public', name: 'item_master' },
      name: 'item_group',
      using: { foreign_key_constraint_on: 'item_group_id' },
    },
  }
  const resp3 = await callMetadata(createRel)
  console.log('create_relationship response:', resp3)

  console.log('\nDone. If any step failed, check Hasura Console Data -> Untracked tables or Metadata logs.')
}

main().catch((err) => { console.error(err); process.exit(1) })
