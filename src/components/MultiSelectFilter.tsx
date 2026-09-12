'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { DropdownPortal } from './DropdownPortal'

export type MultiSelectOption = {
  value: string
  label: string
  sublabel?: string
  /** Optional heading the option is listed under. */
  group?: string
}

/**
 * Searchable multi-select used by the Day-Wise Item Ledger filters.
 *
 * Selections are submitted as repeated hidden inputs of the same `name`, so
 * the whole filter bar stays a plain GET <form> and every filter ends up in
 * the URL — shareable, bookmarkable, and re-readable on the server without
 * any client state to rehydrate.
 */
export function MultiSelectFilter({
  name,
  label,
  options,
  selected,
  placeholder = 'All',
  maxChips = 3,
}: {
  name: string
  label: string
  options: MultiSelectOption[]
  selected: string[]
  placeholder?: string
  maxChips?: number
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [values, setValues] = useState<string[]>(selected)
  const anchorRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  // A multi-select has to survive clicks on its own options, so it closes on
  // an outside pointer-down / Escape rather than on blur the way the
  // single-pick AutocompleteSelect does.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (anchorRef.current?.contains(t) || popupRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.sublabel ?? '').toLowerCase().includes(q)
    )
  }, [options, search])

  const toggle = (value: string) => {
    setValues((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))
  }

  const chips = values.slice(0, maxChips)
  const overflow = values.length - chips.length

  return (
    <div className="min-w-[15rem]">
      <label className="block text-[0.6875rem] font-medium text-gray-500 mb-1 uppercase">{label}</label>

      {/* The actual submitted payload — one input per selection. */}
      {values.map((v) => (
        <input key={v} type="hidden" name={name} value={v} />
      ))}

      <div ref={anchorRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 rounded border border-gray-300 bg-white px-2 py-1.5 text-left text-[0.9375rem] text-gray-700 hover:border-gray-400 focus:border-blue-500 focus:outline-none"
        >
          <span className="flex flex-1 flex-wrap items-center gap-1 overflow-hidden">
            {values.length === 0 ? (
              <span className="text-gray-400">{placeholder}</span>
            ) : (
              <>
                {chips.map((v) => (
                  <span
                    key={v}
                    className="inline-flex max-w-[11rem] items-center gap-1 truncate rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700"
                  >
                    <span className="truncate">{byValue.get(v)?.label ?? v}</span>
                    <X
                      className="h-3 w-3 shrink-0 cursor-pointer hover:text-blue-900"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggle(v)
                      }}
                    />
                  </span>
                ))}
                {overflow > 0 && <span className="text-xs text-gray-500">+{overflow} more</span>}
              </>
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
        </button>
      </div>

      <DropdownPortal
        anchorRef={anchorRef}
        open={open}
        matchWidth
        maxHeight={320}
        className="rounded-lg border border-gray-200 bg-white shadow-lg overflow-y-auto"
      >
        <div ref={popupRef}>
            <div className="sticky top-0 border-b bg-white p-2">
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
              />
              {values.length > 0 && (
                <button
                  type="button"
                  onClick={() => setValues([])}
                  className="mt-1 text-xs text-gray-500 hover:text-gray-800 hover:underline"
                >
                  Clear {values.length} selected
                </button>
              )}
            </div>
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-gray-400">No matches.</p>
            ) : (
              filtered.map((o, i) => {
                const isSelected = values.includes(o.value)
                const showGroup = o.group && (i === 0 || filtered[i - 1].group !== o.group)
                return (
                  <div key={o.value}>
                    {showGroup && (
                      <p className="bg-gray-50 px-3 py-1 text-[0.6875rem] font-semibold uppercase text-gray-500">
                        {o.group}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => toggle(o.value)}
                      className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm hover:bg-blue-50"
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          isSelected ? 'border-blue-600 bg-blue-600' : 'border-gray-300 bg-white'
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-gray-800">{o.label}</span>
                        {o.sublabel && <span className="block truncate text-xs text-gray-500">{o.sublabel}</span>}
                      </span>
                    </button>
                  </div>
                )
              })
            )}
        </div>
      </DropdownPortal>
    </div>
  )
}
