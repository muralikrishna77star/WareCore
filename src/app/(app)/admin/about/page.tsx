export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft, Database, Bot, Clock } from 'lucide-react'
import { hasuraRunSql } from '@/lib/hasura/server'
import { APP_VERSION } from '@/lib/version'
import { TECH_STACK, PRICING_CHECKED_ON, type Service } from '@/lib/aboutServices'
import { ServiceSections } from '@/components/about/ServiceSections'
import { isMultiTenant } from '@/lib/tenancy/config'
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
  // WareCore's own plans, costs and billing are not for a customer's admins:
  // in multi-customer mode they live on the owner console (/owner/services).
  const showServices = !isMultiTenant()

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
      <div className={`grid grid-cols-1 gap-4 ${showServices ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
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
        {showServices && (
          <div className="rounded-xl border bg-white p-4">
            <div className="flex items-center gap-2 text-xs text-gray-500"><Clock className="h-4 w-4" /> Prices last checked</div>
            <p className="mt-1 text-xl font-bold text-gray-900">
              {new Date(PRICING_CHECKED_ON).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
            <p className="text-xs text-gray-500">Providers change plans — use each Source link to re-check</p>
          </div>
        )}
      </div>

      {showServices && <ServiceSections liveUsage={(service) => liveUsageFor(service, stats)} />}

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
          The desktop build runs the same app and a local PostgreSQL on one PC, so it uses no paid cloud services
          except the AI Copilot.
        </p>
      </section>
    </div>
  )
}
