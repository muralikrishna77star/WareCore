'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import MissingMasterDataBanner from '@/components/MissingMasterDataBanner'
import {
  ACTIVE_COMPANIES_QUERY, ACTIVE_WAREHOUSES_QUERY, ACTIVE_SUPPLIERS_QUERY,
  ACTIVE_MATERIAL_TYPES_QUERY, ACTIVE_MATERIAL_SIZES_QUERY,
  CREATE_PURCHASE_BILL_MUTATION, CREATE_PURCHASE_BILL_ITEMS_MUTATION,
} from '@/lib/hasura/queries'
import type { Company, Warehouse, Supplier, MaterialType, MaterialSize } from '@/types'

type LineItem = {
  material_type_id: string
  material_size_id: string
  size_label: string
  quantity: string
  rate: string
  amount: string
  notes: string
}

const emptyLine = (): LineItem => ({
  material_type_id: '',
  material_size_id: '',
  size_label: '',
  quantity: '',
  rate: '',
  amount: '',
  notes: '',
})

export default function NewBillPage() {
  const router = useRouter()

  const [companies, setCompanies] = useState<Company[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([])
  const [materialSizes, setMaterialSizes] = useState<MaterialSize[]>([])

  const [companyId, setCompanyId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [billNumber, setBillNumber] = useState('')
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineItem[]>([emptyLine()])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [masterDataLoading, setMasterDataLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [c, w, s, mt, ms] = await Promise.all([
        hasuraFetch(ACTIVE_COMPANIES_QUERY),
        hasuraFetch(ACTIVE_WAREHOUSES_QUERY),
        hasuraFetch(ACTIVE_SUPPLIERS_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_TYPES_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_SIZES_QUERY),
      ])
      setCompanies((c.data as any)?.companies ?? [])
      setWarehouses((w.data as any)?.warehouses ?? [])
      setSuppliers((s.data as any)?.suppliers ?? [])
      setMaterialTypes((mt.data as any)?.material_types ?? [])
      setMaterialSizes((ms.data as any)?.material_sizes ?? [])
      setMasterDataLoading(false)
    }
    load()
  }, [])

  const filteredWarehouses = warehouseId
    ? warehouses
    : companyId
    ? warehouses.filter((w) => w.company_id === companyId || !w.company_id)
    : warehouses

  const updateLine = useCallback((index: number, field: keyof LineItem, value: string) => {
    setLines((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      // Auto-calculate amount
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
      setError('Add at least one line item with material and quantity.')
      setLoading(false)
      return
    }

    // Create bill
    const { data: billData, error: billError } = await hasuraFetch<any>(
      CREATE_PURCHASE_BILL_MUTATION, {
        company_id: companyId || null,
        warehouse_id: warehouseId || null,
        supplier_id: supplierId || null,
        bill_number: billNumber,
        bill_date: billDate,
        total_quantity: totalQty,
        total_amount: totalAmt,
        notes: notes || null,
      }
    )
    const bill = billData?.insert_purchase_bills_one
    if (billError || !bill) {
      setError(billError?.message ?? 'Failed to create bill')
      setLoading(false)
      return
    }

    // Insert line items
    const items = validLines.map((l) => ({
      bill_id: bill.id,
      material_type_id: l.material_type_id || null,
      material_size_id: l.material_size_id || null,
      size_label: l.size_label || null,
      quantity: parseFloat(l.quantity),
      rate: l.rate ? parseFloat(l.rate) : null,
      amount: l.amount ? parseFloat(l.amount) : null,
      notes: l.notes || null,
    }))
    const { error: itemsError } = await hasuraFetch(CREATE_PURCHASE_BILL_ITEMS_MUTATION, { items })
    if (itemsError) {
      setError(itemsError.message)
      setLoading(false)
      return
    }

    router.push('/bills')
    router.refresh()
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">New Purchase Bill</h1>
        <p className="mt-1 text-sm text-gray-500">Record a new inward purchase</p>
      </div>

      <MissingMasterDataBanner
        loading={masterDataLoading}
        checks={[
          { label: 'Companies', count: companies.length, adminPath: '/admin/companies/new' },
          { label: 'Warehouses', count: warehouses.length, adminPath: '/admin/warehouses/new' },
          { label: 'Suppliers', count: suppliers.length, adminPath: '/admin/suppliers/new' },
          { label: 'Material Types', count: materialTypes.length, adminPath: '/admin/materials/new' },
        ]}
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Header Details */}
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Bill Details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">— Select Company —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse</label>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">— Select Warehouse —</option>
                {filteredWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">— Select Supplier —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bill Number</label>
              <input
                type="text"
                value={billNumber}
                onChange={(e) => setBillNumber(e.target.value)}
                placeholder="e.g. INV-2024-001"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bill Date</label>
              <input
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                required
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">Line Items</h2>
            <button
              type="button"
              onClick={addLine}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              + Add Line
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Material Type</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Size</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Custom Size</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Quantity</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Rate (₹)</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Amount (₹)</th>
                  <th className="pb-2 text-xs font-medium text-gray-500">Notes</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lines.map((line, i) => {
                  const sizesForType = materialSizes.filter(
                    (s) => !s.material_type_id || s.material_type_id === line.material_type_id
                  )
                  return (
                    <tr key={i} className="py-1">
                      <td className="pr-3 py-2">
                        <select
                          value={line.material_type_id}
                          onChange={(e) => updateLine(i, 'material_type_id', e.target.value)}
                          required
                          className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">Select</option>
                          {materialTypes.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="pr-3 py-2">
                        <select
                          value={line.material_size_id}
                          onChange={(e) => {
                            const size = materialSizes.find(s => s.id === e.target.value)
                            updateLine(i, 'material_size_id', e.target.value)
                            if (size) updateLine(i, 'size_label', size.size_label)
                          }}
                          className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">Select</option>
                          {sizesForType.map((s) => (
                            <option key={s.id} value={s.id}>{s.size_label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="pr-3 py-2">
                        <input
                          type="text"
                          value={line.size_label}
                          onChange={(e) => updateLine(i, 'size_label', e.target.value)}
                          placeholder="Custom size"
                          className="block w-28 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="pr-3 py-2">
                        <input
                          type="number"
                          value={line.quantity}
                          onChange={(e) => updateLine(i, 'quantity', e.target.value)}
                          step="0.001"
                          min="0"
                          required
                          placeholder="0.000"
                          className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="pr-3 py-2">
                        <input
                          type="number"
                          value={line.rate}
                          onChange={(e) => updateLine(i, 'rate', e.target.value)}
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="pr-3 py-2">
                        <input
                          type="number"
                          value={line.amount}
                          onChange={(e) => updateLine(i, 'amount', e.target.value)}
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          className="block w-28 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="pr-3 py-2">
                        <input
                          type="text"
                          value={line.notes}
                          onChange={(e) => updateLine(i, 'notes', e.target.value)}
                          placeholder="Notes"
                          className="block w-32 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="py-2">
                        {lines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeLine(i)}
                            className="text-red-400 hover:text-red-600 font-bold px-2"
                          >
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200">
                  <td colSpan={3} className="py-3 text-sm font-semibold text-gray-700 text-right pr-3">Totals:</td>
                  <td className="py-3 pr-3 text-sm font-bold text-gray-900">{totalQty.toFixed(3)}</td>
                  <td className="py-3 pr-3"></td>
                  <td className="py-3 pr-3 text-sm font-bold text-gray-900">₹{totalAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
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
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Saving...' : '✓ Save Bill'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg border border-gray-300 px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
