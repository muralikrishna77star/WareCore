import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'

// Cancels a customer return: cancel_sale_return() (migration 173) removes the
// return's SALE_RETURN_IN rows outright (archived in stock_ledger_deletions)
// and marks it cancelled. A cancelled return can't be re-activated.

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager', 'billing_staff', 'sales_manager'])
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  if (!uuidRe.test(id)) return NextResponse.json({ error: 'Invalid return ID' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const notes = typeof body?.notes === 'string' && body.notes.trim() ? body.notes.trim() : null
  const sqlNotes = notes ? `'${notes.replace(/'/g, "''")}'` : 'NULL'
  const userId = uuidRe.test(session.userId) ? `'${session.userId}'::uuid` : 'NULL::uuid'

  try {
    const result = await hasuraRunSql(`SELECT cancel_sale_return('${id}'::uuid, ${sqlNotes}::text, ${userId})`)
    const json = JSON.parse(result?.result?.[1]?.[0] ?? '{}') as { success: boolean; error?: string }
    if (!json.success) return NextResponse.json({ error: json.error ?? 'Cancellation failed' }, { status: 400 })
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cancellation failed'
    console.error('[sale-return-cancel]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
