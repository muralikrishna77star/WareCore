'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { OutputReceipt, TrackingUnit } from '@/lib/tracking/constants'
import { errorText, formatWhen, trackingApi } from './api'
import { VendorSelect, type JobWorkOptions } from './Dispatches'
import { LabelPrintPanel } from './LabelPrintPanel'
import DateInput from '@/components/DateInput'

type Source = TrackingUnit & { dispatch_id: string | null }

interface Candidates {
  units: Source[]
  dispatches: { id: string; dispatch_no: string; sent_at: string | null; job_work_reference: string | null }[]
}

interface Item {
  id: string
  item_code: string
  item_name: string
  size_label: string | null
  unit: string | null
}

interface OutputRow {
  key: number
  item: Item | null
  search: string
  size_label: string
  quantity: string
  weighed: boolean
  parents: string[]
}

const field = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm'
const quiet = 'rounded border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50 disabled:opacity-50'
const WEIGHT_RE = /^[0-9]+(\.[0-9]{1,3})?$/
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

/** Searches the item master as staff type. */
function ItemPicker({ row, onPick, onSearch }: { row: OutputRow; onPick: (item: Item) => void; onSearch: (text: string) => void }) {
  const [results, setResults] = useState<Item[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      trackingApi<{ items: Item[] }>(`outputs?items=${encodeURIComponent(row.search)}`)
        .then((data) => setResults(data.items))
        .catch(() => setResults([]))
    }, 250)
    return () => clearTimeout(timer)
  }, [row.search, open])

  return (
    <div className="relative">
      <input
        value={row.item && !open ? `${row.item.item_code} ${row.item.item_name}` : row.search}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search item code or name"
        className={field}
      />
      {open && results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow">
          {results.map((item) => (
            <li key={item.id}>
              <button type="button" onMouseDown={() => { onPick(item); setOpen(false) }} className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50">
                <span className="font-mono text-gray-900">{item.item_code}</span> <span className="text-gray-700">{item.item_name} {item.size_label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Outputs({ canReceive }: { canReceive: boolean }) {
  const [receipts, setReceipts] = useState<OutputReceipt[] | null>(null)
  const [options, setOptions] = useState<JobWorkOptions>({ warehouses: [], vendors: [] })
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [candidates, setCandidates] = useState<Candidates | null>(null)
  const [dispatchId, setDispatchId] = useState('')
  const [sources, setSources] = useState<string[]>([])
  const [receivedOn, setReceivedOn] = useState(istToday)
  const [rows, setRows] = useState<OutputRow[]>([])
  const [remainders, setRemainders] = useState<Record<string, string>>({})
  const [usedUp, setUsedUp] = useState<Record<string, boolean>>({})
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState<{ receipt: OutputReceipt; units: TrackingUnit[] } | null>(null)
  const [nextKey, setNextKey] = useState(1)

  const warehouse = options.warehouses.find((w) => w.id === warehouseId)

  useEffect(() => {
    const timer = setTimeout(() => {
      trackingApi<{ receipts: OutputReceipt[] } & JobWorkOptions>(`outputs?search=${encodeURIComponent(search)}`)
        .then((data) => {
          setReceipts(data.receipts)
          setOptions({ warehouses: data.warehouses, vendors: data.vendors })
        })
        .catch((err) => setError(errorText(err)))
    }, 250)
    return () => clearTimeout(timer)
  }, [search])

  // Keyed on the company, not the warehouse object, so refreshing the receipt list never clears the form.
  const companyId = warehouse?.company_id ?? ''
  useEffect(() => {
    if (!companyId || !vendorId) return
    let current = true
    trackingApi<Candidates>(`outputs?company=${companyId}&vendor=${vendorId}`)
      .then((data) => {
        if (!current) return
        setCandidates(data)
        setDispatchId('')
        setSources([])
        setRows([])
        setRemainders({})
        setUsedUp({})
      })
      .catch((err) => { if (current) setError(errorText(err)) })
    return () => { current = false }
  }, [companyId, vendorId])

  const units = useMemo(() => candidates?.units ?? [], [candidates])
  const sourceUnits = units.filter((u) => sources.includes(u.id))

  const chooseDispatch = (id: string) => {
    setDispatchId(id)
    // The bundles that went out on that dispatch are the usual sources.
    const picked = units.filter((u) => !id || u.dispatch_id === id).map((u) => u.id)
    setSources(picked)
    setUsedUp(Object.fromEntries(picked.map((u) => [u, true])))
    setRows((all) => all.map((row) => ({ ...row, parents: picked })))
  }

  const toggleSource = (id: string) => {
    const next = sources.includes(id) ? sources.filter((s) => s !== id) : [...sources, id]
    setSources(next)
    setUsedUp((all) => ({ ...all, [id]: !sources.includes(id) }))
    setRows((all) => all.map((row) => ({ ...row, parents: row.parents.filter((p) => next.includes(p)).concat(sources.includes(id) ? [] : [id]) })))
  }

  const addRow = () => {
    setRows((all) => [...all, { key: nextKey, item: null, search: '', size_label: '', quantity: '', weighed: true, parents: sources }])
    setNextKey((k) => k + 1)
  }
  const updateRow = (key: number, change: Partial<OutputRow>) => setRows((all) => all.map((row) => (row.key === key ? { ...row, ...change } : row)))

  const remainderList = Object.entries(remainders).filter(([id, qty]) => sources.includes(id) && qty.trim())
  const rowsValid = rows.every((row) => row.item && WEIGHT_RE.test(row.quantity.trim()) && Number(row.quantity) > 0 && row.parents.length > 0)
  const remaindersValid = remainderList.every(([, qty]) => WEIGHT_RE.test(qty.trim()) && Number(qty) > 0)
  const canSave = !!warehouse && !!vendorId && (rows.length + remainderList.length) > 0 && rowsValid && remaindersValid && !!receivedOn

  const save = async () => {
    if (!warehouse) return
    setSaving(true)
    setError('')
    try {
      const result = await trackingApi<{ receipt: OutputReceipt; units: TrackingUnit[] }>('outputs', {
        method: 'POST',
        body: {
          company_id: warehouse.company_id, warehouse_id: warehouse.id, vendor_id: vendorId, dispatch_id: dispatchId || null,
          received_on: receivedOn, note,
          outputs: rows.map((row) => ({
            item_master_id: row.item?.id, size_label: row.size_label, quantity: row.quantity.trim(),
            weight_basis: row.weighed ? 'weighed' : 'estimated', parents: row.parents,
          })),
          remainders: remainderList.map(([parent, quantity]) => ({ parent, quantity: quantity.trim(), weight_basis: 'weighed' })),
          used_up: sources.filter((id) => usedUp[id] && !remainders[id]?.trim()),
        },
      })
      setCreated(result)
    } catch (err) {
      setError(errorText(err))
    }
    setSaving(false)
  }

  if (created) {
    return (
      <div className="space-y-4">
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Receipt <Link href={`/tracking/outputs/${created.receipt.id}`} className="font-mono text-blue-600 hover:underline">{created.receipt.receipt_no}</Link> saved
          </h2>
          <p className="text-sm text-gray-600">Print the labels, then put each bundle away from Put Away &amp; Move.</p>
          <LabelPrintPanel units={created.units} />
        </section>
        <button type="button" onClick={() => { setCreated(null); setRows([]); setRemainders({}); setVendorId(''); setCandidates(null) }} className={quiet}>Receive more</button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {canReceive && (
        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Receive outputs from a vendor</h2>
            <p className="text-sm text-gray-600">Weigh each processed bundle as it arrives. Each output keeps a link to the bundles it was made from, and lists all their purchase lines.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Arriving at</span>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={field}>
                <option value="">Choose</option>
                {options.warehouses.map((w) => <option key={w.id} value={w.id}>{w.company_name} · {w.name}</option>)}
              </select>
            </label>
            <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">From vendor</span>
              <VendorSelect vendors={options.vendors} value={vendorId} onChange={setVendorId} />
            </label>
            <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Received on</span>
              <DateInput value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className={field} />
            </label>
          </div>

          {candidates && units.length === 0 && <p className="text-sm text-gray-600">This vendor holds no labelled bundles for this company.</p>}

          {units.length > 0 && (
            <>
              {candidates && candidates.dispatches.length > 0 && (
                <label className="block max-w-sm text-sm text-gray-700"><span className="mb-1 block font-medium">Sent on dispatch</span>
                  <select value={dispatchId} onChange={(e) => chooseDispatch(e.target.value)} className={field}>
                    <option value="">Any dispatch</option>
                    {candidates.dispatches.map((d) => <option key={d.id} value={d.id}>{d.dispatch_no}{d.job_work_reference ? ` · ${d.job_work_reference}` : ''}</option>)}
                  </select>
                </label>
              )}

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Used</th>
                      <th className="px-3 py-2">Bundle at the vendor</th>
                      <th className="px-3 py-2 text-right">Sent</th>
                      <th className="px-3 py-2">Remainder back (optional)</th>
                      <th className="px-3 py-2">Used up</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {units.map((unit) => {
                      const on = sources.includes(unit.id)
                      const remainder = remainders[unit.id] ?? ''
                      return (
                        <tr key={unit.id} className={on ? '' : 'text-gray-400'}>
                          <td className="px-3 py-2"><input type="checkbox" aria-label={`Use ${unit.stock_tracking_id}`} checked={on} onChange={() => toggleSource(unit.id)} /></td>
                          <td className="px-3 py-2">
                            <span className="font-mono">{unit.stock_tracking_id}</span>
                            <span className="ml-2">{unit.item_code} {unit.item_name} {unit.size_label}</span>
                            <span className="block text-xs text-gray-500">{unit.purchase_line_id ?? `Mixed lines (${unit.receipt_no})`}</span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right">{unit.quantity} {unit.unit}</td>
                          <td className="px-3 py-2">
                            <input inputMode="decimal" disabled={!on} value={remainder} placeholder="0.000"
                              onChange={(e) => setRemainders((all) => ({ ...all, [unit.id]: e.target.value }))}
                              className="w-28 rounded border border-gray-300 px-2 py-1 text-right font-mono disabled:bg-gray-50" />
                          </td>
                          <td className="px-3 py-2">
                            <input type="checkbox" aria-label={`${unit.stock_tracking_id} used up`} disabled={!on || !!remainder.trim()}
                              checked={on && (!!remainder.trim() || !!usedUp[unit.id])}
                              onChange={(e) => setUsedUp((all) => ({ ...all, [unit.id]: e.target.checked }))} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500">A bundle with a remainder is always used up: the remainder gets its own label. Untick Used up for a bundle that will feed later outputs too.</p>

              <div className="space-y-3">
                <h3 className="font-semibold text-gray-900">Outputs</h3>
                {rows.map((row, index) => (
                  <div key={row.key} className="space-y-2 rounded-lg border border-gray-200 p-3">
                    <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                      <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Output {index + 1} item</span>
                        <ItemPicker row={row} onSearch={(text) => updateRow(row.key, { search: text, item: null })}
                          onPick={(item) => updateRow(row.key, { item, search: '', size_label: row.size_label || item.size_label || '' })} />
                      </label>
                      <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Size</span>
                        <input value={row.size_label} onChange={(e) => updateRow(row.key, { size_label: e.target.value })} className={field} />
                      </label>
                      <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Weight</span>
                        <input inputMode="decimal" value={row.quantity} onChange={(e) => updateRow(row.key, { quantity: e.target.value })} className={`${field} text-right font-mono`} />
                      </label>
                      <button type="button" aria-label={`Remove output ${index + 1}`} onClick={() => setRows((all) => all.filter((r) => r.key !== row.key))} className="self-end rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-gray-600">
                      <input type="checkbox" checked={!row.weighed} onChange={(e) => updateRow(row.key, { weighed: !e.target.checked })} /> Weight is estimated, not weighed
                    </label>
                    <div className="text-sm text-gray-700">
                      <span className="font-medium">Made from</span>
                      <span className="ml-2 inline-flex flex-wrap gap-2">
                        {sourceUnits.map((unit) => (
                          <label key={unit.id} className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-0.5 font-mono text-xs">
                            <input type="checkbox" checked={row.parents.includes(unit.id)}
                              onChange={(e) => updateRow(row.key, { parents: e.target.checked ? [...row.parents, unit.id] : row.parents.filter((p) => p !== unit.id) })} />
                            {unit.stock_tracking_id}
                          </label>
                        ))}
                        {sourceUnits.length === 0 && <span className="text-xs text-red-600">Tick the bundles used above first.</span>}
                      </span>
                    </div>
                  </div>
                ))}
                <button type="button" disabled={sources.length === 0} onClick={addRow} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  <Plus className="h-4 w-4" /> Add an output
                </button>
              </div>

              <label className="block text-sm text-gray-700"><span className="mb-1 block font-medium">Note (optional)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} className={field} />
              </label>
              <button type="button" disabled={saving || !canSave} onClick={save} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save and create labels'}
              </button>
            </>
          )}
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search receipt, vendor, dispatch or job work order" className="min-w-64 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </div>
      {receipts === null && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {receipts?.length === 0 && <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">No output receipts yet.</p>}
      {!!receipts?.length && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Receipt</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3 text-right">Outputs</th>
                <th className="px-4 py-3 text-right">Remainders</th>
                <th className="px-4 py-3">Job work order</th>
                <th className="px-4 py-3">Received</th>
                <th className="px-4 py-3">Saved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {receipts.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono"><Link href={`/tracking/outputs/${r.id}`} className="text-blue-600 hover:underline">{r.receipt_no}</Link></td>
                  <td className="px-4 py-3 text-gray-700">{r.vendor_name}</td>
                  <td className="px-4 py-3 text-right text-gray-900">{r.output_count}</td>
                  <td className="px-4 py-3 text-right text-gray-900">{r.remainder_count}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{r.job_work_reference ?? 'Not linked'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{r.received_on}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatWhen(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
