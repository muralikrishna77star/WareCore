export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import { hasuraRunSql } from '@/lib/hasura/server'
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { CAN_MANAGE_RULES } from '@/lib/dataIntegrity/auth'
import RepairExecutionToggle from './RepairExecutionToggle'

type Row = string[]
function rowsToObjects(result: { result: Row[] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-800',
  HIGH: 'bg-orange-100 text-orange-800',
  MEDIUM: 'bg-amber-100 text-amber-800',
  LOW: 'bg-gray-100 text-gray-700',
  INFO: 'bg-blue-100 text-blue-700',
}

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
  const implementedCount = rules.filter((r) => r.is_enabled === 'true').length
  const repairExecutionEnabled = rowsToObjects(settingsResult)[0]?.repair_execution_enabled === 'true'

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
          <thead>
            <tr className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <th className="px-4 py-3 text-left">Rule</th>
              <th className="px-4 py-3 text-left">Category</th>
              <th className="px-4 py-3 text-left">Severity</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-right">Tolerance</th>
              <th className="px-4 py-3 text-right">Version</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rules.map((r) => (
              <tr key={r.rule_code} className="align-top hover:bg-gray-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{r.rule_code} — {r.rule_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5 max-w-xl">{r.description}</p>
                </td>
                <td className="px-4 py-3 text-gray-600">{r.category}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_COLOR[r.severity] ?? 'bg-gray-100'}`}>{r.severity}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${r.is_enabled === 'true' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                    {r.is_enabled === 'true' ? 'Implemented' : 'Catalogued only'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-gray-500">{r.tolerance ?? '—'}</td>
                <td className="px-4 py-3 text-right text-gray-500">{r.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
