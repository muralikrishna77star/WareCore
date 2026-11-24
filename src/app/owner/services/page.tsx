import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { currentOwner } from '@/lib/tenancy/ownerAuth'
import { getControlPool } from '@/lib/tenancy/control'
import { PRICING_CHECKED_ON, type Service } from '@/lib/aboutServices'
import { ServiceSections } from '@/components/about/ServiceSections'
import { formatDate } from '@/lib/dates'

export const dynamic = 'force-dynamic'

type DbSize = { name: string; database: string; bytes: number }

// Every customer's database plus the registry, read from the registry's server
// (all on the same Neon branch). Any failure just hides the figures.
async function databaseSizes(): Promise<DbSize[] | null> {
  try {
    const { rows } = await getControlPool().query(
      `SELECT t.display_name AS name, d.datname AS database, pg_database_size(d.datname)::text AS bytes
         FROM tenants t JOIN pg_database d ON d.datname = t.db_name
       UNION ALL
       SELECT 'Customer registry', current_database(), pg_database_size(current_database())::text
       ORDER BY 1`,
    )
    return rows.map((r) => ({ name: r.name as string, database: r.database as string, bytes: Number(r.bytes) }))
  } catch (err) {
    console.error('[owner/services] database sizes failed:', err instanceof Error ? err.message : err)
    return null
  }
}

const fmtMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

export default async function OwnerServicesPage() {
  if (!(await currentOwner())) redirect('/owner/login')
  const sizes = await databaseSizes()
  const total = sizes?.reduce((sum, s) => sum + s.bytes, 0) ?? 0

  const liveUsage = (service: Service): string | null => {
    switch (service.usageKey) {
      case 'database':
        if (!sizes) return null
        return `${sizes.length} databases, ${fmtMb(total)} in all (≈ $${((total / 1024 ** 3) * 0.35).toFixed(2)}/month storage)`
      case 'cron':
        return '1 scheduled job — nightly data-integrity scan for every customer (within the once-a-day Hobby limit)'
      default:
        return null
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Services & costs</h1>
          <p className="mt-1 text-sm text-gray-600">
            WareCore&apos;s own outside services, shared by all customers. Customers&apos; admins don&apos;t see this page.
            Prices last checked{' '}
            {formatDate(PRICING_CHECKED_ON)}.
          </p>
        </div>
        <Link href="/owner" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Customers
        </Link>
      </div>

      <section className="overflow-hidden rounded-xl border bg-white">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-gray-900">Database sizes</h2>
          <p className="mt-0.5 text-xs text-gray-500">Neon storage is billed on the total of all of these.</p>
        </div>
        {sizes ? (
          <table className="min-w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {sizes.map((s) => (
                <tr key={s.database}>
                  <td className="px-4 py-2 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{s.database}</td>
                  <td className="px-4 py-2 text-right text-gray-700">{fmtMb(s.bytes)}</td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-semibold">
                <td className="px-4 py-2 text-gray-900" colSpan={2}>Total</td>
                <td className="px-4 py-2 text-right text-gray-900">{fmtMb(total)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="px-6 py-4 text-sm text-gray-500">Unavailable right now.</p>
        )}
      </section>

      <ServiceSections liveUsage={liveUsage} />
    </div>
  )
}
