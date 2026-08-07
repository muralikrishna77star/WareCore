'use client'

import Link from 'next/link'
import { formatNumber } from '@/lib/utils'
import { isReferenceType } from '@/lib/reference'
import { ReferenceLink } from '@/components/ReferenceLink'
import { useDashboardData } from './useDashboardData'
import { DashboardAsyncSection } from './DashboardAsyncSection'

const ENTRY_TYPE_LABELS: Record<string, string> = {
  PURCHASE_IN: 'Purchase In',
  VENDOR_RETURN_IN: 'Vendor Return',
  JOB_WORK_RETURN_IN: 'JW Return',
  TRANSFER_IN: 'Transfer In',
  ADJUSTMENT_IN: 'Adj. In',
  SALE_OUT: 'Sale Out',
  SALE_CANCEL: 'Sale Reversal',
  PURCHASE_CANCEL: 'Purchase Cancel',
  JOB_WORK_OUT: 'JW Out',
  TRANSFER_OUT: 'Transfer Out',
  ADJUSTMENT_OUT: 'Adj. Out',
}

const QUICK_LINKS = [
  { label: 'New Bill', href: '/bills/new' },
  { label: 'New Transfer', href: '/transfers/new' },
  { label: 'New Job Work', href: '/jobwork/new' },
  { label: 'New Dispatch', href: '/dispatch/new' },
  { label: 'Inventory', href: '/inventory' },
  { label: 'Reports', href: '/reports' },
]

export function ClassicDashboard() {
  const { data, loading, error } = useDashboardData()

  const rows = [
    { label: 'Total Stock', value: data ? `${formatNumber(data.totalStock, 2)} t` : '—' },
    { label: 'Purchase Bills', value: data ? String(data.totalBills) : '—' },
    { label: 'Pending Transfers', value: data ? String(data.pendingTransfers) : '—' },
    { label: 'Active Job Work', value: data ? String(data.pendingJobWork) : '—' },
    { label: 'Total Dispatches', value: data ? String(data.totalDispatches) : '—' },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Compact operational view of your warehouse</p>
      </div>

      {/* Compact summary strip */}
      <div className="overflow-hidden rounded-lg border bg-white">
        <DashboardAsyncSection loading={loading} error={error} skeletonRows={1}>
          <dl className="grid grid-cols-2 divide-x divide-gray-200 sm:grid-cols-5">
            {rows.map((row) => (
              <div key={row.label} className="px-3 py-2.5">
                <dt className="text-[11px] uppercase tracking-wide text-gray-500">{row.label}</dt>
                <dd className="mt-0.5 text-base font-semibold text-gray-900">{row.value}</dd>
              </div>
            ))}
          </dl>
        </DashboardAsyncSection>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Quick access */}
        <div className="rounded-lg border bg-white p-3 lg:col-span-1">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Quick Access</h2>
          <ul className="divide-y divide-gray-100">
            {QUICK_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="flex items-center justify-between py-1.5 text-sm text-gray-700 hover:text-blue-600">
                  {link.label}
                  <span aria-hidden="true">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Stock by company, compact */}
        <div className="rounded-lg border bg-white p-3 lg:col-span-2">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Stock by Company</h2>
          <DashboardAsyncSection
            loading={loading}
            error={error}
            isEmpty={!!data && data.companyStock.length === 0}
            emptyMessage="No stock data yet."
            skeletonRows={3}
          >
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {data?.companyStock.map((c) => (
                  <tr key={c.id}>
                    <td className="py-1.5 pr-2 text-gray-700">
                      {c.name} <span className="text-xs text-gray-400">{c.code}</span>
                    </td>
                    <td className="py-1.5 text-right font-medium text-gray-900">{formatNumber(c.stock, 2)} t</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DashboardAsyncSection>
        </div>
      </div>

      {/* Dense recent transactions table */}
      <div className="rounded-lg border bg-white">
        <div className="border-b px-3 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Recent Transactions</h2>
        </div>
        <div className="overflow-x-auto">
          <DashboardAsyncSection
            loading={loading}
            error={error}
            isEmpty={!!data && data.movements.length === 0}
            emptyMessage="No movements recorded yet."
            skeletonRows={5}
          >
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500">
                  <th className="px-3 py-1.5 font-medium">Date</th>
                  <th className="px-3 py-1.5 font-medium">Type</th>
                  <th className="px-3 py-1.5 font-medium">Material</th>
                  <th className="px-3 py-1.5 text-right font-medium">Qty</th>
                  <th className="px-3 py-1.5 font-medium">Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data?.movements.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-3 py-1.5 text-gray-600">
                      {new Date(entry.entry_date).toLocaleDateString('en-IN')}
                    </td>
                    <td className="px-3 py-1.5 text-gray-700">{ENTRY_TYPE_LABELS[entry.entry_type] || entry.entry_type}</td>
                    <td className="px-3 py-1.5 text-gray-700">
                      {entry.material_types?.description} {entry.size_label ? `(${entry.size_label})` : ''}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-medium ${entry.quantity >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {entry.quantity >= 0 ? '+' : ''}
                      {formatNumber(Math.abs(entry.quantity), 3)} {entry.material_types?.unit}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-gray-500">
                      {isReferenceType(entry.reference_type) && entry.reference_id ? (
                        <ReferenceLink type={entry.reference_type} id={entry.reference_id} className="text-blue-600 hover:underline">
                          {entry.reference_number || '-'}
                        </ReferenceLink>
                      ) : (
                        entry.reference_number || '-'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DashboardAsyncSection>
        </div>
      </div>
    </div>
  )
}
