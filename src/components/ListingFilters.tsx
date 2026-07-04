'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ItemComboBox, type ComboOption } from '@/components/ItemComboBox'

type PartyOption = { id: string; name: string }
type ItemOption = { id: string; item_code: string; item_name: string }

export function ListingFilters({
  basePath,
  fromDate,
  toDate,
  partyLabel,
  partyName,
  partyValue,
  partyOptions,
  itemValue,
  itemOptions,
  extra,
}: {
  basePath: string
  fromDate: string
  toDate: string
  partyLabel?: string
  partyName?: string
  partyValue?: string
  partyOptions?: PartyOption[]
  itemValue: string
  itemOptions: ItemOption[]
  extra?: ReactNode
}) {
  const partyCombo: ComboOption[] = (partyOptions ?? []).map((p) => ({ id: p.id, label: p.name, search: p.name.toLowerCase() }))
  const itemCombo: ComboOption[] = itemOptions.map((i) => ({
    id: i.id,
    label: `${i.item_code} — ${i.item_name}`,
    search: `${i.item_code} ${i.item_name}`.toLowerCase(),
  }))
  const selectedParty = partyOptions?.find((p) => p.id === partyValue)
  const selectedItem = itemOptions.find((i) => i.id === itemValue)

  const hasFilters = !!(partyValue || itemValue)

  return (
    <form className="rounded-xl border bg-white p-4">
      <div className="flex flex-wrap gap-3 items-end">
        {partyName && (
          <div className="min-w-[14rem]">
            <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">{partyLabel}</label>
            <ItemComboBox
              name={partyName}
              defaultValue={partyValue || ''}
              defaultLabel={selectedParty?.name || ''}
              placeholder={`Search ${partyLabel?.toLowerCase()}…`}
              options={partyCombo}
            />
          </div>
        )}

        <div className="min-w-[16rem]">
          <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">Item</label>
          <ItemComboBox
            name="item"
            defaultValue={itemValue}
            defaultLabel={selectedItem ? `${selectedItem.item_code} — ${selectedItem.item_name}` : ''}
            placeholder="Search item…"
            options={itemCombo}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">From Date</label>
          <input
            type="date"
            name="from"
            defaultValue={fromDate}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">To Date</label>
          <input
            type="date"
            name="to"
            defaultValue={toDate}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        {extra}

        <button type="submit" className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          Apply
        </button>
        {hasFilters && (
          <Link href={basePath} className="text-sm text-gray-500 hover:underline pb-1.5">
            Clear
          </Link>
        )}
      </div>
    </form>
  )
}
