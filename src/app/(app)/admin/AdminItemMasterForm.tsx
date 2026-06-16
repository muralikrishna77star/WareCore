'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import {
  CREATE_ITEM_MASTER_MUTATION,
  CREATE_MATERIAL_TYPE_MUTATION,
  CREATE_MATERIAL_SIZE_MUTATION,
} from '@/lib/hasura/queries'
import type { MaterialSize, MaterialType, ItemMaster } from '@/types'

interface Props {
  materialTypes: MaterialType[]
  materialSizes: MaterialSize[]
  existingItems: ItemMaster[]
}

export default function AdminItemMasterForm({ materialTypes, materialSizes, existingItems }: Props) {
  const router = useRouter()
  const [materialTypeId, setMaterialTypeId] = useState('')
  const [materialSizeId, setMaterialSizeId] = useState('')
  const [itemName, setItemName] = useState('')
  const [unit, setUnit] = useState('MT')
  const [description, setDescription] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [localMaterialTypes, setLocalMaterialTypes] = useState(materialTypes)
  const [localMaterialSizes, setLocalMaterialSizes] = useState(materialSizes)

  const [showNewMaterialTypeForm, setShowNewMaterialTypeForm] = useState(false)
  const [newMaterialTypeCode, setNewMaterialTypeCode] = useState('')
  const [newMaterialTypeDescription, setNewMaterialTypeDescription] = useState('')
  const [newMaterialTypeUnit, setNewMaterialTypeUnit] = useState('MT')
  const [newMaterialTypeLoading, setNewMaterialTypeLoading] = useState(false)

  const [showNewSizeForm, setShowNewSizeForm] = useState(false)
  const [newSizeMaterialTypeId, setNewSizeMaterialTypeId] = useState('')
  const [newSizeLabel, setNewSizeLabel] = useState('')
  const [newSizeThickness, setNewSizeThickness] = useState('')
  const [newSizeWidth, setNewSizeWidth] = useState('')
  const [newSizeLoading, setNewSizeLoading] = useState(false)

  const selectedMaterialType = useMemo(
    () => localMaterialTypes.find((m) => m.id === materialTypeId),
    [materialTypeId, localMaterialTypes]
  )

  useEffect(() => {
    if (selectedMaterialType) setUnit(selectedMaterialType.unit || 'MT')
  }, [selectedMaterialType])

  useEffect(() => {
    if (!materialTypeId) setMaterialSizeId('')
  }, [materialTypeId])

  // Generate item code from material type code
  useEffect(() => {
    if (!selectedMaterialType?.code) { setItemCode(''); return }
    const prefix = selectedMaterialType.code.trim().toUpperCase()
    const safePrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const sequence = existingItems.reduce((max, item) => {
      if (!item.item_code?.startsWith(prefix)) return max
      const match = item.item_code.match(new RegExp(`^${safePrefix}(\\d+)$`))
      if (!match) return max
      const n = Number(match[1])
      return Number.isFinite(n) ? Math.max(max, n) : max
    }, 0)
    setItemCode(`${prefix}${String(sequence + 1).padStart(5, '0')}`)
  }, [selectedMaterialType, existingItems])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!materialTypeId || !itemName.trim() || !itemCode.trim()) {
      setError('Please fill all required fields.')
      return
    }
    setLoading(true); setError('')
    const { error: err } = await hasuraFetch(CREATE_ITEM_MASTER_MUTATION, {
      item_code: itemCode,
      item_name: itemName,
      material_type_id: materialTypeId,
      material_size_id: materialSizeId || null,
      size_label: localMaterialSizes.find(s => s.id === materialSizeId)?.size_label || null,
      unit,
      description: description || null,
    })
    if (err) { setError(err.message); setLoading(false); return }
    router.push('/admin/items')
  }

  const handleCreateMaterialType = async () => {
    const code = newMaterialTypeCode.trim().toUpperCase()
    if (code.length !== 2) { setError('Code must be exactly 2 characters.'); return }
    if (!newMaterialTypeDescription.trim()) { setError('Description is required.'); return }
    setNewMaterialTypeLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_material_types_one: MaterialType }>(CREATE_MATERIAL_TYPE_MUTATION, {
      code,
      description: newMaterialTypeDescription.trim(),
      unit: newMaterialTypeUnit || 'tons',
    })
    if (err) { setError(err.message); setNewMaterialTypeLoading(false); return }
    const newMT = data?.insert_material_types_one
    if (newMT) {
      setLocalMaterialTypes(prev => [...prev, newMT])
      setMaterialTypeId(newMT.id)
      setShowNewMaterialTypeForm(false)
      setNewMaterialTypeCode(''); setNewMaterialTypeDescription(''); setNewMaterialTypeUnit('tons')
      setError('')
    }
    setNewMaterialTypeLoading(false)
  }

  const handleCreateSize = async () => {
    const mtId = newSizeMaterialTypeId || materialTypeId
    if (!mtId || !newSizeLabel.trim()) { setError('Material type and size label are required.'); return }
    setNewSizeLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_material_sizes_one: MaterialSize }>(CREATE_MATERIAL_SIZE_MUTATION, {
      material_type_id: mtId,
      size_label: newSizeLabel.trim(),
      thickness: newSizeThickness ? parseFloat(newSizeThickness) : null,
      width: newSizeWidth ? parseFloat(newSizeWidth) : null,
    })
    if (err) { setError(err.message); setNewSizeLoading(false); return }
    const newSize = data?.insert_material_sizes_one
    if (newSize) {
      setLocalMaterialSizes(prev => [...prev, newSize])
      setMaterialSizeId(newSize.id)
      setShowNewSizeForm(false)
      setNewSizeMaterialTypeId(''); setNewSizeLabel(''); setNewSizeThickness(''); setNewSizeWidth('')
      setError('')
    }
    setNewSizeLoading(false)
  }

  useEffect(() => {
    if (showNewSizeForm && materialTypeId && !newSizeMaterialTypeId) setNewSizeMaterialTypeId(materialTypeId)
  }, [showNewSizeForm, materialTypeId, newSizeMaterialTypeId])

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white rounded-xl border border-gray-200 p-6">
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Material Type *</label>
          <select value={materialTypeId} onChange={(e) => {
            if (e.target.value === '__add_new__') { setShowNewMaterialTypeForm(true); setMaterialTypeId(''); return }
            setMaterialTypeId(e.target.value)
          }} className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
            <option value="">— Select Material Type —</option>
            {localMaterialTypes.map(m => <option key={m.id} value={m.id}>{m.code} — {m.description}</option>)}
            <option value="__add_new__">+ Add new Material Type</option>
          </select>
          {showNewMaterialTypeForm && (
            <div className="mt-3 space-y-3 rounded border border-dashed border-gray-300 bg-gray-50 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Code (2 chars) *</label>
                  <input value={newMaterialTypeCode} maxLength={2}
                    onChange={(e) => setNewMaterialTypeCode(e.target.value.toUpperCase())}
                    className="block w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono uppercase focus:border-blue-500 focus:outline-none"
                    placeholder="e.g. GA" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
                  <input value={newMaterialTypeDescription} onChange={(e) => setNewMaterialTypeDescription(e.target.value)}
                    className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    placeholder="e.g. GA Sheet" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                <input value={newMaterialTypeUnit} onChange={(e) => setNewMaterialTypeUnit(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="tons" />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={handleCreateMaterialType} disabled={newMaterialTypeLoading}
                  className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {newMaterialTypeLoading ? 'Adding…' : 'Add Material Type'}
                </button>
                <button type="button" onClick={() => { setShowNewMaterialTypeForm(false); setNewMaterialTypeCode(''); setNewMaterialTypeDescription(''); setNewMaterialTypeUnit('MT'); setError('') }}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Item Code</label>
          <input readOnly value={itemCode}
            className="block w-full rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm font-mono"
            placeholder="Select material type to generate code" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Item Name *</label>
          <input value={itemName} onChange={(e) => setItemName(e.target.value)}
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            placeholder="Item name" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
          <input value={unit} onChange={(e) => setUnit(e.target.value)}
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Size</label>
          <select value={materialSizeId} onChange={(e) => {
            if (e.target.value === '__add_new_size__') { setShowNewSizeForm(true); setMaterialSizeId(''); return }
            setMaterialSizeId(e.target.value)
          }} className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
            <option value="">— Select Size —</option>
            {localMaterialSizes.filter(s => s.material_type_id === materialTypeId).map(s => (
              <option key={s.id} value={s.id}>{s.size_label}</option>
            ))}
            <option value="__add_new_size__">+ Add new Size</option>
          </select>
          {showNewSizeForm && (
            <div className="mt-3 space-y-3 rounded border border-dashed border-gray-300 bg-gray-50 p-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Material Type for Size</label>
                <select value={newSizeMaterialTypeId || materialTypeId || ''} onChange={(e) => setNewSizeMaterialTypeId(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                  <option value="">— Select —</option>
                  {localMaterialTypes.map(m => <option key={m.id} value={m.id}>{m.code} — {m.description}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Size Label *</label>
                <input value={newSizeLabel} onChange={(e) => setNewSizeLabel(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="e.g. 0.50mm x 1250mm" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Thickness</label>
                  <input value={newSizeThickness} onChange={(e) => setNewSizeThickness(e.target.value)}
                    className="block w-full rounded border border-gray-300 px-3 py-2 text-sm" placeholder="Optional" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Width</label>
                  <input value={newSizeWidth} onChange={(e) => setNewSizeWidth(e.target.value)}
                    className="block w-full rounded border border-gray-300 px-3 py-2 text-sm" placeholder="Optional" />
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={handleCreateSize} disabled={newSizeLoading}
                  className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {newSizeLoading ? 'Adding…' : 'Add Size'}
                </button>
                <button type="button" onClick={() => { setShowNewSizeForm(false); setNewSizeMaterialTypeId(''); setNewSizeLabel(''); setNewSizeThickness(''); setNewSizeWidth(''); setError('') }}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            placeholder="Optional" />
        </div>
      </div>

      <div className="flex gap-3">
        <button type="submit" disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Saving…' : 'Create Item'}
        </button>
        <button type="button" onClick={() => router.push('/admin/items')}
          className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  )
}
