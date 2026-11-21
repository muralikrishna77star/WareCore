import { ExternalLink, TriangleAlert } from 'lucide-react'
import { SERVICES, type Service, type ServiceStatus } from '@/lib/aboutServices'

// WareCore's own outside services: plans, costs, billing accounts and limits.
// Internal to WareCore — shown on the owner console, and on /admin/about only
// when there is a single customer (desktop / single-customer mode). Never on a
// customer's own site in multi-customer mode.

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

export function ServiceSections({ liveUsage }: { liveUsage: (service: Service) => string | null }) {
  const attention = SERVICES.filter((s) => s.status === 'attention')
  return (
    <>
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
            const live = liveUsage(s)
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
    </>
  )
}
