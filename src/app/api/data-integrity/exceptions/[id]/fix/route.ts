import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { UUID_RE } from '@/lib/dataIntegrity/auth'
import type { ExceptionFixRequest } from '@/lib/dataIntegrity/review'

// Same people who can resolve an exception (see ../route.ts PATCH): a fix
// writes ledger rows and can mark the exception resolved.
const CAN_FIX = new Set(['admin', 'developer'])

// Applies one Review & Fix repair (migration 165). Each is a single database
// function that re-derives what to change, refuses with "Nothing was
// changed." if the data no longer matches, logs to stock_reconcile_fix_log,
// and resolves the exception when its stock no longer goes negative.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_FIX.has(session.role)) {
    return NextResponse.json({ error: 'Only an admin or developer can apply fixes.' }, { status: 403 })
  }

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid exception id' }, { status: 400 })
  const user = UUID_RE.test(session.userId) ? `'${session.userId}'::uuid` : 'NULL'

  const body = (await request.json().catch(() => ({}))) as Partial<ExceptionFixRequest>
  let sql: string
  if (body.kind === 'intercompany_transfer') {
    sql = `SELECT fn_rec005_fix_intercompany('${id}'::uuid, ${user})`
  } else if (body.kind === 'output_item') {
    if (typeof body.outputItemId !== 'string' || !UUID_RE.test(body.outputItemId)) {
      return NextResponse.json({ error: 'Invalid output line — reload and try again.' }, { status: 400 })
    }
    sql = `SELECT fn_rec005_fix_output_item('${id}'::uuid, '${body.outputItemId}'::uuid, ${user})`
  } else {
    return NextResponse.json({ error: 'Unknown fix.' }, { status: 400 })
  }

  try {
    const result = await hasuraRunSql(sql)
    return NextResponse.json({ success: true, summary: result.result?.[1]?.[0] ?? 'Fixed.' })
  } catch (err) {
    console.error('[data-integrity/fix]', err)
    const message = err instanceof Error ? err.message : 'Fix failed'
    const business = message.indexOf('Nothing was changed.')
    if (business >= 0) return NextResponse.json({ error: message.slice(business) }, { status: 400 })
    return NextResponse.json({ error: 'The fix could not be applied. Nothing was changed.' }, { status: 500 })
  }
}
