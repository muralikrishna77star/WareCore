'use client'

import { useCallback, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { MAX_BUNDLES, type EligibleLine, type TrackingUnit } from '@/lib/tracking/constants'
import { splitEqually, sumWeights, toThousandths } from '@/lib/tracking/bundles'
import { errorText, trackingApi } from './api'
import { LabelPrintPanel } from './LabelPrintPanel'

interface BundleRow {
  quantity: string
  weight_basis: 'weighed' | 'estimated'
}

export function ReceiveAndLabel() {
  const [search, setSearch] = useState('')
  const [lines, setLines] = useState<EligibleLine[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<EligibleLine | null>(null)
  const [count, setCount] = useState('')
  const [bundles, setBundles] = useState<BundleRow[]>([])
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState<TrackingUnit[] | null>(null)

  const load = useCallback(async (term: string) => {
    try {
      const data = await trackingApi<{ lines: EligibleLine[] }>(`eligible-lines?search=${encodeURIComponent(term)}`)
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

  const choose = (line: EligibleLine) => {
    setSelected(line)
    setCount('')
    setBundles([])
    setCreated(null)
    setError('')
  }

  const changeCount = (value: string) => {
    setCount(value)
    const number = Number(value)
    if (!selected || !value.trim() || !Number.isInteger(number) || number < 1 || number > MAX_BUNDLES) {
      setBundles([])
      return
    }
    setBundles(splitEqually(selected.quantity, number).map((quantity) => ({ quantity, weight_basis: 'estimated' })))
  }

  const changeWeight = (index: number, quantity: string) => {
    setBundles((rows) => rows.map((row, i) => (i === index ? { quantity, weight_basis: 'weighed' } : row)))
  }

  const countInvalid = count.trim() !== '' && bundles.length === 0
  const total = bundles.length ? sumWeights(bundles.map((row) => row.quantity)) : null
  const matches = !bundles.length || (total !== null && toThousandths(total) === toThousandths(selected?.quantity ?? ''))

  const create = async () => {
    if (!selected) return
    setSaving(true)
    setError('')
    try {
      const data = await trackingApi<{ units: TrackingUnit[] }>('units', {
        method: 'POST',
        body: { purchase_line_id: selected.purchase_line_id, bundles: bundles.length ? bundles : null },
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
        <h2 className="text-lg font-semibold text-gray-900">Purchase lines ready to label</h2>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search line, bill or item"
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm"
          />
        </div>
        {lines === null && !error && <p className="text-sm text-gray-500">Loading…</p>}
        {lines?.length === 0 && (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
            No purchase lines are waiting. Lines appear here once tracking is on for the warehouse and a new purchase is saved.
          </p>
        )}
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
          {lines?.map((line) => (
            <li key={line.purchase_line_id}>
              <button
                type="button"
                onClick={() => choose(line)}
                className={`w-full px-4 py-3 text-left text-sm hover:bg-blue-50 ${selected?.purchase_line_id === line.purchase_line_id ? 'bg-blue-50' : ''}`}
              >
                <span className="flex justify-between gap-3">
                  <span className="font-mono font-medium text-gray-900">{line.purchase_line_id}</span>
                  <span className="whitespace-nowrap font-medium text-gray-900">{line.quantity} {line.unit}</span>
                </span>
                <span className="mt-0.5 block text-gray-600">{line.item_code} {line.item_name} {line.size_label}</span>
                <span className="block text-xs text-gray-500">Bill {line.bill_number} · {line.company_name} · {line.warehouse_name}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
        {!selected && <p className="text-sm text-gray-500">Choose a purchase line to create its labels.</p>}

        {selected && !created && (
          <>
            <div>
              <h2 className="font-mono text-lg font-semibold text-gray-900">{selected.purchase_line_id}</h2>
              <p className="text-sm text-gray-600">{selected.item_code} {selected.item_name} {selected.size_label}</p>
              <p className="text-sm font-medium text-gray-900">{selected.quantity} {selected.unit}</p>
            </div>

            <label className="block text-sm text-gray-700">
              <span className="mb-1 block font-medium">Number of bundles (optional)</span>
              <input
                inputMode="numeric"
                value={count}
                onChange={(e) => changeCount(e.target.value)}
                placeholder="Leave blank for one label"
                className="w-56 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            {countInvalid && <p className="text-sm text-red-600">Enter a whole number from 1 to {MAX_BUNDLES}.</p>}
            {!count.trim() && <p className="text-sm text-gray-600">One label will cover the whole purchase line.</p>}

            {bundles.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-gray-600">Weights are split equally and marked estimated until you change them.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {bundles.map((row, index) => (
                    <label key={index} className="flex items-center gap-2 text-sm text-gray-700">
                      <span className="w-20 shrink-0">Bundle {index + 1}</span>
                      <input
                        inputMode="decimal"
                        value={row.quantity}
                        onChange={(e) => changeWeight(index, e.target.value)}
                        className="w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-right font-mono text-sm"
                      />
                      <span className="text-xs text-gray-500">{row.weight_basis === 'estimated' ? 'Estimated' : 'Weighed'}</span>
                    </label>
                  ))}
                </div>
                <p className={`text-sm font-medium ${matches ? 'text-green-700' : 'text-red-600'}`}>
                  Total {total ?? 'not valid'} of {selected.quantity} {selected.unit}
                </p>
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="button"
              disabled={saving || countInvalid || !matches}
              onClick={create}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create labels'}
            </button>
          </>
        )}

        {created && (
          <>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Labels created</h2>
              <p className="text-sm text-gray-600">{created.length} for purchase line {created[0]?.purchase_line_id}</p>
            </div>
            <LabelPrintPanel units={created} />
          </>
        )}
      </section>
    </div>
  )
}
