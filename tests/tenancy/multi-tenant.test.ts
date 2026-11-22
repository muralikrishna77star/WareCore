// Multi-customer mode: one deployment, one database per customer, picked by
// the web address. Runs against a throwaway Postgres: the harness database
// plays BSM's existing database, and a second customer is set up from
// scratch through the owner console's own API route.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { NextRequest } from 'next/server'
import { startTestDb } from '../../scripts/test/testDb.mjs'

let db: Awaited<ReturnType<typeof startTestDb>>
let saiDb: string
let session: typeof import('@/lib/auth/session')
let ownerSession: typeof import('@/lib/tenancy/ownerSession')
let control: typeof import('@/lib/tenancy/control')
let context: typeof import('@/lib/tenancy/context')
let config: typeof import('@/lib/tenancy/config')
let pool: typeof import('@/lib/localdb/pool')
let sql: typeof import('@/lib/localdb/sql')
let proxyMod: typeof import('@/proxy')
let ownerToken: string

const OWNER_EMAIL = 'owner@warecore.test'
const OWNER_PASSWORD = 'owner-password-123'
const MIGRATION_FILES = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'))

const withDb = (db: string) => { const u = new URL(process.env.DATABASE_URL!); u.pathname = `/${db}`; return u.toString() }
async function query(dbName: string, text: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: withDb(dbName) })
  await c.connect()
  try { return (await c.query(text, params)).rows } finally { await c.end() }
}

function setupControl(extra: string[] = []) {
  return execFileSync(process.execPath, [
    'scripts/tenants/setup-control.mjs', '--database-url', db.connectionString,
    '--slug', 'bsm', '--name', 'BSM', '--db', saiDb,
    '--host', 'bsm.warecore.space', '--extra-host', 'warecore.vercel.app', '--google',
    '--baseline', '--owner-email', OWNER_EMAIL, '--owner-name', 'Owner', ...extra,
  ], { env: { ...process.env, OWNER_PASSWORD }, encoding: 'utf-8' })
}

