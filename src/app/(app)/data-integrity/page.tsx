export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { hasuraRunSql } from '@/lib/hasura/server'

type Row = string[]
function rowsToObjects(result: { result: Row[] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}

export default async function DataIntegrityDashboardPage() {
  const [
    lastFullResult,
    lastIncrementalResult,
    openBySeverityResult,
    openByRuleResult,
    recentlyResolvedResult,
    trendResult,
  ] = await Promise.all([
    hasuraRunSql(`SELECT run_number, completed_at, status, exceptions_found FROM reconciliation_runs WHERE run_type = 'NIGHTLY_FULL' AND status IN ('COMPLETED', 'COMPLETED_WITH_EXCEPTIONS') ORDER BY completed_at DESC LIMIT 1`),
    hasuraRunSql(`SELECT run_number, completed_at, status, exceptions_found FROM reconciliation_runs WHERE run_type = 'INCREMENTAL' AND status IN ('COMPLETED', 'COMPLETED_WITH_EXCEPTIONS') ORDER BY completed_at DESC LIMIT 1`),
    hasuraRunSql(`SELECT severity, COUNT(*) AS n FROM reconciliation_exceptions WHERE status NOT IN ('RESOLVED', 'IGNORED') GROUP BY severity`),
    hasuraRunSql(`
      SELECT r.rule_code, r.rule_name, r.category, COUNT(e.id) AS n
      FROM reconciliation_rules r
      LEFT JOIN reconciliation_exceptions e ON e.rule_id = r.id AND e.status NOT IN ('RESOLVED', 'IGNORED')
      GROUP BY r.rule_code, r.rule_name, r.category
      ORDER BY n DESC, r.rule_code
    `),
    hasuraRunSql(`SELECT exception_number, summary, resolved_at FROM reconciliation_exceptions WHERE status = 'RESOLVED' ORDER BY resolved_at DESC LIMIT 8`),
    hasuraRunSql(`SELECT run_number, completed_at, exceptions_found, critical_count, high_count FROM reconciliation_runs WHERE status IN ('COMPLETED', 'COMPLETED_WITH_EXCEPTIONS') ORDER BY completed_at DESC LIMIT 10`),
  ])

  const lastFull = rowsToObjects(lastFullResult)[0]
  const lastIncremental = rowsToObjects(lastIncrementalResult)[0]
  const openBySeverity = rowsToObjects(openBySeverityResult)
  const openByRule = rowsToObjects(openByRuleResult)
  const recentlyResolved = rowsToObjects(recentlyResolvedResult)
  const trend = rowsToObjects(trendResult)

  const severityCount = (sev: string) => Number(openBySeverity.find((r) => r.severity === sev)?.n ?? 0)
  const critical = severityCount('CRITICAL')
  const high = severityCount('HIGH')
  const medium = severityCount('MEDIUM')
  const low = severityCount('LOW') + severityCount('INFO')
  const totalOpen = critical + high + medium + low

  const overallStatus = critical > 0 ? 'Critical' : high > 0 ? 'Warning' : 'Healthy'
  const statusColor = overallStatus === 'Critical' ? 'text-red-700 bg-red-50 border-red-200'
    : overallStatus === 'Warning' ? 'text-amber-700 bg-amber-50 border-amber-200'
    : 'text-green-700 bg-green-50 border-green-200'

  const ruleCount = (code: string) => Number(openByRule.find((r) => r.rule_code === code)?.n ?? 0)

  return (
    <div className="space-y-6">
      <div className={`rounded-xl border p-4 flex items-center justify-between ${statusColor}`}>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide">Overall Status</p>
          <p className="text-2xl font-bold">{overallStatus}</p>
        </div>
        <p className="text-sm">{totalOpen} open exception{totalOpen !== 1 ? 's' : ''}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border bg-red-50 p-4">
          <p className="text-xs text-gray-500">Critical</p>
          <p className="text-xl font-bold text-red-700">{critical}</p>
        </div>
        <div className="rounded-xl border bg-orange-50 p-4">
          <p className="text-xs text-gray-500">High</p>
          <p className="text-xl font-bold text-orange-700">{high}</p>
        </div>
        <div className="rounded-xl border bg-amber-50 p-4">
          <p className="text-xs text-gray-500">Medium</p>
          <p className="text-xl font-bold text-amber-700">{medium}</p>
        </div>
        <div className="rounded-xl border bg-gray-50 p-4">
          <p className="text-xs text-gray-500">Low / Info</p>
          <p className="text-xl font-bold text-gray-700">{low}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs text-gray-500">Last Nightly Full Scan</p>
          {lastFull ? (
            <>
              <p className="font-semibold text-gray-900">{lastFull.run_number}</p>
              <p className="text-sm text-gray-500">{new Date(lastFull.completed_at).toLocaleString()} — {lastFull.exceptions_found} exceptions found</p>
            </>
          ) : (
            <p className="text-sm text-gray-400 mt-1">No full scan has run yet — nightly scheduling is a Phase 2 item (see docs/data-integrity/ROLLOUT_PLAN.md). Start one manually from Reconciliation Runs.</p>
          )}
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs text-gray-500">Last Incremental Scan</p>
          {lastIncremental ? (
            <>
              <p className="font-semibold text-gray-900">{lastIncremental.run_number}</p>
              <p className="text-sm text-gray-500">{new Date(lastIncremental.completed_at).toLocaleString()} — {lastIncremental.exceptions_found} exceptions found</p>
            </>
          ) : (
            <p className="text-sm text-gray-400 mt-1">No incremental scan has run yet.</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-6 py-3 border-b bg-gray-50 flex justify-between items-center">
          <span className="font-semibold text-gray-700 text-sm">Open exceptions by rule</span>
          <Link href="/data-integrity/exceptions?openOnly=1" className="text-xs text-blue-600 hover:underline">View all →</Link>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <th className="px-4 py-2 text-left">Rule</th>
              <th className="px-4 py-2 text-left">Category</th>
              <th className="px-4 py-2 text-right">Open</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {openByRule.map((r) => (
              <tr key={r.rule_code} className={Number(r.n) > 0 ? '' : 'text-gray-400'}>
                <td className="px-4 py-2">{r.rule_code} — {r.rule_name}</td>
                <td className="px-4 py-2">{r.category}</td>
                <td className="px-4 py-2 text-right font-medium">{r.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-2 text-xs text-gray-400 border-t">
          Negative-stock items: {ruleCount('REC-005')} · Duplicate events: {ruleCount('REC-001')} ·
          Missing postings: {ruleCount('REC-002')} · Orphan ledger rows: {ruleCount('REC-003')} ·
          Transfer mismatches: {ruleCount('REC-008')} · Job Work mismatches: {ruleCount('REC-009')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border bg-white overflow-hidden">
          <div className="px-6 py-3 border-b bg-gray-50">
            <span className="font-semibold text-gray-700 text-sm">Recently resolved</span>
          </div>
          {recentlyResolved.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">Nothing resolved yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recentlyResolved.map((e) => (
                <li key={e.exception_number} className="px-4 py-2 text-sm">
                  <span className="font-medium text-gray-700">{e.exception_number}</span>
                  <span className="text-gray-500"> — {e.summary}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border bg-white overflow-hidden">
          <div className="px-6 py-3 border-b bg-gray-50">
            <span className="font-semibold text-gray-700 text-sm">Recent runs (trend)</span>
          </div>
          {trend.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">No completed runs yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {trend.map((t) => (
                <li key={t.run_number} className="px-4 py-2 text-sm flex justify-between">
                  <span className="text-gray-700">{t.run_number}</span>
                  <span className="text-gray-500">{t.exceptions_found} found ({t.critical_count} crit / {t.high_count} high)</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
