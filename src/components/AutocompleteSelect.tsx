'use client'

import { useRef, useState } from 'react'
import { DropdownPortal } from './DropdownPortal'

// Generic searchable-select built on the existing DropdownPortal primitive
// (the same portal-positioning mechanism src/app/(app)/bills/new/page.tsx's
// per-line item/material-type dropdowns already use) — built fresh for the
// purchase-import review screen rather than retrofitting bills/new's own
// hand-rolled copies of this pattern (left untouched, out of scope).
export interface AutocompleteOption {
  id: string
  label: string
  sublabel?: string
}

export default function AutocompleteSelect({
  currentLabel,
  options,
  onSelect,
  placeholder = 'Search…',
  error,
  disabled = false,
}: {
  currentLabel: string | null
  options: AutocompleteOption[]
  onSelect: (option: AutocompleteOption) => void
  placeholder?: string
  error?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const anchorRef = useRef<HTMLDivElement>(null)

  const filtered = options.filter(
    (o) => o.label.toLowerCase().includes(search.toLowerCase()) || (o.sublabel ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div ref={anchorRef} className="relative">
      <input
        type="text"
        disabled={disabled}
        value={open ? search : (currentLabel ?? '')}
        onChange={(e) => setSearch(e.target.value)}
        onFocus={() => { setSearch(''); setOpen(true) }}
        onBlur={() => setOpen(false)}
        placeholder={currentLabel ? undefined : placeholder}
        className={`block w-full rounded border px-2 py-1.5 text-sm focus:outline-none disabled:bg-gray-50 ${
          error ? 'border-red-400' : 'border-gray-300 focus:border-blue-500'
        } ${!currentLabel && !open ? 'text-red-600 placeholder:text-red-400' : ''}`}
      />
      <DropdownPortal anchorEl={anchorRef.current} open={open} matchWidth className="rounded-md border border-gray-300 bg-white shadow-lg overflow-y-auto max-h-60">
        {filtered.length === 0 && <div className="px-3 py-2 text-sm text-gray-400">No matches</div>}
        {filtered.map((o) => (
          <button
            key={o.id}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onSelect(o); setOpen(false); setSearch('') }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 flex items-center justify-between gap-2"
          >
            <span>{o.label}</span>
            {o.sublabel && <span className="text-gray-400 text-xs">{o.sublabel}</span>}
          </button>
        ))}
      </DropdownPortal>
      {error && <p className="mt-0.5 text-xs text-red-600">{error}</p>}
    </div>
  )
}
