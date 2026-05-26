'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import MissingMasterDataBanner from '@/components/MissingMasterDataBanner'
import {
  ACTIVE_COMPANIES_QUERY, ACTIVE_WAREHOUSES_QUERY, ACTIVE_SUPPLIERS_QUERY,
  ACTIVE_MATERIAL_TYPES_QUERY, ACTIVE_MATERIAL_SIZES_QUERY, ACTIVE_ITEM_MASTER_QUERY,
  ACTIVE_ITEM_GROUPS_QUERY,
  CREATE_PURCHASE_BILL_MUTATION, CREATE_PURCHASE_BILL_ITEMS_MUTATION,
  CREATE_MATERIAL_TYPE_MUTATION, CREATE_MATERIAL_SIZE_MUTATION,
  CREATE_ITEM_MASTER_MUTATION, CREATE_ITEM_GROUP_MUTATION,
} from '@/lib/hasura/queries'
import type { Company, Warehouse, Supplier, MaterialType, MaterialSize, ItemMaster, ItemGroup } from '@/types'

type LineItem = {
  purchase_line_id: string
  item_master_id: string
  item_name: string
  item_code: string
  material_type_id: string
  material_size_id: string
  size_label: string
  quantity: string
  rate: string
  amount: string
  notes: string
}

const emptyLine = (): LineItem => ({
  purchase_line_id: '',
  item_master_id: '',
  item_name: '',
  item_code: '',
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

  // Master data
  const [companies, setCompanies] = useState<Company[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([])
  const [materialSizes, setMaterialSizes] = useState<MaterialSize[]>([])
  const [itemMasters, setItemMasters] = useState<ItemMaster[]>([])
  const [itemGroups, setItemGroups] = useState<ItemGroup[]>([])

  // Form state
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

  // Dialog states
  const [showMaterialTypeDialog, setShowMaterialTypeDialog] = useState(false)
  const [newMaterialTypeName, setNewMaterialTypeName] = useState('')
  const [newMaterialTypeUnit, setNewMaterialTypeUnit] = useState('tons')
  const [materialTypeDialogLoading, setMaterialTypeDialogLoading] = useState(false)

  const [showSizeDialog, setShowSizeDialog] = useState(false)
  const [newSizeMaterialTypeId, setNewSizeMaterialTypeId] = useState('')
  const [newSizeLabel, setNewSizeLabel] = useState('')
  const [newSizeThickness, setNewSizeThickness] = useState('')
  const [newSizeWidth, setNewSizeWidth] = useState('')
  const [sizeDialogLoading, setSizeDialogLoading] = useState(false)

  const [showNewItemDialog, setShowNewItemDialog] = useState(false)
  const [newItemLineIndex, setNewItemLineIndex] = useState<number | null>(null)
  const [newItemGroupId, setNewItemGroupId] = useState('')
  const [newItemMaterialTypeId, setNewItemMaterialTypeId] = useState('')
  const [newItemMaterialSizeId, setNewItemMaterialSizeId] = useState('')
  const [newItemName, setNewItemName] = useState('')
  const [newItemUnit, setNewItemUnit] = useState('tons')
  const [newItemDescription, setNewItemDescription] = useState('')
  const [newItemCode, setNewItemCode] = useState('')
  const [newItemDialogLoading, setNewItemDialogLoading] = useState(false)
  const [showNewGroupDialog, setShowNewGroupDialog] = useState(false)
  const [newGroupCode, setNewGroupCode] = useState('')
  const [newGroupDesc, setNewGroupDesc] = useState('')
  const [newGroupDialogLoading, setNewGroupDialogLoading] = useState(false)

  // Load master data
  useEffect(() => {
    const load = async () => {
      const [c, w, s, mt, ms, ig, im] = await Promise.all([
        hasuraFetch(ACTIVE_COMPANIES_QUERY),
        hasuraFetch(ACTIVE_WAREHOUSES_QUERY),
        hasuraFetch(ACTIVE_SUPPLIERS_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_TYPES_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_SIZES_QUERY),
        hasuraFetch(ACTIVE_ITEM_GROUPS_QUERY),
        hasuraFetch(ACTIVE_ITEM_MASTER_QUERY),
      ])
      setCompanies((c.data as any)?.companies ?? [])
      setWarehouses((w.data as any)?.warehouses ?? [])
      setSuppliers((s.data as any)?.suppliers ?? [])
      setMaterialTypes((mt.data as any)?.material_types ?? [])
      setMaterialSizes((ms.data as any)?.material_sizes ?? [])
      setItemGroups((ig.data as any)?.item_groups ?? [])
      setItemMasters((im.data as any)?.item_master ?? [])
      setMasterDataLoading(false)
    }
    load()
  }, [])

  const filteredWarehouses = warehouseId
    ? warehouses
    : companyId
    ? warehouses.filter((w) => w.company_id === companyId || !w.company_id)
    : warehouses

  const generateItemCode = (groupId: string) => {
    const group = itemGroups.find((g) => g.id === groupId)
    if (!group?.group_code) return ''
    const prefix = group.group_code.trim().toUpperCase()
    if (!prefix) return ''
    const safePrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    const sequence = itemMasters.reduce((max, item) => {
      if (!item.item_code?.startsWith(prefix)) return max
      const match = item.item_code.match(new RegExp(`^${safePrefix}(\\d+)$`))
      if (!match) return max
      const n = Number(match[1])
      return Number.isFinite(n) ? Math.max(max, n) : max
    }, 0)

    return `${prefix}${String(sequence + 1).padStart(3, '0')}`
  }

  useEffect(() => {
    if (!newItemGroupId) {
      setNewItemCode('')
      return
    }
    setNewItemCode(generateItemCode(newItemGroupId))
  }, [newItemGroupId, itemMasters])

  useEffect(() => {
    const materialType = materialTypes.find((mt) => mt.id === newItemMaterialTypeId)
    if (materialType) {
      setNewItemUnit(materialType.unit || 'tons')
    }
  }, [newItemMaterialTypeId, materialTypes])

  useEffect(() => {
    if (!newItemMaterialTypeId) {
      setNewItemMaterialSizeId('')
    }
  }, [newItemMaterialTypeId])

  const selectedNewItemSize = materialSizes.find((s) => s.id === newItemMaterialSizeId)

  // Get items for selected material type
  const getItemsForMaterialType = (materialTypeId: string) => {
    return itemMasters.filter((im) => im.material_type_id === materialTypeId)
  }

  const updateLine = useCallback((index: number, field: keyof LineItem, value: string) => {
    setLines((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }

      // Auto-populate from Item Master when selected
      if (field === 'item_master_id') {
        const item = itemMasters.find((im) => im.id === value)
        if (item) {
          updated[index].item_name = item.item_name
          updated[index].item_code = item.item_code
          updated[index].material_type_id = item.material_type_id
          updated[index].material_size_id = item.material_size_id || ''
          updated[index].size_label = item.size_label || ''
        }
      }

      // Auto-calculate amount
      if (field === 'quantity' || field === 'rate') {
        const qty = parseFloat(field === 'quantity' ? value : updated[index].quantity) || 0
        const rate = parseFloat(field === 'rate' ? value : updated[index].rate) || 0
        updated[index].amount = (qty * rate).toFixed(2)
      }

      return updated
    })
  }, [itemMasters])

  const addLine = () => setLines((prev) => [...prev, emptyLine()])
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i))

  const totalQty = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0)
  const totalAmt = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)

  // Create Material Type
  const handleCreateMaterialType = async () => {
    if (!newMaterialTypeName.trim()) {
      alert('Material Type name is required')
      return
    }

    setMaterialTypeDialogLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_material_types_one: MaterialType }>(CREATE_MATERIAL_TYPE_MUTATION, {
      name: newMaterialTypeName,
      unit: newMaterialTypeUnit,
    })

    if (err) {
      alert(`Error: ${err.message}`)
      setMaterialTypeDialogLoading(false)
      return
    }

    const newMT = data?.insert_material_types_one
    if (newMT) {
      setMaterialTypes((prev) => [...prev, newMT])
      setNewMaterialTypeName('')
      setNewMaterialTypeUnit('tons')
      setShowMaterialTypeDialog(false)
    }

    setMaterialTypeDialogLoading(false)
  }

  // Create Material Size
  const handleCreateSize = async () => {
    if (!newSizeMaterialTypeId || !newSizeLabel.trim()) {
      alert('Material Type and Size Label are required')
      return
    }

    setSizeDialogLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_material_sizes_one: MaterialSize }>(CREATE_MATERIAL_SIZE_MUTATION, {
      material_type_id: newSizeMaterialTypeId,
      size_label: newSizeLabel,
      thickness: newSizeThickness ? parseFloat(newSizeThickness) : null,
      width: newSizeWidth ? parseFloat(newSizeWidth) : null,
    })

    if (err) {
      alert(`Error: ${err.message}`)
      setSizeDialogLoading(false)
      return
    }

    const newSize = data?.insert_material_sizes_one
    if (newSize) {
      setMaterialSizes((prev) => [...prev, newSize])
      setNewSizeMaterialTypeId('')
      setNewSizeLabel('')
      setNewSizeThickness('')
      setNewSizeWidth('')
      setShowSizeDialog(false)
    }

    setSizeDialogLoading(false)
  }

  const handleCreateNewItem = async () => {
    if (!newItemGroupId || !newItemMaterialTypeId || !newItemName.trim()) {
      alert('Group, material type, and item name are required.')
      return
    }

    if (!newItemCode) {
      alert('Select a group first to generate an item code.')
      return
    }

    setNewItemDialogLoading(true)

    const { data, error: err } = await hasuraFetch<{ insert_item_master_one: ItemMaster }>(CREATE_ITEM_MASTER_MUTATION, {
      item_code: newItemCode,
      item_name: newItemName,
      item_group_id: newItemGroupId,
      material_type_id: newItemMaterialTypeId,
      material_size_id: newItemMaterialSizeId || null,
      size_label: selectedNewItemSize?.size_label || null,
      unit: newItemUnit,
      description: newItemDescription || null,
    })

    if (err) {
      alert(`Error: ${err.message}`)
      setNewItemDialogLoading(false)
      return
    }

    const created = data?.insert_item_master_one
    if (created) {
      setItemMasters((prev) => [...prev, created])
      if (newItemLineIndex !== null) {
        setLines((prev) => {
          const updated = [...prev]
          updated[newItemLineIndex] = {
            ...updated[newItemLineIndex],
            item_master_id: created.id,
            item_name: created.item_name,
            item_code: created.item_code,
            material_type_id: newItemMaterialTypeId,
            material_size_id: created.material_size_id || '',
            size_label: created.size_label || '',
          }
          return updated
        })
      }
      setShowNewItemDialog(false)
      setNewItemLineIndex(null)
      setNewItemGroupId('')
      setNewItemMaterialTypeId('')
      setNewItemMaterialSizeId('')
      setNewItemName('')
      setNewItemUnit('tons')
      setNewItemDescription('')
      setNewItemCode('')
    }

    setNewItemDialogLoading(false)
  }

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
    if (!warehouseId) {
      setError('Please select a warehouse before saving.')
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
      item_name: l.item_name || null,
      item_master_id: l.item_master_id || null,
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
    <div className="max-w-6xl mx-auto space-y-6">
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
              <label className="block text-sm font-medium text-gray-700 mb-1">My Companies</label>
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
                required
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
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">PurchaseLineID</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Item Code</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Item Name</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Material Type</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Size</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Quantity</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Rate (₹)</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Amount (₹)</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Notes</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lines.map((line, i) => {
                  const sizesForType = materialSizes.filter(
                    (s) => !s.material_type_id || s.material_type_id === line.material_type_id
                  )
                  const itemsForType = getItemsForMaterialType(line.material_type_id)
                  return (
                    <tr key={i} className="py-1">
                      <td className="pr-3 py-2">
                        <input
                          type="text"
                          value={line.purchase_line_id}
                          onChange={(e) => updateLine(i, 'purchase_line_id', e.target.value)}
                          placeholder="Auto-generated"
                          className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="pr-3 py-2">
                        <input
                          type="text"
                          value={line.item_code}
                          readOnly
                          placeholder="Item code"
                          className="block w-20 rounded border border-gray-300 px-2 py-1.5 text-sm bg-gray-50"
                        />
                      </td>
                      <td className="pr-3 py-2">
                        <select
                          value={line.item_master_id}
                          onChange={(e) => {
                            if (e.target.value === 'NEW') {
                              setNewItemLineIndex(i)
                              setShowNewItemDialog(true)
                              setNewItemMaterialTypeId(line.material_type_id)
                              setNewItemMaterialSizeId(line.material_size_id)
                              setNewItemName('')
                              setNewItemDescription('')
                              setNewItemGroupId('')
                              setNewItemCode('')
                            } else {
                              updateLine(i, 'item_master_id', e.target.value)
                            }
                          }}
                          className="block w-32 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">Select Item</option>
                          {itemsForType.map((im) => (
                            <option key={im.id} value={im.id}>{im.item_name}</option>
                          ))}
                          <option value="NEW" className="font-semibold">+ New Item</option>
                        </select>
                      </td>
                      <td className="pr-3 py-2">
                        <select
                          value={line.material_type_id}
                          onChange={(e) => {
                            if (e.target.value === 'NEW') {
                              setShowMaterialTypeDialog(true)
                            } else {
                              updateLine(i, 'material_type_id', e.target.value)
                            }
                          }}
                          className="block w-28 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">Select</option>
                          {materialTypes.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                          <option value="NEW" className="font-semibold">+ New Material Type</option>
                        </select>
                      </td>
                      <td className="pr-3 py-2">
                        <select
                          value={line.material_size_id}
                          onChange={(e) => {
                            if (e.target.value === 'NEW') {
                              setNewSizeMaterialTypeId(line.material_type_id)
                              setShowSizeDialog(true)
                            } else {
                              const size = materialSizes.find(s => s.id === e.target.value)
                              updateLine(i, 'material_size_id', e.target.value)
                              if (size) updateLine(i, 'size_label', size.size_label)
                            }
                          }}
                          className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">Select</option>
                          {sizesForType.map((s) => (
                            <option key={s.id} value={s.id}>{s.size_label}</option>
                          ))}
                          <option value="NEW" className="font-semibold">+ New Size</option>
                        </select>
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
                          className="block w-20 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
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
                          className="block w-20 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
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
                          className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="pr-3 py-2">
                        <input
                          type="text"
                          value={line.notes}
                          onChange={(e) => updateLine(i, 'notes', e.target.value)}
                          placeholder="Notes"
                          className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
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
                  <td colSpan={5} className="py-3 text-sm font-semibold text-gray-700 text-right pr-3">Totals:</td>
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

      {/* Material Type Creation Dialog */}
      {showMaterialTypeDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Create New Material Type</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Material Type Name</label>
              <input
                type="text"
                value={newMaterialTypeName}
                onChange={(e) => setNewMaterialTypeName(e.target.value)}
                placeholder="e.g., CR, GI, GA, HR Coil"
                className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
              <select
                value={newMaterialTypeUnit}
                onChange={(e) => setNewMaterialTypeUnit(e.target.value)}
                className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="tons">Tons</option>
                <option value="kg">Kilograms</option>
                <option value="units">Units</option>
                <option value="meters">Meters</option>
              </select>
            </div>
            <div className="flex gap-3 justify-end pt-4">
              <button
                onClick={() => setShowMaterialTypeDialog(false)}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateMaterialType}
                disabled={materialTypeDialogLoading}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {materialTypeDialogLoading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Size Creation Dialog */}
      {showSizeDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Create New Size</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Material Type</label>
              <select
                value={newSizeMaterialTypeId}
                onChange={(e) => setNewSizeMaterialTypeId(e.target.value)}
                className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">— Select Material Type —</option>
                {materialTypes.map((mt) => (
                  <option key={mt.id} value={mt.id}>{mt.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Size Label</label>
              <input
                type="text"
                value={newSizeLabel}
                onChange={(e) => setNewSizeLabel(e.target.value)}
                placeholder="e.g., 0.80x121"
                className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Thickness</label>
                <input
                  type="number"
                  value={newSizeThickness}
                  onChange={(e) => setNewSizeThickness(e.target.value)}
                  step="0.01"
                  placeholder="Optional"
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Width</label>
                <input
                  type="number"
                  value={newSizeWidth}
                  onChange={(e) => setNewSizeWidth(e.target.value)}
                  step="0.01"
                  placeholder="Optional"
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-4">
              <button
                onClick={() => setShowSizeDialog(false)}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateSize}
                disabled={sizeDialogLoading}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {sizeDialogLoading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewItemDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Create New Item</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Group Code *</label>
                <select
                  value={newItemGroupId}
                  onChange={(e) => {
                    if (e.target.value === 'NEW_GROUP') {
                      setShowNewGroupDialog(true)
                      setNewGroupCode('')
                      setNewGroupDesc('')
                    } else {
                      setNewItemGroupId(e.target.value)
                    }
                  }}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">— Select Group —</option>
                  {itemGroups.map((group) => (
                    <option key={group.id} value={group.id}>{group.group_code}</option>
                  ))}
                  <option value="NEW_GROUP" className="font-semibold">+ Add New Group</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Item Code</label>
                <input
                  readOnly
                  value={newItemCode}
                  className="block w-full rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm"
                  placeholder="Select group to generate code"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Item Name *</label>
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Material Type *</label>
                <select
                  value={newItemMaterialTypeId}
                  onChange={(e) => setNewItemMaterialTypeId(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">— Select Material Type —</option>
                  {materialTypes.map((mt) => (
                    <option key={mt.id} value={mt.id}>{mt.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Size</label>
                <select
                  value={newItemMaterialSizeId}
                  onChange={(e) => setNewItemMaterialSizeId(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">— Select Size —</option>
                  {materialSizes
                    .filter((size) => size.material_type_id === newItemMaterialTypeId)
                    .map((size) => (
                      <option key={size.id} value={size.id}>{size.size_label}</option>
                    ))}
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                <input
                  type="text"
                  value={newItemUnit}
                  onChange={(e) => setNewItemUnit(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input
                  type="text"
                  value={newItemDescription}
                  onChange={(e) => setNewItemDescription(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowNewItemDialog(false)
                  setNewItemLineIndex(null)
                  setNewItemGroupId('')
                  setNewItemMaterialTypeId('')
                  setNewItemName('')
                  setNewItemUnit('tons')
                  setNewItemDescription('')
                  setNewItemCode('')
                }}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateNewItem}
                disabled={newItemDialogLoading}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {newItemDialogLoading ? 'Creating...' : 'Create Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewGroupDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Create New Item Group</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Group Code *</label>
              <input
                type="text"
                value={newGroupCode}
                onChange={(e) => setNewGroupCode(e.target.value)}
                placeholder="e.g. X"
                className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Group Description</label>
              <input
                type="text"
                value={newGroupDesc}
                onChange={(e) => setNewGroupDesc(e.target.value)}
                placeholder="Optional description"
                className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="flex gap-3 justify-end pt-4">
              <button
                type="button"
                onClick={() => setShowNewGroupDialog(false)}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!newGroupCode.trim()) {
                    alert('Group code is required.')
                    return
                  }
                  setNewGroupDialogLoading(true)
                  const { data, error: err } = await hasuraFetch<{ insert_item_groups_one: ItemGroup }>(CREATE_ITEM_GROUP_MUTATION, {
                    group_code: newGroupCode,
                    group_desc: newGroupDesc || null,
                  })
                  setNewGroupDialogLoading(false)
                  if (err) {
                    alert(`Error: ${err.message}`)
                    return
                  }
                  const created = data?.insert_item_groups_one
                  if (created) {
                    setItemGroups((prev) => [...prev, created])
                    setNewItemGroupId(created.id)
                    setShowNewGroupDialog(false)
                  }
                }}
                disabled={newGroupDialogLoading}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {newGroupDialogLoading ? 'Creating...' : 'Create Group'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
