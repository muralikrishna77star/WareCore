import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { CAN_MANAGE_RULES, UUID_RE } from '@/lib/dataIntegrity/auth'
import { isImplementedRuleCode } from '@/lib/dataIntegrity/rules'

function rowsToObjects(result: { result: string[][] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}

// Rule changes are audited (version bumped, updated_at touched by the
// existing fn_data_integrity_touch_updated_at trigger) and admin/developer
// only — a rule's severity/tolerance/enabled state directly controls what
// gets surfaced as a defect, so changing it is a data-governance action,
// not a UI preference.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_MANAGE_RULES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid rule id' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const updates: string[] = []

  if (typeof body.isEnabled === 'boolean') {
    if (body.isEnabled) {
      const existing = await hasuraRunSql(`SELECT rule_code FROM reconciliation_rules WHERE id = '${id}'::uuid`)
      const rows = rowsToObjects(existing)
      if (!rows.length) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
      if (!isImplementedRuleCode(rows[0].rule_code)) {
        return NextResponse.json(
          { error: `${rows[0].rule_code} has no implementation in this release yet — see docs/data-integrity/RULE_CATALOGUE.md. Enabling it would have no effect on a scan.` },
          { status: 400 }
        )
      }
    }
    updates.push(`is_enabled = ${body.isEnabled}`)
  }

  if (typeof body.tolerance === 'number' && Number.isFinite(body.tolerance) && body.tolerance >= 0) {
    updates.push(`tolerance = ${body.tolerance}`)
  }

  if (!updates.length) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  updates.push(`version = version + 1`)

  try {
    await hasuraRunSql(`UPDATE reconciliation_rules SET ${updates.join(', ')} WHERE id = '${id}'::uuid`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update rule' }, { status: 500 })
  }
}
