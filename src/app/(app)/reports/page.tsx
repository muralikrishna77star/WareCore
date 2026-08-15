export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import { REPORTS_QUERY } from '@/lib/hasura/queries'
import Link from 'next/link'
import {
  ChartColumn, Calendar, Receipt, ArrowLeftRight, RefreshCw, Factory, Truck,
  Wrench, BookOpen, Compass, HardHat, type LucideIcon,
} from 'lucide-react'
import { InventoryByCompanyRows, StockAtVendorsRows } from './ReportsIndexTables'

interface CurrentStockRow {
  company_name: string
  company_code: string
  material_type_name: string
  unit: string
  size_label: string | null
  current_stock: number | string
}

interface StockAtVendorRow {
  vendor_name: string
  material_type_name: string
  size_label: string | null
  pending_quantity: number | string
}

interface PurchaseBillSummary {
  bill_date: string
  total_quantity: number | string | null
  total_amount: number | string | null
  companies: { name: string; code?: string | null } | null
}

interface DispatchOrderSummary {
  dispatch_date: string
  total_quantity: number | string | null
  total_amount: number | string | null
  companies: { name: string; code?: string | null } | null
}

const REPORT_LINKS: {
  href: string
  icon: LucideIcon
  iconBg: string
  iconColor: string
  hoverBorder: string
  hoverText: string
  accentBorder: string
  tintBg: string
  title: string
  description: string
}[] = [
  { href: '/reports/stock-statement', icon: ChartColumn, iconBg: 'bg-blue-100', iconColor: 'text-blue-600', hoverBorder: 'hover:border-blue-300', hoverText: 'group-hover:text-blue-700', accentBorder: 'border-l-blue-500', tintBg: 'bg-blue-50/40', title: 'Stock Statement', description: 'Opening · Purchases · Transfers · Dispatch · Closing stock' },
  { href: '/reports/daywise-stock-statement', icon: Calendar, iconBg: 'bg-blue-100', iconColor: 'text-blue-600', hoverBorder: 'hover:border-blue-300', hoverText: 'group-hover:text-blue-700', accentBorder: 'border-l-blue-500', tintBg: 'bg-blue-50/40', title: 'Daywise Stock Statement', description: 'Day-by-day summary with every transaction listed underneath' },
  { href: '/reports/billing', icon: Receipt, iconBg: 'bg-green-100', iconColor: 'text-green-600', hoverBorder: 'hover:border-green-300', hoverText: 'group-hover:text-green-700', accentBorder: 'border-l-green-500', tintBg: 'bg-green-50/40', title: 'Billing Report', description: 'Purchase bills with supplier, materials, quantities and amounts' },
  { href: '/reports/transfers', icon: ArrowLeftRight, iconBg: 'bg-indigo-100', iconColor: 'text-indigo-600', hoverBorder: 'hover:border-indigo-300', hoverText: 'group-hover:text-indigo-700', accentBorder: 'border-l-indigo-500', tintBg: 'bg-indigo-50/40', title: 'Transfers Report', description: 'Inter-company and inter-warehouse material transfers' },
  { href: '/reports/movements', icon: RefreshCw, iconBg: 'bg-orange-100', iconColor: 'text-orange-600', hoverBorder: 'hover:border-orange-300', hoverText: 'group-hover:text-orange-700', accentBorder: 'border-l-orange-500', tintBg: 'bg-orange-50/40', title: 'Movements Report', description: 'All stock ledger entries: purchase, dispatch, transfers, job work' },
  { href: '/reports/jobwork', icon: Factory, iconBg: 'bg-purple-100', iconColor: 'text-purple-600', hoverBorder: 'hover:border-purple-300', hoverText: 'group-hover:text-purple-700', accentBorder: 'border-l-purple-500', tintBg: 'bg-purple-50/40', title: 'Job Work Report', description: 'Material sent to vendors: sent, received, and pending quantities' },
  { href: '/reports/dispatch', icon: Truck, iconBg: 'bg-red-100', iconColor: 'text-red-600', hoverBorder: 'hover:border-red-300', hoverText: 'group-hover:text-red-700', accentBorder: 'border-l-red-500', tintBg: 'bg-red-50/40', title: 'Dispatch Report', description: 'Customer dispatch orders with invoice, vehicle, and item details' },
  { href: '/reports/stock-reconcile', icon: Wrench, iconBg: 'bg-orange-100', iconColor: 'text-orange-600', hoverBorder: 'hover:border-orange-300', hoverText: 'group-hover:text-orange-700', accentBorder: 'border-l-orange-500', tintBg: 'bg-orange-50/40', title: 'Stock Reconciliation', description: 'Detect and fix phantom stock entries from past bill edits' },
  { href: '/reports/item-ledger', icon: BookOpen, iconBg: 'bg-teal-100', iconColor: 'text-teal-600', hoverBorder: 'hover:border-teal-300', hoverText: 'group-hover:text-teal-700', accentBorder: 'border-l-teal-500', tintBg: 'bg-teal-50/40', title: 'Item Stock Ledger', description: 'Opening, movements, and running balance for a single item between two dates' },
  { href: '/reports/purchase-line-ledger', icon: Compass, iconBg: 'bg-pink-100', iconColor: 'text-pink-600', hoverBorder: 'hover:border-pink-300', hoverText: 'group-hover:text-pink-700', accentBorder: 'border-l-pink-500', tintBg: 'bg-pink-50/40', title: 'Purchase Line Movements', description: 'Trace the full lifecycle of a purchase line: dispatch, job work, transfers and returns' },
  { href: '/reports/vendor-movements', icon: HardHat, iconBg: 'bg-amber-100', iconColor: 'text-amber-600', hoverBorder: 'hover:border-amber-300', hoverText: 'group-hover:text-amber-700', accentBorder: 'border-l-amber-500', tintBg: 'bg-amber-50/40', title: 'Vendorwise Stock Movement', description: 'Job work out, direct sales, returns and pending balance, by vendor' },
]

