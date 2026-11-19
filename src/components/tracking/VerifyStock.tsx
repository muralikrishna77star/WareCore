'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { MAX_BUNDLES, type TrackingUnit, type VerifiableLine } from '@/lib/tracking/constants'
import { sumWeights } from '@/lib/tracking/bundles'
import { errorText, trackingApi } from './api'
import { LabelPrintPanel } from './LabelPrintPanel'

const lineKey = (line: VerifiableLine) => `${line.purchase_line_id}|${line.company_id}|${line.warehouse_id}`

/** Labels old stock once someone has physically found and weighed it. */
export function VerifyStock() {
  const [search, setSearch] = useState('')
  const [lines, setLines] = useState<VerifiableLine[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<VerifiableLine | null>(null)
  const [count, setCount] = useState('')
  const [weights, setWeights] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState<TrackingUnit[] | null>(null)

  const load = useCallback(async (term: string) => {
    try {
      const data = await trackingApi<{ lines: VerifiableLine[] }>(`verify?search=${encodeURIComponent(term)}`)
      setLines(data.lines)
      setError('')
    } catch (err) {
      setError(errorText(err))
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => load(search), 250)
    return () => clearTimeout(timer)
  }, [search, load])

  const choose = (line: VerifiableLine) => {
    setSelected(line)
    setCount('')
    setWeights([])
    setNote('')
    setCreated(null)
    setError('')
  }

  const changeCount = (value: string) => {
    setCount(value)
    const number = Number(value)
    setWeights(Number.isInteger(number) && number >= 1 && number <= MAX_BUNDLES ? Array.from({ length: number }, () => '') : [])
  }

  const total = weights.length ? sumWeights(weights) : null
  // The book balance can be negative, so this is worked out in whole thousandths and signed.
  const differenceValue = total !== null && selected
    ? Math.round(Number(total) * 1000) - Math.round(Number(selected.book_quantity) * 1000)
    : null
  const difference = differenceValue === null ? null : `${differenceValue > 0 ? '+' : ''}${(differenceValue / 1000).toFixed(3)}`

  const save = async () => {
    if (!selected) return
    setSaving(true)
    setError('')
    try {
      const data = await trackingApi<{ units: TrackingUnit[] }>('verify', {
        method: 'POST',
        body: {
          purchase_line_id: selected.purchase_line_id,
          company_id: selected.company_id,
          warehouse_id: selected.warehouse_id,
          bundles: weights.map((quantity) => ({ quantity, weight_basis: 'weighed' })),
          note,
        },
      })
      setCreated(data.units)
      await load(search)
    } catch (err) {
      setError(errorText(err))
    }
    setSaving(false)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Existing stock</h2>
        <p className="text-sm text-gray-600">Find the purchase line for material on the floor, then weigh it. This never changes stock figures.</p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search line, bill or item" className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm" />
        </div>
        {lines === null && !error && <p className="text-sm text-gray-500">Loading…</p>}
        {lines?.length === 0 && <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">No matching purchase lines. Tracking must be on for the warehouse.</p>}
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
          {lines?.map((line) => (
            <li key={lineKey(line)}>
              <button
                type="button"
                onClick={() => choose(line)}
                className={`w-full px-4 py-3 text-left text-sm hover:bg-blue-50 ${selected && lineKey(selected) === lineKey(line) ? 'bg-blue-50' : ''}`}
              >
                <span className="flex justify-between gap-3">
                  <span className="font-mono font-medium text-gray-900">{line.purchase_line_id}</span>
                  <span className="whitespace-nowrap font-medium text-gray-900">Book {line.book_quantity} {line.unit}</span>
                </span>
                <span className="mt-0.5 block text-gray-600">{line.item_code} {line.item_name} {line.size_label}</span>
                <span className="block text-xs text-gray-500">{line.company_name} · {line.warehouse_name}{Number(line.labelled_quantity) > 0 ? ` · ${line.labelled_quantity} already labelled` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
        {!selected && <p className="text-sm text-gray-500">Choose a purchase line to record what you weighed.</p>}

        {selected && !created && (
          <>
            <div>
              <h2 className="font-mono text-lg font-semibold text-gray-900">{selected.purchase_line_id}</h2>
              <p className="text-sm text-gray-600">{selected.item_code} {selected.item_name} {selected.size_label}</p>
              <p className="text-sm text-gray-600">{selected.company_name} · {selected.warehouse_name}</p>
              <p className="text-sm font-medium text-gray-900">
                Book stock {selected.book_quantity} {selected.unit}{selected.book_as_of ? ` as of ${selected.book_as_of}` : ''}
              </p>
            </div>

            <label className="block text-sm text-gray-700">
              <span className="mb-1 block font-medium">Number of bundles found</span>
              <input inputMode="numeric" value={count} onChange={(e) => changeCount(e.target.value)} className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>

            {weights.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {weights.map((weight, index) => (
                  <label key={index} className="flex items-center gap-2 text-sm text-gray-700">
                    <span className="w-20 shrink-0">Bundle {index + 1}</span>
                    <input
                      inputMode="decimal"
                      value={weight}
                      onChange={(e) => setWeights((rows) => rows.map((row, i) => (i === index ? e.target.value : row)))}
                      className="w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-right font-mono text-sm"
                    />
                  </label>
                ))}
              </div>
            )}

            {total !== null && (
              <p className="text-sm text-gray-800">
                Weighed {total} {selected.unit}. Difference from books: <span className="font-medium">{difference} {selected.unit}</span>
              </p>
            )}

            <label className="block text-sm text-gray-700">
              <span className="mb-1 block font-medium">Note (optional)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where it was found" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>

            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

            <button type="button" disabled={saving || total === null} onClick={save} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save and create labels'}
            </button>
          </>
        )}

        {created && (
          <>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Labels created</h2>
              <p className="text-sm text-gray-600">Print them, then <Link href="/tracking/stock" className="text-blue-600 hover:underline">put each bundle away</Link>.</p>
            </div>
            <LabelPrintPanel units={created} />
          </>
        )}
      </section>
    </div>
  )
}
