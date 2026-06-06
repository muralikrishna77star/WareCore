export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import { DASHBOARD_STATS_QUERY, RECENT_MOVEMENTS_QUERY } from '@/lib/hasura/queries'
import { formatNumber } from '@/lib/utils'

async function getDashboardStats() {
  try {
    const result = await hasuraQuery(DASHBOARD_STATS_QUERY)
    
    const stockByCompany = result.v_current_stock || []
    const totalBills = result.purchase_bills_aggregate?.aggregate?.count || 0
    const pendingTransfers = result.transfers_aggregate?.aggregate?.count || 0
    const pendingJobWork = result.job_work_orders_aggregate?.aggregate?.count || 0
    const totalDispatches = result.dispatch_orders_aggregate?.aggregate?.count || 0

    const totalStock = stockByCompany.reduce((sum: number, row: any) => sum + (Number(row.current_stock) || 0), 0)

    return { totalStock, totalBills, pendingTransfers, pendingJobWork, totalDispatches, stockByCompany }
  } catch (error) {
    console.error('Failed to fetch dashboard stats:', error)
    return { totalStock: 0, totalBills: 0, pendingTransfers: 0, pendingJobWork: 0, totalDispatches: 0, stockByCompany: [] }
  }
}

export default async function DashboardPage() {
  const { totalStock, totalBills, pendingTransfers, pendingJobWork, totalDispatches, stockByCompany } = await getDashboardStats()

  // Group stock by company
  const companyStock: Record<string, { name: string; code: string; stock: number }> = {}
  for (const row of stockByCompany) {
    if (!companyStock[row.company_id]) {
      companyStock[row.company_id] = { name: row.company_name, code: row.company_code, stock: 0 }
    }
    companyStock[row.company_id].stock += Number(row.current_stock) || 0
  }

  const statCards = [
    { title: 'Total Stock', value: `${formatNumber(totalStock, 2)} tons`, icon: '📦', color: 'bg-blue-50 border-blue-200', textColor: 'text-blue-700' },
    { title: 'Purchase Bills', value: totalBills.toString(), icon: '📋', color: 'bg-green-50 border-green-200', textColor: 'text-green-700' },
    { title: 'Pending Transfers', value: pendingTransfers.toString(), icon: '↔️', color: 'bg-yellow-50 border-yellow-200', textColor: 'text-yellow-700' },
    { title: 'Active Job Work', value: pendingJobWork.toString(), icon: '🏭', color: 'bg-purple-50 border-purple-200', textColor: 'text-purple-700' },
    { title: 'Total Dispatches', value: totalDispatches.toString(), icon: '🚚', color: 'bg-red-50 border-red-200', textColor: 'text-red-700' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Overview of your warehouse operations</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {statCards.map((card) => (
          <div key={card.title} className={`rounded-xl border p-5 ${card.color}`}>
            <div className="flex items-center justify-between">
              <span className="text-2xl">{card.icon}</span>
            </div>
            <p className={`mt-3 text-2xl font-bold ${card.textColor}`}>{card.value}</p>
            <p className="mt-1 text-sm text-gray-600">{card.title}</p>
          </div>
        ))}
      </div>

      {/* Company-wise Stock */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Stock by Company</h2>
          {Object.keys(companyStock).length === 0 ? (
            <p className="text-gray-500 text-sm">No stock data yet. Add purchase bills to get started.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(companyStock).map(([id, data]) => (
                <div key={id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium text-gray-900">{data.name}</p>
                    <p className="text-xs text-gray-500">{data.code}</p>
                  </div>
                  <span className="font-semibold text-blue-700">{formatNumber(data.stock, 2)} tons</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="rounded-xl border bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'New Bill Entry', href: '/bills/new', icon: '📋', color: 'bg-blue-600 hover:bg-blue-700' },
              { label: 'New Transfer', href: '/transfers/new', icon: '↔️', color: 'bg-purple-600 hover:bg-purple-700' },
              { label: 'New Job Work', href: '/jobwork/new', icon: '🏭', color: 'bg-orange-600 hover:bg-orange-700' },
              { label: 'New Dispatch', href: '/dispatch/new', icon: '🚚', color: 'bg-green-600 hover:bg-green-700' },
              { label: 'View Inventory', href: '/inventory', icon: '📦', color: 'bg-gray-700 hover:bg-gray-800' },
              { label: 'View Reports', href: '/reports', icon: '📈', color: 'bg-teal-600 hover:bg-teal-700' },
            ].map((action) => (
              <a
                key={action.href}
                href={action.href}
                className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium text-white transition-colors ${action.color}`}
              >
                <span>{action.icon}</span>
                {action.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Movements (top 10 from stock ledger) */}
      <RecentMovements />
    </div>
  )
}

async function RecentMovements() {
  let data: any[] = []
  try {
    const result = await hasuraQuery(RECENT_MOVEMENTS_QUERY)
    data = result.stock_ledger ?? []
  } catch {
    // ignore errors — show empty state
  }

  const entryTypeColors: Record<string, string> = {
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

  const entryTypeLabels: Record<string, string> = {
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

  return (
    <div className="rounded-xl border bg-white">
      <div className="p-6 border-b">
        <h2 className="text-lg font-semibold text-gray-900">Recent Stock Movements</h2>
      </div>
      <div className="overflow-x-auto">
        {!data || data.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">No movements recorded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Material</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Size</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Qty</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Company</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Warehouse</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 whitespace-nowrap text-gray-700">
                    {new Date(entry.entry_date).toLocaleDateString('en-IN')}
                  </td>
                  <td className="px-6 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${entryTypeColors[entry.entry_type] || 'bg-gray-100 text-gray-800'}`}>
                      {entryTypeLabels[entry.entry_type] || entry.entry_type}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-gray-700">
                    {entry.material_types?.description}
                  </td>
                  <td className="px-6 py-3 text-gray-600">{entry.size_label || '-'}</td>
                  <td className={`px-6 py-3 font-medium ${entry.quantity >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {entry.quantity >= 0 ? '+' : ''}{formatNumber(Math.abs(entry.quantity), 3)} {entry.material_types?.unit}
                  </td>
                  <td className="px-6 py-3 text-gray-700">{entry.companies?.name}</td>
                  <td className="px-6 py-3 text-gray-600">{entry.warehouses?.name}</td>
                  <td className="px-6 py-3 text-gray-500 font-mono text-xs">{entry.reference_number || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}


