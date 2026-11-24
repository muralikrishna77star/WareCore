'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { LIFECYCLE_LABELS } from '@/lib/tracking/constants'
import {
  MAX_SYNC_BATCH, SNAPSHOT_REFRESH_MS,
  type OfflineAction, type OfflineActionPayload, type OfflineActionType, type OfflineResult, type OfflineSnapshot,
  type SnapshotLocation, type SnapshotUnit,
} from '@/lib/tracking/offlineShared'
import * as store from '@/lib/tracking/offlineStore'
import { ScanInput } from './ScanInput'
import { formatDateTime } from '@/lib/dates'

type Mode = 'place' | 'pickup' | 'dispatch' | 'count' | 'lookup'
type SendState = 'idle' | 'sending' | 'offline' | 'signin' | 'other' | 'off' | 'error'

interface CurrentCount {
  id: string
  warehouse_id: string
  location_code: string
  codes: string[]
}

interface Message {
  tone: 'ok' | 'error' | 'info'
  text: string
}

const MODES: { key: Mode; label: string }[] = [
  { key: 'place', label: 'Put away / move' },
  { key: 'pickup', label: 'Pickup' },
  { key: 'dispatch', label: 'Vendor dispatch' },
  { key: 'count', label: 'Stock count' },
  { key: 'lookup', label: 'Look up' },
]

const SEND_WORDS: Record<SendState, string> = {
  idle: '',
  sending: 'Sending…',
  offline: 'No signal. Scans are saved on this phone and sent when the signal returns.',
  signin: 'Your sign-in has expired. Sign in again on this phone to send the saved scans.',
  other: 'Some saved scans belong to another person. They are sent only while that person is signed in on this phone.',
  off: 'QR tracking is switched off, so saved scans cannot be sent.',
  error: 'The server could not take the scans just now. They are kept and will be sent again.',
}

// Online status that stays correct through hydration of a page served from the phone's cache.
const subscribeOnline = (callback: () => void) => {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}
const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)

const parseServerTime = (value: string) => Date.parse(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'))
const clock = (iso: string) => formatDateTime(iso)

function findUnit(snapshot: OfflineSnapshot, raw: string): SnapshotUnit | undefined {
  const code = raw.trim().toUpperCase()
  return snapshot.units.find((u) => u.qr_reference === code || u.stock_tracking_id === code)
}

function findLocation(snapshot: OfflineSnapshot, raw: string): SnapshotLocation | undefined {
  const code = raw.trim().toUpperCase()
  return snapshot.locations.find((l) => l.location_ref === code || l.code === code)
}

/** Never rejects: a scan goes ahead without a position when there is none. GPS needs no signal. */
function readPosition(): Promise<OfflineActionPayload['position']> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return }
    navigator.geolocation.getCurrentPosition(
      (fix) => resolve({ latitude: fix.coords.latitude, longitude: fix.coords.longitude, accuracy_m: fix.coords.accuracy ?? null }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 30_000 },
    )
  })
}

const unitWords = (u: SnapshotUnit) =>
  `${u.stock_tracking_id} · ${[u.item_code, u.size_label].filter(Boolean).join(' ')} · ${u.quantity} ${u.unit}`

