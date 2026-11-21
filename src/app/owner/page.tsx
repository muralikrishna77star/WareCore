import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentOwner } from '@/lib/tenancy/ownerAuth'
import { listTenants } from '@/lib/tenancy/control'
import { StatusBadge } from './StatusBadge'

export const dynamic = 'force-dynamic'

export default async function OwnerHome() {
  if (!(await currentOwner())) redirect('/owner/login')
  const customers = await listTenants()

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="mt-1 text-sm text-gray-600">Each customer has its own address and its own database.</p>
        </div>
        <Link href="/owner/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          Add customer
        </Link>
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg bg-white shadow">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Address</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {customers.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/owner/customers/${c.slug}`} className="flex items-center gap-2 font-medium text-blue-700 hover:underline">
                    <span className="inline-block h-3 w-3 rounded-full border border-gray-200" style={{ background: c.brandColor ?? '#2563eb' }} />
                    {c.displayName}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-700">
                  {c.hosts.map((h) => <div key={h}>{h}</div>)}
                </td>
                <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                <td className="px-4 py-3 text-gray-600">{new Date(c.createdAt).toLocaleDateString('en-IN')}</td>
              </tr>
            ))}
            {!customers.length && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">No customers yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
