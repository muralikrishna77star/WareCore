import { NextRequest, NextResponse } from 'next/server'
import { dbNameForSlug, isValidSlug, rootDomain } from '@/lib/tenancy/config'
import { getControlPool, listTenants, logTenantEvent } from '@/lib/tenancy/control'
import { requireOwner } from '@/lib/tenancy/ownerAuth'
import { provisionTenant } from '@/lib/tenancy/provision'
import { validateFirstAdmin, validateTenantFields } from '@/lib/tenancy/validation'

// Creating a customer's database and running every migration takes a while.
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const owner = await requireOwner(request)
  if (owner instanceof NextResponse) return owner
  return NextResponse.json({ customers: await listTenants(), rootDomain: rootDomain() })
}

/** Adds a customer and sets them up: database, migrations, first admin, address. */
export async function POST(request: NextRequest) {
  const owner = await requireOwner(request)
  if (owner instanceof NextResponse) return owner

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const slug = String(body.slug ?? '').toLowerCase().trim()
  if (!isValidSlug(slug)) {
    return NextResponse.json({
      error: 'The address name must be 2–30 lower-case letters, digits or single hyphens, start with a letter, and not be a reserved word (www, console, admin…).',
    }, { status: 400 })
  }
  const fields = validateTenantFields({ displayName: body.displayName, brandColor: body.brandColor })
  if ('error' in fields) return NextResponse.json({ error: fields.error }, { status: 400 })
  if (!fields.displayName) return NextResponse.json({ error: 'Customer name is required' }, { status: 400 })
  const admin = validateFirstAdmin(body.admin)
  if ('error' in admin) return NextResponse.json({ error: admin.error }, { status: 400 })

  const host = `${slug}.${rootDomain()}`
  const dbName = dbNameForSlug(slug)
  const pool = getControlPool()
  const client = await pool.connect()
  let tenantId: string
  try {
    await client.query('BEGIN')
    const taken = await client.query(
      'SELECT 1 FROM tenants WHERE slug = $1 OR db_name = $2 UNION ALL SELECT 1 FROM tenant_domains WHERE host = $3',
      [slug, dbName, host],
    )
    if (taken.rowCount) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: `${host} is already taken` }, { status: 409 })
    }
    const ins = await client.query(
      `INSERT INTO tenants (slug, display_name, db_name, brand_color, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id::text`,
      [slug, fields.displayName, dbName, fields.brandColor ?? null, owner.email],
    )
    tenantId = ins.rows[0].id
    await client.query('INSERT INTO tenant_domains (host, tenant_id, is_primary) VALUES ($1, $2, true)', [host, tenantId])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  await logTenantEvent(tenantId, owner.email, 'customer_added', `${fields.displayName} at ${host}`)

  const result = await provisionTenant(tenantId, admin, owner.email)
  return NextResponse.json({ slug, host, ...result }, { status: result.ok ? 201 : 500 })
}
