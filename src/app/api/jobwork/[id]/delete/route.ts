import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'

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

  // Validate UUID to prevent SQL injection before embedding in SQL
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid job work order ID' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const notes: string | null = typeof body.notes === 'string' && body.notes.trim()
    ? body.notes.trim()
    : null

  // Escape user text for safe SQL embedding (double single-quotes)
  const sqlNotes = notes ? `'${notes.replace(/'/g, "''")}'` : 'NULL'
  const sql = `SELECT delete_job_work_order('${id}'::uuid, ${sqlNotes}::text)`

  try {
    const result = await hasuraRunSql(sql)
    // result.result is [["delete_job_work_order"], ["<json>"]]
    const json = JSON.parse(result.result?.[1]?.[0] ?? '{}') as {
      success: boolean
      error?: string
    }
    if (!json.success) {
      return NextResponse.json({ error: json.error ?? 'Delete failed' }, { status: 400 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[delete-job-work]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Delete failed' },
      { status: 500 }
    )
  }
}
