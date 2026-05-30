'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import {
  CREATE_ITEM_MASTER_MUTATION,
  CREATE_ITEM_GROUP_MUTATION,
  CREATE_MATERIAL_TYPE_MUTATION,
  CREATE_MATERIAL_SIZE_MUTATION,
} from '@/lib/hasura/queries'
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
  const [localItemGroups, setLocalItemGroups] = useState(itemGroups)
  const [localMaterialTypes, setLocalMaterialTypes] = useState(materialTypes)
  const [localMaterialSizes, setLocalMaterialSizes] = useState(materialSizes)

  const [showNewGroupForm, setShowNewGroupForm] = useState(false)
  const [newGroupCode, setNewGroupCode] = useState('')
  const [newGroupDesc, setNewGroupDesc] = useState('')
  const [newGroupLoading, setNewGroupLoading] = useState(false)

  const [showNewMaterialTypeForm, setShowNewMaterialTypeForm] = useState(false)
  const [newMaterialTypeName, setNewMaterialTypeName] = useState('')
  const [newMaterialTypeUnit, setNewMaterialTypeUnit] = useState('tons')
  const [newMaterialTypeLoading, setNewMaterialTypeLoading] = useState(false)

  const [showNewSizeForm, setShowNewSizeForm] = useState(false)
  const [newSizeMaterialTypeId, setNewSizeMaterialTypeId] = useState('')
  const [newSizeLabel, setNewSizeLabel] = useState('')
  const [newSizeThickness, setNewSizeThickness] = useState('')
  const [newSizeWidth, setNewSizeWidth] = useState('')
  const [newSizeLoading, setNewSizeLoading] = useState(false)

  const selectedGroup = useMemo(() => localItemGroups.find((g) => g.id === groupId), [groupId, localItemGroups])
  const selectedMaterialType = useMemo(
    () => localMaterialTypes.find((m) => m.id === materialTypeId),
    [materialTypeId, localMaterialTypes]
  )

  const selectedMaterialSize = useMemo(
    () => localMaterialSizes.find((s) => s.id === materialSizeId),
    [materialSizeId, localMaterialSizes]
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

    setItemCode(`${prefix}${String(sequence + 1).padStart(4, '0')}`)
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

  const handleCreateGroup = async () => {
    const code = newGroupCode.trim().toUpperCase()
    if (!code) {
      setError('Group code is required to create a new group.')
      return
    }
    if (code.length !== 2) {
      setError('Group code must be exactly 2 characters.')
      return
    }

    setNewGroupLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_item_groups_one: ItemGroup }>(CREATE_ITEM_GROUP_MUTATION, {
      group_code: code,
      group_desc: newGroupDesc.trim() || null,
    })

    if (err) {
      setError(err.message)
      setNewGroupLoading(false)
      return
    }

    const newGroup = data?.insert_item_groups_one
    if (newGroup) {
      setLocalItemGroups((prev) => [...prev, newGroup])
      setGroupId(newGroup.id)
      setShowNewGroupForm(false)
      setNewGroupCode('')
      setNewGroupDesc('')
      setError('')
    }

    setNewGroupLoading(false)
  }

  const handleCreateMaterialType = async () => {
    if (!newMaterialTypeName.trim()) {
      setError('Material type name is required to create a new material type.')
      return
    }

    setNewMaterialTypeLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_material_types_one: MaterialType }>(CREATE_MATERIAL_TYPE_MUTATION, {
      name: newMaterialTypeName.trim(),
      unit: newMaterialTypeUnit.trim() || null,
      description: null,
    })

    if (err) {
      setError(err.message)
      setNewMaterialTypeLoading(false)
      return
    }

    const newMaterialType = data?.insert_material_types_one
    if (newMaterialType) {
      setLocalMaterialTypes((prev) => [...prev, newMaterialType])
      setMaterialTypeId(newMaterialType.id)
      setShowNewMaterialTypeForm(false)
      setNewMaterialTypeName('')
      setNewMaterialTypeUnit('tons')
      setError('')
    }

    setNewMaterialTypeLoading(false)
  }

  const handleCreateSize = async () => {
    const materialTypeForSize = newSizeMaterialTypeId || materialTypeId
    if (!materialTypeForSize || !newSizeLabel.trim()) {
      setError('Material type and size label are required to create a new size.')
      return
    }

    setNewSizeLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_material_sizes_one: MaterialSize }>(CREATE_MATERIAL_SIZE_MUTATION, {
      material_type_id: materialTypeForSize,
      size_label: newSizeLabel.trim(),
      thickness: newSizeThickness ? parseFloat(newSizeThickness) : null,
      width: newSizeWidth ? parseFloat(newSizeWidth) : null,
    })

    if (err) {
      setError(err.message)
      setNewSizeLoading(false)
      return
    }

    const newSize = data?.insert_material_sizes_one
    if (newSize) {
      setLocalMaterialSizes((prev) => [...prev, newSize])
      setMaterialSizeId(newSize.id)
      setShowNewSizeForm(false)
      setNewSizeMaterialTypeId('')
      setNewSizeLabel('')
      setNewSizeThickness('')
      setNewSizeWidth('')
      setError('')
    }

    setNewSizeLoading(false)
  }

  useEffect(() => {
    if (showNewSizeForm && materialTypeId && !newSizeMaterialTypeId) {
      setNewSizeMaterialTypeId(materialTypeId)
    }
  }, [showNewSizeForm, materialTypeId, newSizeMaterialTypeId])

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
            onChange={(e) => {
              if (e.target.value === '__add_new_group__') {
                setShowNewGroupForm(true)
                setGroupId('')
                return
              }
              setGroupId(e.target.value)
            }}
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">— Select Group —</option>
            {localItemGroups.map((group) => (
              <option key={group.id} value={group.id}>{group.group_code} {group.group_desc ? `— ${group.group_desc}` : ''}</option>
            ))}
            <option value="__add_new_group__">+ Add new Group</option>
          </select>
          {showNewGroupForm ? (
            <div className="mt-3 space-y-3 rounded border border-dashed border-gray-300 bg-gray-50 p-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Group Code</label>
                <input
                  value={newGroupCode}
                  onChange={(e) => setNewGroupCode(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="Enter group code"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Group Description</label>
                <input
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="Optional description"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleCreateGroup}
                  disabled={newGroupLoading}
                  className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {newGroupLoading ? 'Adding…' : 'Add Group'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewGroupForm(false)
                    setNewGroupCode('')
                    setNewGroupDesc('')
                    setError('')
                  }}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
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
            onChange={(e) => {
              if (e.target.value === '__add_new_material_type__') {
                setShowNewMaterialTypeForm(true)
                setMaterialTypeId('')
                return
              }
              setMaterialTypeId(e.target.value)
            }}
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">— Select Material Type —</option>
            {localMaterialTypes.map((material) => (
              <option key={material.id} value={material.id}>{material.name}</option>
            ))}
            <option value="__add_new_material_type__">+ Add new Material Type</option>
          </select>
          {showNewMaterialTypeForm ? (
            <div className="mt-3 space-y-3 rounded border border-dashed border-gray-300 bg-gray-50 p-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Material Type</label>
                <input
                  value={newMaterialTypeName}
                  onChange={(e) => setNewMaterialTypeName(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="Enter material type"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                <input
                  value={newMaterialTypeUnit}
                  onChange={(e) => setNewMaterialTypeUnit(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="tons"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleCreateMaterialType}
                  disabled={newMaterialTypeLoading}
                  className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {newMaterialTypeLoading ? 'Adding…' : 'Add Material Type'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewMaterialTypeForm(false)
                    setNewMaterialTypeName('')
                    setNewMaterialTypeUnit('tons')
                    setError('')
                  }}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Size</label>
          <select
            value={materialSizeId}
            onChange={(e) => {
              if (e.target.value === '__add_new_size__') {
                setShowNewSizeForm(true)
                setMaterialSizeId('')
                return
              }
              setMaterialSizeId(e.target.value)
            }}
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">— Select Size —</option>
            {localMaterialSizes
              .filter((size) => size.material_type_id === materialTypeId)
              .map((size) => (
                <option key={size.id} value={size.id}>{size.size_label}</option>
              ))}
            <option value="__add_new_size__">+ Add new Size</option>
          </select>
          {showNewSizeForm ? (
            <div className="mt-3 space-y-3 rounded border border-dashed border-gray-300 bg-gray-50 p-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Material Type for Size</label>
                <select
                  value={newSizeMaterialTypeId || materialTypeId || ''}
                  onChange={(e) => setNewSizeMaterialTypeId(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">— Select Material Type —</option>
                  {localMaterialTypes.map((material) => (
                    <option key={material.id} value={material.id}>{material.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Size Label</label>
                <input
                  value={newSizeLabel}
                  onChange={(e) => setNewSizeLabel(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="Enter size label"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Thickness</label>
                  <input
                    value={newSizeThickness}
                    onChange={(e) => setNewSizeThickness(e.target.value)}
                    className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Width</label>
                  <input
                    value={newSizeWidth}
                    onChange={(e) => setNewSizeWidth(e.target.value)}
                    className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    placeholder="Optional"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleCreateSize}
                  disabled={newSizeLoading}
                  className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {newSizeLoading ? 'Adding…' : 'Add Size'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewSizeForm(false)
                    setNewSizeMaterialTypeId('')
                    setNewSizeLabel('')
                    setNewSizeThickness('')
                    setNewSizeWidth('')
                    setError('')
                  }}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
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
