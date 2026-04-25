/**
 * Creates a user in WareCore's user_profiles table.
 * Run: node scripts/create-user.mjs
 *
 * For Google OAuth users, leave password blank (they won't use password login).
 * For password users, provide a password and a bcrypt hash will be generated.
 */

import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const require = createRequire(import.meta.url)

// Load .env.local manually
const envPath = resolve(process.cwd(), '.env.local')
const envLines = readFileSync(envPath, 'utf-8').split('\n')
for (const line of envLines) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const idx = trimmed.indexOf('=')
  if (idx === -1) continue
  const key = trimmed.slice(0, idx).trim()
  const val = trimmed.slice(idx + 1).trim()
  process.env[key] = val
}

const bcrypt = require('bcryptjs')

const HASURA_URL = process.env.NEXT_PUBLIC_HASURA_URL
const HASURA_SECRET = process.env.HASURA_ADMIN_SECRET

if (!HASURA_URL || !HASURA_SECRET) {
  console.error('Missing NEXT_PUBLIC_HASURA_URL or HASURA_ADMIN_SECRET in .env.local')
  process.exit(1)
}

// ── Configure the user to create ───────────────────────────────────────────
const USER = {
  full_name: 'Murali Krishna',
  email: 'muralikrishna77star@gmail.com',
  role: 'admin',        // 'admin' | 'manager' | 'staff'
  password: '',         // Leave blank for Google-only login
}
// ───────────────────────────────────────────────────────────────────────────

const INSERT_USER = `
  mutation InsertUser(
    $full_name: String!
    $email: String!
    $role: String!
    $password_hash: String!
    $is_active: Boolean!
  ) {
    insert_user_profiles_one(
      object: {
        full_name: $full_name
        email: $email
        role: $role
        password_hash: $password_hash
        is_active: $is_active
      }
      on_conflict: {
        constraint: user_profiles_email_key
        update_columns: [full_name, role, is_active]
      }
    ) {
      id
      email
      role
    }
  }
`

async function main() {
  const password_hash = USER.password
    ? await bcrypt.hash(USER.password, 12)
    : 'GOOGLE_OAUTH_USER' // placeholder — password login won't work without a real hash

  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': HASURA_SECRET,
    },
    body: JSON.stringify({
      query: INSERT_USER,
      variables: {
        full_name: USER.full_name,
        email: USER.email.toLowerCase(),
        role: USER.role,
        password_hash,
        is_active: true,
      },
    }),
  })

  const json = await res.json()

  if (json.errors) {
    console.error('Hasura error:', JSON.stringify(json.errors, null, 2))
    process.exit(1)
  }

  const created = json.data?.insert_user_profiles_one
  console.log('✓ User created/updated successfully:')
  console.log(`  ID:    ${created.id}`)
  console.log(`  Email: ${created.email}`)
  console.log(`  Role:  ${created.role}`)
  console.log()
  console.log('You can now sign in with Google using this email.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
