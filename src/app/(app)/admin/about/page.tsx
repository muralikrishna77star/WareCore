export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft, ExternalLink, TriangleAlert, Database, Bot, Clock } from 'lucide-react'
import { hasuraRunSql } from '@/lib/hasura/server'
import { APP_VERSION } from '@/lib/version'
import { TECH_STACK, SERVICES, PRICING_CHECKED_ON, type Service, type ServiceStatus } from '@/lib/aboutServices'
import { RefreshUsageButton } from './RefreshUsageButton'

type LiveStats = {
  databaseBytes: number
  postgresVersion: string
  ledgerRows: number
  totalRows: number
  copilotQuestionsTotal: number
  copilotQuestions30d: number
}

// One read-only round trip; any failure just hides the live figures.
async function fetchLiveStats(): Promise<LiveStats | null> {
  try {
    const res = await hasuraRunSql(`
      SELECT pg_database_size(current_database())::text,
             current_setting('server_version'),
             (SELECT COUNT(*) FROM stock_ledger)::text,
             (SELECT COALESCE(SUM(n_live_tup), 0) FROM pg_stat_user_tables)::text,
             (SELECT COUNT(*) FROM ai_messages WHERE role = 'user')::text,
             (SELECT COUNT(*) FROM ai_messages WHERE role = 'user' AND created_at > now() - interval '30 days')::text`)
    const row = res.result?.[1]
    if (!row) return null
    return {
      databaseBytes: Number(row[0]),
      postgresVersion: row[1].split(' ')[0],
      ledgerRows: Number(row[2]),
      totalRows: Number(row[3]),
      copilotQuestionsTotal: Number(row[4]),
      copilotQuestions30d: Number(row[5]),
    }
  } catch {
    return null
  }
}

const fmtInt = (n: number) => n.toLocaleString('en-IN')
const fmtMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

