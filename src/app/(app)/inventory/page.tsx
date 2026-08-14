export const dynamic = 'force-dynamic'

import { Package, Building2, Warehouse, Layers, TriangleAlert } from 'lucide-react'
import { hasuraQuery } from '@/lib/hasura/server'
import { CURRENT_STOCK_QUERY } from '@/lib/hasura/queries'
import { ExportExcelButton } from '@/components/ExportExcelButton'
import { StatCard } from '@/components/StatCard'
import { InventoryCompanyRows } from './InventoryCompanyRows'

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
  const warehouseIds = new Set<string>()
  const materialTypeIds = new Set<string>()
  let totalStock = 0
  let negativeLineCount = 0
  for (const row of stock as StockRow[]) {
    if (Number(row.current_stock) === 0) continue
    if (!grouped[row.company_id]) {
      grouped[row.company_id] = { company: row.company_name, code: row.company_code, rows: [] }
    }
    grouped[row.company_id].rows.push(row)
    warehouseIds.add(row.warehouse_id)
    materialTypeIds.add(row.material_type_id)
    totalStock += Number(row.current_stock)
    if (Number(row.current_stock) < 0) negativeLineCount++
  }
  const companyCount = Object.keys(grouped).length

  const asOfDate = new Date().toISOString().split('T')[0]
  const exportRows = (stock as StockRow[])
    .filter((row) => Number(row.current_stock) !== 0)
    .map((row) => ({
      'As Of': asOfDate,
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

      {companyCount > 0 && (
        <div className="flex flex-wrap gap-3">
          <StatCard icon={Package} iconBg="bg-blue-100" iconColor="text-blue-600"
            value={`${totalStock.toFixed(3)} tons`} label="Total Stock" />
          <StatCard icon={Building2} iconBg="bg-teal-100" iconColor="text-teal-600"
            value={String(companyCount)} label={companyCount === 1 ? 'Company' : 'Companies'} />
          <StatCard icon={Warehouse} iconBg="bg-orange-100" iconColor="text-orange-600"
            value={String(warehouseIds.size)} label={warehouseIds.size === 1 ? 'Warehouse' : 'Warehouses'} />
          <StatCard icon={Layers} iconBg="bg-purple-100" iconColor="text-purple-600"
            value={String(materialTypeIds.size)} label="Material Types" />
          {negativeLineCount > 0 && (
            <StatCard icon={TriangleAlert} iconBg="bg-red-100" iconColor="text-red-600"
              value={String(negativeLineCount)} label={negativeLineCount === 1 ? 'Negative Stock Line' : 'Negative Stock Lines'} />
          )}
        </div>
      )}

      {companyCount === 0 ? (
        <div className="rounded-xl border bg-white p-12 text-center">
          <Package className="mx-auto h-10 w-10 text-gray-400 mb-3" />
          <p className="text-gray-500">No stock found. Add purchase bills to populate inventory.</p>
        </div>
      ) : (
        Object.entries(grouped).map(([companyId, { company, code, rows }]) => (
          <div key={companyId} className="rounded-xl border bg-white overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b flex items-center gap-3">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100">
                <Building2 className="h-4 w-4 text-blue-600" strokeWidth={2} />
              </span>
              <h2 className="font-semibold text-gray-900">{company}</h2>
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                {code}
              </span>
              <span className="text-sm text-gray-500 ml-auto">
                Total: {rows.reduce((s, r) => s + Number(r.current_stock), 0).toFixed(3)} tons
              </span>
            </div>
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full text-sm">
                <InventoryCompanyRows rows={rows} />
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
