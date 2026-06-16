'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import MissingMasterDataBanner from '@/components/MissingMasterDataBanner'
import {
  ACTIVE_COMPANIES_QUERY, ACTIVE_WAREHOUSES_QUERY,
  ACTIVE_MATERIAL_TYPES_QUERY, ACTIVE_MATERIAL_SIZES_QUERY,
  ACTIVE_ITEM_MASTER_QUERY,
  ALL_PURCHASE_BILL_ITEM_LINES_QUERY,
  CREATE_TRANSFER_MUTATION, CREATE_TRANSFER_ITEMS_MUTATION,
  CREATE_MATERIAL_TYPE_MUTATION, CREATE_MATERIAL_SIZE_MUTATION,
} from '@/lib/hasura/queries'
import type { Company, Warehouse, MaterialType, MaterialSize } from '@/types'

type TransferLine = {
  item_master_id: string
  item_name: string
  item_search: string
  material_type_id: string
  material_size_id: string
  size_label: string
  purchase_line_id: string
  quantity: string
  notes: string
}

const emptyLine = (): TransferLine => ({
  item_master_id: '',
  item_name: '',
  item_search: '',
  material_type_id: '',
  material_size_id: '',
  size_label: '',
  purchase_line_id: '',
  quantity: '',
  notes: '',
})