export function OfflineScan() {
  const online = useOnline()
  const [loaded, setLoaded] = useState(false)
  const [storageError, setStorageError] = useState('')
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null)
  const [clockOffsetMin, setClockOffsetMin] = useState(0)
  const [mode, setMode] = useState<Mode>('place')
  const [queue, setQueue] = useState<store.QueuedAction[]>([])
  const [attention, setAttention] = useState<store.AttentionItem[]>([])
  const [sendState, setSendState] = useState<SendState>('idle')
  const [message, setMessage] = useState<Message | null>(null)
  const [pendingUnit, setPendingUnit] = useState<SnapshotUnit | null>(null)
  const [pickupId, setPickupId] = useState('')
  const [dispatchId, setDispatchId] = useState('')
  const [count, setCount] = useState<CurrentCount | null>(null)
  const [looked, setLooked] = useState<SnapshotUnit | null>(null)
  const sending = useRef(false)
  const snapshotRef = useRef<OfflineSnapshot | null>(null)

  useEffect(() => { snapshotRef.current = snapshot }, [snapshot])

  const reloadLocal = useCallback(async () => {
    setQueue(await store.queueList())
    setAttention(await store.attentionList())
  }, [])

  const keepSnapshot = useCallback(async (next: OfflineSnapshot) => {
    setSnapshot(next)
    await store.saveSnapshot(next)
  }, [])

  /** Replaces what the phone keeps with the server's current view of the warehouse. */
  const refresh = useCallback(async (warehouseId?: string) => {
    const wanted = warehouseId ?? snapshotRef.current?.warehouse?.id ?? ''
    let res: Response
    try {
      res = await fetch(`/api/tracking/offline/snapshot${wanted ? `?warehouse_id=${wanted}` : ''}`, { cache: 'no-store' })
    } catch {
      return
    }
    if (res.status === 401) { setSendState('signin'); return }
    if (res.status === 404) { setSendState('off'); return }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setMessage({ tone: 'error', text: data.error ?? 'The warehouse could not be loaded' }); return }
    const next = data as OfflineSnapshot
    setClockOffsetMin(Math.round((Date.now() - parseServerTime(next.server_time)) / 60_000))
    await keepSnapshot(next)
    if (next.warehouse) await store.setMeta('warehouse_id', next.warehouse.id)
  }, [keepSnapshot])

  /** Sends this person's saved scans in the order they were scanned, a batch at a time. */
  const sendQueue = useCallback(async () => {
    if (sending.current) return
    sending.current = true
    setSendState('sending')
    let state: SendState = 'idle'
    try {
      const device = await store.deviceId()
      for (;;) {
        const me = snapshotRef.current?.user_id
        const mine = (await store.queueList()).filter((a) => a.actor_id === me)
        if (!me || mine.length === 0) break
        const batch = mine.slice(0, MAX_SYNC_BATCH)
        let res: Response
        try {
          res = await fetch('/api/tracking/offline/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              device_id: device,
              actions: batch.map((a) => ({ id: a.id, action: a.action, scanned_at: a.scanned_at, warehouse_id: a.warehouse_id, actor_id: a.actor_id, payload: a.payload })),
            }),
          })
        } catch {
          state = 'offline'
          break
        }
        if (res.status === 401) { state = 'signin'; break }
        if (res.status === 404) { state = 'off'; break }
        if (res.status === 409) { state = 'other'; break }
        if (!res.ok) { state = 'error'; break }
        const { results } = (await res.json()) as { results: OfflineResult[] }
        const byId = new Map(batch.map((a) => [a.id, a]))
        const refused = results.filter((r) => r.outcome === 'REFUSED').map((r) => ({
          id: r.id,
          summary: byId.get(r.id)?.summary ?? '',
          reason: r.reason ?? 'Refused by the server',
          scanned_at: byId.get(r.id)?.scanned_at ?? new Date().toISOString(),
          refused_at: new Date().toISOString(),
        }))
        if (refused.length) await store.attentionAdd(refused)
        await store.queueRemove(results.map((r) => r.id))
        await reloadLocal()
        // Stop rather than resend forever if the answer named none of the scans sent.
        if (!results.some((r) => byId.has(r.id))) { state = 'error'; break }
      }
    } catch (err) {
      state = 'error'
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Sending failed' })
    } finally {
      sending.current = false
    }
    setSendState(state)
    await reloadLocal()
  }, [reloadLocal])

  // What the phone already holds, then the server's latest when there is a signal.
  useEffect(() => {
    let current = true
    ;(async () => {
      try {
        const warehouseId = await store.getMeta<string>('warehouse_id')
        const saved = await store.loadSnapshot(warehouseId ?? 'none')
        const savedCount = await store.getMeta<CurrentCount>('count')
        if (!current) return
        if (saved) setSnapshot(saved)
        if (savedCount) setCount(savedCount)
        await reloadLocal()
      } catch (err) {
        if (current) setStorageError(err instanceof Error ? err.message : 'This browser cannot keep scans on the phone')
      }
      if (current) setLoaded(true)
    })()
    return () => { current = false }
  }, [reloadLocal])

  // With a signal: send first, so the refreshed snapshot already includes this phone's scans.
  useEffect(() => {
    if (!loaded || !online) return
    let current = true
    ;(async () => {
      await sendQueue()
      if (current) await refresh()
      // The camera decoder loads on first use; load it now so the camera also works without a signal.
      import('@zxing/browser').catch(() => {})
    })()
    const timer = setInterval(() => { void sendQueue().then(() => refresh()) }, SNAPSHOT_REFRESH_MS)
    return () => { current = false; clearInterval(timer) }
  }, [loaded, online, sendQueue, refresh])

  const say = (tone: Message['tone'], text: string) => setMessage({ tone, text })

  const patchUnit = async (id: string, changes: Partial<SnapshotUnit>) => {
    const snap = snapshotRef.current
    if (!snap) return
    await keepSnapshot({ ...snap, units: snap.units.map((u) => (u.id === id ? { ...u, ...changes } : u)) })
  }

  const save = async (action: OfflineActionType, payload: OfflineActionPayload, summary: string) => {
    const snap = snapshotRef.current
    if (!snap?.warehouse) return
    const item: OfflineAction = {
      id: crypto.randomUUID(), action, scanned_at: new Date().toISOString(),
      warehouse_id: snap.warehouse.id, actor_id: snap.user_id, payload,
    }
    await store.queueAdd(item, summary)
    await reloadLocal()
    if (navigator.onLine) void sendQueue()
  }

  // ── Scan handlers ─────────────────────────────────────────────────────────

  const onPlaceScan = async (code: string) => {
    if (!snapshot) return
    if (!pendingUnit) {
      const unit = findUnit(snapshot, code)
      if (!unit) { say('error', `${code} is not a bundle of this warehouse, or it was voided. Not saved.`); return }
      setPendingUnit(unit)
      say('info', `${unitWords(unit)}. Now scan the location.`)
      return
    }
    const location = findLocation(snapshot, code)
    if (!location) {
      if (findUnit(snapshot, code)) { say('error', 'That is a bundle label. Scan the location label, or cancel.'); return }
      say('error', `${code} is not an active location of this warehouse. Not saved.`)
      return
    }
    const unit = pendingUnit
    setPendingUnit(null)
    const position = snapshot.gps ? await readPosition() : null
    await save('PLACE', { code: unit.stock_tracking_id, location: location.code, position }, `${unit.stock_tracking_id} to ${location.code}`)
    await patchUnit(unit.id, { location_code: location.code, lifecycle_status: unit.lifecycle_status === 'ON_HOLD' ? 'ON_HOLD' : 'IN_STOCK', current_vendor_name: null })
    say('ok', `Saved: ${unit.stock_tracking_id} to ${location.code}`)
  }

  const onListScan = async (code: string, kind: 'pickup' | 'dispatch') => {
    if (!snapshot) return
    const targetId = kind === 'pickup' ? pickupId : dispatchId
    const target = kind === 'pickup' ? snapshot.pickups.find((p) => p.id === targetId) : snapshot.dispatches.find((d) => d.id === targetId)
    if (!target) { say('error', `Choose the ${kind === 'pickup' ? 'pickup' : 'vendor dispatch'} first`); return }
    const unit = findUnit(snapshot, code)
    if (!unit) { say('error', `${code} is not a bundle of this warehouse, or it was voided. Not saved.`); return }
    const number = 'pickup_no' in target ? target.pickup_no : target.dispatch_no
    await save(kind === 'pickup' ? 'ADD_TO_PICKUP' : 'ADD_TO_DISPATCH',
      kind === 'pickup' ? { code: unit.stock_tracking_id, pickup_id: target.id } : { code: unit.stock_tracking_id, dispatch_id: target.id },
      `${unit.stock_tracking_id} onto ${number}`)
    if (kind === 'pickup') await patchUnit(unit.id, { lifecycle_status: 'ON_PICKUP' })
    say('ok', `Saved: ${unit.stock_tracking_id} onto ${number}`)
  }

  const keepCount = async (next: CurrentCount | null) => {
    setCount(next)
    if (next) await store.setMeta('count', next)
    else await store.deleteMeta('count')
  }

  const onCountScan = async (code: string) => {
    if (!snapshot?.warehouse) return
    if (!count) {
      const location = findLocation(snapshot, code)
      if (!location) { say('error', `${code} is not an active location of this warehouse. Scan a location label to start.`); return }
      const id = crypto.randomUUID()
      await save('COUNT_START', { count_id: id, location: location.code }, `Count started at ${location.code}`)
      await keepCount({ id, warehouse_id: snapshot.warehouse.id, location_code: location.code, codes: [] })
      say('ok', `Count started at ${location.code}. Scan every bundle on it.`)
      return
    }
    const unit = findUnit(snapshot, code)
    const key = unit?.stock_tracking_id ?? code.trim().toUpperCase()
    if (count.codes.includes(key)) { say('info', `${key} is already counted`); return }
    if (findLocation(snapshot, code)) { say('error', 'That is a location label. Scan the bundles, then finish the count.'); return }
    await save('COUNT_SCAN', { count_id: count.id, code: key }, `Counted ${key} at ${count.location_code}`)
    await keepCount({ ...count, codes: [...count.codes, key] })
    say(unit ? 'ok' : 'info', unit ? `Counted ${unitWords(unit)}` : `Counted ${key}. It is not a bundle of this warehouse; it will be listed as an unknown label.`)
  }

  const finishCount = async () => {
    if (!count) return
    await save('COUNT_SUBMIT', { count_id: count.id }, `Count at ${count.location_code} finished, ${count.codes.length} scanned`)
    say('ok', `Count at ${count.location_code} finished. A manager reviews any differences on Stock Counts.`)
    await keepCount(null)
  }

  const resumeCount = async (id: string, locationCode: string) => {
    if (!snapshot?.warehouse) return
    await keepCount({ id, warehouse_id: snapshot.warehouse.id, location_code: locationCode, codes: [] })
    say('info', `Continuing the count at ${locationCode}. Bundles already counted are counted once.`)
  }

  const onLookup = (code: string) => {
    if (!snapshot) return
    const unit = findUnit(snapshot, code)
    setLooked(unit ?? null)
    if (!unit) say('error', `${code} is not a bundle of this warehouse, or it was voided.`)
    else setMessage(null)
  }

  const dismiss = async (id: string) => {
    await store.attentionRemove(id)
    await reloadLocal()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const mine = queue.filter((a) => a.actor_id === snapshot?.user_id)
  const others = queue.length - mine.length
  const expectedHere = count && snapshot ? snapshot.units.filter((u) => u.location_code === count.location_code) : []
  const countedExpected = count ? expectedHere.filter((u) => count.codes.includes(u.stock_tracking_id)).length : 0
  const sendWords = sendState === 'idle' && !online ? SEND_WORDS.offline : SEND_WORDS[sendState]
  const toneClass = message?.tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : message?.tone === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-blue-200 bg-blue-50 text-blue-800'

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Offline Scan</h1>
          <p className="text-xs text-gray-500">{snapshot?.user_name ? `Signed in as ${snapshot.user_name}` : 'Scans are saved on this phone and sent when there is a signal'}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${online ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>
            {online ? 'Online' : 'No signal'}
          </span>
          <Link href="/tracking/dashboard" className="text-sm text-blue-600 hover:underline">Back</Link>
        </div>
      </header>

      {storageError && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{storageError}. Use the normal tracking screens instead.</p>}

      {loaded && !snapshot && (
        <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
          {online ? 'Loading your warehouse…' : 'This phone has no saved warehouse yet. Open this screen once with a signal, then it works without one.'}
        </p>
      )}

      {snapshot && snapshot.warehouses.length === 0 && (
        <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">QR tracking is not switched on for any warehouse you can scan in.</p>
      )}

      {snapshot && snapshot.warehouses.length > 0 && (
        <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Warehouse"
              value={snapshot.warehouse?.id ?? ''}
              disabled={!online}
              onChange={(e) => { setPendingUnit(null); void refresh(e.target.value) }}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2"
            >
              {!snapshot.warehouse && <option value="">Choose a warehouse</option>}
              {snapshot.warehouses.map((w) => <option key={w.id} value={w.id}>{w.company_name}: {w.name}</option>)}
            </select>
            <button type="button" disabled={!online} onClick={() => void sendQueue().then(() => refresh())} className="rounded-lg border border-gray-300 px-3 py-2 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Refresh
            </button>
          </div>
          {snapshot.warehouse && (
            <p className="text-xs text-gray-500">
              {snapshot.units.length} bundles and {snapshot.locations.length} locations kept on this phone, as of {clock(new Date(parseServerTime(snapshot.server_time)).toISOString())}
            </p>
          )}
          {Math.abs(clockOffsetMin) >= 10 && (
            <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              This phone&apos;s clock is {Math.abs(clockOffsetMin)} minutes {clockOffsetMin > 0 ? 'ahead' : 'behind'}. Correct the phone time: scans more than 10 minutes ahead are refused.
            </p>
          )}
        </section>
      )}

      {(queue.length > 0 || sendWords) && (
        <section className="space-y-1 rounded-lg border border-gray-200 bg-white p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-gray-900">{mine.length === 0 ? 'All your scans are sent' : `${mine.length} ${mine.length === 1 ? 'scan' : 'scans'} waiting to send`}</p>
            {mine.length > 0 && (
              <button type="button" disabled={!online || sendState === 'sending'} onClick={() => void sendQueue()} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                Send now
              </button>
            )}
          </div>
          {sendWords && <p className="text-xs text-gray-600">{sendWords}</p>}
          {sendState === 'signin' && <Link href="/login" className="text-xs font-semibold text-blue-600 hover:underline">Sign in again</Link>}
          {others > 0 && <p className="text-xs text-gray-600">{others} {others === 1 ? 'scan' : 'scans'} saved by another person on this phone wait for them to sign in.</p>}
        </section>
      )}

      {snapshot?.warehouse && (
        <>
          <nav className="flex gap-1 overflow-x-auto rounded-lg bg-gray-100 p-1 text-sm">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => { setMode(m.key); setPendingUnit(null); setMessage(null) }}
                className={`whitespace-nowrap rounded-md px-3 py-2 font-medium ${mode === m.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'}`}
              >
                {m.label}
              </button>
            ))}
          </nav>

          <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
            {mode === 'place' && (
              <>
                <p className="text-sm text-gray-600">Scan a bundle, then the location it is going to. A bundle back from a vendor is taken back the same way.</p>
                <ScanInput
                  id="offline-place"
                  label={pendingUnit ? `Scan the location for ${pendingUnit.stock_tracking_id}` : 'Scan a bundle'}
                  buttonLabel={pendingUnit ? 'Place' : 'Find'}
                  autoFocus
                  onScan={onPlaceScan}
                />
                {pendingUnit && (
                  <div className="flex items-center justify-between gap-2 rounded bg-gray-50 p-2 text-xs text-gray-700">
                    <span>{unitWords(pendingUnit)} · {LIFECYCLE_LABELS[pendingUnit.lifecycle_status]}{pendingUnit.location_code ? ` at ${pendingUnit.location_code}` : ''}</span>
                    <button type="button" onClick={() => setPendingUnit(null)} className="text-blue-600 hover:underline">Cancel</button>
                  </div>
                )}
              </>
            )}

            {mode === 'pickup' && (
              <>
                <select value={pickupId} onChange={(e) => setPickupId(e.target.value)} aria-label="Pickup" className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                  <option value="">{snapshot.pickups.length ? 'Choose an open pickup' : 'No open pickups. Open one with a signal first.'}</option>
                  {snapshot.pickups.map((p) => <option key={p.id} value={p.id}>{p.pickup_no}: {p.customer_name}</option>)}
                </select>
                <ScanInput id="offline-pickup" label="Scan each bundle onto the pickup" buttonLabel="Add" onScan={(code) => onListScan(code, 'pickup')} />
                <p className="text-xs text-gray-500">Marking ready and handing over need a signal.</p>
              </>
            )}

            {mode === 'dispatch' && (
              <>
                <select value={dispatchId} onChange={(e) => setDispatchId(e.target.value)} aria-label="Vendor dispatch" className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                  <option value="">{snapshot.dispatches.length ? 'Choose an open vendor dispatch' : 'No open dispatches. Start one with a signal first.'}</option>
                  {snapshot.dispatches.map((d) => <option key={d.id} value={d.id}>{d.dispatch_no}: {d.vendor_name}</option>)}
                </select>
                <ScanInput id="offline-dispatch" label="Scan each bundle as it is loaded" buttonLabel="Add" onScan={(code) => onListScan(code, 'dispatch')} />
                <p className="text-xs text-gray-500">Marking the dispatch sent needs a signal.</p>
              </>
            )}

            {mode === 'count' && (
              <>
                {!count ? (
                  <>
                    <ScanInput id="offline-count-start" label="Scan the location to count" buttonLabel="Start" onScan={onCountScan} />
                    {snapshot.counts.length > 0 && (
                      <div className="space-y-1 text-xs text-gray-700">
                        <p>Your open counts:</p>
                        {snapshot.counts.map((c) => (
                          <button key={c.id} type="button" onClick={() => void resumeCount(c.id, c.location_code)} className="mr-2 rounded border border-gray-300 px-2 py-1 hover:bg-gray-50">
                            Continue {c.count_no} at {c.location_code}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-gray-900">Counting {count.location_code}</p>
                    <p className="text-xs text-gray-600">
                      {count.codes.length} scanned · {countedExpected} of {expectedHere.length} that this phone expects here
                    </p>
                    <ScanInput id="offline-count" label="Scan every bundle on this location" buttonLabel="Count" autoFocus onScan={onCountScan} />
                    <button type="button" onClick={() => void finishCount()} className="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white">
                      Finish count
                    </button>
                    <p className="text-xs text-gray-500">Finishing changes no bundle. A manager decides on each difference. A count started by mistake can be cancelled on Stock Counts.</p>
                  </>
                )}
              </>
            )}

            {mode === 'lookup' && (
              <>
                <ScanInput id="offline-lookup" label="Scan a bundle to see what this phone knows" onScan={onLookup} />
                {looked && (
                  <dl className="grid grid-cols-2 gap-2 rounded bg-gray-50 p-3 text-sm">
                    <dt className="text-gray-500">Bundle</dt><dd className="font-mono">{looked.stock_tracking_id}</dd>
                    <dt className="text-gray-500">Item</dt><dd>{[looked.item_code, looked.item_name, looked.size_label].filter(Boolean).join(' ')}</dd>
                    <dt className="text-gray-500">Weight</dt><dd>{looked.quantity} {looked.unit}</dd>
                    <dt className="text-gray-500">Status</dt><dd>{LIFECYCLE_LABELS[looked.lifecycle_status]}</dd>
                    <dt className="text-gray-500">{looked.current_vendor_name ? 'Vendor' : 'Location'}</dt><dd className="font-mono">{looked.current_vendor_name ?? looked.location_code ?? 'None'}</dd>
                  </dl>
                )}
              </>
            )}

            {message && <p role="status" className={`rounded border p-2 text-sm ${toneClass}`}>{message.text}</p>}
          </section>
        </>
      )}

      {attention.length > 0 && (
        <section className="space-y-2 rounded-lg border border-red-200 bg-white p-3">
          <h2 className="text-sm font-semibold text-red-800">Needs attention ({attention.length})</h2>
          <p className="text-xs text-gray-600">The server refused these scans, so they were not applied. A manager also sees them on Sync Problems.</p>
          <ul className="divide-y divide-gray-100 text-sm">
            {attention.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-2 py-2">
                <div>
                  <p className="font-medium text-gray-900">{item.summary}</p>
                  <p className="text-xs text-red-700">{item.reason}</p>
                  <p className="text-xs text-gray-500">Scanned {clock(item.scanned_at)}</p>
                </div>
                <button type="button" onClick={() => void dismiss(item.id)} className="text-xs text-blue-600 hover:underline">Dismiss</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {mine.length > 0 && (
        <section className="space-y-1 rounded-lg border border-gray-200 bg-white p-3">
          <h2 className="text-sm font-semibold text-gray-900">Waiting to send</h2>
          <ul className="space-y-1 text-xs text-gray-700">
            {mine.slice(-20).reverse().map((a) => <li key={a.id}>{clock(a.scanned_at)} · {a.summary}</li>)}
          </ul>
          {mine.length > 20 && <p className="text-xs text-gray-500">and {mine.length - 20} earlier</p>}
        </section>
      )}
    </div>
  )
}
