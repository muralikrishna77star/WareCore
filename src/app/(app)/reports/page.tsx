import { createClient } from '@/lib/supabase/server'

export default async function ReportsPage() {
  const supabase = await createClient()

  const [stockResult, billsResult, dispatchResult, jwResult] = await Promise.all([
    supabase.from('v_current_stock').select('*'),
    supabase.from('purchase_bills').select('bill_date, total_quantity, total_amount, companies(name, code)').order('bill_date', { ascending: false }),
    supabase.from('dispatch_orders').select('dispatch_date, total_quantity, total_amount, companies(name, code)').order('dispatch_date', { ascending: false }),
    supabase.from('v_stock_at_vendors').select('*'),
  ])

  type StockRow = { company_name: string; company_code: string; material_type_name: string; unit: string; size_label: string | null; current_stock: number }
  type JWRow = { vendor_name: string; material_type_name: string; size_label: string | null; pending_quantity: number }

  const stockRows = (stockResult.data ?? []) as StockRow[]
  const jwRows = (jwResult.data ?? []) as JWRow[]

  // Group inventory by company/material
  const inventoryByCompany: Record<string, { code: string; materials: Record<string, number> }> = {}
  for (const row of stockRows) {
    if (Number(row.current_stock) <= 0) continue
    if (!inventoryByCompany[row.company_name]) inventoryByCompany[row.company_name] = { code: row.company_code, materials: {} }
    const key = row.material_type_name + (row.size_label ? ` (${row.size_label})` : '')
    inventoryByCompany[row.company_name].materials[key] = (inventoryByCompany[row.company_name].materials[key] || 0) + Number(row.current_stock)
  }

  // Bills summary
  type BillRow = { bill_date: string; total_quantity: number; total_amount: number; companies: { name: string; code: string } | null }
  const bills = (billsResult.data ?? []) as unknown as BillRow[]
  const totalPurchased = bills.reduce((s, b) => s + Number(b.total_quantity || 0), 0)
  const totalPurchaseAmt = bills.reduce((s, b) => s + Number(b.total_amount || 0), 0)

  type DispatchRow = { dispatch_date: string; total_quantity: number; total_amount: number; companies: { name: string; code: string } | null }
  const dispatches = (dispatchResult.data ?? []) as unknown as DispatchRow[]
  const totalDispatched = dispatches.reduce((s, d) => s + Number(d.total_quantity || 0), 0)
  const totalDispatchAmt = dispatches.reduce((s, d) => s + Number(d.total_amount || 0), 0)

  const totalCurrentStock = stockRows.reduce((s, r) => s + Number(r.current_stock), 0)
  const totalAtVendors = jwRows.reduce((s, r) => s + Number(r.pending_quantity), 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="mt-1 text-sm text-gray-500">Summary reports and analytics</p>
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
