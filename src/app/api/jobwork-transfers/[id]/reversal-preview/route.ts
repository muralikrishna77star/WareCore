import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { UUID_RE, type TransferReversalPreview } from '@/lib/jobWorkTransferReversal'

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager'])

export async function GET(
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

  try {
    const result = await hasuraRunSql(`SELECT preview_job_work_transfer_reversal('${id}'::uuid)`)
    const json = JSON.parse(result.result?.[1]?.[0] ?? '{}') as TransferReversalPreview & { error?: string }
    if (json.error) {
      return NextResponse.json({ error: json.error }, { status: 404 })
    }
    return NextResponse.json(json)
  } catch (err) {
    console.error('[jobwork-transfer-reversal-preview]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not load the transfer' }, { status: 500 })
  }
}
