'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
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

  // Dropdown portal state
  const [openDropdown, setOpenDropdown] = useState<number | null>(null)
  const [dropdownRect, setDropdownRect] = useState({ top: 0, left: 0, width: 0 })
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => { setIsMounted(true) }, [])

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

  // Close dropdown on outside click
  useEffect(() => {
    if (openDropdown === null) return
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node
      const input = inputRefs.current[openDropdown!]
      const dropdown = document.getElementById('transfer-item-dropdown')
      if (!input?.contains(target) && !dropdown?.contains(target)) {
        setOpenDropdown(null)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [openDropdown])

  function openDropdownAt(i: number) {
    const input = inputRefs.current[i]
    if (input) {
      const rect = input.getBoundingClientRect()
      setDropdownRect({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 340) })
    }
    setOpenDropdown(i)
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

  const selectItem = useCallback((i: number, item: any) => {
    setLines((prev) => {
      const updated = [...prev]
      updated[i] = {
        ...updated[i],
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
  const removeLine = (i: number) => {
    if (openDropdown === i) setOpenDropdown(null)
    setLines((prev) => prev.filter((_, idx) => idx !== i))
  }

  const handleCreateMaterialType = async () => {
    if (!newMaterialTypeName.trim()) return
    setMaterialTypeDialogLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_material_types_one: MaterialType }>(CREATE_MATERIAL_TYPE_MUTATION, {
      name: newMaterialTypeName.trim(), unit: newMaterialTypeUnit.trim() || null, description: null,
    })
    if (err) { setError(err.message); setMaterialTypeDialogLoading(false); return }
    const newType = data?.insert_material_types_one
    if (newType) {
      setMaterialTypes((prev) => [...prev, newType])
      if (activeLineIndexForNewType !== null)
        selectLineFields(activeLineIndexForNewType, { material_type_id: newType.id, material_size_id: '', size_label: '' })
      setShowMaterialTypeDialog(false)
      setNewMaterialTypeName('')
      setNewMaterialTypeUnit('MT')
      setActiveLineIndexForNewType(null)
    }
    setMaterialTypeDialogLoading(false)
  }

  const handleCreateSize = async () => {
    const mtId = newSizeMaterialTypeId || (activeLineIndexForNewSize !== null ? lines[activeLineIndexForNewSize].material_type_id : '')
    if (!mtId || !newSizeLabel.trim()) return
    setSizeDialogLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_material_sizes_one: MaterialSize }>(CREATE_MATERIAL_SIZE_MUTATION, {
      material_type_id: mtId, size_label: newSizeLabel.trim(),
      thickness: newSizeThickness ? parseFloat(newSizeThickness) : null,
      width: newSizeWidth ? parseFloat(newSizeWidth) : null,
    })
    if (err) { setError(err.message); setSizeDialogLoading(false); return }
    const newSize = data?.insert_material_sizes_one
    if (newSize) {
      setMaterialSizes((prev) => [...prev, newSize])
      if (activeLineIndexForNewSize !== null)
        selectLineFields(activeLineIndexForNewSize, { material_size_id: newSize.id, size_label: newSize.size_label })
      setShowSizeDialog(false); setNewSizeMaterialTypeId(''); setNewSizeLabel(''); setNewSizeThickness(''); setNewSizeWidth(''); setActiveLineIndexForNewSize(null)
    }
    setSizeDialogLoading(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError(null)

    const validLines = lines.filter((l) => l.material_type_id && l.quantity)
    if (!validLines.length) {
      setError('Add at least one line item with material type and quantity.')
      setLoading(false); return
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
    if (tErr || !transfer) { setError(tErr?.message ?? 'Failed to create transfer'); setLoading(false); return }

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
        {/* Header fields */}
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Transfer Details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Company</label>
              <select value={fromCompanyId} onChange={e => setFromCompanyId(e.target.value)} className={fieldCls}>
                <option value="">— Select —</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Warehouse</label>
              <select value={fromWarehouseId} onChange={e => setFromWarehouseId(e.target.value)} className={fieldCls}>
                <option value="">— Select —</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Transfer Date</label>
              <input type="date" value={transferDate} onChange={e => setTransferDate(e.target.value)} required className={fieldCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Company</label>
              <select value={toCompanyId} onChange={e => setToCompanyId(e.target.value)} className={fieldCls}>
                <option value="">— Select —</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Warehouse</label>
              <select value={toWarehouseId} onChange={e => setToWarehouseId(e.target.value)} className={fieldCls}>
                <option value="">— Select —</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" className={fieldCls} />
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">Line Items</h2>
            <button type="button" onClick={addLine} className="text-sm text-blue-600 hover:text-blue-800 font-medium">+ Add Line</button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="border-b text-left">
                  <th className="pb-2 pr-3 pt-2 px-2 text-xs font-medium text-gray-500 whitespace-nowrap">Item Name</th>
                  <th className="pb-2 pr-3 pt-2 px-2 text-xs font-medium text-gray-500 whitespace-nowrap">Purchase Line ID</th>
                  <th className="pb-2 pr-3 pt-2 px-2 text-xs font-medium text-gray-500 whitespace-nowrap">Material Type</th>
                  <th className="pb-2 pr-3 pt-2 px-2 text-xs font-medium text-gray-500 whitespace-nowrap">Size</th>
                  <th className="pb-2 pr-3 pt-2 px-2 text-xs font-medium text-gray-500 whitespace-nowrap">Custom Size</th>
                  <th className="pb-2 pr-3 pt-2 px-2 text-xs font-medium text-gray-500 whitespace-nowrap">Quantity (MT)</th>
                  <th className="pb-2 pr-3 pt-2 px-2 text-xs font-medium text-gray-500 whitespace-nowrap">Notes</th>
                  <th className="pb-2 pt-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lines.map((line, i) => {
                  const q = line.item_search.trim()
                  const filtered = q
                    ? itemMaster.filter(it =>
                        it.item_name?.toLowerCase().includes(q.toLowerCase()) ||
                        it.item_code?.toLowerCase().includes(q.toLowerCase())
                      )
                    : itemMaster
                  const displayItems = filtered.slice(0, 15)

                  const sizesForType = materialSizes.filter(
                    s => !s.material_type_id || s.material_type_id === line.material_type_id
                  )
                  const availablePurchaseLines = purchaseLinesByItem[line.item_master_id] ?? []

                  return (
                    <tr key={i} className="hover:bg-gray-50/50">
                      {/* Item Name Combobox */}
                      <td className="pr-3 py-2 px-2">
                        <input
                          ref={el => { inputRefs.current[i] = el }}
                          type="text"
                          value={line.item_search}
                          onChange={e => {
                            const val = e.target.value
                            selectLineFields(i, {
                              item_search: val,
                              item_name: val,
                              ...(val === '' ? {
                                item_master_id: '',
                                material_type_id: '',
                                material_size_id: '',
                                size_label: '',
                                purchase_line_id: '',
                              } : {}),
                            })
                            openDropdownAt(i)
                          }}
                          onFocus={() => openDropdownAt(i)}
                          placeholder={masterDataLoading ? 'Loading…' : 'Type or click to search…'}
                          autoComplete="off"
                          className={`block w-52 rounded border px-2 py-1.5 text-sm focus:outline-none ${
                            line.item_master_id
                              ? 'border-green-400 bg-green-50 text-green-900'
                              : 'border-gray-300 focus:border-blue-500'
                          }`}
                        />
                        {line.item_master_id && (
                          <span className="block text-[10px] font-mono text-green-700 mt-0.5 truncate w-52">
                            {itemMaster.find(it => it.id === line.item_master_id)?.item_code ?? ''}
                            {' · '}
                            {itemMaster.find(it => it.id === line.item_master_id)?.material_types?.description ?? ''}
                          </span>
                        )}
                      </td>

                      {/* Purchase Line ID */}
                      <td className="pr-3 py-2 px-2">
                        {availablePurchaseLines.length > 0 ? (
                          <select
                            value={line.purchase_line_id}
                            onChange={e => updateLine(i, 'purchase_line_id', e.target.value)}
                            className="block w-36 rounded border border-gray-300 px-2 py-1.5 text-sm font-mono focus:border-blue-500 focus:outline-none"
                          >
                            <option value="">— Any —</option>
                            {availablePurchaseLines.map(pl => (
                              <option key={pl} value={pl}>{pl}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={line.purchase_line_id}
                            onChange={e => updateLine(i, 'purchase_line_id', e.target.value)}
                            placeholder="e.g. CR0626-0001"
                            className="block w-36 rounded border border-gray-300 px-2 py-1.5 text-sm font-mono focus:border-blue-500 focus:outline-none"
                          />
                        )}
                      </td>

                      {/* Material Type */}
                      <td className="pr-3 py-2 px-2">
                        {line.material_type_id ? (
                          <div className="flex items-center gap-1 max-w-[10rem]">
                            <span className="text-xs text-gray-700 bg-gray-100 rounded px-2 py-1 truncate">
                              {materialTypes.find(m => m.id === line.material_type_id)?.description ?? '—'}
                            </span>
                            <button
                              type="button"
                              onClick={() => selectLineFields(i, { material_type_id: '', material_size_id: '', size_label: '' })}
                              className="text-gray-400 hover:text-gray-600 text-sm leading-none shrink-0"
                            >×</button>
                          </div>
                        ) : (
                          <select
                            value={line.material_type_id}
                            onChange={e => {
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
                            {materialTypes.map(m => <option key={m.id} value={m.id}>{m.description}</option>)}
                            <option value="NEW_TYPE" className="font-semibold">+ New Material Type</option>
                          </select>
                        )}
                      </td>

                      {/* Size */}
                      <td className="pr-3 py-2 px-2">
                        <select
                          value={line.material_size_id}
                          onChange={e => {
                            if (e.target.value === 'NEW_SIZE') {
                              setActiveLineIndexForNewSize(i)
                              setNewSizeMaterialTypeId(line.material_type_id)
                              setShowSizeDialog(true)
                              return
                            }
                            const size = materialSizes.find(s => s.id === e.target.value)
                            selectLineFields(i, { material_size_id: e.target.value, ...(size ? { size_label: size.size_label } : {}) })
                          }}
                          className="block w-28 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">Select</option>
                          {sizesForType.map(s => <option key={s.id} value={s.id}>{s.size_label}</option>)}
                          <option value="NEW_SIZE" className="font-semibold">+ New Size</option>
                        </select>
                      </td>

                      {/* Custom Size */}
                      <td className="pr-3 py-2 px-2">
                        <input
                          type="text"
                          value={line.size_label}
                          onChange={e => updateLine(i, 'size_label', e.target.value)}
                          placeholder="Custom"
                          className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </td>

                      {/* Quantity */}
                      <td className="pr-3 py-2 px-2">
                        <input
                          type="number"
                          value={line.quantity}
                          onChange={e => updateLine(i, 'quantity', e.target.value)}
                          step="0.001" min="0" required placeholder="0.000"
                          className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </td>

                      {/* Notes */}
                      <td className="pr-3 py-2 px-2">
                        <input
                          type="text"
                          value={line.notes}
                          onChange={e => updateLine(i, 'notes', e.target.value)}
                          className="block w-32 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </td>

                      {/* Remove */}
                      <td className="py-2 px-2">
                        {lines.length > 1 && (
                          <button type="button" onClick={() => removeLine(i)}
                            className="text-red-400 hover:text-red-600 font-bold px-1">×</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Dialogs */}
          {showMaterialTypeDialog && (
            <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50 p-5 mt-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-blue-900">Create New Material Type</h2>
                  <p className="text-sm text-blue-700">Add a material type and assign it to the selected line.</p>
                </div>
                <button type="button" onClick={() => { setShowMaterialTypeDialog(false); setActiveLineIndexForNewType(null) }} className="text-sm text-blue-700 hover:text-blue-900">Cancel</button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-blue-900 mb-1">Material Type Name</label>
                  <input value={newMaterialTypeName} onChange={e => setNewMaterialTypeName(e.target.value)}
                    className="block w-full rounded border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" placeholder="Enter material type" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-blue-900 mb-1">Unit</label>
                  <input value={newMaterialTypeUnit} onChange={e => setNewMaterialTypeUnit(e.target.value)}
                    className="block w-full rounded border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" placeholder="MT" />
                </div>
              </div>
              <div className="mt-4">
                <button type="button" onClick={handleCreateMaterialType} disabled={materialTypeDialogLoading}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {materialTypeDialogLoading ? 'Creating…' : 'Create Material Type'}
                </button>
              </div>
            </div>
          )}

          {showSizeDialog && (
            <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50 p-5 mt-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-blue-900">Create New Size</h2>
                  <p className="text-sm text-blue-700">Add a size for the selected material type.</p>
                </div>
                <button type="button" onClick={() => { setShowSizeDialog(false); setActiveLineIndexForNewSize(null) }} className="text-sm text-blue-700 hover:text-blue-900">Cancel</button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-blue-900 mb-1">Material Type</label>
                  <select value={newSizeMaterialTypeId} onChange={e => setNewSizeMaterialTypeId(e.target.value)}
                    className="block w-full rounded border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                    <option value="">— Select Material Type —</option>
                    {materialTypes.map(m => <option key={m.id} value={m.id}>{m.description}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-blue-900 mb-1">Size Label</label>
                  <input value={newSizeLabel} onChange={e => setNewSizeLabel(e.target.value)}
                    className="block w-full rounded border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" placeholder="Enter size label" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-blue-900 mb-1">Thickness</label>
                  <input value={newSizeThickness} onChange={e => setNewSizeThickness(e.target.value)}
                    className="block w-full rounded border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" placeholder="Optional" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-blue-900 mb-1">Width</label>
                  <input value={newSizeWidth} onChange={e => setNewSizeWidth(e.target.value)}
                    className="block w-full rounded border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" placeholder="Optional" />
                </div>
              </div>
              <div className="mt-4">
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

      {/* Dropdown portal — rendered at document.body to escape overflow clipping */}
      {isMounted && openDropdown !== null && createPortal(
        <div
          id="transfer-item-dropdown"
          style={{
            position: 'fixed',
            top: dropdownRect.top,
            left: dropdownRect.left,
            width: dropdownRect.width,
            zIndex: 9999,
          }}
          className="rounded-lg border border-gray-200 bg-white shadow-2xl overflow-hidden"
        >
          {/* Search hint */}
          <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">
              {lines[openDropdown]?.item_search.trim()
                ? `Matching "${lines[openDropdown].item_search}"`
                : `All items (${itemMaster.length})`}
            </span>
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); setOpenDropdown(null) }}
              className="text-gray-300 hover:text-gray-500 text-xs px-1"
            >✕</button>
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {(() => {
              const q = lines[openDropdown]?.item_search.trim() ?? ''
              const filtered = q
                ? itemMaster.filter(it =>
                    it.item_name?.toLowerCase().includes(q.toLowerCase()) ||
                    it.item_code?.toLowerCase().includes(q.toLowerCase())
                  )
                : itemMaster
              const display = filtered.slice(0, 15)

              if (display.length === 0) {
                return (
                  <li className="px-3 py-3 text-sm text-gray-400 text-center">
                    No items match &ldquo;{q}&rdquo;
                  </li>
                )
              }
              return display.map(item => (
                <li key={item.id}>
                  <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); selectItem(openDropdown, item) }}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none border-b border-gray-50 last:border-0"
                  >
                    <div className="font-medium text-gray-900 text-sm">{item.item_name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      <span className="font-mono">{item.item_code}</span>
                      {item.material_types?.description && (
                        <span className="ml-2 text-blue-500">{item.material_types.description}</span>
                      )}
                    </div>
                  </button>
                </li>
              ))
            })()}
          </ul>
          {itemMaster.length > 15 && (lines[openDropdown]?.item_search ?? '').trim() === '' && (
            <div className="px-3 py-1.5 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400 text-center">
              Type to filter {itemMaster.length} items
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
