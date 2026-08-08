import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { CAN_RUN_SCAN, CAN_VIEW, DATE_RE, UUID_RE } from '@/lib/dataIntegrity/auth'
import { runReconciliation, type RunScope } from '@/lib/dataIntegrity/engine'
import { isImplementedRuleCode } from '@/lib/dataIntegrity/rules'

const RUN_TYPES = new Set(['MANUAL', 'INCREMENTAL', 'NIGHTLY_FULL', 'POST_TRANSACTION', 'POST_REPAIR'])
const SCOPE_TYPES = new Set(['FULL', 'COMPANY', 'WAREHOUSE', 'ITEM', 'DOCUMENT', 'DATE_RANGE', 'INCREMENTAL_SINCE_LAST'])

function parseRows(result: { result: string[][] }): string[][] {
  return result.result.slice(1)
}

// Reconciliation is read-only by default: every rule function is a pure
// SELECT (088_data_integrity_rule_functions.sql), and this route only ever
// writes to reconciliation_runs/reconciliation_exceptions — never to
// stock_ledger or any other production table. No repair action is
// reachable from here.
export async function POST(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_RUN_SCAN.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const runType = typeof body.runType === 'string' ? body.runType : 'MANUAL'
  const scopeType = typeof body.scopeType === 'string' ? body.scopeType : 'FULL'
  const companyId = typeof body.companyId === 'string' ? body.companyId : null
  const fromDate = typeof body.fromDate === 'string' ? body.fromDate : '2000-01-01'
  const toDate = typeof body.toDate === 'string' ? body.toDate : new Date().toISOString().slice(0, 10)
  const ruleCodesInput: unknown = body.ruleCodes

  if (!RUN_TYPES.has(runType)) return NextResponse.json({ error: 'Invalid runType' }, { status: 400 })
  if (!SCOPE_TYPES.has(scopeType)) return NextResponse.json({ error: 'Invalid scopeType' }, { status: 400 })
  if (companyId && !UUID_RE.test(companyId)) return NextResponse.json({ error: 'Invalid companyId' }, { status: 400 })
  if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) {
    return NextResponse.json({ error: 'fromDate/toDate must be YYYY-MM-DD' }, { status: 400 })
  }
  // company_manager is scope-restricted to their own company (per §9) —
  // admin/developer may run across all companies.
  if (session.role === 'company_manager' && !companyId) {
    return NextResponse.json({ error: 'company_manager must scope a scan to a single company' }, { status: 403 })
  }

  let ruleCodes: RunScope['ruleCodes']
  if (Array.isArray(ruleCodesInput)) {
    const invalid = ruleCodesInput.filter((c) => typeof c !== 'string' || !isImplementedRuleCode(c))
    if (invalid.length) {
      return NextResponse.json({ error: `Unknown or unimplemented rule code(s): ${invalid.join(', ')}` }, { status: 400 })
    }
    ruleCodes = ruleCodesInput as RunScope['ruleCodes']
  }

  try {
    const result = await runReconciliation({
      runType: runType as RunScope['runType'],
      scopeType: scopeType as RunScope['scopeType'],
      companyId,
      fromDate,
      toDate,
      startedBy: session.userId,
      ruleCodes,
    })
    return NextResponse.json(result, { status: result.status === 'FAILED' ? 500 : 200 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Reconciliation run failed' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_VIEW.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 25, 1), 100)
  const offset = Math.max(Number(searchParams.get('offset')) || 0, 0)

  const sql = `
    SELECT id, run_number, run_type, scope_type, scope, status, started_at, completed_at,
           rules_executed, records_scanned, exceptions_found, critical_count, high_count,
           medium_count, low_count, resolved_count, execution_time_ms, error_message, created_at
    FROM reconciliation_runs
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `
  try {
    const result = await hasuraRunSql(sql)
    const rows = parseRows(result)
    const columns = result.result[0]
    const runs = rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
    return NextResponse.json({ runs, limit, offset })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to list runs' }, { status: 500 })
  }
}
