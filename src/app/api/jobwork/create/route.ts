import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'

// Same role set the /api/graphql proxy applied to the CreateJobWorkOrder /
// CreateJobWorkItems mutations this route replaces — moving the writes into
// one transaction must not quietly change who may create an order.
const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager', 'billing_staff', 'sales_manager'])

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const dateRe = /^\d{4}-\d{2}-\d{2}$/

type Line = Record<string, unknown>

/** Keeps only the fields create_job_work_order() reads, normalised to string|null. */
function cleanLine(line: Line, fields: string[], numeric: string[]): Line | string {
  const out: Line = {}
  for (const f of fields) {
    const v = line[f]
    out[f] = v == null || v === '' ? null : String(v)
  }
  for (const f of numeric) {
    const v = line[f]
    if (v == null || v === '') { out[f] = null; continue }
    const n = Number(v)
    if (!Number.isFinite(n)) return `"${f}" must be a number`
    out[f] = String(n)
  }
  for (const [k, v] of Object.entries(out)) {
    if (k.endsWith('_id') && k !== 'purchase_line_id' && k !== 'sub_purchase_line_id'
        && k !== 'job_line_id' && k !== 'source_job_line_id'
        && v != null && !uuidRe.test(String(v))) {
      return `"${k}" must be a UUID`
    }
  }
  return out
}

const INPUT_TEXT = ['purchase_line_id', 'sub_purchase_line_id', 'job_line_id', 'item_master_id',
  'item_name', 'material_type_id', 'material_size_id', 'size_label', 'unit']
const OUTPUT_TEXT = ['item_master_id', 'item_name', 'material_type_id', 'material_size_id',
  'size_label', 'unit', 'source_job_line_id', 'notes']

// One atomic call replacing the old 3-step client sequence (create order,
// create input items, create output items). See migration 146: a trigger
// rejecting the items left the already-committed order header behind as an
// invisible orphan, three of which had accumulated in the table.
export async function POST(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const {
    reference_number, company_id, warehouse_id, vendor_id,
    dispatch_date, expected_return_date, work_description, status, notes,
    inputs, outputs,
  } = body

  if (!reference_number) return NextResponse.json({ error: 'reference_number is required' }, { status: 400 })
  if (!dateRe.test(dispatch_date ?? '')) return NextResponse.json({ error: 'dispatch_date must be YYYY-MM-DD' }, { status: 400 })
  if (expected_return_date && !dateRe.test(expected_return_date)) {
    return NextResponse.json({ error: 'expected_return_date must be YYYY-MM-DD' }, { status: 400 })
  }
  for (const [name, value] of Object.entries({ company_id, warehouse_id, vendor_id })) {
    if (value && !uuidRe.test(String(value))) return NextResponse.json({ error: `${name} must be a UUID` }, { status: 400 })
  }
  if (!Array.isArray(inputs) || !inputs.length) {
    return NextResponse.json({ error: 'At least one input line is required' }, { status: 400 })
  }

  const cleanInputs: Line[] = []
  for (const line of inputs) {
    const cleaned = cleanLine(line ?? {}, INPUT_TEXT, ['quantity_sent'])
    if (typeof cleaned === 'string') return NextResponse.json({ error: cleaned }, { status: 400 })
    cleanInputs.push(cleaned)
  }
  const cleanOutputs: Line[] = []
  for (const line of Array.isArray(outputs) ? outputs : []) {
    const cleaned = cleanLine(line ?? {}, OUTPUT_TEXT, ['quantity'])
    if (typeof cleaned === 'string') return NextResponse.json({ error: cleaned }, { status: 400 })
    cleanOutputs.push(cleaned)
  }

  const escape = (v: unknown) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
  const escapeJson = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'`

  const sql = `
    SELECT create_job_work_order(
      ${escape(reference_number)}::text,
      ${escape(company_id)}::uuid,
      ${escape(warehouse_id)}::uuid,
      ${escape(vendor_id)}::uuid,
      ${escape(dispatch_date)}::date,
      ${escape(expected_return_date)}::date,
      ${escape(work_description)}::text,
      ${escape(status || 'dispatched')}::text,
      ${escape(notes)}::text,
      ${escapeJson(cleanInputs)}::jsonb,
      ${escapeJson(cleanOutputs)}::jsonb,
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
    if (!json.success) return NextResponse.json({ error: json.error ?? 'Failed to create job work order' }, { status: 400 })
    return NextResponse.json({ success: true, jobWorkOrderId: json.job_work_order_id })
  } catch (err) {
    // hasuraRunSql already unwraps Postgres detail, so a trigger's RAISE
    // (e.g. the purchase-date guard) reaches the user as its real message.
    const message = err instanceof Error ? err.message : 'Failed to create job work order'
    console.error('[jobwork-create]', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
