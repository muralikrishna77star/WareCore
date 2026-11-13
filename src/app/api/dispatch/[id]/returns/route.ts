import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'

// Records a customer return against a sale. All the work — validation,
// over-return check, numbering and the stock posting — happens in one
// transaction inside create_sale_return() (migration 173). The client sends
// its own return id, so a retried/double-clicked request returns the same
// return instead of posting the stock a second time.

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager', 'billing_staff', 'sales_manager'])

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const dateRe = /^\d{4}-\d{2}-\d{2}$/

const sqlText = (v: unknown) =>
  typeof v === 'string' && v.trim() ? `'${v.trim().replace(/'/g, "''")}'` : 'NULL'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id: orderId } = await params
  if (!uuidRe.test(orderId)) return NextResponse.json({ error: 'Invalid sale ID' }, { status: 400 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { return_id, return_date, reason, notes, items } = body as Record<string, unknown>

  if (typeof return_id !== 'string' || !uuidRe.test(return_id)) {
    return NextResponse.json({ error: 'return_id must be a UUID' }, { status: 400 })
  }
  if (typeof return_date !== 'string' || !dateRe.test(return_date)) {
    return NextResponse.json({ error: 'Return date must be YYYY-MM-DD' }, { status: 400 })
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'Enter a return quantity on at least one line' }, { status: 400 })
  }

  // Rebuild the line list from validated values only — nothing else from
  // the request reaches the SQL.
  const lines: { dispatch_item_id: string; quantity: number; notes: string | null }[] = []
  for (const raw of items as unknown[]) {
    const it = (raw ?? {}) as Record<string, unknown>
    const qty = Number(it.quantity)
    if (typeof it.dispatch_item_id !== 'string' || !uuidRe.test(it.dispatch_item_id)) {
      return NextResponse.json({ error: 'Invalid sale line' }, { status: 400 })
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json({ error: 'Every returned line needs a quantity greater than zero' }, { status: 400 })
    }
    lines.push({
      dispatch_item_id: it.dispatch_item_id,
      quantity: Math.round(qty * 1000) / 1000,
      notes: typeof it.notes === 'string' && it.notes.trim() ? it.notes.trim() : null,
    })
  }

  const itemsJson = JSON.stringify(lines).replace(/'/g, "''")
  const userId = uuidRe.test(session.userId) ? `'${session.userId}'::uuid` : 'NULL::uuid'

  const sql = `
    SELECT create_sale_return(
      '${return_id}'::uuid,
      '${orderId}'::uuid,
      '${return_date}'::date,
      ${sqlText(reason)}::text,
      ${sqlText(notes)}::text,
      '${itemsJson}'::jsonb,
      ${userId}
    )
  `

  try {
    const result = await hasuraRunSql(sql)
    const json = JSON.parse(result?.result?.[1]?.[0] ?? '{}') as {
      success: boolean; error?: string; id?: string; return_number?: string; already_saved?: boolean
    }
    if (!json.success) return NextResponse.json({ error: json.error ?? 'Could not save the return' }, { status: 400 })
    return NextResponse.json(json)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not save the return'
    console.error('[sale-return-create]', message)
    // Validation RAISEs from the database (over-return, wrong line…) are
    // the user's to fix, not a server fault.
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
