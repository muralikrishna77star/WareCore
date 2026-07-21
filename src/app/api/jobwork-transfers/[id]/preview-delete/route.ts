import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'

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
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid transfer ID' }, { status: 400 })
  }

  try {
    const result = await hasuraRunSql(`SELECT preview_job_work_transfer_deletion('${id}'::uuid)`)
    const json = JSON.parse(result.result?.[1]?.[0] ?? '{}') as {
      error?: string
      blocked?: boolean
      reason?: string
      dispatches?: { id: string; invoice_number: string | null; sale_ref_id: string | null; dispatch_date: string; customer_name: string | null }[]
      transfers?: { id: string; transfer_number: string; transfer_date: string; to_vendor_name: string | null }[]
    }
    if (json.error) {
      return NextResponse.json({ error: json.error }, { status: 404 })
    }
    return NextResponse.json(json)
  } catch (err) {
    console.error('[preview-delete-job-work-transfer]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Preview failed' },
      { status: 500 }
    )
  }
}
