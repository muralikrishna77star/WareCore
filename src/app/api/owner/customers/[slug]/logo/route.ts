import { NextRequest, NextResponse } from 'next/server'
import { forgetTenantCache, getControlPool, getTenantLogo, logTenantEvent } from '@/lib/tenancy/control'
import { requireOwner } from '@/lib/tenancy/ownerAuth'
import { MAX_LOGO_BYTES, sniffLogo } from '@/lib/tenancy/validation'

type Ctx = { params: Promise<{ slug: string }> }

/** The customer's logo, for the owner console's preview. */
export async function GET(request: NextRequest, { params }: Ctx) {
  const owner = await requireOwner(request)
  if (owner instanceof NextResponse) return owner
  const { slug } = await params
  const logo = await getTenantLogo(slug)
  if (!logo) return NextResponse.json({ error: 'No logo' }, { status: 404 })
  return new NextResponse(new Uint8Array(logo.bytes), {
    headers: { 'Content-Type': logo.mime, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' },
  })
}

/** Upload a logo: PNG, JPEG or WebP, up to 256 KB, sent as form field "logo". */
export async function POST(request: NextRequest, { params }: Ctx) {
  const owner = await requireOwner(request)
  if (owner instanceof NextResponse) return owner
  const { slug } = await params

  let file: File | null = null
  try {
    const form = await request.formData()
    const f = form.get('logo')
    file = f instanceof File ? f : null
  } catch {
    // fall through
  }
  if (!file) return NextResponse.json({ error: 'Choose a logo file' }, { status: 400 })
  if (file.size > MAX_LOGO_BYTES) return NextResponse.json({ error: 'The logo must be 256 KB or smaller' }, { status: 400 })
  const bytes = Buffer.from(await file.arrayBuffer())
  const mime = sniffLogo(bytes)
  if (!mime) return NextResponse.json({ error: 'The logo must be a PNG, JPEG or WebP image' }, { status: 400 })

  const { rows } = await getControlPool().query(
    `UPDATE tenants SET logo = $2, logo_mime = $3, updated_at = now() WHERE slug = $1 RETURNING id::text`,
    [slug, bytes, mime],
  )
  if (!rows[0]) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  await logTenantEvent(rows[0].id, owner.email, 'logo_changed', `${mime}, ${bytes.length} bytes`)
  forgetTenantCache()
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const owner = await requireOwner(request)
  if (owner instanceof NextResponse) return owner
  const { slug } = await params
  const { rows } = await getControlPool().query(
    `UPDATE tenants SET logo = NULL, logo_mime = NULL, updated_at = now() WHERE slug = $1 RETURNING id::text`,
    [slug],
  )
  if (!rows[0]) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  await logTenantEvent(rows[0].id, owner.email, 'logo_removed')
  forgetTenantCache()
  return NextResponse.json({ ok: true })
}
