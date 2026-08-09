import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { CAN_VIEW, CAN_MANAGE_RULES } from '@/lib/dataIntegrity/auth'

function rowsToObjects(result: { result: string[][] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}

// reconciliation_settings is a singleton row (id is always TRUE, enforced by
// a CHECK constraint — see supabase/migrations/085_data_integrity_schema.sql).
// repair_execution_enabled is the single audited gate Stage D's execution
// path checks before doing anything (see repair-batches/[id]'s PATCH) —
// flipping it here is the intended "turn repair execution on" mechanism,
// not a code deploy.
export async function GET(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_VIEW.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  try {
    // hasuraRunSql renders boolean columns as the strings 'true'/'false'
    // (see r.is_enabled === 'true' in data-integrity/rules/page.tsx).
    const result = await hasuraRunSql(`
      SELECT repair_proposals_enabled, repair_execution_enabled, post_transaction_checks_enabled,
        quantity_tolerance, incremental_scan_interval_minutes, max_rows_per_scan, retention_days, updated_at
      FROM reconciliation_settings WHERE id = TRUE
    `)
    return NextResponse.json({ settings: rowsToObjects(result)[0] })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load settings' }, { status: 500 })
  }
}

// Gated by CAN_MANAGE_RULES (admin/developer) — this module doesn't
// otherwise distinguish "admin only" from "admin/developer" for governance
// actions, and flipping this flag is exactly that class of action.
export async function PATCH(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_MANAGE_RULES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const updates: string[] = []
  if (typeof body.repairExecutionEnabled === 'boolean') {
    updates.push(`repair_execution_enabled = ${body.repairExecutionEnabled}`)
  }
  if (typeof body.repairProposalsEnabled === 'boolean') {
    updates.push(`repair_proposals_enabled = ${body.repairProposalsEnabled}`)
  }
  if (!updates.length) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  updates.push(`updated_by = '${session.userId}'::uuid`)

  try {
    await hasuraRunSql(`UPDATE reconciliation_settings SET ${updates.join(', ')} WHERE id = TRUE`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update settings' }, { status: 500 })
  }
}
