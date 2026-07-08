export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import { CURRENT_STOCK_QUERY } from '@/lib/hasura/queries'
import { ExportExcelButton } from '@/components/ExportExcelButton'

export default async function InventoryPage() {
  const result = await hasuraQuery(CURRENT_STOCK_QUERY)
  const stock = result.v_current_stock ?? []

  // Group by company
  type StockRow = {
    company_id: string
    company_name: string
    company_code: string
    warehouse_id: string
    warehouse_name: string
    material_type_id: string
    material_type_name: string
    unit: string
    size_label: string | null
    current_stock: number
  }

  const grouped: Record<string, { company: string; code: string; rows: StockRow[] }> = {}
  for (const row of stock as StockRow[]) {
    if (Number(row.current_stock) === 0) continue
    if (!grouped[row.company_id]) {
      grouped[row.company_id] = { company: row.company_name, code: row.company_code, rows: [] }
    }
    grouped[row.company_id].rows.push(row)
  }

  const exportRows = (stock as StockRow[])
    .filter((row) => Number(row.current_stock) !== 0)
    .map((row) => ({
      'Company': row.company_name,
      'Warehouse': row.warehouse_name,
      'Material': row.material_type_name,
      'Size': row.size_label || '',
      'Stock': Number(row.current_stock),
      'Unit': row.unit,
    }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Current Inventory</h1>
          <p className="mt-1 text-sm text-gray-500">Live stock levels across all companies and warehouses</p>
        </div>
        {exportRows.length > 0 && (
          <ExportExcelButton
            rows={exportRows}
            filename={`current-inventory_${new Date().toISOString().split('T')[0]}`}
            sheetName="Inventory"
          />
        )}
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="rounded-xl border bg-white p-12 text-center">
          <p className="text-gray-400 text-4xl mb-3">📦</p>
          <p className="text-gray-500">No stock found. Add purchase bills to populate inventory.</p>
        </div>
      ) : (
        Object.entries(grouped).map(([companyId, { company, code, rows }]) => (
          <div key={companyId} className="rounded-xl border bg-white overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b flex items-center gap-3">
              <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                {code}
              </span>
              <h2 className="font-semibold text-gray-900">{company}</h2>
              <span className="text-sm text-gray-500 ml-auto">
                Total: {rows.reduce((s, r) => s + Number(r.current_stock), 0).toFixed(3)} tons
              </span>
            </div>
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b text-left bg-gray-50">
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Warehouse</th>
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Material</th>
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Size</th>
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-right">Stock</th>
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Unit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-gray-700">{row.warehouse_name}</td>
                      <td className="px-6 py-3 font-medium text-gray-900">{row.material_type_name}</td>
                      <td className="px-6 py-3 text-gray-600">{row.size_label || '—'}</td>
                      <td className={`px-6 py-3 text-right font-semibold ${Number(row.current_stock) < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                        {Number(row.current_stock).toFixed(3)}
                      </td>
                      <td className="px-6 py-3 text-gray-500">{row.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
