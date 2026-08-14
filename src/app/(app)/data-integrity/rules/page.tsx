export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import { hasuraRunSql } from '@/lib/hasura/server'
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { CAN_MANAGE_RULES } from '@/lib/dataIntegrity/auth'
import RepairExecutionToggle from './RepairExecutionToggle'
import { RuleCatalogueRows } from './RuleCatalogueRows'

type Row = string[]
function rowsToObjects(result: { result: Row[] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}

// hasuraRunSql's run_sql endpoint stringifies booleans using Postgres's own
// text output format — 't'/'f' — not the JS-style 'true'/'false' this file
// previously checked for, which meant is_enabled/repair_execution_enabled
// always parsed as false regardless of the real value (verified directly
// against production). See src/lib/purchaseImport/db.ts's toBool() for the
// same fix applied to the purchase-import module.
const isTrue = (v: string | undefined) => v === 'true' || v === 't'

export default async function RuleCataloguePage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  const session = token ? verifySession(token) : null
  const canManage = !!session && CAN_MANAGE_RULES.has(session.role)

  const [result, settingsResult] = await Promise.all([
    hasuraRunSql(`
      SELECT rule_code, rule_name, description, category, severity, is_enabled, supports_auto_repair, tolerance, version, updated_at
      FROM reconciliation_rules ORDER BY rule_code
    `),
    hasuraRunSql(`SELECT repair_execution_enabled FROM reconciliation_settings WHERE id = TRUE`),
  ])
  const rules = rowsToObjects(result)
  const implementedCount = rules.filter((r) => isTrue(r.is_enabled)).length
  const repairExecutionEnabled = isTrue(rowsToObjects(settingsResult)[0]?.repair_execution_enabled)

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-white p-4 text-sm text-gray-600 flex items-center justify-between flex-wrap gap-3">
        <div>
          <span className="font-semibold text-gray-900">{implementedCount} of {rules.length} rules implemented</span> in this release
          (is_enabled). The rest are fully specified but not yet executable — see{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">docs/data-integrity/RULE_CATALOGUE.md</code> for the Phase 2 backlog and rationale per rule.
        </div>
        <RepairExecutionToggle enabled={repairExecutionEnabled} canManage={canManage} />
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <RuleCatalogueRows rules={rules} />
        </table>
      </div>
    </div>
  )
}
