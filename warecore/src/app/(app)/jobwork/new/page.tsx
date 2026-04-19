'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { generateReferenceNumber } from '@/lib/utils'
import type { Company, Supplier, Warehouse, MaterialType, MaterialSize } from '@/types'

type JobWorkLine = {
  material_type_id: string
  material_size_id: string
  size_label: string
  quantity: string
  notes: string
}

const emptyLine = (): JobWorkLine => ({ material_type_id: '', material_size_id: '', size_label: '', quantity: '', notes: '' })

export default function NewJobWorkPage() {
  const router = useRouter()
  const supabase = createClient()

  const [companies, setCompanies] = useState<Company[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([])
  const [materialSizes, setMaterialSizes] = useState<MaterialSize[]>([])

  const [companyId, setCompanyId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [dispatchDate, setDispatchDate] = useState(new Date().toISOString().split('T')[0])
  const [expectedReturnDate, setExpectedReturnDate] = useState('')
  const [workDescription, setWorkDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<JobWorkLine[]>([emptyLine()])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const [c, s, w, mt, ms] = await Promise.all([
        supabase.from('companies').select('*').eq('is_active', true).order('name'),
        supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
        supabase.from('warehouses').select('*').eq('is_active', true).order('name'),
        supabase.from('material_types').select('*').eq('is_active', true).order('name'),
        supabase.from('material_sizes').select('*').eq('is_active', true).order('size_label'),
      ])
      setCompanies(c.data ?? [])
      setSuppliers(s.data ?? [])
      setWarehouses(w.data ?? [])
      setMaterialTypes(mt.data ?? [])
      setMaterialSizes(ms.data ?? [])
    }
    load()
  }, [supabase])

  const updateLine = useCallback((index: number, field: keyof JobWorkLine, value: string) => {
    setLines((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }, [])

  const addLine = () => setLines((prev) => [...prev, emptyLine()])
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i))

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

    const { data: order, error: oErr } = await supabase
      .from('job_work_orders')
      .insert({
        reference_number: generateReferenceNumber('JW'),
        company_id: companyId || null,
        warehouse_id: warehouseId || null,
        vendor_id: vendorId || null,
        dispatch_date: dispatchDate,
        expected_return_date: expectedReturnDate || null,
        work_description: workDescription || null,
        status: 'dispatched',
        notes: notes || null,
      })
      .select()
      .single()

    if (oErr || !order) {
      setError(oErr?.message ?? 'Failed to create job work order')
      setLoading(false)
      return
    }

    const itemsPayload = validLines.map((l) => ({
      job_work_order_id: order.id,
      material_type_id: l.material_type_id || null,
      material_size_id: l.material_size_id || null,
      size_label: l.size_label || null,
      quantity_sent: parseFloat(l.quantity),
      quantity_received: 0,
    }))

    const { error: iErr } = await supabase.from('job_work_items').insert(itemsPayload)

    if (iErr) {
      setError(iErr.message)
      setLoading(false)
      return
    }

    router.push('/jobwork')
    router.refresh()
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">New Job Work Order</h1>
        <p className="mt-1 text-sm text-gray-500">Dispatch material to a vendor for processing</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Order Details</h2>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
              <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                <option value="">— Select Vendor —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                <option value="">— Select Warehouse —</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dispatch Date</label>
              <input type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} required
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Expected Return</label>
              <input type="date" value={expectedReturnDate} onChange={(e) => setExpectedReturnDate(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Work Description</label>
              <input type="text" value={workDescription} onChange={(e) => setWorkDescription(e.target.value)}
                placeholder="e.g. Slitting, Shearing, etc."
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">Material Items</h2>
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
                          placeholder="Custom" className="block w-28 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
                      </td>
                      <td className="pr-3 py-2">
                        <input type="number" value={line.quantity} onChange={(e) => updateLine(i, 'quantity', e.target.value)}
                          step="0.001" min="0" required placeholder="0.000"
                          className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
                      </td>
                      <td className="pr-3 py-2">
                        <input type="text" value={line.notes} onChange={(e) => updateLine(i, 'notes', e.target.value)}
                          className="block w-32 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
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
            {loading ? 'Saving...' : '✓ Create Job Work Order'}
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
