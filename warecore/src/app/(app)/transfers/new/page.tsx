'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Company, Warehouse, MaterialType, MaterialSize } from '@/types'

type TransferLine = {
  material_type_id: string
  material_size_id: string
  size_label: string
  quantity: string
  notes: string
}

const emptyLine = (): TransferLine => ({
  material_type_id: '',
  material_size_id: '',
  size_label: '',
  quantity: '',
  notes: '',
})

export default function NewTransferPage() {
  const router = useRouter()
  const supabase = createClient()

  const [companies, setCompanies] = useState<Company[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([])
  const [materialSizes, setMaterialSizes] = useState<MaterialSize[]>([])

  const [fromCompanyId, setFromCompanyId] = useState('')
  const [toCompanyId, setToCompanyId] = useState('')
  const [fromWarehouseId, setFromWarehouseId] = useState('')
  const [toWarehouseId, setToWarehouseId] = useState('')
  const [transferDate, setTransferDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<TransferLine[]>([emptyLine()])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const [c, w, mt, ms] = await Promise.all([
        supabase.from('companies').select('*').eq('is_active', true).order('name'),
        supabase.from('warehouses').select('*').eq('is_active', true).order('name'),
        supabase.from('material_types').select('*').eq('is_active', true).order('name'),
        supabase.from('material_sizes').select('*').eq('is_active', true).order('size_label'),
      ])
      setCompanies(c.data ?? [])
      setWarehouses(w.data ?? [])
      setMaterialTypes(mt.data ?? [])
      setMaterialSizes(ms.data ?? [])
    }
    load()
  }, [supabase])

  const updateLine = useCallback((index: number, field: keyof TransferLine, value: string) => {
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

    const { data: transfer, error: tErr } = await supabase
      .from('transfers')
      .insert({
        from_company_id: fromCompanyId || null,
        to_company_id: toCompanyId || null,
        from_warehouse_id: fromWarehouseId || null,
        to_warehouse_id: toWarehouseId || null,
        transfer_date: transferDate,
        status: 'pending',
        notes: notes || null,
      })
      .select()
      .single()

    if (tErr || !transfer) {
      setError(tErr?.message ?? 'Failed to create transfer')
      setLoading(false)
      return
    }

    const itemsPayload = validLines.map((l) => ({
      transfer_id: transfer.id,
      material_type_id: l.material_type_id || null,
      material_size_id: l.material_size_id || null,
      size_label: l.size_label || null,
      quantity: parseFloat(l.quantity),
      notes: l.notes || null,
    }))

    const { error: iErr } = await supabase.from('transfer_items').insert(itemsPayload)

    if (iErr) {
      setError(iErr.message)
      setLoading(false)
      return
    }

    router.push('/transfers')
    router.refresh()
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">New Transfer</h1>
        <p className="mt-1 text-sm text-gray-500">Transfer material between companies or warehouses</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Transfer Details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Company</label>
              <select
                value={fromCompanyId}
                onChange={(e) => setFromCompanyId(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">— Select —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Warehouse</label>
              <select
                value={fromWarehouseId}
                onChange={(e) => setFromWarehouseId(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">— Select —</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Transfer Date</label>
              <input
                type="date"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
                required
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Company</label>
              <select
                value={toCompanyId}
                onChange={(e) => setToCompanyId(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">— Select —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Warehouse</label>
              <select
                value={toWarehouseId}
                onChange={(e) => setToWarehouseId(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">— Select —</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">Line Items</h2>
            <button type="button" onClick={addLine} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
              + Add Line
            </button>
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
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lines.map((line, i) => {
                  const sizesForType = materialSizes.filter(
                    (s) => !s.material_type_id || s.material_type_id === line.material_type_id
                  )
                  return (
                    <tr key={i}>
                      <td className="pr-3 py-2">
                        <select
                          value={line.material_type_id}
                          onChange={(e) => updateLine(i, 'material_type_id', e.target.value)}
                          required
                          className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">Select</option>
                          {materialTypes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
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
                          {sizesForType.map((s) => <option key={s.id} value={s.id}>{s.size_label}</option>)}
                        </select>
                      </td>
                      <td className="pr-3 py-2">
                        <input
                          type="text"
                          value={line.size_label}
                          onChange={(e) => updateLine(i, 'size_label', e.target.value)}
                          placeholder="Custom"
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
                          type="text"
                          value={line.notes}
                          onChange={(e) => updateLine(i, 'notes', e.target.value)}
                          className="block w-32 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
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
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Saving...' : '✓ Create Transfer'}
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
