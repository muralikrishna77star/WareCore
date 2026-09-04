import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager'])

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const dateRe = /^\d{4}-\d{2}-\d{2}$/

// Creates a brand-new job work order whose input line(s) are sourced from
// this order's own OUTPUT items instead of a purchase line — the "send
// finished product to another vendor for a further processing stage" case
// (see migration 138). One atomic DB call from the start, following the
// same lesson as /api/jobwork/[id]/transfer: a multi-step client sequence
// once left a transfer's ledger legs unposted (JWT-0826-0012).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  // The order id in the URL identifies which order's output the UI loaded
  // this from — the DB function itself derives company/warehouse from each
  // line's actual source_output_item_id, so this is only used to validate
  // the request shape, matching the sibling /transfer route's contract.
  const { id } = await params
  if (!uuidRe.test(id)) return NextResponse.json({ error: 'Invalid job work order ID' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const { target_vendor_id, dispatch_date, reference_number, expected_return_date, work_description, notes, lines } = body

  if (!uuidRe.test(target_vendor_id ?? '')) return NextResponse.json({ error: 'target_vendor_id is required' }, { status: 400 })
  if (!dispatch_date) return NextResponse.json({ error: 'dispatch_date is required' }, { status: 400 })
  if (!dateRe.test(dispatch_date)) return NextResponse.json({ error: 'dispatch_date must be YYYY-MM-DD' }, { status: 400 })
  if (expected_return_date != null && !dateRe.test(expected_return_date)) return NextResponse.json({ error: 'expected_return_date must be YYYY-MM-DD' }, { status: 400 })
  if (!reference_number) return NextResponse.json({ error: 'reference_number is required' }, { status: 400 })
  if (!Array.isArray(lines) || !lines.length) return NextResponse.json({ error: 'At least one output line is required' }, { status: 400 })
  for (const line of lines) {
    if (!uuidRe.test(line?.source_output_item_id ?? '')) return NextResponse.json({ error: 'Each line requires a valid source_output_item_id' }, { status: 400 })
    if (typeof line.quantity !== 'number' || !(line.quantity > 0)) return NextResponse.json({ error: 'Each line requires a positive quantity' }, { status: 400 })
  }

  const escape = (v: unknown) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
  const escapedLines = JSON.stringify(lines).replace(/'/g, "''")

  const sql = `
    SELECT create_job_work_order_from_output(
      '${target_vendor_id}'::uuid,
      '${dispatch_date}'::date,
      ${escape(reference_number)}::text,
      ${expected_return_date ? `'${expected_return_date}'::date` : 'NULL'},
      ${escape(work_description)}::text,
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
      job_work_order_id?: string
    }
    if (!json.success) return NextResponse.json({ error: json.error ?? 'Send failed' }, { status: 400 })
    return NextResponse.json({ success: true, jobWorkOrderId: json.job_work_order_id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Send failed'
    console.error('[jobwork-send-output]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
