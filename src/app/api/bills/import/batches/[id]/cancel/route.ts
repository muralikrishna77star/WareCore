import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { UUID_RE } from '@/lib/dataIntegrity/auth'
import { ALLOWED_ROLES } from '@/lib/purchaseImport/auth'
import { rowsToObjects } from '@/lib/purchaseImport/db'

// Discards a batch — only reachable from STAGED. Rows are kept (soft,
// auditable — a cancelled batch still shows in history).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid batch id' }, { status: 400 })

  try {
    const result = await hasuraRunSql(`
      UPDATE purchase_import_batches SET status = 'CANCELLED', cancelled_by = '${session.userId}'::uuid, cancelled_at = NOW()
      WHERE id = '${id}'::uuid AND status = 'STAGED'
      RETURNING id
    `)
    if (!rowsToObjects(result).length) return NextResponse.json({ error: 'Batch not found or not cancellable (must be STAGED)' }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to cancel batch' }, { status: 500 })
  }
}
