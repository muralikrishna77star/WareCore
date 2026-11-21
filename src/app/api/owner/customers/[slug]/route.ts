import { NextRequest, NextResponse } from 'next/server'
import { forgetTenantCache, getControlPool, logTenantEvent } from '@/lib/tenancy/control'
import { requireOwner } from '@/lib/tenancy/ownerAuth'
import { validateTenantFields } from '@/lib/tenancy/validation'

type Ctx = { params: Promise<{ slug: string }> }

export async function GET(request: NextRequest, { params }: Ctx) {
  const owner = await requireOwner(request)
  if (owner instanceof NextResponse) return owner
  const { slug } = await params
  const pool = getControlPool()
  const { rows } = await pool.query(
    `SELECT t.id::text, t.slug, t.display_name, t.db_name, t.status, t.brand_color, (t.logo IS NOT NULL) AS has_logo,
            t.google_sign_in, t.provision_error, t.created_at, t.created_by,
            extract(epoch FROM t.updated_at)::bigint::text AS version,
            ARRAY(SELECT host FROM tenant_domains d WHERE d.tenant_id = t.id ORDER BY d.is_primary DESC, d.host) AS hosts
       FROM tenants t WHERE t.slug = $1`,
    [slug],
  )
  if (!rows[0]) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  const events = await pool.query(
    `SELECT action, detail, owner_email, created_at FROM tenant_events WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50`,
    [rows[0].id],
  )
  return NextResponse.json({ customer: rows[0], events: events.rows })
}

/** Name, colour, Google sign-in, and switching a customer off or back on. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const owner = await requireOwner(request)
  if (owner instanceof NextResponse) return owner
  const { slug } = await params
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const fields = validateTenantFields({ displayName: body.displayName, brandColor: body.brandColor })
  if ('error' in fields) return NextResponse.json({ error: fields.error }, { status: 400 })

  const sets: string[] = []
  const values: unknown[] = [slug]
  const add = (col: string, v: unknown) => { values.push(v); sets.push(`${col} = $${values.length}`) }
  if (fields.displayName !== undefined) add('display_name', fields.displayName)
  if (fields.brandColor !== undefined) add('brand_color', fields.brandColor)
  if (body.googleSignIn !== undefined) add('google_sign_in', body.googleSignIn === true)

  const pool = getControlPool()
  const current = await pool.query('SELECT id::text, status FROM tenants WHERE slug = $1', [slug])
  if (!current.rows[0]) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  if (body.status !== undefined) {
    // Only switching off and back on here; setting up is POST …/setup.
    const from = current.rows[0].status
    const to = body.status
    const allowed = (from === 'active' && to === 'suspended') || (from === 'suspended' && to === 'active')
    if (!allowed) return NextResponse.json({ error: `Can't change a ${from} customer to ${String(to)}` }, { status: 400 })
    add('status', to)
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })

  await pool.query(`UPDATE tenants SET ${sets.join(', ')}, updated_at = now() WHERE slug = $1`, values)
  const changed = Object.keys(body).filter((k) => ['displayName', 'brandColor', 'googleSignIn', 'status'].includes(k))
  await logTenantEvent(current.rows[0].id, owner.email, body.status === 'suspended' ? 'suspended' : body.status === 'active' ? 'reactivated' : 'updated',
    changed.map((k) => `${k}=${JSON.stringify(body[k])}`).join(', '))
  forgetTenantCache()
  return NextResponse.json({ ok: true })
}
