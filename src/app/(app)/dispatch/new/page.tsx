'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import MissingMasterDataBanner from '@/components/MissingMasterDataBanner'
import {
  ACTIVE_COMPANIES_QUERY, ACTIVE_WAREHOUSES_QUERY, ACTIVE_CUSTOMERS_QUERY,
  ACTIVE_MATERIAL_TYPES_QUERY, ACTIVE_MATERIAL_SIZES_QUERY,
  CREATE_DISPATCH_ORDER_MUTATION, CREATE_DISPATCH_ITEMS_MUTATION,
} from '@/lib/hasura/queries'
import { generateReferenceNumber } from '@/lib/utils'
import type { Company, Warehouse, Customer, MaterialType, MaterialSize } from '@/types'

type DispatchLine = {
  material_type_id: string
  material_size_id: string
  size_label: string
  quantity: string
  rate: string
  amount: string
  notes: string
}

const emptyLine = (): DispatchLine => ({ material_type_id: '', material_size_id: '', size_label: '', quantity: '', rate: '', amount: '', notes: '' })

export default function NewDispatchPage() {
  const router = useRouter()

  const [companies, setCompanies] = useState<Company[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([])
  const [materialSizes, setMaterialSizes] = useState<MaterialSize[]>([])

  const [companyId, setCompanyId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [dispatchDate, setDispatchDate] = useState(new Date().toISOString().split('T')[0])
  const [vehicleNumber, setVehicleNumber] = useState('')
  const [driverName, setDriverName] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DispatchLine[]>([emptyLine()])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [masterDataLoading, setMasterDataLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [c, w, cu, mt, ms] = await Promise.all([
        hasuraFetch(ACTIVE_COMPANIES_QUERY),
        hasuraFetch(ACTIVE_WAREHOUSES_QUERY),
        hasuraFetch(ACTIVE_CUSTOMERS_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_TYPES_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_SIZES_QUERY),
      ])
      setCompanies((c.data as any)?.companies ?? [])
      setWarehouses((w.data as any)?.warehouses ?? [])
      setCustomers((cu.data as any)?.customers ?? [])
      setMaterialTypes((mt.data as any)?.material_types ?? [])
      setMaterialSizes((ms.data as any)?.material_sizes ?? [])
      setMasterDataLoading(false)
    }
    load()
  }, [])

  const updateLine = useCallback((index: number, field: keyof DispatchLine, value: string) => {
    setLines((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      if (field === 'quantity' || field === 'rate') {
        const qty = parseFloat(field === 'quantity' ? value : updated[index].quantity) || 0
        const rate = parseFloat(field === 'rate' ? value : updated[index].rate) || 0
        updated[index].amount = (qty * rate).toFixed(2)
      }
      return updated
    })
  }, [])

  const addLine = () => setLines((prev) => [...prev, emptyLine()])
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i))
  const totalQty = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0)
  const totalAmt = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const validLines = lines.filter((l) => l.material_type_id && l.quantity)
    if (!validLines.length) {
      setError('Add at least one line item.')
      setLoading(false)
      return
    }

    const { data: orderData, error: oErr } = await hasuraFetch<any>(
      CREATE_DISPATCH_ORDER_MUTATION, {
        company_id: companyId || null,
        warehouse_id: warehouseId || null,
        customer_id: customerId || null,
        invoice_number: generateReferenceNumber('INV'),
        dispatch_date: dispatchDate,
        vehicle_number: vehicleNumber || null,
        driver_name: driverName || null,
        total_quantity: totalQty,
        total_amount: totalAmt || null,
        notes: notes || null,
      }
    )
    const order = orderData?.insert_dispatch_orders_one
    if (oErr || !order) {
      setError(oErr?.message ?? 'Failed to create dispatch')
      setLoading(false)
      return
    }

    const items = validLines.map((l) => ({
      dispatch_order_id: order.id,
      material_type_id: l.material_type_id || null,
      material_size_id: l.material_size_id || null,
      size_label: l.size_label || null,
      quantity: parseFloat(l.quantity),
      rate: l.rate ? parseFloat(l.rate) : null,
      amount: l.amount ? parseFloat(l.amount) : null,
      notes: l.notes || null,
    }))
    const { error: iErr } = await hasuraFetch(CREATE_DISPATCH_ITEMS_MUTATION, { items })
    if (iErr) {
      setError(iErr.message)
      setLoading(false)
      return
    }

    router.push('/dispatch')
    router.refresh()
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">New Dispatch Order</h1>
        <p className="mt-1 text-sm text-gray-500">Create a new sales dispatch</p>
      </div>

      <MissingMasterDataBanner
        loading={masterDataLoading}
        checks={[
          { label: 'Companies', count: companies.length, adminPath: '/admin/companies/new' },
          { label: 'Warehouses', count: warehouses.length, adminPath: '/admin/warehouses/new' },
          { label: 'Customers', count: customers.length, adminPath: '/admin/customers/new' },
          { label: 'Material Types', count: materialTypes.length, adminPath: '/admin/materials/new' },
        ]}
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Dispatch Details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
              <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                <option value="">— Select —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                <option value="">— Select —</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                <option value="">— Select —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dispatch Date</label>
              <input type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} required
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Number</label>
              <input type="text" value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)}
                placeholder="e.g. MH-01-AB-1234"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Driver Name</label>
              <input type="text" value={driverName} onChange={(e) => setDriverName(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">Items</h2>
            <button type="button" onClick={addLine} className="text-sm text-blue-600 hover:text-blue-800 font-medium">+ Add Line</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Material</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Size</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Custom Size</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Quantity</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Rate (₹)</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Amount (₹)</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lines.map((line, i) => {
                  const sizesForType = materialSizes.filter((s) => !s.material_type_id || s.material_type_id === line.material_type_id)
                  return (
                    <tr key={i}>
                      <td className="pr-3 py-2">
                        <select value={line.material_type_id} onChange={(e) => updateLine(i, 'material_type_id', e.target.value)} required
                          className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none">
                          <option value="">Select</option>
                          {materialTypes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                      </td>
                      <td className="pr-3 py-2">
                        <select value={line.material_size_id}
                          onChange={(e) => { const sz = materialSizes.find(s => s.id === e.target.value); updateLine(i, 'material_size_id', e.target.value); if (sz) updateLine(i, 'size_label', sz.size_label) }}
                          className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none">
                          <option value="">Select</option>
                          {sizesForType.map((s) => <option key={s.id} value={s.id}>{s.size_label}</option>)}
                        </select>
                      </td>
                      <td className="pr-3 py-2">
                        <input type="text" value={line.size_label} onChange={(e) => updateLine(i, 'size_label', e.target.value)}
                          placeholder="Custom" className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
                      </td>
                      <td className="pr-3 py-2">
                        <input type="number" value={line.quantity} onChange={(e) => updateLine(i, 'quantity', e.target.value)}
                          step="0.001" min="0" required placeholder="0.000"
                          className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
                      </td>
                      <td className="pr-3 py-2">
                        <input type="number" value={line.rate} onChange={(e) => updateLine(i, 'rate', e.target.value)}
                          step="0.01" min="0" placeholder="0.00"
                          className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
                      </td>
                      <td className="pr-3 py-2">
                        <input type="number" value={line.amount} onChange={(e) => updateLine(i, 'amount', e.target.value)}
                          step="0.01" min="0" placeholder="0.00"
                          className="block w-28 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
                      </td>
                      <td className="pr-3 py-2">
                        <input type="text" value={line.notes} onChange={(e) => updateLine(i, 'notes', e.target.value)}
                          className="block w-28 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
                      </td>
                      <td className="py-2">
                        {lines.length > 1 && (
                          <button type="button" onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600 font-bold px-2">×</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200">
                  <td colSpan={3} className="py-3 text-sm font-semibold text-right pr-3">Totals:</td>
                  <td className="py-3 pr-3 text-sm font-bold">{totalQty.toFixed(3)}</td>
                  <td></td>
                  <td className="py-3 pr-3 text-sm font-bold">₹{totalAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button type="submit" disabled={loading}
            className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {loading ? 'Saving...' : '✓ Create Dispatch'}
          </button>
          <button type="button" onClick={() => router.back()}
            className="rounded-lg border border-gray-300 px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
