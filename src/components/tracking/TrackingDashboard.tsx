'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { LIFECYCLE_LABELS, type LifecycleStatus } from '@/lib/tracking/constants'
import type { DashboardFigures } from '@/lib/tracking/reportDefs'
import { errorText, trackingApi } from './api'
import { WarehouseFilter } from './WarehouseFilter'

/** Statuses a bundle can be in today. Picked up, split and processed bundles are history. */
const LIVE: LifecycleStatus[] = ['LABELLED', 'IN_STOCK', 'ON_HOLD', 'ON_PICKUP', 'READY', 'AT_VENDOR', 'MISSING', 'LEFT_WAREHOUSE']

const days = (n: number | null) => (n == null ? '' : n === 1 ? '1 day' : `${n} days`)
const hours = (n: number | null) => (n == null ? '' : n < 24 ? `${n} h` : days(Math.floor(n / 24)))

function Tile({ title, value, sub, href, tone = 'plain' }: {
  title: string
  value: string | number
  sub?: string
  href: string
  tone?: 'plain' | 'warn' | 'good'
}) {
  const ring = tone === 'warn' ? 'border-amber-300 bg-amber-50' : tone === 'good' ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'
  return (
    <Link href={href} className={`block rounded-xl border p-4 transition-shadow hover:shadow-sm ${ring}`}>
      <p className="text-sm font-medium text-gray-600">{title}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
    </Link>
  )
}

export function TrackingDashboard() {
  const [warehouseId, setWarehouseId] = useState('')
  const [figures, setFigures] = useState<DashboardFigures | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    trackingApi<DashboardFigures>(`dashboard${warehouseId ? `?warehouse_id=${warehouseId}` : ''}`)
      .then((data) => { if (current) { setFigures(data); setError('') } })
      .catch((err) => { if (current) setError(errorText(err)) })
    return () => { current = false }
  }, [warehouseId])

  const reportHref = (key: string) => `/reports/tracking/${key}${warehouseId ? `?warehouse_id=${warehouseId}` : ''}`

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WarehouseFilter value={warehouseId} onChange={setWarehouseId} />
        <Link href="/reports/tracking" className="text-sm font-medium text-blue-600 hover:underline">All tracking reports</Link>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!figures && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {figures && !figures.enabled && (
        <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
          QR tracking is not switched on for any warehouse you can see. An admin can switch it on in Settings.
        </p>
      )}
      {figures && figures.enabled && (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Needs action</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile
                title="Not put away"
                value={figures.notPutAway.bundles}
                sub={figures.notPutAway.bundles ? `oldest ${days(figures.notPutAway.oldestDays) || 'today'}` : 'every labelled bundle is on a location'}
                href="/tracking/stock"
                tone={figures.notPutAway.bundles ? 'warn' : 'plain'}
              />
              <Tile
                title="Pickups waiting"
                value={figures.pickups.ready}
                sub={`${figures.pickups.ready ? `ready, oldest waiting ${hours(figures.pickups.oldestReadyHours)}` : 'none ready'} · ${figures.pickups.open} being loaded`}
                href="/tracking/pickups"
                tone={figures.pickups.ready ? 'warn' : 'plain'}
              />
              <Tile
                title="Stock counts"
                value={figures.counts.waiting}
                sub={`waiting for decisions · ${figures.counts.open} open`}
                href="/tracking/counts"
                tone={figures.counts.waiting ? 'warn' : 'plain'}
              />
              <Tile
                title="Sync problems"
                value={figures.syncProblems}
                sub="offline scans refused and not yet reviewed"
                href="/tracking/sync-problems"
                tone={figures.syncProblems ? 'warn' : 'plain'}
              />
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Bundles by status</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {LIVE.map((status) => {
                const row = figures.statuses.find((s) => s.status === status)
                return (
                  <Tile
                    key={status}
                    title={LIFECYCLE_LABELS[status]}
                    value={row?.bundles ?? 0}
                    sub={row ? `${row.quantity} total weight` : undefined}
                    href={`/tracking/units?status=${status}`}
                    tone={(status === 'MISSING' || status === 'ON_HOLD') && row ? 'warn' : 'plain'}
                  />
                )
              })}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Labelled share of book stock</h2>
              <Link href={reportHref('tracked-vs-book')} className="block rounded-xl border border-gray-200 bg-white p-4 hover:shadow-sm">
                <p className="text-2xl font-semibold tabular-nums text-gray-900">
                  {figures.share.percentSinceLive == null ? 'No stock yet' : `${figures.share.percentSinceLive}%`}
                </p>
                <p className="text-sm text-gray-600">of stock received since the Live Date ({figures.share.bookSinceLive} on the books)</p>
                <p className="mt-2 text-xs text-gray-500">
                  {figures.share.tracked} labelled in the yard against {figures.share.book} total book stock
                  {figures.share.percent == null ? '' : ` (${figures.share.percent}%)`}. Older stock is labelled only when verified.
                </p>
              </Link>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Labels</h2>
              <div className="grid grid-cols-2 gap-3">
                <Tile title="Printed today" value={figures.labels.printedToday} href="/tracking/receive" />
                <Tile title="Failed prints" value={figures.labels.failed} sub="last print failed" href={reportHref('exceptions')} tone={figures.labels.failed ? 'warn' : 'plain'} />
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">At vendors</h2>
              {figures.vendors.length === 0 ? (
                <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">No labelled bundles are at a vendor.</p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                      <tr><th className="px-4 py-2">Vendor</th><th className="px-4 py-2 text-right">Bundles</th><th className="px-4 py-2 text-right">Weight</th><th className="px-4 py-2 text-right">Longest stay</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {figures.vendors.map((v) => (
                        <tr key={v.vendor_name}>
                          <td className="px-4 py-2"><Link href="/tracking/vendors" className="text-blue-600 hover:underline">{v.vendor_name}</Link></td>
                          <td className="px-4 py-2 text-right tabular-nums">{v.bundles}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{v.quantity}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{days(v.oldestDays) || 'today'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Open warnings</h2>
              {figures.warnings.length === 0 ? (
                <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">Nothing needs checking.</p>
              ) : (
                <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white text-sm">
                  {figures.warnings.map((w) => (
                    <li key={w.kind}>
                      <Link href={reportHref('exceptions')} className="flex justify-between px-4 py-2 hover:bg-gray-50">
                        <span className="text-gray-800">{w.kind}</span>
                        <span className="font-semibold tabular-nums text-amber-700">{w.count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
