import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager'])

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  if (!uuidRe.test(id)) return NextResponse.json({ error: 'Invalid job work order ID' }, { status: 400 })

  const body = await request.json()
  const {
    company_id, warehouse_id, vendor_id,
    dispatch_date, expected_return_date, work_description, notes,
    input_items, output_items,
  } = body

  if (!dispatch_date) return NextResponse.json({ error: 'dispatch_date is required' }, { status: 400 })
  if (!Array.isArray(input_items) || !input_items.length) {
    return NextResponse.json({ error: 'At least one input item is required' }, { status: 400 })
  }
  if (!Array.isArray(output_items)) return NextResponse.json({ error: 'output_items must be an array' }, { status: 400 })

  const escape = (v: string | null | undefined) =>
    v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`
  const uuidOrNull = (v: string | null | undefined) =>
    v && uuidRe.test(v) ? `'${v}'::uuid` : 'NULL::uuid'

  const escapedInputItems = JSON.stringify(input_items).replace(/'/g, "''")
  const escapedOutputItems = JSON.stringify(output_items).replace(/'/g, "''")

  const sql = `
    SELECT edit_job_work_order(
      '${id}'::uuid,
      ${uuidOrNull(company_id)},
      ${uuidOrNull(warehouse_id)},
      ${uuidOrNull(vendor_id)},
      '${dispatch_date}'::date,
      ${expected_return_date ? `'${expected_return_date}'::date` : 'NULL::date'},
      ${escape(work_description)}::text,
      ${escape(notes)}::text,
      '${escapedInputItems}'::jsonb,
      '${escapedOutputItems}'::jsonb
    )
  `

  try {
    const result = await hasuraRunSql(sql)
    const json = JSON.parse(result?.result?.[1]?.[0] ?? '{}') as { success: boolean; error?: string }
    if (!json.success) return NextResponse.json({ error: json.error ?? 'Edit failed' }, { status: 400 })
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Edit failed'
    console.error('[jobwork-save-edit]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
