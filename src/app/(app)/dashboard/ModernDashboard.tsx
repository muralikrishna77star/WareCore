'use client'

import Link from 'next/link'
import { Package, ClipboardList, ArrowLeftRight, Factory, Truck, FileText, TrendingUp, type LucideIcon } from 'lucide-react'
import { formatNumber } from '@/lib/utils'
import { isReferenceType } from '@/lib/reference'
import { ReferenceLink } from '@/components/ReferenceLink'
import { DashboardStatCard } from '@/components/DashboardStatCard'
import { useDashboardData } from './useDashboardData'
import { DashboardAsyncSection } from './DashboardAsyncSection'

const ENTRY_TYPE_COLORS: Record<string, string> = {
  PURCHASE_IN: 'bg-green-100 text-green-800',
  VENDOR_RETURN_IN: 'bg-teal-100 text-teal-800',
  JOB_WORK_RETURN_IN: 'bg-blue-100 text-blue-800',
  TRANSFER_IN: 'bg-indigo-100 text-indigo-800',
  ADJUSTMENT_IN: 'bg-cyan-100 text-cyan-800',
  SALE_OUT: 'bg-red-100 text-red-800',
  SALE_CANCEL: 'bg-gray-100 text-gray-600',
  PURCHASE_CANCEL: 'bg-gray-100 text-gray-600',
  JOB_WORK_OUT: 'bg-orange-100 text-orange-800',
  TRANSFER_OUT: 'bg-yellow-100 text-yellow-800',
  ADJUSTMENT_OUT: 'bg-pink-100 text-pink-800',
}

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

const QUICK_ACTIONS: { label: string; href: string; icon: LucideIcon; gradient: string }[] = [
  { label: 'New Bill', href: '/bills/new', icon: FileText, gradient: 'from-blue-500 to-blue-600' },
  { label: 'New Transfer', href: '/transfers/new', icon: ArrowLeftRight, gradient: 'from-purple-500 to-purple-600' },
  { label: 'New Job Work', href: '/jobwork/new', icon: Factory, gradient: 'from-orange-500 to-orange-600' },
  { label: 'New Dispatch', href: '/dispatch/new', icon: Truck, gradient: 'from-green-500 to-green-600' },
  { label: 'Inventory', href: '/inventory', icon: Package, gradient: 'from-gray-600 to-gray-700' },
  { label: 'Reports', href: '/reports', icon: TrendingUp, gradient: 'from-teal-500 to-teal-600' },
]

