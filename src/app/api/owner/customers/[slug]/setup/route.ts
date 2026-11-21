import { NextRequest, NextResponse } from 'next/server'
import { getControlPool } from '@/lib/tenancy/control'
import { requireOwner } from '@/lib/tenancy/ownerAuth'
import { provisionTenant } from '@/lib/tenancy/provision'
import { validateFirstAdmin } from '@/lib/tenancy/validation'

export const maxDuration = 300

type Ctx = { params: Promise<{ slug: string }> }

/**
 * Runs set-up again for a customer whose set-up failed or stopped part-way.
 * Steps already done are skipped. The first admin's details are asked for
 * again because passwords are never kept.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const owner = await requireOwner(request)
  if (owner instanceof NextResponse) return owner
  const { slug } = await params
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const admin = validateFirstAdmin(body.admin)
  if ('error' in admin) return NextResponse.json({ error: admin.error }, { status: 400 })

  const { rows } = await getControlPool().query('SELECT id::text, status FROM tenants WHERE slug = $1', [slug])
  if (!rows[0]) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  if (!['failed', 'provisioning'].includes(rows[0].status)) {
    return NextResponse.json({ error: `This customer is ${rows[0].status}; set-up only re-runs after a failure` }, { status: 400 })
  }
  const result = await provisionTenant(rows[0].id, admin, owner.email)
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
