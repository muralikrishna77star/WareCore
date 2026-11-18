'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, TriangleAlert } from 'lucide-react'
import type { TrackingUnit } from '@/lib/tracking/constants'
import { errorText, trackingApi } from './api'

type Lookup =
  | { kind: 'found'; unit: TrackingUnit; warnings: string[]; printCount: number }
  | { kind: 'test' | 'invalid' | 'not_found' | 'other_company' }

const MESSAGES = {
  test: 'This is a printer test label. It is not a stock item.',
  invalid: 'This is not a WareCore tracking label.',
  not_found: 'No tracked unit has this code.',
  other_company: 'This label belongs to a company or warehouse you do not have access to.',
}

export function ScanLookup() {
  const [code, setCode] = useState('')
  const [result, setResult] = useState<Lookup | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const lastScan = useRef('')

  const lookup = useCallback(async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    setBusy(true)
    setError('')
    try {
      setResult(await trackingApi<Lookup>('lookup', { method: 'POST', body: { code: trimmed } }))
      setCode('')
    } catch (err) {
      setError(errorText(err))
    }
    setBusy(false)
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!cameraOn) return
    let stop: (() => void) | undefined
    let cancelled = false
    ;(async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const reader = new BrowserMultiFormatReader()
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: 'environment' } },
          videoRef.current ?? undefined,
          (scan) => {
            const text = scan?.getText()
            if (text && text !== lastScan.current) {
              lastScan.current = text
              lookup(text)
            }
          },
        )
        if (cancelled) controls.stop()
        else stop = () => controls.stop()
      } catch {
        if (!cancelled) {
          setError('The camera could not start. Allow camera access, or use a handheld scanner or type the ID.')
          setCameraOn(false)
        }
      }
    })()
    return () => {
      cancelled = true
      stop?.()
      lastScan.current = ''
    }
  }, [cameraOn, lookup])

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <form
        onSubmit={(e) => { e.preventDefault(); lookup(code) }}
        className="space-y-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <label className="block text-sm font-medium text-gray-700" htmlFor="tracking-code">
          Scan a label or type its tracking ID
        </label>
        <div className="flex gap-2">
          <input
            id="tracking-code"
            ref={inputRef}
            autoFocus
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ST2611-000001"
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
          />
          <button type="submit" disabled={busy || !code.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            Find
          </button>
        </div>
        <button
          type="button"
          onClick={() => setCameraOn((on) => !on)}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {cameraOn ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
          {cameraOn ? 'Stop camera' : 'Use camera'}
        </button>
        {cameraOn && <video ref={videoRef} muted playsInline className="aspect-video w-full rounded-lg bg-black object-cover" />}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      {result && result.kind !== 'found' && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{MESSAGES[result.kind]}</p>
      )}

      {result?.kind === 'found' && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          {result.warnings.map((warning) => (
            <p key={warning} className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
              <TriangleAlert className="h-4 w-4 shrink-0" /> {warning}
            </p>
          ))}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-mono text-lg font-semibold text-gray-900">{result.unit.stock_tracking_id}</h2>
              <p className="text-sm text-gray-700">{result.unit.item_code} {result.unit.item_name} {result.unit.size_label}</p>
            </div>
            <p className="whitespace-nowrap text-lg font-semibold text-gray-900">{result.unit.quantity} {result.unit.unit}</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div><dt className="text-gray-500">Bundle</dt><dd className="text-gray-900">{result.unit.bundle_no} of {result.unit.bundle_count}</dd></div>
            <div><dt className="text-gray-500">Purchase line</dt><dd className="font-mono text-gray-900">{result.unit.purchase_line_id}</dd></div>
            <div><dt className="text-gray-500">Bill</dt><dd className="text-gray-900">{result.unit.bill_number}</dd></div>
            <div><dt className="text-gray-500">Warehouse</dt><dd className="text-gray-900">{result.unit.warehouse_name}</dd></div>
            <div><dt className="text-gray-500">Labels printed</dt><dd className="text-gray-900">{result.printCount}</dd></div>
          </dl>
          <Link href={`/tracking/units/${result.unit.id}`} className="inline-block text-sm font-medium text-blue-600 hover:underline">View full history</Link>
        </section>
      )}
    </div>
  )
}
