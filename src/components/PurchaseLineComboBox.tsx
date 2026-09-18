'use client'

import { useMemo, useRef, useState } from 'react'
import { DropdownPortal } from './DropdownPortal'

// A purchase line as the Sale Entry screens need to show it. `_key` is the
// value actually stored on the line — a real purchase_line_id, or an "ID:<uuid>"
// synthetic key for job-work output / unlinked stock that has no purchase line.
export type PurchaseLineChoice = {
  _key: string
  purchase_line_id: string | null
  item_name: string | null
  size_label: string | null
  available_quantity: number
  bill_number: string | null
  bill_date: string | null
  supplier_name: string | null
}

/** "CR0125-0080" for a real line, "[Stock] 2.30 X 377" for unlinked stock. */
export function purchaseLineLabel(pl: PurchaseLineChoice): string {
  return pl.purchase_line_id ?? `[Stock] ${pl.item_name || pl.size_label || 'General'}`
}

/** "31-Jan-2025" — matches how dates read elsewhere in the sale screens. */
function formatBillDate(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d}-${months[Number(m) - 1] ?? m}-${y}`
}

// Bill number first: it is the document identity, and it is the only thing
// that separates sibling lines cut from the same bill on the same day from
// the same supplier (CR0125-0080 vs CR0125-0081), which date and supplier
// alone cannot.
function secondaryLine(pl: PurchaseLineChoice): string {
  return [pl.bill_number, formatBillDate(pl.bill_date), pl.supplier_name].filter(Boolean).join('  ·  ')
}

/**
 * Type-to-filter picker for a purchase line, replacing a plain <select>.
 *
 * The select listed only the line id, so choosing between several lines of the
 * same item meant guessing which bill each came from, and a long list could
 * only be scrolled. This matches on the line id, the supplier, the item and the
 * bill date, and shows the date and supplier under each id.
 */
export function PurchaseLineComboBox({
  value,
  options,
  onChange,
  disabled = false,
  currentFallbackLabel,
  widthClass = 'w-44',
  dropdownWidthClass = 'w-72',
}: {
  value: string
  options: PurchaseLineChoice[]
  onChange: (key: string) => void
  disabled?: boolean
  /** Label for an already-saved line that no longer has stock, so editing an
   *  existing sale doesn't silently drop its purchase line. */
  currentFallbackLabel?: string
  widthClass?: string
  dropdownWidthClass?: string
}) {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const [search, setSearch] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const selected = options.find(o => o._key === value) ?? null
  const selectedLabel = selected
    ? purchaseLineLabel(selected)
    : value
    ? currentFallbackLabel ?? value
    : ''

  // null search => showing the current selection, not a query in progress.
  const query = search ?? ''
  const filtered = useMemo(() => {
    if (search === null || !query.trim()) return options
    const q = query.toLowerCase()
    return options.filter(o =>
      purchaseLineLabel(o).toLowerCase().includes(q)
      || (o.bill_number ?? '').toLowerCase().includes(q)
      || (o.supplier_name ?? '').toLowerCase().includes(q)
      || (o.item_name ?? '').toLowerCase().includes(q)
      || (o.size_label ?? '').toLowerCase().includes(q)
      || (o.bill_date ?? '').includes(q)
      || formatBillDate(o.bill_date).toLowerCase().includes(q)
    )
  }, [options, query, search])

  const commit = (pl: PurchaseLineChoice) => {
    onChange(pl._key)
    setSearch(null)
    setOpen(false)
    setHighlight(0)
  }

  const close = () => {
    setSearch(null)
    setOpen(false)
    setHighlight(0)
  }

  return (
    <div className="relative" ref={anchorRef}>
      <input
        type="text"
        disabled={disabled}
        value={search ?? selectedLabel}
        placeholder={disabled ? 'No stock' : '— Select —'}
        onChange={e => { setSearch(e.target.value); setOpen(true); setHighlight(0) }}
        onFocus={() => { setSearch(''); setOpen(true); setHighlight(0) }}
        onBlur={close}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (!open) { setOpen(true); setHighlight(0); return }
            setHighlight(h => Math.min(h + 1, filtered.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight(h => Math.max(h - 1, 0))
          } else if (e.key === 'Enter') {
            // The best match is highlighted from the first keystroke, so
            // typing a few characters and pressing Enter fills the line.
            e.preventDefault()
            if (open && filtered[highlight]) commit(filtered[highlight])
          } else if (e.key === 'Escape') {
            close()
          } else if (e.key === 'Backspace' && search === null && value) {
            // Clearing the box clears the selection rather than leaving a
            // stale label over an empty query.
            onChange('')
            setSearch('')
          }
        }}
        className={`block ${widthClass} rounded border px-2 py-1.5 text-sm font-mono focus:outline-none ${
          disabled ? 'border-gray-200 bg-gray-50 text-gray-400' : 'border-gray-300 focus:border-blue-500'
        }`}
      />
      <DropdownPortal
        anchorRef={anchorRef}
        open={open && !disabled}
        className={`${dropdownWidthClass} overflow-y-auto rounded-md border border-gray-300 bg-white shadow-lg max-h-56`}
      >
        {value && (
          <button
            type="button"
            onMouseDown={e => e.preventDefault()}
            onClick={() => { onChange(''); close() }}
            className="w-full text-left px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-100 border-b border-gray-100"
          >
            — Clear selection —
          </button>
        )}
        {filtered.map((pl, idx) => {
          const sub = secondaryLine(pl)
          return (
            <button
              key={pl._key}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => commit(pl)}
              className={`w-full text-left px-2 py-2 text-xs ${
                idx === highlight ? 'bg-blue-100 text-blue-800' : 'hover:bg-gray-100'
              }`}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-mono font-medium">{purchaseLineLabel(pl)}</span>
                <span className="text-green-700 whitespace-nowrap">{pl.available_quantity.toFixed(2)}</span>
              </span>
              {sub && <span className="block text-gray-500 mt-0.5">{sub}</span>}
            </button>
          )
        })}
        {filtered.length === 0 && (
          <div className="px-2 py-2 text-xs text-gray-400">No matching purchase lines</div>
        )}
      </DropdownPortal>
    </div>
  )
}
