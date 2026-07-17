#!/usr/bin/env node
/*
Script: Track the new `ai_conversations` and `ai_messages` tables
(migration 058) in Hasura and create their relationships.

Usage:
  node --env-file=.env.local scripts/hasura-track-ai-copilot.mjs
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
  'ai_conversations',
  'ai_messages',
]

for (const table of tables) {
  console.log(`Tracking table: ${table}`)
  console.log(await callMetadata({
    type: 'pg_track_table',
    args: { source: 'warecore', table: { schema: 'public', name: table } },
  }))
}

console.log('Creating array relationship: ai_conversations.ai_messages')
console.log(await callMetadata({
  type: 'pg_create_array_relationship',
  args: {
    source: 'warecore',
    table: { schema: 'public', name: 'ai_conversations' },
    name: 'ai_messages',
    using: {
      foreign_key_constraint_on: {
        table: { schema: 'public', name: 'ai_messages' },
        column: 'conversation_id',
      },
    },
  },
}))

console.log('Creating object relationship: ai_messages.ai_conversations (conversation_id)')
console.log(await callMetadata({
  type: 'pg_create_object_relationship',
  args: {
    source: 'warecore',
    table: { schema: 'public', name: 'ai_messages' },
    name: 'ai_conversations',
    using: { foreign_key_constraint_on: 'conversation_id' },
  },
}))
