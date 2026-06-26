import pg from 'pg'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'

const { Client } = pg

const DEFAULT_EMAIL = 'TestUser'
const DEFAULT_PASSWORD = 'TestPassword'
const DEFAULT_FULL_NAME = 'Test User'

/**
 * Creates a demo admin account (TestUser / TestPassword) the first time the
 * desktop app runs against an empty database, so there's something to log
 * in with immediately — without it, a fresh install lands on /setup and
 * needs a manual admin-creation step before the app is usable at all.
 * No-ops once any user already exists (including the demo one itself).
 */
export async function ensureDefaultUser({ connectionString, log = console.log }) {
  const client = new Client({ connectionString })
  await client.connect()

  try {
    const { rows } = await client.query('SELECT count(*)::int AS count FROM user_profiles')
    if (rows[0].count > 0) return

    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12)
    // Login normalizes the typed email with .toLowerCase().trim() before
    // querying — store it the same way, or "TestUser" (mixed case) would
    // never match and login would 401 despite the account existing.
    await client.query(
      `INSERT INTO user_profiles (id, full_name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, 'admin', true)`,
      [randomUUID(), DEFAULT_FULL_NAME, DEFAULT_EMAIL.toLowerCase(), passwordHash]
    )
    log(`Created default demo account — log in with "${DEFAULT_EMAIL}" / "${DEFAULT_PASSWORD}".`)
  } finally {
    await client.end()
  }
}
