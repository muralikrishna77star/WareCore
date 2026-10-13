import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { DATE_RE, UUID_RE, type ReconcileFixRequest } from '@/lib/reconcileFix'

// Review & Fix writes to the stock ledger, so it is narrower than the
// read-only reconciliation (which billing staff can also run).
const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager'])

// Each fix is one database function (migration 163): it re-checks that the
// data still has the problem, changes it in one transaction, and logs it to
// stock_reconcile_fix_log. Its refusals start with "Nothing was changed."
export async function POST(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) {
    return NextResponse.json({ error: 'Only an admin or company manager can apply fixes.' }, { status: 403 })
  }

  const body = (await request.json().catch(() => ({}))) as Partial<ReconcileFixRequest>
  if (typeof body.itemId !== 'string' || !UUID_RE.test(body.itemId)) {
    return NextResponse.json({ error: 'Invalid item — reload and try again.' }, { status: 400 })
  }
  const sqlUser = UUID_RE.test(session.userId) ? `'${session.userId}'::uuid` : 'NULL'
  const sqlItem = `'${body.itemId}'::uuid`

  let sql: string
  if (body.kind === 'align_pair_timestamp') {
    if (typeof body.ledgerId !== 'string' || !UUID_RE.test(body.ledgerId)
      || typeof body.partnerId !== 'string' || !UUID_RE.test(body.partnerId)) {
      return NextResponse.json({ error: 'Invalid ledger rows — reload and try again.' }, { status: 400 })
    }
    sql = `SELECT fn_reconcile_fix_align_pair_timestamp('${body.ledgerId}'::uuid, '${body.partnerId}'::uuid, ${sqlItem}, ${sqlUser})`
  } else if (body.kind === 'output_received_date') {
    if (typeof body.outputItemId !== 'string' || !UUID_RE.test(body.outputItemId)) {
      return NextResponse.json({ error: 'Invalid output line — reload and try again.' }, { status: 400 })
    }
    if (typeof body.newDate !== 'string' || !DATE_RE.test(body.newDate) || Number.isNaN(Date.parse(body.newDate))) {
      return NextResponse.json({ error: 'Enter a valid date.' }, { status: 400 })
    }
    sql = `SELECT fn_reconcile_fix_output_received_date('${body.outputItemId}'::uuid, DATE '${body.newDate}', ${sqlItem}, ${sqlUser})`
  } else {
    return NextResponse.json({ error: 'Unknown fix.' }, { status: 400 })
  }

  try {
    const result = await hasuraRunSql(sql)
    return NextResponse.json({ success: true, summary: result.result?.[1]?.[0] ?? 'Fixed.' })
  } catch (err) {
    console.error('[stock/reconcile-items/fix]', err)
    const message = err instanceof Error ? err.message : 'Fix failed'
    const business = message.indexOf('Nothing was changed.')
    if (business >= 0) return NextResponse.json({ error: message.slice(business) }, { status: 400 })
    return NextResponse.json({ error: 'The fix could not be applied. Nothing was changed.' }, { status: 500 })
  }
}