export default async function ReportsPage() {
  const result = await hasuraQuery(REPORTS_QUERY)

  const stockRows = (result.v_current_stock ?? []) as CurrentStockRow[]
  const jwRows = (result.v_stock_at_vendors ?? []) as StockAtVendorRow[]
  const bills = (result.purchase_bills ?? []) as PurchaseBillSummary[]
  const dispatches = (result.dispatch_orders ?? []) as DispatchOrderSummary[]

  // Group inventory by company/material
  const inventoryByCompany: Record<string, { code: string; materials: Record<string, number> }> = {}
  for (const row of stockRows) {
    if (Number(row.current_stock) <= 0) continue
    if (!inventoryByCompany[row.company_name]) inventoryByCompany[row.company_name] = { code: row.company_code, materials: {} }
    const key = row.material_type_name + (row.size_label ? ` (${row.size_label})` : '')
    inventoryByCompany[row.company_name].materials[key] = (inventoryByCompany[row.company_name].materials[key] || 0) + Number(row.current_stock)
  }

  // Bills summary
  const totalPurchased = bills.reduce((s, b) => s + Number(b.total_quantity || 0), 0)
  const totalPurchaseAmt = bills.reduce((s, b) => s + Number(b.total_amount || 0), 0)
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

      {/* Quick Links */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-start gap-4 rounded-xl border border-l-4 ${item.accentBorder} ${item.tintBg} p-5 ${item.hoverBorder} hover:shadow-sm transition-all group`}
          >
            <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${item.iconBg}`}>
              <item.icon className={`h-5 w-5 ${item.iconColor}`} strokeWidth={2} />
            </span>
            <div>
              <p className={`font-semibold text-gray-900 ${item.hoverText}`}>{item.title}</p>
              <p className="text-sm text-gray-500 mt-0.5">{item.description}</p>
            </div>
          </Link>
        ))}
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
        <div className="overflow-auto max-h-[70vh]">
          {Object.keys(inventoryByCompany).length === 0 ? (
            <p className="p-6 text-sm text-gray-500">No inventory data yet.</p>
          ) : (
            <table className="w-full text-sm">
              <InventoryByCompanyRows inventoryByCompany={inventoryByCompany} />
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
          <div className="overflow-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <StockAtVendorsRows jwRows={jwRows} />
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
