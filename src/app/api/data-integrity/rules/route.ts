import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { CAN_VIEW } from '@/lib/dataIntegrity/auth'

function rowsToObjects(result: { result: string[][] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}

export async function GET(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_VIEW.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  try {
    const result = await hasuraRunSql(`
      SELECT id, rule_code, rule_name, description, category, severity, is_enabled,
             supports_auto_repair, tolerance, version, updated_at
      FROM reconciliation_rules
      ORDER BY rule_code
    `)
    return NextResponse.json({ rules: rowsToObjects(result) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to list rules' }, { status: 500 })
  }
}
