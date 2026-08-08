import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { CAN_VIEW, UUID_RE } from '@/lib/dataIntegrity/auth'

function rowsToObjects(result: { result: string[][] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_VIEW.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid run id' }, { status: 400 })

  try {
    const runResult = await hasuraRunSql(`SELECT * FROM reconciliation_runs WHERE id = '${id}'::uuid`)
    const runs = rowsToObjects(runResult)
    if (!runs.length) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

    const exceptionsResult = await hasuraRunSql(`
      SELECT id, exception_number, severity, status, summary, source_document_type, reference_number
      FROM reconciliation_exceptions
      WHERE run_id = '${id}'::uuid
      ORDER BY severity = 'CRITICAL' DESC, severity = 'HIGH' DESC, first_detected_at DESC
      LIMIT 500
    `)
    return NextResponse.json({ run: runs[0], exceptions: rowsToObjects(exceptionsResult) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load run' }, { status: 500 })
  }
}
