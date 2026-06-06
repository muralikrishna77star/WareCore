import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager'])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid bill ID' }, { status: 400 })
  }

  const userId = session.userId ?? null
  const userSql = userId ? `'${userId}'::uuid` : 'NULL'
  const sql = `SELECT purge_cancelled_bill('${id}'::uuid, ${userSql})`

  try {
    const result = await hasuraRunSql(sql)
    const json = JSON.parse(result.result?.[1]?.[0] ?? '{}') as { success: boolean; error?: string; cancellation_id?: string }
    if (!json.success) return NextResponse.json({ error: json.error ?? 'Purge failed' }, { status: 400 })
    return NextResponse.json({ success: true, cancellation_id: json.cancellation_id })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Purge failed' }, { status: 500 })
  }
}