const STATUS_BADGE: Record<ServiceStatus, { label: string; className: string }> = {
  free: { label: 'Free', className: 'bg-green-50 text-green-700 border-green-200' },
  paid: { label: 'Paid', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  attention: { label: 'Free — needs attention', className: 'bg-amber-50 text-amber-800 border-amber-200' },
}

function StatusBadge({ status }: { status: ServiceStatus }) {
  const badge = STATUS_BADGE[status]
  return (
    <span className={`inline-flex whitespace-nowrap items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badge.className}`}>
      {badge.label}
    </span>
  )
}

function liveUsageFor(service: Service, stats: LiveStats | null): string | null {
  if (!stats) return null
  switch (service.usageKey) {
    case 'database': {
      // Storage only — compute hours are on the Neon bill, not visible from inside the database.
      const storageCost = (stats.databaseBytes / 1024 ** 3) * 0.35
      return `Database size ${fmtMb(stats.databaseBytes)} (≈ $${storageCost.toFixed(2)}/month storage) · ${fmtInt(stats.totalRows)} rows`
    }
    case 'copilot':
      return `${fmtInt(stats.copilotQuestions30d)} questions in the last 30 days · ${fmtInt(stats.copilotQuestionsTotal)} since launch`
    case 'cron':
      return '1 scheduled job — nightly data-integrity scan (within the once-a-day Hobby limit)'
    default:
      return null
  }
}

export default async function AboutPage() {
  const stats = await fetchLiveStats()
  const fetchedAt = new Date().toISOString()
  const attention = SERVICES.filter((s) => s.status === 'attention')

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">About WareCore</h1>
          <p className="mt-1 text-sm text-gray-500">
            Warehouse, purchase, sales and job work management · version {APP_VERSION}
          </p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <RefreshUsageButton fetchedAt={fetchedAt} />
          <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
            <ArrowLeft className="h-4 w-4" /> Back to Admin
          </Link>
        </div>
      </div>

      {/* Live figures */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-white p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500"><Database className="h-4 w-4" /> Database size</div>
          <p className="mt-1 text-xl font-bold text-gray-900">{stats ? fmtMb(stats.databaseBytes) : '—'}</p>
          <p className="text-xs text-gray-500">
            {stats ? `PostgreSQL ${stats.postgresVersion} · ${fmtInt(stats.ledgerRows)} stock ledger rows` : 'Unavailable'}
          </p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500"><Bot className="h-4 w-4" /> AI Copilot use</div>
          <p className="mt-1 text-xl font-bold text-gray-900">{stats ? fmtInt(stats.copilotQuestions30d) : '—'}</p>
          <p className="text-xs text-gray-500">
            {stats ? `questions in the last 30 days · ${fmtInt(stats.copilotQuestionsTotal)} in total` : 'Unavailable'}
          </p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500"><Clock className="h-4 w-4" /> Prices last checked</div>
          <p className="mt-1 text-xl font-bold text-gray-900">
            {new Date(PRICING_CHECKED_ON).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
          </p>
          <p className="text-xs text-gray-500">Providers change plans — use each Source link to re-check</p>
        </div>
      </div>

      {attention.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-semibold"><TriangleAlert className="h-4 w-4" /> Needs attention</p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            {attention.map((s) => <li key={s.name}><span className="font-medium">{s.name}:</span> {s.note}</li>)}
          </ul>
        </div>
      )}

      {/* Services summary */}
      <section className="rounded-xl border bg-white overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="font-semibold text-gray-900">Services & subscriptions</h2>
          <p className="text-xs text-gray-500 mt-0.5">Every outside service WareCore depends on. Amounts in US dollars.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Service</th>
                <th className="px-4 py-2">Used for</th>
                <th className="px-4 py-2">Plan</th>
                <th className="px-4 py-2">Cost</th>
                <th className="px-4 py-2">Billed at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {SERVICES.map((s) => (
                <tr key={s.name} className="align-top">
                  <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{s.name}</td>
                  <td className="px-4 py-3 text-gray-600 min-w-[14rem]">{s.usedFor}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-gray-900">{s.plan}</div>
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{s.monthlyCost}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {s.billedAt ? (
                      <a href={s.billedAt.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                        {s.billedAt.label} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-gray-400">Not billed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Per-service limits */}
      <section className="space-y-3">
        <h2 className="font-semibold text-gray-900">Limits, current usage and what happens at the limit</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {SERVICES.map((s) => {
            const live = liveUsageFor(s, stats)
            return (
              <div key={s.name} className="rounded-xl border bg-white p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-gray-900">{s.name}</h3>
                  <StatusBadge status={s.status} />
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Included each month — {s.plan}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
                    {s.limits.map((l) => <li key={l}>{l}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Our usage</p>
                  {live && <p className="mt-1 text-sm text-gray-900">{live}</p>}
                  <p className="mt-0.5 text-sm text-gray-600">{live ? 'Full figures: ' : 'Check: '}{s.usageWhere}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">When the limit is reached</p>
                  <p className="mt-1 text-sm text-gray-700">{s.whenLimitReached}</p>
                </div>
                {s.note && s.status !== 'attention' && <p className="text-sm text-gray-600">{s.note}</p>}
                <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                  Source <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )
          })}
        </div>
      </section>

      {/* Technology */}
      <section className="rounded-xl border bg-white p-6">
        <h2 className="font-semibold text-gray-900">Technology used</h2>
        <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
          {TECH_STACK.map((group) => (
            <div key={group.title}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">{group.title}</h3>
              <dl className="mt-2 space-y-1.5">
                {group.items.map((item) => (
                  <div key={item.name} className="text-sm">
                    <dt className="inline font-medium text-gray-900">{item.name}</dt>
                    <dd className="inline text-gray-600"> — {item.detail}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <p className="mt-6 text-xs text-gray-500">
          The desktop build runs the same app and a local PostgreSQL on one PC, so it uses none of the paid services above
          except the AI Copilot.
        </p>
      </section>
    </div>
  )
}
