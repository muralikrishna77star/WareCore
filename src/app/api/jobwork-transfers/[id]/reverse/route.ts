import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { UUID_RE, type TransferReversalResult } from '@/lib/jobWorkTransferReversal'

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager'])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifySessionCookie(request)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!ALLOWED_ROLES.has(session.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid transfer ID' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const itemIds: unknown = body.item_ids
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one line to reverse.' }, { status: 400 })
  }
  // Validate every id before embedding it in SQL.
  if (!itemIds.every((v) => typeof v === 'string' && UUID_RE.test(v))) {
    return NextResponse.json({ error: 'Invalid line selection — reload and try again.' }, { status: 400 })
  }
  const notes: string | null = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null
  const sqlNotes = notes ? `'${notes.replace(/'/g, "''")}'` : 'NULL'
  const sqlUser = UUID_RE.test(session.userId) ? `'${session.userId}'::uuid` : 'NULL'
  const sqlIds = `ARRAY[${(itemIds as string[]).map((v) => `'${v}'`).join(',')}]::uuid[]`
  const sql = `SELECT reverse_job_work_transfer_items('${id}'::uuid, ${sqlIds}, ${sqlNotes}::text, ${sqlUser})`

  try {
    const result = await hasuraRunSql(sql)
    const json = JSON.parse(result.result?.[1]?.[0] ?? '{}') as TransferReversalResult
    if (!json.success) {
      return NextResponse.json({ error: json.error ?? 'Reversal failed' }, { status: 400 })
    }
    return NextResponse.json(json)
  } catch (err) {
    console.error('[jobwork-transfer-reverse]', err)
    const message = err instanceof Error ? err.message : 'Reversal failed'
    // The function RAISEs a business message (rolling everything back) when
    // the ledger doesn't match the transfer — show that, not the SQL prefix.
    const business = message.indexOf('Nothing was reversed.')
    if (business >= 0) {
      return NextResponse.json({ error: message.slice(business) }, { status: 400 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
