'use client'

import { useState } from 'react'
import { ItemComboBox, type ComboOption } from '@/components/ItemComboBox'

type Item = {
  id: string
  item_code: string
  item_name: string
  material_type_id: string
  material_size_id: string | null
  size_label?: string | null
}

type Size = { id: string; material_type_id: string | null; size_label: string }

function itemLabel(i: Item) {
  return `${i.item_code} — ${i.item_name}${i.size_label ? ` (${i.size_label})` : ''}`
}

export function ItemLedgerItemSizeFields({
  items,
  allSizes,
  defaultItemId,
  defaultSizeId,
}: {
  items: Item[]
  allSizes: Size[]
  defaultItemId: string
  defaultSizeId: string
}) {
  const [itemId, setItemId] = useState(defaultItemId)
  const [sizeId, setSizeId] = useState(defaultSizeId)

  const selectedItem = items.find((i) => i.id === itemId) || null

  // Item options narrow to the selected size, if one is set
  const itemsForSize = sizeId ? items.filter((i) => i.material_size_id === sizeId) : items
  const itemOptions: ComboOption[] = itemsForSize.map((i) => ({
    id: i.id,
    label: itemLabel(i),
    search: `${i.item_code} ${i.item_name} ${i.size_label ?? ''}`.toLowerCase(),
  }))

  // Size options narrow to the selected item's material type, if one is set
  const sizesForItem = selectedItem
    ? allSizes.filter((s) => !s.material_type_id || s.material_type_id === selectedItem.material_type_id)
    : allSizes

  return (
    <>
      <div className="min-w-[16rem]">
        <label className="block text-xs font-medium text-gray-500 mb-1">Item *</label>
        <ItemComboBox
          name="item"
          defaultValue={itemId}
          defaultLabel={selectedItem ? itemLabel(selectedItem) : ''}
          placeholder="Search item by name or code…"
          options={itemOptions}
          onSelect={(option) => {
            if (!option) {
              setItemId('')
              return
            }
            setItemId(option.id)
            const picked = items.find((i) => i.id === option.id)
            setSizeId(picked?.material_size_id || '')
          }}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Size</label>
        <select
          name="size"
          value={sizeId}
          onChange={(e) => {
            const newSizeId = e.target.value
            setSizeId(newSizeId)
            if (!newSizeId) return
            const matches = items.filter((i) => i.material_size_id === newSizeId)
            if (matches.length === 1) {
              setItemId(matches[0].id)
            } else if (selectedItem && selectedItem.material_size_id !== newSizeId) {
              setItemId('')
            }
          }}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">All Sizes</option>
          {sizesForItem.map((s) => (
            <option key={s.id} value={s.id}>{s.size_label}</option>
          ))}
        </select>
      </div>
    </>
  )
}
