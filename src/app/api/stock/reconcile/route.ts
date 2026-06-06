import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager', 'billing_staff'])

export async function POST(request: NextRequest) {
  try {
    const session = await verifySessionCookie(request)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const result = await hasuraRunSql('SELECT reconcile_purchase_stock() AS count')
    const count = Number(result?.result?.[1]?.[0] ?? 0)
    return NextResponse.json({ success: true, reconciled: count })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reconciliation failed'
    console.error('[reconcile]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