const req = (url: string, init: { headers?: Record<string, string>; method?: string; body?: string } = {}) => {
  const host = new URL(url).host
  return new NextRequest(url, { method: init.method ?? 'GET', body: init.body, headers: { host, ...(init.headers ?? {}) } })
}
const forwardedHeader = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`)

beforeAll(async () => {
  db = await startTestDb({})
  saiDb = new URL(db.connectionString).pathname.slice(1)
  process.env.DATABASE_URL = db.connectionString
  process.env.DIRECT_DB = 'true'
  process.env.JWT_SECRET = 'test-secret-for-multi-tenant'
  process.env.MULTI_TENANT = 'true'
  delete process.env.LOCAL_MODE
  session = await import('@/lib/auth/session')
  ownerSession = await import('@/lib/tenancy/ownerSession')
  control = await import('@/lib/tenancy/control')
  context = await import('@/lib/tenancy/context')
  config = await import('@/lib/tenancy/config')
  pool = await import('@/lib/localdb/pool')
  sql = await import('@/lib/localdb/sql')
  proxyMod = await import('@/proxy')

  // The live database was migrated by hand: no record of which migrations ran.
  const c = new pg.Client({ connectionString: db.connectionString })
  await c.connect()
  await c.query('ALTER TABLE schema_migrations RENAME TO schema_migrations_harness')
  await c.end()
}, 120_000)

afterAll(async () => {
  await pool?.closePool()
  await control?.closeControlPool()
  await db?.stop()
})

describe('switch-over script', () => {
  it('creates the registry, registers the existing database and baselines its migrations', async () => {
    const out = setupControl()
    expect(out).toContain('Created registry database warecore_control')
    expect(out).toContain(`Recorded ${MIGRATION_FILES.length} migrations`)
    expect(out).toContain(`Created owner account ${OWNER_EMAIL}`)
    expect(out).not.toContain(OWNER_PASSWORD) // a given password is never echoed

    const [t] = await query('warecore_control', `SELECT slug, display_name, db_name, status, google_sign_in FROM tenants`)
    expect(t).toMatchObject({ slug: 'bsm', display_name: 'BSM', db_name: saiDb, status: 'active', google_sign_in: true })
    const hosts = await query('warecore_control', `SELECT host, is_primary FROM tenant_domains ORDER BY host`)
    expect(hosts).toEqual([{ host: 'bsm.warecore.space', is_primary: true }, { host: 'warecore.vercel.app', is_primary: false }])
    const [{ n }] = await query(saiDb, 'SELECT count(*)::int AS n FROM schema_migrations')
    expect(n).toBe(MIGRATION_FILES.length)
  }, 60_000)

  it('is safe to run again', () => {
    const out = setupControl()
    expect(out).toContain('already exists')
    expect(out).toContain(`already records ${MIGRATION_FILES.length} migrations; not baselining`)
    expect(out).toContain('already exists; password unchanged')
  }, 60_000)

  it('migrate-all finds nothing pending for the switched-over database', () => {
    const out = execFileSync(process.execPath, ['scripts/tenants/migrate-all.mjs', '--dry-run'], { encoding: 'utf-8' })
    expect(out).toContain(`bsm (${saiDb}): up to date`)
  }, 60_000)
})

describe('owner console', () => {
  it('signs in the owner on the console address only', async () => {
    const login = await import('@/app/api/owner/login/route')
    const body = JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD })
    const onCustomer = await login.POST(req('https://bsm.warecore.space/api/owner/login', { method: 'POST', body }))
    expect(onCustomer.status).toBe(404)
    const wrong = await login.POST(req('https://console.warecore.space/api/owner/login', { method: 'POST', body: JSON.stringify({ email: OWNER_EMAIL, password: 'nope-nope-nope' }) }))
    expect(wrong.status).toBe(401)
    const ok = await login.POST(req('https://console.warecore.space/api/owner/login', { method: 'POST', body }))
    expect(ok.status).toBe(200)
    ownerToken = ok.cookies.get(ownerSession.OWNER_COOKIE_NAME)!.value
    expect(ownerSession.verifyOwnerToken(ownerToken)?.email).toBe(OWNER_EMAIL)
  })

  it('refuses bad addresses and taken ones', async () => {
    const route = await import('@/app/api/owner/customers/route')
    const admin = { fullName: 'A', email: 'a@x.test', password: 'long-enough-1' }
    const post = (slug: string) => route.POST(req('https://console.warecore.space/api/owner/customers', {
      method: 'POST', headers: { cookie: `wc_owner=${ownerToken}` }, body: JSON.stringify({ slug, displayName: 'X', admin }),
    }))
    expect((await post('console')).status).toBe(400) // reserved
    expect((await post('Bad_Name')).status).toBe(400)
    expect((await post('a')).status).toBe(400)
    expect((await post('bsm')).status).toBe(409)
    const noCookie = await route.POST(req('https://console.warecore.space/api/owner/customers', { method: 'POST', body: '{}' }))
    expect(noCookie.status).toBe(401)
  })

  it('sets up a new customer end to end: database, migrations, first admin', async () => {
    const route = await import('@/app/api/owner/customers/route')
    const res = await route.POST(req('https://console.warecore.space/api/owner/customers', {
      method: 'POST', headers: { cookie: `wc_owner=${ownerToken}` },
      body: JSON.stringify({ slug: 'acme-steel', displayName: 'Acme Steel', brandColor: '#0F766E', admin: { fullName: 'Acme Admin', email: ' Admin@Acme.test ', password: 'acme-password-1' } }),
    }))
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body).toMatchObject({ ok: true, host: 'acme-steel.warecore.space', adminCreated: true, domain: { state: 'manual' } })

    const [t] = await query('warecore_control', `SELECT status, db_name, brand_color FROM tenants WHERE slug = 'acme-steel'`)
    expect(t).toEqual({ status: 'active', db_name: 'wc_acme_steel', brand_color: '#0f766e' })
    const users = await query('wc_acme_steel', 'SELECT email, role, is_active FROM user_profiles')
    expect(users).toEqual([{ email: 'admin@acme.test', role: 'admin', is_active: true }])
    const [{ n }] = await query('wc_acme_steel', 'SELECT count(*)::int AS n FROM schema_migrations')
    const { PRODUCTION_DATA_DEPENDENT_MIGRATIONS } = await import('../../scripts/desktop/productionDataMigrations.mjs')
    expect(n).toBe(MIGRATION_FILES.length - [...PRODUCTION_DATA_DEPENDENT_MIGRATIONS].filter((f) => MIGRATION_FILES.includes(f)).length)
    // A new customer starts empty: none of BSM's companies.
    const [{ c }] = await query('wc_acme_steel', 'SELECT count(*)::int AS c FROM companies')
    expect(c).toBe(0)
  }, 240_000)

  it('re-running set-up skips what is done and adds no second admin', async () => {
    const pool = control.getControlPool()
    await pool.query(`UPDATE tenants SET status = 'failed' WHERE slug = 'acme-steel'`)
    const setup = await import('@/app/api/owner/customers/[slug]/setup/route')
    const res = await setup.POST(req('https://console.warecore.space/api/owner/customers/acme-steel/setup', {
      method: 'POST', headers: { cookie: `wc_owner=${ownerToken}` },
      body: JSON.stringify({ admin: { fullName: 'Other', email: 'other@acme.test', password: 'other-password-1' } }),
    }), { params: Promise.resolve({ slug: 'acme-steel' }) })
    expect(await res.json()).toMatchObject({ ok: true, migrationsApplied: 0, adminCreated: false })
    expect(await query('wc_acme_steel', 'SELECT email FROM user_profiles')).toEqual([{ email: 'admin@acme.test' }])
  }, 120_000)

  it('changes name and colour, takes PNG logos and refuses SVG', async () => {
    const one = await import('@/app/api/owner/customers/[slug]/route')
    const logo = await import('@/app/api/owner/customers/[slug]/logo/route')
    const params = { params: Promise.resolve({ slug: 'acme-steel' }) }
    const cookie = { cookie: `wc_owner=${ownerToken}` }
    const patch = await one.PATCH(req('https://console.warecore.space/api/owner/customers/acme-steel', {
      method: 'PATCH', headers: cookie, body: JSON.stringify({ displayName: '  Acme   Steel Pvt Ltd ', brandColor: '#B91C1C' }),
    }), params)
    expect(patch.status).toBe(200)
    expect((await control.findTenantBySlug('acme-steel', { fresh: true }))).toMatchObject({ displayName: 'Acme Steel Pvt Ltd', brandColor: '#b91c1c' })

    const upload = (bytes: Buffer, type: string) => {
      const form = new FormData()
      form.append('logo', new Blob([new Uint8Array(bytes)], { type }), 'logo')
      return logo.POST(new NextRequest('https://console.warecore.space/api/owner/customers/acme-steel/logo', {
        method: 'POST', body: form, headers: { host: 'console.warecore.space', ...cookie },
      }), params)
    }
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect((await upload(svg, 'image/png')).status).toBe(400) // labelled PNG, but isn't one
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')
    expect((await upload(png, 'image/png')).status).toBe(200)
    expect((await control.findTenantBySlug('acme-steel', { fresh: true }))?.hasLogo).toBe(true)

    const bad = await one.PATCH(req('https://console.warecore.space/api/owner/customers/acme-steel', {
      method: 'PATCH', headers: cookie, body: JSON.stringify({ status: 'provisioning' }),
    }), params)
    expect(bad.status).toBe(400)
  })
})

describe('each address opens its own customer only', () => {
  it('finds customers by address, ignoring case and port', async () => {
    control.forgetTenantCache()
    expect((await control.findTenantByHost('BSM.warecore.space:443'))?.slug).toBe('bsm')
    expect((await control.findTenantByHost('warecore.vercel.app'))?.slug).toBe('bsm')
    expect((await control.findTenantByHost('acme-steel.warecore.space'))?.slug).toBe('acme-steel')
    expect(await control.findTenantByHost('nobody.warecore.space')).toBeNull()
  })

  it('reads and writes the right database, and never a default one', async () => {
    const sai = { slug: 'bsm', dbName: saiDb }
    const acme = { slug: 'acme-steel', dbName: 'wc_acme_steel' }
    await context.runWithTenant(sai, () => sql.runSqlLocal(`INSERT INTO companies (name, code) VALUES ('Sai Only Co', 'SAIONLY')`))
    const inSai = await context.runWithTenant(sai, () => sql.runSqlLocal(`SELECT count(*) FROM companies WHERE code = 'SAIONLY'`))
    const inAcme = await context.runWithTenant(acme, () => sql.runSqlLocal(`SELECT count(*) FROM companies WHERE code = 'SAIONLY'`))
    expect(inSai.result?.[1]).toEqual(['1'])
    expect(inAcme.result?.[1]).toEqual(['0'])
    // No customer chosen: refuse rather than guess.
    await expect(sql.runSqlLocal('SELECT 1')).rejects.toThrow(/No WareCore customer/)
  })

  it('proxy: picks the customer from the address and overwrites any spoofed choice', async () => {
    const token = session.signSession({ userId: 'u1', email: 'a', role: 'admin', fullName: 'A', tenant: 'acme-steel' })
    const res = await proxyMod.proxy(req('https://acme-steel.warecore.space/dashboard', {
      headers: { cookie: `wc_session=${token}`, 'x-warecore-tenant': 'bsm', 'x-warecore-tenant-db': saiDb },
    }))
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(forwardedHeader(res, 'x-warecore-tenant')).toBe('acme-steel')
    expect(forwardedHeader(res, 'x-warecore-tenant-db')).toBe('wc_acme_steel')
  })

  it('proxy: another customer\'s sign-in is dropped and never reaches the app', async () => {
    const saiToken = session.signSession({ userId: 'u1', email: 'a', role: 'admin', fullName: 'A', tenant: 'bsm' })
    const page = await proxyMod.proxy(req('https://acme-steel.warecore.space/dashboard', { headers: { cookie: `wc_session=${saiToken}` } }))
    expect(page.status).toBe(307)
    expect(new URL(page.headers.get('location')!).pathname).toBe('/login')
    expect(page.headers.get('set-cookie')).toMatch(/wc_session=;/)

    const api = await proxyMod.proxy(req('https://acme-steel.warecore.space/api/stock/verify', { headers: { cookie: `wc_session=${saiToken}; other=1` } }))
    expect(api.headers.get('x-middleware-next')).toBe('1')
    expect(forwardedHeader(api, 'cookie')).toBe('other=1')

    // A session from before multi-customer mode (no customer in it) is dropped too.
    const legacy = session.signSession({ userId: 'u1', email: 'a', role: 'admin', fullName: 'A' })
    const old = await proxyMod.proxy(req('https://bsm.warecore.space/dashboard', { headers: { cookie: `wc_session=${legacy}` } }))
    expect(new URL(old.headers.get('location')!).pathname).toBe('/login')
  })

  it('proxy: unknown, switched-off and owner-only addresses', async () => {
    const unknown = await proxyMod.proxy(req('https://nobody.warecore.space/login'))
    expect(unknown.status).toBe(404)
    expect(unknown.headers.get('x-middleware-rewrite')).toContain('/unavailable?reason=unknown')

    await control.getControlPool().query(`UPDATE tenants SET status = 'suspended' WHERE slug = 'acme-steel'`)
    control.forgetTenantCache()
    const off = await proxyMod.proxy(req('https://acme-steel.warecore.space/login'))
    expect(off.status).toBe(403)
    expect(off.headers.get('x-middleware-rewrite')).toContain('reason=suspended')
    await control.getControlPool().query(`UPDATE tenants SET status = 'active' WHERE slug = 'acme-steel'`)
    control.forgetTenantCache()

    expect((await proxyMod.proxy(req('https://acme-steel.warecore.space/owner'))).status).toBe(404)
    expect((await proxyMod.proxy(req('https://console.warecore.space/dashboard'))).status).toBe(404)
    const consoleNoOwner = await proxyMod.proxy(req('https://console.warecore.space/owner'))
    expect(new URL(consoleNoOwner.headers.get('location')!).pathname).toBe('/owner/login')
    const consoleOwner = await proxyMod.proxy(req('https://console.warecore.space/owner', { headers: { cookie: `wc_owner=${ownerToken}` } }))
    expect(consoleOwner.headers.get('x-middleware-next')).toBe('1')
    expect((await proxyMod.proxy(req('https://warecore.space/tour'))).headers.get('x-middleware-next')).toBe('1')
    expect((await proxyMod.proxy(req('https://warecore.space/dashboard'))).status).toBe(404)
    // A customer's address never shows the sales tour: visitors get the
    // customer tour page (no sign-in), signed-in staff the in-app one.
    const visitorTour = await proxyMod.proxy(req('https://bsm.warecore.space/tour'))
    expect(visitorTour.headers.get('x-middleware-rewrite')).toContain('/customer-tour')
    expect(forwardedHeader(visitorTour, 'x-warecore-tenant')).toBe('bsm')
    const staff = session.signSession({ userId: 'u1', email: 'a', role: 'admin', fullName: 'A', tenant: 'bsm' })
    const staffTour = await proxyMod.proxy(req('https://bsm.warecore.space/tour', { headers: { cookie: `wc_session=${staff}` } }))
    expect(new URL(staffTour.headers.get('location')!).pathname).toBe('/help/tour')
    // The page behind the rewrite is not itself an open address.
    expect(new URL((await proxyMod.proxy(req('https://bsm.warecore.space/customer-tour'))).headers.get('location')!).pathname).toBe('/login')
    expect((await proxyMod.proxy(req('https://warecore.space/customer-tour'))).status).toBe(404)
  })

  it('an owner token is never a customer session, and the reverse', () => {
    expect(session.verifySession(ownerToken)).toBeNull()
    const customer = session.signSession({ userId: 'u1', email: 'a', role: 'admin', fullName: 'A', tenant: 'bsm' })
    expect(ownerSession.verifyOwnerToken(customer)).toBeNull()
  })
})

describe('single-customer mode is unchanged', () => {
  it('uses DATABASE_URL with no customer and the old sign-in rules', async () => {
    process.env.MULTI_TENANT = 'false'
    try {
      expect(await context.currentTenant()).toBeNull()
      const r = await sql.runSqlLocal(`SELECT count(*) FROM companies WHERE code = 'SAIONLY'`)
      expect(r.result?.[1]).toEqual(['1'])
      const noSession = await proxyMod.proxy(req('https://warecore.vercel.app/dashboard?x=1'))
      expect(noSession.headers.get('location')).toBe('https://warecore.vercel.app/login?x=1')
      const legacy = session.signSession({ userId: 'u1', email: 'a', role: 'admin', fullName: 'A' })
      const ok = await proxyMod.proxy(req('https://warecore.vercel.app/dashboard', { headers: { cookie: `wc_session=${legacy}`, 'x-warecore-tenant': 'acme-steel' } }))
      expect(ok.headers.get('x-middleware-next')).toBe('1')
      expect(forwardedHeader(ok, 'x-warecore-tenant')).toBeNull()
    } finally {
      process.env.MULTI_TENANT = 'true'
    }
  })
})

describe('helpers', () => {
  it('address names', () => {
    for (const ok of ['bsm', 'acme-steel', 'ds2']) expect(config.isValidSlug(ok)).toBe(true)
    for (const bad of ['www', 'console', 'a', '1abc', 'ab-', 'a--b', 'Abc', 'a_b', 'x'.repeat(31)]) expect(config.isValidSlug(bad)).toBe(false)
    expect(config.dbNameForSlug('acme-steel')).toBe('wc_acme_steel')
    expect(() => config.databaseUrlFor('postgres://u:p@h/db', 'x"; DROP')).toThrow()
    expect(config.databaseUrlFor('postgres://u:p@h:5432/neondb?sslmode=require', 'wc_a')).toBe('postgres://u:p@h:5432/wc_a?sslmode=require')
    expect(config.directUrl('postgres://u:p@ep-x-pooler.ap-southeast-1.aws.neon.tech/db')).toBe('postgres://u:p@ep-x.ap-southeast-1.aws.neon.tech/db')
  })

  it('brand colour re-colours the blue scale', async () => {
    const { brandCss } = await import('@/lib/tenancy/brandShared')
    expect(brandCss(null)).toBe('')
    expect(brandCss('red;}body{display:none')).toBe('')
    const css = brandCss('#0f766e')
    expect(css).toContain('--color-blue-600:#0f766e')
    expect(css).toContain('--color-blue-50:color-mix(in oklab, #0f766e 7%, white)')
  })

  it('one customer\'s repair migrations run only for that customer', async () => {
    const { skipFilenamesFor } = await import('../../scripts/tenants/customerMigrations.mjs')
    const dir = mkdtempSync(join(tmpdir(), 'wc-mig-'))
    try {
      writeFileSync(join(dir, '900_schema.sql'), 'SELECT 1;\n')
      writeFileSync(join(dir, '901_fix_sai_rows.sql'), '-- warecore-customer: bsm\nSELECT 1;\n')
      writeFileSync(join(dir, '902_fix_acme_rows.sql'), '-- warecore-customer: acme-steel\r\nSELECT 1;\r\n')
      const sai = skipFilenamesFor('bsm', dir)
      const acme = skipFilenamesFor('acme-steel', dir)
      expect([sai.has('900_schema.sql'), sai.has('901_fix_sai_rows.sql'), sai.has('902_fix_acme_rows.sql')]).toEqual([false, false, true])
      expect([acme.has('900_schema.sql'), acme.has('901_fix_sai_rows.sql'), acme.has('902_fix_acme_rows.sql')]).toEqual([false, true, false])
      expect(sai.has('063_restore_job_work_transfer_ledger.sql')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
