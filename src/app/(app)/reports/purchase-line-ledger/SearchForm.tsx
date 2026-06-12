'use client'

import { useMemo, useState } from 'react'
import { ItemComboBox, type ComboOption } from '@/components/ItemComboBox'

export type ItemOption = ComboOption & {
  material_type_id: string
  material_size_id: string | null
}

export type PurchaseLineRef = {
  purchase_line_id: string
  material_type_id: string | null
  material_size_id: string | null
}

export function SearchForm({
  items,
  purchaseLines,
  defaultItemId,
  defaultItemLabel,
  defaultLine,
}: {
  items: ItemOption[]
  purchaseLines: PurchaseLineRef[]
  defaultItemId: string
  defaultItemLabel: string
  defaultLine: string
}) {
  const [selectedItem, setSelectedItem] = useState<ItemOption | null>(
    items.find((i) => i.id === defaultItemId) ?? null
  )

  const lineIds = useMemo(() => {
    const matches = selectedItem
      ? purchaseLines.filter(
          (p) =>
            p.material_type_id === selectedItem.material_type_id &&
            p.material_size_id === selectedItem.material_size_id
        )
      : purchaseLines
    return Array.from(new Set(matches.map((p) => p.purchase_line_id))).sort()
  }, [selectedItem, purchaseLines])

  return (
    <div className="flex flex-wrap gap-3 items-end">
      <div className="min-w-[16rem]">
        <label className="block text-xs font-medium text-gray-500 mb-1">Item (filter)</label>
        <ItemComboBox
          name="item"
          defaultValue={defaultItemId}
          defaultLabel={defaultItemLabel}
          placeholder="Search item to narrow line IDs…"
          options={items}
          onSelect={(option) => setSelectedItem((option as ItemOption | null) ?? null)}
        />
      </div>
      <div className="min-w-[16rem]">
        <label className="block text-xs font-medium text-gray-500 mb-1">Purchase Line ID *</label>
        <input
          type="text"
          name="line"
          list="purchase-line-ids"
          defaultValue={defaultLine}
          placeholder="e.g. HR0625-0001"
          autoComplete="off"
          className="rounded border border-gray-300 px-2 py-1.5 text-sm font-mono w-full focus:border-blue-500 focus:outline-none"
        />
        <datalist id="purchase-line-ids">
          {lineIds.map((id) => <option key={id} value={id} />)}
        </datalist>
      </div>
      <button
        type="submit"
        className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
      >
        View
      </button>
    </div>
  )
}
