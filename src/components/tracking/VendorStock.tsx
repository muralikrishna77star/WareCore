'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { VendorMove } from '@/lib/tracking/constants'
import type { VendorStockEntry } from '@/lib/tracking/jobwork'
import { errorText, formatWhen, trackingApi } from './api'
import { VendorSelect, type JobWorkOptions } from './Dispatches'
import { formatDate } from '@/lib/dates'

interface Data {
  stock: VendorStockEntry[]
  moves: VendorMove[]
  vendors: JobWorkOptions['vendors']
}

interface Transfer {
  id: string
  transfer_number: string
  transfer_date: string
  quantity: string
}

const field = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm'
const quiet = 'rounded border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50 disabled:opacity-50'

const parseWhen = (value: string) => Date.parse(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'))
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

export function VendorStock({ canOperate }: { canOperate: boolean }) {
  const [data, setData] = useState<Data | null>(null)
  const [loadedAt, setLoadedAt] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [moveForm, setMoveForm] = useState<{ key: string; to: string; on: string; reason: string } | null>(null)
  const [linking, setLinking] = useState<{ moveId: string; search: string; transfers: Transfer[] | null } | null>(null)

  const fetchData = useCallback(() => trackingApi<Data>('vendors'), [])

  const load = useCallback(async () => {
    try {
      setData(await fetchData())
      setLoadedAt(Date.now())
    } catch (err) {
      setError(errorText(err))
    }
  }, [fetchData])

  useEffect(() => {
    let current = true
    fetchData()
      .then((result) => { if (current) { setData(result); setLoadedAt(Date.now()) } })
      .catch((err) => { if (current) setError(errorText(err)) })
    return () => { current = false }
  }, [fetchData])

  const post = async (body: Record<string, unknown>, done: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await trackingApi('vendors', { method: 'POST', body })
      setNotice(done)
      await load()
      return true
    } catch (err) {
      setError(errorText(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  const days = (since: string | null) => (since && loadedAt ? Math.max(0, Math.floor((loadedAt - parseWhen(since)) / 86_400_000)) : null)

  const toggle = (key: string, unitId: string) => setSelected((all) => {
    const list = all[key] ?? []
    return { ...all, [key]: list.includes(unitId) ? list.filter((id) => id !== unitId) : [...list, unitId] }
  })

  const findTransfers = async () => {
    if (!linking) return
    try {
      const result = await trackingApi<{ transfers: Transfer[] }>(`vendors?move=${linking.moveId}&transfers=${encodeURIComponent(linking.search)}`)
      setLinking({ ...linking, transfers: result.transfers })
    } catch (err) {
      setError(errorText(err))
    }
  }

  if (!data) return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-gray-500">Loading…</p>

  const unlinkedMoves = data.moves.filter((m) => !m.job_work_transfer_id)

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}

      <p className="text-sm text-gray-600">
        Bundles at each job work vendor, beside the book vendor balance for the same item and size. The book figure uses the same
        vendor movement rules as the Stock Statement. Nothing here changes stock.
      </p>

      {data.stock.length === 0 && <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">No labelled bundles are at a vendor.</p>}

      {data.stock.map((entry) => {
        const key = `${entry.company_id}|${entry.vendor_id}`
        const chosen = selected[key] ?? []
        const oldest = days(entry.oldest_since)
        return (
          <section key={key} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-gray-900">{entry.vendor_name}</h2>
              <p className="text-sm text-gray-600">
                {entry.company_name} · {entry.bundle_count} {entry.bundle_count === 1 ? 'bundle' : 'bundles'}, {entry.total_quantity}
                {oldest !== null && ` · oldest there ${oldest} ${oldest === 1 ? 'day' : 'days'}`}
              </p>
            </div>

            {entry.warnings.map((warning) => (
              <p key={warning} className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
                <TriangleAlert className="h-4 w-4 shrink-0" /> {warning}
              </p>
            ))}

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Item and size</th>
                    <th className="px-3 py-2 text-right">Bundles</th>
                    <th className="px-3 py-2 text-right">Bundle weight</th>
                    <th className="px-3 py-2 text-right">Book at vendor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {entry.groups.map((group) => {
                    const above = Number(group.bundle_quantity) > Number(group.book_quantity ?? 0)
                    return (
                      <tr key={`${group.material_type_id}|${group.size_label}`}>
                        <td className="px-3 py-2 text-gray-800">{group.label} {group.size_label}</td>
                        <td className="px-3 py-2 text-right text-gray-900">{group.bundle_count}</td>
                        <td className={`whitespace-nowrap px-3 py-2 text-right font-medium ${above ? 'text-amber-800' : 'text-gray-900'}`}>{group.bundle_quantity} {group.unit}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-gray-700">{group.book_quantity ?? '0.000'} {group.unit}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <details>
              <summary className="cursor-pointer text-sm font-medium text-blue-600">Show the {entry.bundle_count} {entry.bundle_count === 1 ? 'bundle' : 'bundles'}</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                      {canOperate && <th className="px-3 py-2"><span className="sr-only">Choose</span></th>}
                      <th className="px-3 py-2">Tracking ID</th>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Weight</th>
                      <th className="px-3 py-2">Dispatch</th>
                      <th className="px-3 py-2">Order</th>
                      <th className="px-3 py-2 text-right">Days</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {entry.units.map((unit) => (
                      <tr key={unit.id}>
                        {canOperate && (
                          <td className="px-3 py-2">
                            <input type="checkbox" aria-label={`Choose ${unit.stock_tracking_id}`} disabled={!!unit.on_pickup}
                              checked={chosen.includes(unit.id)} onChange={() => toggle(key, unit.id)} />
                          </td>
                        )}
                        <td className="whitespace-nowrap px-3 py-2 font-mono"><Link href={`/tracking/units/${unit.id}`} className="text-blue-600 hover:underline">{unit.stock_tracking_id}</Link></td>
                        <td className="px-3 py-2 text-gray-700">
                          {unit.item_code} {unit.item_name} {unit.size_label}
                          {unit.on_pickup && <span className="block text-xs text-amber-700">On pickup {unit.on_pickup}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-gray-900">{unit.quantity} {unit.unit}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-700">{unit.dispatch_no}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-700">{unit.job_work_reference ?? (unit.dispatch_no ? 'Not linked' : '')}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{days(unit.at_vendor_since)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {canOperate && chosen.length > 0 && (
                <div className="mt-3 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  {moveForm?.key !== key ? (
                    <button type="button" onClick={() => setMoveForm({ key, to: '', on: istToday(), reason: '' })} className={quiet}>
                      Move {chosen.length} {chosen.length === 1 ? 'bundle' : 'bundles'} to another vendor
                    </button>
                  ) : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">New vendor</span>
                          <VendorSelect vendors={data.vendors} value={moveForm.to} exclude={entry.vendor_id} onChange={(to) => setMoveForm({ ...moveForm, to })} />
                        </label>
                        <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Moved on</span>
                          <input type="date" value={moveForm.on} onChange={(e) => setMoveForm({ ...moveForm, on: e.target.value })} className={field} />
                        </label>
                        <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Reason (optional)</span>
                          <input value={moveForm.reason} onChange={(e) => setMoveForm({ ...moveForm, reason: e.target.value })} className={field} />
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy || !moveForm.to || !moveForm.on}
                          onClick={async () => {
                            if (await post({ action: 'move', unit_ids: chosen, to_vendor_id: moveForm.to, moved_on: moveForm.on, reason: moveForm.reason }, `${chosen.length} moved`)) {
                              setMoveForm(null)
                              setSelected((all) => ({ ...all, [key]: [] }))
                            }
                          }}
                          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          Move
                        </button>
                        <button type="button" onClick={() => setMoveForm(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </details>
          </section>
        )
      })}

      {data.moves.length > 0 && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-gray-900">Moves between vendors</h2>
          {unlinkedMoves.length > 0 && <p className="text-sm text-gray-600">{unlinkedMoves.length} {unlinkedMoves.length === 1 ? 'move has' : 'moves have'} no WareCore transfer linked yet.</p>}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Bundle</th>
                  <th className="px-3 py-2">From</th>
                  <th className="px-3 py-2">To</th>
                  <th className="px-3 py-2">Moved on</th>
                  <th className="px-3 py-2">Transfer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.moves.map((move) => (
                  <tr key={move.id}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono"><Link href={`/tracking/units/${move.tracking_unit_id}`} className="text-blue-600 hover:underline">{move.stock_tracking_id}</Link></td>
                    <td className="px-3 py-2 text-gray-700">{move.from_vendor_name}</td>
                    <td className="px-3 py-2 text-gray-700">{move.to_vendor_name}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700" title={formatWhen(move.created_at)}>{move.moved_on}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {move.transfer_number ?? (canOperate
                        ? <button type="button" onClick={() => setLinking({ moveId: move.id, search: '', transfers: null })} className={quiet}>Link transfer</button>
                        : 'Not linked')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {linking && (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="flex max-w-md gap-2">
                <input value={linking.search} onChange={(e) => setLinking({ ...linking, search: e.target.value })} placeholder="Search transfer number" className={field} />
                <button type="button" onClick={findTransfers} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Find</button>
                <button type="button" onClick={() => setLinking(null)} className="px-2 text-sm text-gray-600 hover:underline">Close</button>
              </div>
              {linking.transfers?.length === 0 && <p className="text-sm text-gray-600">No transfers between these two vendors were found.</p>}
              {!!linking.transfers?.length && (
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                  {linking.transfers.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="text-gray-800">{t.transfer_number} · {formatDate(t.transfer_date)} · {t.quantity}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => { if (await post({ action: 'link_transfer', move_id: linking.moveId, transfer_id: t.id }, 'Transfer linked')) setLinking(null) }}
                        className={quiet}
                      >
                        Link
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
