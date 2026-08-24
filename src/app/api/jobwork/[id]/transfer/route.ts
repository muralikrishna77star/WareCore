import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager'])

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Single atomic call replacing the old 5-step client-side sequence (create
// order, create items, update source quantity_transferred_out, create
// transfer audit row, create transfer items) — see migration 120 for why:
// that sequence once left a transfer's ledger legs unposted while every
// other table involved still recorded it as complete.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  if (!uuidRe.test(id)) return NextResponse.json({ error: 'Invalid job work order ID' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const { target_vendor_id, transfer_date, reference_number, transfer_number, reason, notes, lines } = body

  if (!uuidRe.test(target_vendor_id ?? '')) return NextResponse.json({ error: 'target_vendor_id is required' }, { status: 400 })
  if (!transfer_date) return NextResponse.json({ error: 'transfer_date is required' }, { status: 400 })
  if (!reference_number || !transfer_number) return NextResponse.json({ error: 'reference_number and transfer_number are required' }, { status: 400 })
  if (!Array.isArray(lines) || !lines.length) return NextResponse.json({ error: 'At least one line is required' }, { status: 400 })

  const escape = (v: unknown) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
  const escapedLines = JSON.stringify(lines).replace(/'/g, "''")

  const sql = `
    SELECT create_job_work_transfer(
      '${id}'::uuid,
      '${target_vendor_id}'::uuid,
      '${transfer_date}'::date,
      ${escape(reference_number)}::text,
      ${escape(transfer_number)}::text,
      ${escape(reason)}::text,
      ${escape(notes)}::text,
      '${escapedLines}'::jsonb,
      '${session.userId}'::uuid
    )
  `

  try {
    const result = await hasuraRunSql(sql)
    const json = JSON.parse(result?.result?.[1]?.[0] ?? '{}') as {
      success: boolean
      error?: string
      to_job_work_order_id?: string
      transfer_number?: string
    }
    if (!json.success) return NextResponse.json({ error: json.error ?? 'Transfer failed' }, { status: 400 })
    return NextResponse.json({ success: true, toJobWorkOrderId: json.to_job_work_order_id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transfer failed'
    console.error('[jobwork-transfer]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
