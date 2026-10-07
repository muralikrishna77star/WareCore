import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'

// Direct stock_ledger row deletion is raw data surgery (bypasses the normal
// bill/dispatch/job-work flows) — restrict to admin/developer only, stricter
// than the cancel/purge routes.
const ALLOWED_ROLES = new Set(['admin', 'developer'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body.ids) ? body.ids : []
  const validIds = ids.filter((id) => typeof id === 'string' && UUID_RE.test(id))

  if (!validIds.length) {
    return NextResponse.json({ error: 'No valid row IDs provided' }, { status: 400 })
  }

  const idList = validIds.map((id) => `'${id}'`).join(',')
  const deletedBy = UUID_RE.test(session.userId ?? '') ? `'${session.userId}'::uuid` : 'NULL'

  // delete_stock_ledger_rows() (migration 153) archives every row to
  // stock_ledger_deletions and refuses — rolling back — any deletion that
  // would leave stock a still-existing bill/order doesn't account for, e.g.
  // deleting only the PURCHASE_CANCEL of a removed bill line.
  try {
    const result = await hasuraRunSql(
      `SELECT delete_stock_ledger_rows(ARRAY[${idList}]::uuid[], ${deletedBy})`
    )
    const deleted = Number(result.result?.[1]?.[0] ?? 0)
    return NextResponse.json({ success: true, deleted })
  } catch (err) {
    // hasuraRunSql unwraps the Postgres message, so a refusal reaches the
    // user as the function's own explanation.
    const message = err instanceof Error ? err.message : 'Delete failed'
    console.error('[ledger-entries delete]', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
