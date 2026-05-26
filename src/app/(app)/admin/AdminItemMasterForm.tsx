'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import { CREATE_ITEM_MASTER_MUTATION } from '@/lib/hasura/queries'
import type { ItemGroup, MaterialSize, MaterialType, ItemMaster } from '@/types'

interface Props {
  itemGroups: ItemGroup[]
  materialTypes: MaterialType[]
  materialSizes: MaterialSize[]
  existingItems: ItemMaster[]
}

export default function AdminItemMasterForm({ itemGroups, materialTypes, materialSizes, existingItems }: Props) {
  const router = useRouter()
  const [groupId, setGroupId] = useState('')
  const [materialTypeId, setMaterialTypeId] = useState('')
  const [materialSizeId, setMaterialSizeId] = useState('')
  const [itemName, setItemName] = useState('')
  const [unit, setUnit] = useState('tons')
  const [description, setDescription] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const selectedGroup = useMemo(() => itemGroups.find((g) => g.id === groupId), [groupId, itemGroups])
  const selectedMaterialType = useMemo(
    () => materialTypes.find((m) => m.id === materialTypeId),
    [materialTypeId, materialTypes]
  )

  const selectedMaterialSize = useMemo(
    () => materialSizes.find((s) => s.id === materialSizeId),
    [materialSizeId, materialSizes]
  )

  useEffect(() => {
    if (selectedMaterialType) {
      setUnit(selectedMaterialType.unit || 'tons')
    }
  }, [selectedMaterialType])

  useEffect(() => {
    if (!materialTypeId) {
      setMaterialSizeId('')
    }
  }, [materialTypeId])

  useEffect(() => {
    if (!selectedGroup) {
      setItemCode('')
      return
    }

    const prefix = selectedGroup.group_code.trim().toUpperCase()
    if (!prefix) {
      setItemCode('')
      return
    }

    const safePrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const sequence = existingItems.reduce((max, item) => {
      if (!item.item_code?.startsWith(prefix)) return max
      const match = item.item_code.match(new RegExp(`^${safePrefix}(\\d+)$`))
      if (!match) return max
      const n = Number(match[1])
      return Number.isFinite(n) ? Math.max(max, n) : max
    }, 0)

    setItemCode(`${prefix}${String(sequence + 1).padStart(3, '0')}`)
  }, [selectedGroup, existingItems])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!groupId || !materialTypeId || !itemName.trim() || !itemCode.trim()) {
      setError('Please fill all required fields.')
      return
    }

    setLoading(true)
    setError('')

    const { error: err } = await hasuraFetch(CREATE_ITEM_MASTER_MUTATION, {
      item_code: itemCode,
      item_name: itemName,
      item_group_id: groupId,
      material_type_id: materialTypeId,
      material_size_id: materialSizeId || null,
      size_label: selectedMaterialSize?.size_label || null,
      unit,
      description: description || null,
    })

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    router.push('/admin/items')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white rounded-xl border border-gray-200 p-6">
      {error ? (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Group Code *</label>
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">— Select Group —</option>
            {itemGroups.map((group) => (
              <option key={group.id} value={group.id}>{group.group_code} {group.group_desc ? `— ${group.group_desc}` : ''}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Item Code</label>
          <input
            readOnly
            value={itemCode}
            className="block w-full rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm"
            placeholder="Select group to generate code"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Item Name *</label>
          <input
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            placeholder="Item name"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Material Type *</label>
          <select
            value={materialTypeId}
            onChange={(e) => setMaterialTypeId(e.target.value)}
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">— Select Material Type —</option>
            {materialTypes.map((material) => (
              <option key={material.id} value={material.id}>{material.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Size</label>
          <select
            value={materialSizeId}
            onChange={(e) => setMaterialSizeId(e.target.value)}
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">— Select Size —</option>
            {materialSizes
              .filter((size) => size.material_type_id === materialTypeId)
              .map((size) => (
                <option key={size.id} value={size.id}>{size.size_label}</option>
              ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Material Type Unit</label>
          <input
            readOnly
            value={unit}
            className="block w-full rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            placeholder="Optional description"
          />
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Create Item'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/admin/items')}
          className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
