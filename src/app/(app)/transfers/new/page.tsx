'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import MissingMasterDataBanner from '@/components/MissingMasterDataBanner'
import {
  ACTIVE_COMPANIES_QUERY, ACTIVE_WAREHOUSES_QUERY,
  ACTIVE_MATERIAL_TYPES_QUERY, ACTIVE_MATERIAL_SIZES_QUERY,
  CREATE_TRANSFER_MUTATION, CREATE_TRANSFER_ITEMS_MUTATION,
  CREATE_MATERIAL_TYPE_MUTATION, CREATE_MATERIAL_SIZE_MUTATION,
} from '@/lib/hasura/queries'
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

  const [companies, setCompanies] = useState<Company[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([])
  const [materialSizes, setMaterialSizes] = useState<MaterialSize[]>([])

  const [showMaterialTypeDialog, setShowMaterialTypeDialog] = useState(false)
  const [newMaterialTypeName, setNewMaterialTypeName] = useState('')
  const [newMaterialTypeUnit, setNewMaterialTypeUnit] = useState('tons')
  const [materialTypeDialogLoading, setMaterialTypeDialogLoading] = useState(false)
  const [activeLineIndexForNewType, setActiveLineIndexForNewType] = useState<number | null>(null)

  const [showSizeDialog, setShowSizeDialog] = useState(false)
  const [newSizeMaterialTypeId, setNewSizeMaterialTypeId] = useState('')
  const [newSizeLabel, setNewSizeLabel] = useState('')
  const [newSizeThickness, setNewSizeThickness] = useState('')
  const [newSizeWidth, setNewSizeWidth] = useState('')
  const [sizeDialogLoading, setSizeDialogLoading] = useState(false)
  const [activeLineIndexForNewSize, setActiveLineIndexForNewSize] = useState<number | null>(null)

  const [fromCompanyId, setFromCompanyId] = useState('')
  const [toCompanyId, setToCompanyId] = useState('')
  const [fromWarehouseId, setFromWarehouseId] = useState('')
  const [toWarehouseId, setToWarehouseId] = useState('')
  const [transferDate, setTransferDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<TransferLine[]>([emptyLine()])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [masterDataLoading, setMasterDataLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [c, w, mt, ms] = await Promise.all([
        hasuraFetch(ACTIVE_COMPANIES_QUERY),
        hasuraFetch(ACTIVE_WAREHOUSES_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_TYPES_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_SIZES_QUERY),
      ])
      setCompanies((c.data as any)?.companies ?? [])
      setWarehouses((w.data as any)?.warehouses ?? [])
      setMaterialTypes((mt.data as any)?.material_types ?? [])
      setMaterialSizes((ms.data as any)?.material_sizes ?? [])
      setMasterDataLoading(false)
    }
    load()
  }, [])

  const handleCreateMaterialType = async () => {
    if (!newMaterialTypeName.trim()) return

    setMaterialTypeDialogLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_material_types_one: MaterialType }>(CREATE_MATERIAL_TYPE_MUTATION, {
      name: newMaterialTypeName.trim(),
      unit: newMaterialTypeUnit.trim() || null,
      description: null,
    })

    if (err) {
      setError(err.message)
      setMaterialTypeDialogLoading(false)
      return
    }

    const newType = data?.insert_material_types_one
    if (newType) {
      setMaterialTypes((prev) => [...prev, newType])
      if (activeLineIndexForNewType !== null) {
        updateLine(activeLineIndexForNewType, 'material_type_id', newType.id)
        updateLine(activeLineIndexForNewType, 'material_size_id', '')
        updateLine(activeLineIndexForNewType, 'size_label', '')
      }
      setShowMaterialTypeDialog(false)
      setNewMaterialTypeName('')
      setNewMaterialTypeUnit('tons')
      setActiveLineIndexForNewType(null)
    }

    setMaterialTypeDialogLoading(false)
  }

  const handleCreateSize = async () => {
    const materialTypeId = newSizeMaterialTypeId || (activeLineIndexForNewSize !== null ? lines[activeLineIndexForNewSize].material_type_id : '')
    if (!materialTypeId || !newSizeLabel.trim()) return

    setSizeDialogLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_material_sizes_one: MaterialSize }>(CREATE_MATERIAL_SIZE_MUTATION, {
      material_type_id: materialTypeId,
      size_label: newSizeLabel.trim(),
      thickness: newSizeThickness ? parseFloat(newSizeThickness) : null,
      width: newSizeWidth ? parseFloat(newSizeWidth) : null,
    })

    if (err) {
      setError(err.message)
      setSizeDialogLoading(false)
      return
    }

    const newSize = data?.insert_material_sizes_one
    if (newSize) {
      setMaterialSizes((prev) => [...prev, newSize])
      if (activeLineIndexForNewSize !== null) {
        updateLine(activeLineIndexForNewSize, 'material_size_id', newSize.id)
        updateLine(activeLineIndexForNewSize, 'size_label', newSize.size_label)
      }
      setShowSizeDialog(false)
      setNewSizeMaterialTypeId('')
      setNewSizeLabel('')
      setNewSizeThickness('')
      setNewSizeWidth('')
      setActiveLineIndexForNewSize(null)
    }

    setSizeDialogLoading(false)
  }

  const handleCancelNewType = () => {
    setShowMaterialTypeDialog(false)
    setNewMaterialTypeName('')
    setNewMaterialTypeUnit('tons')
    setActiveLineIndexForNewType(null)
  }

  const handleCancelNewSize = () => {
    setShowSizeDialog(false)
    setNewSizeMaterialTypeId('')
    setNewSizeLabel('')
    setNewSizeThickness('')
    setNewSizeWidth('')
    setActiveLineIndexForNewSize(null)
  }

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

    const { data: transferData, error: tErr } = await hasuraFetch<any>(
      CREATE_TRANSFER_MUTATION, {
        from_company_id: fromCompanyId || null,
        to_company_id: toCompanyId || null,
        from_warehouse_id: fromWarehouseId || null,
        to_warehouse_id: toWarehouseId || null,
        transfer_date: transferDate,
        status: 'pending',
        notes: notes || null,
      }
    )
    const transfer = transferData?.insert_transfers_one
    if (tErr || !transfer) {
      setError(tErr?.message ?? 'Failed to create transfer')
      setLoading(false)
      return
    }

    const items = validLines.map((l) => ({
      transfer_id: transfer.id,
      material_type_id: l.material_type_id || null,
      material_size_id: l.material_size_id || null,
      size_label: l.size_label || null,
      quantity: parseFloat(l.quantity),
      notes: l.notes || null,
    }))
    const { error: iErr } = await hasuraFetch(CREATE_TRANSFER_ITEMS_MUTATION, { items })
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

      <MissingMasterDataBanner
        loading={masterDataLoading}
        checks={[
          { label: 'Companies', count: companies.length, adminPath: '/admin/companies/new' },
          { label: 'Warehouses', count: warehouses.length, adminPath: '/admin/warehouses/new' },
          { label: 'Material Types', count: materialTypes.length, adminPath: '/admin/materials/new' },
        ]}
      />

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
              <thead className="sticky top-0 z-10 bg-gray-50">
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
                          onChange={(e) => {
                            if (e.target.value === 'NEW_TYPE') {
                              setActiveLineIndexForNewType(i)
                              setShowMaterialTypeDialog(true)
                              return
                            }
                            updateLine(i, 'material_type_id', e.target.value)
                            updateLine(i, 'material_size_id', '')
                            updateLine(i, 'size_label', '')
                          }}
                          required
                          className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">Select</option>
                          {materialTypes.map((m) => <option key={m.id} value={m.id}>{m.description}</option>)}
                          <option value="NEW_TYPE" className="font-semibold">+ New Material Type</option>
                        </select>
                      </td>
                      <td className="pr-3 py-2">
                        <select
                          value={line.material_size_id}
                          onChange={(e) => {
                            if (e.target.value === 'NEW_SIZE') {
                              setActiveLineIndexForNewSize(i)
                              setNewSizeMaterialTypeId(line.material_type_id)
                              setShowSizeDialog(true)
                              return
                            }
                            const size = materialSizes.find(s => s.id === e.target.value)
                            updateLine(i, 'material_size_id', e.target.value)
                            if (size) updateLine(i, 'size_label', size.size_label)
                          }}
                          className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">Select</option>
                          {sizesForType.map((s) => <option key={s.id} value={s.id}>{s.size_label}</option>)}
                          <option value="NEW_SIZE" className="font-semibold">+ New Size</option>
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

          {showMaterialTypeDialog && (
            <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50 p-5 mb-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-blue-900">Create New Material Type</h2>
                  <p className="text-sm text-blue-700">Add a material type and assign it to the selected line.</p>
                </div>
                <button type="button" onClick={handleCancelNewType} className="text-sm text-blue-700 hover:text-blue-900">Cancel</button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-blue-900 mb-1">Material Type Name</label>
                  <input value={newMaterialTypeName} onChange={(e) => setNewMaterialTypeName(e.target.value)}
                    className="block w-full rounded border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    placeholder="Enter material type" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-blue-900 mb-1">Unit</label>
                  <input value={newMaterialTypeUnit} onChange={(e) => setNewMaterialTypeUnit(e.target.value)}
                    className="block w-full rounded border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    placeholder="tons" />
                </div>
              </div>
              <div className="mt-4 flex gap-3">
                <button type="button" onClick={handleCreateMaterialType} disabled={materialTypeDialogLoading}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {materialTypeDialogLoading ? 'Creating…' : 'Create Material Type'}
                </button>
              </div>
            </div>
          )}
          {showSizeDialog && (
            <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50 p-5 mb-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-blue-900">Create New Size</h2>
                  <p className="text-sm text-blue-700">Add a size for the selected material type.</p>
                </div>
                <button type="button" onClick={handleCancelNewSize} className="text-sm text-blue-700 hover:text-blue-900">Cancel</button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-blue-900 mb-1">Material Type</label>
                  <select value={newSizeMaterialTypeId} onChange={(e) => setNewSizeMaterialTypeId(e.target.value)}
                    className="block w-full rounded border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                    <option value="">— Select Material Type —</option>
                    {materialTypes.map((m) => <option key={m.id} value={m.id}>{m.description}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-blue-900 mb-1">Size Label</label>
                  <input value={newSizeLabel} onChange={(e) => setNewSizeLabel(e.target.value)}
                    className="block w-full rounded border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    placeholder="Enter size label" />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 mt-4">
                <div>
                  <label className="block text-sm font-medium text-blue-900 mb-1">Thickness</label>
                  <input value={newSizeThickness} onChange={(e) => setNewSizeThickness(e.target.value)}
                    className="block w-full rounded border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    placeholder="Optional" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-blue-900 mb-1">Width</label>
                  <input value={newSizeWidth} onChange={(e) => setNewSizeWidth(e.target.value)}
                    className="block w-full rounded border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    placeholder="Optional" />
                </div>
              </div>
              <div className="mt-4 flex gap-3">
                <button type="button" onClick={handleCreateSize} disabled={sizeDialogLoading}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {sizeDialogLoading ? 'Creating…' : 'Create Size'}
                </button>
              </div>
            </div>
          )}
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