export default function NewTransferPage() {
  const router = useRouter()

  const [companies, setCompanies] = useState<Company[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([])
  const [materialSizes, setMaterialSizes] = useState<MaterialSize[]>([])
  const [itemMaster, setItemMaster] = useState<any[]>([])
  const [purchaseLinesByItem, setPurchaseLinesByItem] = useState<Record<string, string[]>>({})

  const [showMaterialTypeDialog, setShowMaterialTypeDialog] = useState(false)
  const [newMaterialTypeName, setNewMaterialTypeName] = useState('')
  const [newMaterialTypeUnit, setNewMaterialTypeUnit] = useState('MT')
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
  const [openDropdown, setOpenDropdown] = useState<number | null>(null)

  const tableRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const load = async () => {
      const [c, w, mt, ms, im, pbl] = await Promise.all([
        hasuraFetch(ACTIVE_COMPANIES_QUERY),
        hasuraFetch(ACTIVE_WAREHOUSES_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_TYPES_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_SIZES_QUERY),
        hasuraFetch(ACTIVE_ITEM_MASTER_QUERY),
        hasuraFetch(ALL_PURCHASE_BILL_ITEM_LINES_QUERY),
      ])
      setCompanies((c.data as any)?.companies ?? [])
      setWarehouses((w.data as any)?.warehouses ?? [])
      setMaterialTypes((mt.data as any)?.material_types ?? [])
      setMaterialSizes((ms.data as any)?.material_sizes ?? [])
      setItemMaster((im.data as any)?.item_master ?? [])

      const raw: { item_master_id: string; purchase_line_id: string }[] =
        (pbl.data as any)?.purchase_bill_items ?? []
      const byItem: Record<string, string[]> = {}
      for (const r of raw) {
        if (!r.item_master_id || !r.purchase_line_id) continue
        if (!byItem[r.item_master_id]) byItem[r.item_master_id] = []
        if (!byItem[r.item_master_id].includes(r.purchase_line_id))
          byItem[r.item_master_id].push(r.purchase_line_id)
      }
      setPurchaseLinesByItem(byItem)
      setMasterDataLoading(false)
    }
    load()
  }, [])

  useEffect(() => {
    if (openDropdown === null) return
    function handleClick(e: MouseEvent) {
      if (tableRef.current && !tableRef.current.contains(e.target as Node)) {
        setOpenDropdown(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [openDropdown])

  const handleCreateMaterialType = async () => {
    if (!newMaterialTypeName.trim()) return
    setMaterialTypeDialogLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_material_types_one: MaterialType }>(CREATE_MATERIAL_TYPE_MUTATION, {
      name: newMaterialTypeName.trim(),
      unit: newMaterialTypeUnit.trim() || null,
      description: null,
    })
    if (err) { setError(err.message); setMaterialTypeDialogLoading(false); return }
    const newType = data?.insert_material_types_one
    if (newType) {
      setMaterialTypes((prev) => [...prev, newType])
      if (activeLineIndexForNewType !== null) {
        selectLineFields(activeLineIndexForNewType, { material_type_id: newType.id, material_size_id: '', size_label: '' })
      }
      setShowMaterialTypeDialog(false)
      setNewMaterialTypeName('')
      setNewMaterialTypeUnit('MT')
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
    if (err) { setError(err.message); setSizeDialogLoading(false); return }
    const newSize = data?.insert_material_sizes_one
    if (newSize) {
      setMaterialSizes((prev) => [...prev, newSize])
      if (activeLineIndexForNewSize !== null) {
        selectLineFields(activeLineIndexForNewSize, { material_size_id: newSize.id, size_label: newSize.size_label })
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

  const updateLine = useCallback((index: number, field: keyof TransferLine, value: string) => {
    setLines((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }, [])

  const selectLineFields = useCallback((index: number, fields: Partial<TransferLine>) => {
    setLines((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], ...fields }
      return updated
    })
  }, [])

  const selectItem = useCallback((index: number, item: any) => {
    setLines((prev) => {
      const updated = [...prev]
      updated[index] = {
        ...updated[index],
        item_master_id: item.id,
        item_name: item.item_name,
        item_search: item.item_name,
        material_type_id: item.material_type_id ?? '',
        material_size_id: item.material_size_id ?? '',
        size_label: item.size_label ?? item.material_sizes?.size_label ?? '',
        purchase_line_id: '',
      }
      return updated
    })
    setOpenDropdown(null)
  }, [])

  const addLine = () => setLines((prev) => [...prev, emptyLine()])
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const validLines = lines.filter((l) => l.material_type_id && l.quantity)
    if (!validLines.length) {
      setError('Add at least one line item with a material type and quantity.')
      setLoading(false)
      return
    }

    const { data: transferData, error: tErr } = await hasuraFetch<any>(CREATE_TRANSFER_MUTATION, {
      from_company_id: fromCompanyId || null,
      to_company_id: toCompanyId || null,
      from_warehouse_id: fromWarehouseId || null,
      to_warehouse_id: toWarehouseId || null,
      transfer_date: transferDate,
      status: 'pending',
      notes: notes || null,
    })
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
      item_master_id: l.item_master_id || null,
      item_name: l.item_name || null,
      purchase_line_id: l.purchase_line_id || null,
      quantity: parseFloat(l.quantity),
      notes: l.notes || null,
    }))
    const { error: iErr } = await hasuraFetch(CREATE_TRANSFER_ITEMS_MUTATION, { items })
    if (iErr) { setError(iErr.message); setLoading(false); return }

    router.push('/transfers')
    router.refresh()
  }

  const fieldCls = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none'

  return (
    <div className="max-w-6xl mx-auto space-y-6">
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
              <select value={fromCompanyId} onChange={(e) => setFromCompanyId(e.target.value)} className={fieldCls}>
                <option value="">— Select —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Warehouse</label>
              <select value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)} className={fieldCls}>
                <option value="">— Select —</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Transfer Date</label>
              <input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)}
                required className={fieldCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Company</label>
              <select value={toCompanyId} onChange={(e) => setToCompanyId(e.target.value)} className={fieldCls}>
                <option value="">— Select —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Warehouse</label>
              <select value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)} className={fieldCls}>
                <option value="">— Select —</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional" className={fieldCls} />
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
          <div className="overflow-auto max-h-[70vh]" ref={tableRef}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50">
                <tr className="border-b text-left">
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500 whitespace-nowrap">Item Name</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500 whitespace-nowrap">Purchase Line ID</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500 whitespace-nowrap">Material Type</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500 whitespace-nowrap">Size</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500 whitespace-nowrap">Custom Size</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500 whitespace-nowrap">Quantity</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500 whitespace-nowrap">Notes</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lines.map((line, i) => {
                  const filtered = line.item_search.trim()
                    ? itemMaster.filter(it =>
                        it.item_name.toLowerCase().includes(line.item_search.toLowerCase()) ||
                        it.item_code?.toLowerCase().includes(line.item_search.toLowerCase())
                      ).slice(0, 12)
                    : []

                  const sizesForType = materialSizes.filter(
                    (s) => !s.material_type_id || s.material_type_id === line.material_type_id
                  )
                  const availablePurchaseLines = purchaseLinesByItem[line.item_master_id] ?? []

                  return (
                    <tr key={i}>
                      {/* Item Name Autocomplete */}
                      <td className="pr-3 py-2 relative">
                        <input
                          type="text"
                          value={line.item_search}
                          onChange={(e) => {
                            const val = e.target.value
                            selectLineFields(i, {
                              item_search: val,
                              item_name: val,
                              ...(val === '' ? { item_master_id: '', material_type_id: '', material_size_id: '', size_label: '', purchase_line_id: '' } : {}),
                            })
                            setOpenDropdown(i)
                          }}
                          onFocus={() => {
                            if (line.item_search.trim()) setOpenDropdown(i)
                          }}
                          onBlur={() => setTimeout(() => setOpenDropdown(prev => prev === i ? null : prev), 150)}
                          placeholder="Search item name…"
                          className={`block w-52 rounded border px-2 py-1.5 text-sm focus:outline-none ${
                            line.item_master_id
                              ? 'border-green-400 bg-green-50'
                              : 'border-gray-300 focus:border-blue-500'
                          }`}
                        />
                        {line.item_master_id && (
                          <span className="block text-[10px] text-green-700 font-mono mt-0.5 truncate max-w-[13rem]">
                            {itemMaster.find(it => it.id === line.item_master_id)?.item_code ?? ''}
                          </span>
                        )}
                        {openDropdown === i && filtered.length > 0 && (
                          <div className="absolute left-0 top-full z-50 mt-0.5 max-h-52 w-80 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-xl">
                            {filtered.map((item) => (
                              <div
                                key={item.id}
                                onMouseDown={(e) => { e.preventDefault(); selectItem(i, item) }}
                                className="cursor-pointer px-3 py-2 hover:bg-blue-50 border-b border-gray-50 last:border-0"
                              >
                                <div className="font-medium text-gray-900 text-sm">{item.item_name}</div>
                                <div className="text-xs text-gray-400 mt-0.5">
                                  {item.item_code} · {item.material_types?.description ?? ''}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {openDropdown === i && line.item_search.trim().length >= 1 && filtered.length === 0 && (
                          <div className="absolute left-0 top-full z-50 mt-0.5 w-72 rounded-lg border border-gray-200 bg-white shadow-xl px-3 py-2 text-xs text-gray-400">
                            No items match "{line.item_search}"
                          </div>
                        )}
                      </td>

                      {/* Purchase Line ID */}
                      <td className="pr-3 py-2">
                        {availablePurchaseLines.length > 0 ? (
                          <select
                            value={line.purchase_line_id}
                            onChange={(e) => updateLine(i, 'purchase_line_id', e.target.value)}
                            className="block w-36 rounded border border-gray-300 px-2 py-1.5 text-sm font-mono focus:border-blue-500 focus:outline-none"
                          >
                            <option value="">— Any —</option>
                            {availablePurchaseLines.map((pl) => (
                              <option key={pl} value={pl}>{pl}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={line.purchase_line_id}
                            onChange={(e) => updateLine(i, 'purchase_line_id', e.target.value)}
                            placeholder="e.g. CR0626-0001"
                            className="block w-36 rounded border border-gray-300 px-2 py-1.5 text-sm font-mono focus:border-blue-500 focus:outline-none"
                          />
                        )}
                      </td>

                      {/* Material Type (auto-filled or fallback select) */}
                      <td className="pr-3 py-2">
                        {line.material_type_id ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-gray-700 bg-gray-100 rounded px-2 py-1 max-w-[9rem] truncate">
                              {materialTypes.find(m => m.id === line.material_type_id)?.description ?? '—'}
                            </span>
                            <button type="button" onClick={() => selectLineFields(i, { material_type_id: '', material_size_id: '', size_label: '' })}
                              className="text-gray-300 hover:text-gray-500 text-xs">×</button>
                          </div>
                        ) : (
                          <select
                            value={line.material_type_id}
                            onChange={(e) => {
                              if (e.target.value === 'NEW_TYPE') {
                                setActiveLineIndexForNewType(i)
                                setShowMaterialTypeDialog(true)
                                return
                              }
                              selectLineFields(i, { material_type_id: e.target.value, material_size_id: '', size_label: '' })
                            }}
                            required
                            className="block w-36 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                          >
                            <option value="">Select</option>
                            {materialTypes.map((m) => <option key={m.id} value={m.id}>{m.description}</option>)}
                            <option value="NEW_TYPE" className="font-semibold">+ New Material Type</option>
                          </select>
                        )}
                      </td>

                      {/* Size */}
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
                            selectLineFields(i, {
                              material_size_id: e.target.value,
                              ...(size ? { size_label: size.size_label } : {}),
                            })
                          }}
                          className="block w-28 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">Select</option>
                          {sizesForType.map((s) => <option key={s.id} value={s.id}>{s.size_label}</option>)}
                          <option value="NEW_SIZE" className="font-semibold">+ New Size</option>
                        </select>
                      </td>

                      {/* Custom Size */}
                      <td className="pr-3 py-2">
                        <input
                          type="text"
                          value={line.size_label}
                          onChange={(e) => updateLine(i, 'size_label', e.target.value)}
                          placeholder="Custom"
                          className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </td>

                      {/* Quantity */}
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

                      {/* Notes */}
                      <td className="pr-3 py-2">
                        <input
                          type="text"
                          value={line.notes}
                          onChange={(e) => updateLine(i, 'notes', e.target.value)}
                          className="block w-32 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </td>

                      {/* Remove */}
                      <td className="py-2">
                        {lines.length > 1 && (
                          <button type="button" onClick={() => removeLine(i)}
                            className="text-red-400 hover:text-red-600 font-bold px-2">×</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {showMaterialTypeDialog && (
            <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50 p-5 mb-4 mt-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-blue-900">Create New Material Type</h2>
                  <p className="text-sm text-blue-700">Add a material type and assign it to the selected line.</p>
                </div>
                <button type="button" onClick={() => { setShowMaterialTypeDialog(false); setActiveLineIndexForNewType(null) }}
                  className="text-sm text-blue-700 hover:text-blue-900">Cancel</button>
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
                    placeholder="MT" />
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
            <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50 p-5 mb-4 mt-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-blue-900">Create New Size</h2>
                  <p className="text-sm text-blue-700">Add a size for the selected material type.</p>
                </div>
                <button type="button" onClick={() => { setShowSizeDialog(false); setActiveLineIndexForNewSize(null) }}
                  className="text-sm text-blue-700 hover:text-blue-900">Cancel</button>
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
          <button type="submit" disabled={loading}
            className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {loading ? 'Saving...' : '✓ Create Transfer'}
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
