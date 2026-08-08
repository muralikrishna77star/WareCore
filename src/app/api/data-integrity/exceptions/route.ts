import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { CAN_VIEW, UUID_RE } from '@/lib/dataIntegrity/auth'

const SEVERITIES = new Set(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
const STATUSES = new Set(['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'REPAIR_PROPOSED', 'APPROVED', 'RESOLVED', 'IGNORED', 'REOPENED'])

function rowsToObjects(result: { result: string[][] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}

// Read-only listing over reconciliation_exceptions with server-side
// pagination and scope filters — never fetches the full exception table
// into the browser (assignment §15).
export async function GET(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_VIEW.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 25, 1), 200)
  const offset = Math.max(Number(searchParams.get('offset')) || 0, 0)

  const conditions: string[] = []

  const severity = searchParams.get('severity')
  if (severity) {
    if (!SEVERITIES.has(severity)) return NextResponse.json({ error: 'Invalid severity' }, { status: 400 })
    conditions.push(`severity = '${severity}'`)
  }

  const status = searchParams.get('status')
  if (status) {
    if (!STATUSES.has(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    conditions.push(`status = '${status}'`)
  } else if (searchParams.get('openOnly') === '1') {
    conditions.push(`status NOT IN ('RESOLVED', 'IGNORED')`)
  }

  const companyId = searchParams.get('companyId')
  if (companyId) {
    if (!UUID_RE.test(companyId)) return NextResponse.json({ error: 'Invalid companyId' }, { status: 400 })
    conditions.push(`company_id = '${companyId}'::uuid`)
  }
  // company_manager can only ever see their own company's exceptions.
  if (session.role === 'company_manager') {
    if (!companyId) return NextResponse.json({ error: 'company_manager must filter by companyId' }, { status: 403 })
  }

  const ruleId = searchParams.get('ruleId')
  if (ruleId) {
    if (!UUID_RE.test(ruleId)) return NextResponse.json({ error: 'Invalid ruleId' }, { status: 400 })
    conditions.push(`rule_id = '${ruleId}'::uuid`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const sql = `
    SELECT e.id, e.exception_number, e.severity, e.status, e.summary, e.company_id, e.warehouse_id,
           e.source_document_type, e.reference_number, e.expected_value, e.actual_value, e.difference,
           e.first_detected_at, e.last_detected_at, e.occurrence_count, r.rule_code, r.rule_name
    FROM reconciliation_exceptions e
    LEFT JOIN reconciliation_rules r ON r.id = e.rule_id
    ${where}
    ORDER BY e.severity = 'CRITICAL' DESC, e.severity = 'HIGH' DESC, e.severity = 'MEDIUM' DESC, e.last_detected_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `
  const countSql = `SELECT COUNT(*) AS total FROM reconciliation_exceptions e ${where}`

  try {
    const [listResult, countResult] = await Promise.all([hasuraRunSql(sql), hasuraRunSql(countSql)])
    return NextResponse.json({
      exceptions: rowsToObjects(listResult),
      total: Number(countResult.result[1][0]),
      limit,
      offset,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to list exceptions' }, { status: 500 })
  }
}
