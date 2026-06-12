'use client'

import { useRef, useState } from 'react'
import { DropdownPortal } from '@/components/DropdownPortal'

export type ComboOption = {
  id: string
  label: string
  search: string
}

export function ItemComboBox({
  options,
  name,
  defaultValue = '',
  defaultLabel = '',
  placeholder = 'Search item…',
  onSelect,
}: {
  options: ComboOption[]
  name: string
  defaultValue?: string
  defaultLabel?: string
  placeholder?: string
  onSelect?: (option: ComboOption | null) => void
}) {
  const [search, setSearch] = useState(defaultLabel)
  const [selectedId, setSelectedId] = useState(defaultValue)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const anchorRef = useRef<HTMLDivElement | null>(null)

  const filtered = search.trim()
    ? options.filter((o) => o.search.includes(search.trim().toLowerCase()))
    : options

  const choose = (option: ComboOption) => {
    setSelectedId(option.id)
    setSearch(option.label)
    setOpen(false)
    setHighlight(-1)
    onSelect?.(option)
  }

  return (
    <div className="relative" ref={anchorRef}>
      <input type="hidden" name={name} value={selectedId} readOnly />
      <input
        type="text"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setSelectedId('')
          setOpen(true)
          setHighlight(-1)
          onSelect?.(null)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (!open) { setOpen(true); setHighlight(0); return }
            setHighlight((h) => Math.min(h + 1, filtered.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter') {
            if (open && highlight >= 0 && highlight < filtered.length) {
              e.preventDefault()
              choose(filtered[highlight])
            }
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        className="rounded border border-gray-300 px-2 py-1.5 text-sm w-full focus:border-blue-500 focus:outline-none"
      />
      <DropdownPortal anchorEl={anchorRef.current} open={open} matchWidth className="max-h-60 overflow-y-auto rounded-md border border-gray-300 bg-white shadow-lg">
        {filtered.length === 0 ? (
          <div className="px-3 py-2 text-sm text-gray-500">No items found</div>
        ) : (
          filtered.map((option, idx) => (
            <button
              key={option.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(option)}
              className={`block w-full text-left px-3 py-2 text-sm ${
                idx === highlight ? 'bg-blue-100 text-blue-800' : 'hover:bg-gray-100'
              } ${option.id === selectedId ? 'font-semibold' : ''}`}
            >
              {option.label}
            </button>
          ))
        )}
      </DropdownPortal>
    </div>
  )
}
