import { hasuraQuery } from '@/lib/hasura/server'
import { REPORTS_QUERY } from '@/lib/hasura/queries'
import Link from 'next/link'

export default async function ReportsPage() {
  const result = await hasuraQuery(REPORTS_QUERY)

  const stockRows = (result.v_current_stock ?? []) as any[]
  const jwRows = (result.v_stock_at_vendors ?? []) as any[]
  const bills = (result.purchase_bills ?? []) as any[]
  const dispatches = (result.dispatch_orders ?? []) as any[]

  // Group inventory by company/material
  const inventoryByCompany: Record<string, { code: string; materials: Record<string, number> }> = {}
  for (const row of stockRows) {
    if (Number(row.current_stock) <= 0) continue
    if (!inventoryByCompany[row.company_name]) inventoryByCompany[row.company_name] = { code: row.company_code, materials: {} }
    const key = row.material_type_name + (row.size_label ? ` (${row.size_label})` : '')
    inventoryByCompany[row.company_name].materials[key] = (inventoryByCompany[row.company_name].materials[key] || 0) + Number(row.current_stock)
  }

  // Bills summary
  const totalPurchased = bills.reduce((s: number, b: any) => s + Number(b.total_quantity || 0), 0)
  const totalPurchaseAmt = bills.reduce((s: number, b: any) => s + Number(b.total_amount || 0), 0)
  const totalDispatched = dispatches.reduce((s: number, d: any) => s + Number(d.total_quantity || 0), 0)
  const totalDispatchAmt = dispatches.reduce((s: number, d: any) => s + Number(d.total_amount || 0), 0)
  const totalCurrentStock = stockRows.reduce((s: number, r: any) => s + Number(r.current_stock), 0)
  const totalAtVendors = jwRows.reduce((s: number, r: any) => s + Number(r.pending_quantity), 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="mt-1 text-sm text-gray-500">Summary reports and analytics</p>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/reports/stock-statement"
          className="flex items-start gap-4 rounded-xl border bg-white p-5 hover:border-blue-300 hover:shadow-sm transition-all group"
        >
          <div className="text-3xl">�</div>
          <div>
            <p className="font-semibold text-gray-900 group-hover:text-blue-700">Stock Statement</p>
            <p className="text-sm text-gray-500 mt-0.5">Opening · Purchases · Transfers · Dispatch · Closing stock</p>
          </div>
        </Link>
        <Link
          href="/reports/billing"
          className="flex items-start gap-4 rounded-xl border bg-white p-5 hover:border-green-300 hover:shadow-sm transition-all group"
        >
          <div className="text-3xl">🧾</div>
          <div>
            <p className="font-semibold text-gray-900 group-hover:text-green-700">Billing Report</p>
            <p className="text-sm text-gray-500 mt-0.5">Purchase bills with supplier, materials, quantities and amounts</p>
          </div>
        </Link>
        <Link
          href="/reports/transfers"
          className="flex items-start gap-4 rounded-xl border bg-white p-5 hover:border-indigo-300 hover:shadow-sm transition-all group"
        >
          <div className="text-3xl">↔️</div>
          <div>
            <p className="font-semibold text-gray-900 group-hover:text-indigo-700">Transfers Report</p>
            <p className="text-sm text-gray-500 mt-0.5">Inter-company and inter-warehouse material transfers</p>
          </div>
        </Link>
        <Link
          href="/reports/movements"
          className="flex items-start gap-4 rounded-xl border bg-white p-5 hover:border-orange-300 hover:shadow-sm transition-all group"
        >
          <div className="text-3xl">🔄</div>
          <div>
            <p className="font-semibold text-gray-900 group-hover:text-orange-700">Movements Report</p>
            <p className="text-sm text-gray-500 mt-0.5">All stock ledger entries: purchase, dispatch, transfers, job work</p>
          </div>
        </Link>
        <Link
          href="/reports/jobwork"
          className="flex items-start gap-4 rounded-xl border bg-white p-5 hover:border-purple-300 hover:shadow-sm transition-all group"
        >
          <div className="text-3xl">🏭</div>
          <div>
            <p className="font-semibold text-gray-900 group-hover:text-purple-700">Job Work Report</p>
            <p className="text-sm text-gray-500 mt-0.5">Material sent to vendors: sent, received, and pending quantities</p>
          </div>
        </Link>
        <Link
          href="/reports/dispatch"
          className="flex items-start gap-4 rounded-xl border bg-white p-5 hover:border-red-300 hover:shadow-sm transition-all group"
        >
          <div className="text-3xl">🚚</div>
          <div>
            <p className="font-semibold text-gray-900 group-hover:text-red-700">Dispatch Report</p>
            <p className="text-sm text-gray-500 mt-0.5">Customer dispatch orders with invoice, vehicle, and item details</p>
          </div>
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total Purchased', value: `${totalPurchased.toFixed(3)} T`, sub: `₹${totalPurchaseAmt.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, color: 'border-green-200 bg-green-50', text: 'text-green-800' },
          { label: 'Total Dispatched', value: `${totalDispatched.toFixed(3)} T`, sub: `₹${totalDispatchAmt.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, color: 'border-red-200 bg-red-50', text: 'text-red-800' },
          { label: 'Current Stock', value: `${totalCurrentStock.toFixed(3)} T`, sub: 'across all warehouses', color: 'border-blue-200 bg-blue-50', text: 'text-blue-800' },
          { label: 'Stock at Vendors', value: `${totalAtVendors.toFixed(3)} T`, sub: 'pending job work return', color: 'border-orange-200 bg-orange-50', text: 'text-orange-800' },
        ].map((card) => (
          <div key={card.label} className={`rounded-xl border p-5 ${card.color}`}>
            <p className={`text-xl font-bold ${card.text}`}>{card.value}</p>
            <p className="text-sm font-medium text-gray-700 mt-1">{card.label}</p>
            <p className="text-xs text-gray-500 mt-0.5">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Inventory Report */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="font-semibold text-gray-900">Current Inventory by Company & Material</h2>
        </div>
        <div className="overflow-x-auto">
          {Object.keys(inventoryByCompany).length === 0 ? (
            <p className="p-6 text-sm text-gray-500">No inventory data yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-left">Company</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-left">Material (Size)</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-right">Stock (Tons)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {Object.entries(inventoryByCompany).flatMap(([company, { code, materials }]) =>
                  Object.entries(materials).map(([material, qty], idx) => (
                    <tr key={`${company}-${material}`} className="hover:bg-gray-50">
                      <td className="px-6 py-3">
                        {idx === 0 ? (
                          <div>
                            <p className="font-medium text-gray-900">{company}</p>
                            <p className="text-xs text-gray-500">{code}</p>
                          </div>
                        ) : null}
                      </td>
                      <td className="px-6 py-3 text-gray-700">{material}</td>
                      <td className="px-6 py-3 text-right font-semibold text-gray-900">{qty.toFixed(3)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Stock at Vendors */}
      {jwRows.length > 0 && (
        <div className="rounded-xl border bg-white overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h2 className="font-semibold text-gray-900">Stock at Vendors (Pending Job Work)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-left">Vendor</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-left">Material</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-left">Size</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-right">Pending (Tons)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {jwRows.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{row.vendor_name}</td>
                    <td className="px-6 py-3 text-gray-700">{row.material_type_name}</td>
                    <td className="px-6 py-3 text-gray-500">{row.size_label || '—'}</td>
                    <td className="px-6 py-3 text-right font-semibold text-orange-700">{Number(row.pending_quantity).toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