export function ModernDashboard() {
  const { data, loading, error } = useDashboardData()

  const statCards = [
    {
      title: 'Total Stock', value: data ? `${formatNumber(data.totalStock, 2)} tons` : '—',
      caption: data ? `Across ${data.companyStock.length} ${data.companyStock.length === 1 ? 'company' : 'companies'}` : undefined,
      icon: Package, iconBg: 'bg-blue-100', iconColor: 'text-blue-600', category: 'stock',
    },
    { title: 'Purchase Bills', value: data ? String(data.totalBills) : '—', icon: ClipboardList, iconBg: 'bg-green-100', iconColor: 'text-green-600', category: 'purchase_bills' },
    { title: 'Pending Transfers', value: data ? String(data.pendingTransfers) : '—', icon: ArrowLeftRight, iconBg: 'bg-amber-100', iconColor: 'text-amber-600', category: 'transfers_pending' },
    { title: 'Active Job Work', value: data ? String(data.pendingJobWork) : '—', icon: Factory, iconBg: 'bg-purple-100', iconColor: 'text-purple-600', category: 'job_work_active' },
    { title: 'Total Dispatches', value: data ? String(data.totalDispatches) : '—', icon: Truck, iconBg: 'bg-red-100', iconColor: 'text-red-600', category: 'dispatches' },
  ]

  const hasAttention = !!data && (data.pendingTransfers > 0 || data.pendingJobWork > 0)

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">Operations Overview</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Enterprise overview of your warehouse operations</p>
      </div>

      {/* KPI cards */}
      <DashboardAsyncSection loading={loading} error={error} skeletonRows={1}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {statCards.map((card) => (
            <DashboardStatCard
              key={card.title}
              category={card.category}
              icon={card.icon}
              value={card.value}
              title={card.title}
              caption={card.caption}
              iconBg={card.iconBg}
              iconColor={card.iconColor}
            />
          ))}
        </div>
      </DashboardAsyncSection>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Stock overview */}
        <div className="rounded-xl border bg-white lg:col-span-2">
          <div className="border-b p-6">
            <h2 className="text-lg font-semibold text-gray-900">Stock Overview</h2>
            <p className="text-sm text-gray-500">Current stock by company</p>
          </div>
          <DashboardAsyncSection
            loading={loading}
            error={error}
            isEmpty={!!data && data.companyStock.length === 0}
            emptyMessage="No stock data yet. Add purchase bills to get started."
            skeletonRows={3}
          >
            <div className="divide-y divide-gray-100 px-6">
              {data?.companyStock.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-500">{c.code}</p>
                  </div>
                  <span className="font-semibold text-blue-700">{formatNumber(c.stock, 2)} tons</span>
                </div>
              ))}
            </div>
            <div className="h-2" />
          </DashboardAsyncSection>
        </div>

        {/* Quick actions */}
        <div className="rounded-xl border bg-white p-6 lg:col-span-1">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3">
            {QUICK_ACTIONS.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className={`flex flex-col items-center justify-center gap-1 rounded-xl bg-gradient-to-br ${action.gradient} px-3 py-4 text-center text-xs font-medium text-white shadow-sm transition-transform hover:scale-[1.03]`}
              >
                <action.icon className="h-5 w-5" />
                {action.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Attention needed — real pending counts, honestly labeled */}
      {(loading || hasAttention) && (
        <div className="rounded-xl border bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Needs Attention</h2>
          <DashboardAsyncSection
            loading={loading}
            error={error}
            isEmpty={!!data && !hasAttention}
            emptyMessage="Nothing pending — transfers and job work are all clear."
            skeletonRows={2}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {data && data.pendingTransfers > 0 && (
                <Link href="/transfers" className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 hover:bg-amber-100">
                  <span className="text-sm font-medium text-amber-800">Pending Transfers</span>
                  <span className="text-lg font-bold text-amber-800">{data.pendingTransfers}</span>
                </Link>
              )}
              {data && data.pendingJobWork > 0 && (
                <Link href="/jobwork" className="flex items-center justify-between rounded-lg border border-purple-200 bg-purple-50 px-4 py-3 hover:bg-purple-100">
                  <span className="text-sm font-medium text-purple-800">Active Job Work</span>
                  <span className="text-lg font-bold text-purple-800">{data.pendingJobWork}</span>
                </Link>
              )}
            </div>
          </DashboardAsyncSection>
        </div>
      )}

      {/* Recent activity */}
      <div className="rounded-xl border bg-white">
        <div className="border-b p-6">
          <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
        </div>
        <div className="overflow-x-auto">
          <DashboardAsyncSection
            loading={loading}
            error={error}
            isEmpty={!!data && data.movements.length === 0}
            emptyMessage="No movements recorded yet."
            skeletonRows={5}
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-6 py-3 text-xs font-medium uppercase text-gray-500">Date</th>
                  <th className="px-6 py-3 text-xs font-medium uppercase text-gray-500">Type</th>
                  <th className="px-6 py-3 text-xs font-medium uppercase text-gray-500">Material</th>
                  <th className="px-6 py-3 text-xs font-medium uppercase text-gray-500">Qty</th>
                  <th className="px-6 py-3 text-xs font-medium uppercase text-gray-500">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data?.movements.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-3 text-gray-700">
                      {new Date(entry.entry_date).toLocaleDateString('en-IN')}
                    </td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ENTRY_TYPE_COLORS[entry.entry_type] || 'bg-gray-100 text-gray-800'}`}>
                        {ENTRY_TYPE_LABELS[entry.entry_type] || entry.entry_type}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-700">{entry.material_types?.description}</td>
                    <td className={`px-6 py-3 font-medium ${entry.quantity >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {entry.quantity >= 0 ? '+' : ''}
                      {formatNumber(Math.abs(entry.quantity), 3)} {entry.material_types?.unit}
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-gray-500">
                      {isReferenceType(entry.reference_type) && entry.reference_id ? (
                        <ReferenceLink type={entry.reference_type} id={entry.reference_id} className="font-mono text-xs text-blue-600 hover:underline">
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
