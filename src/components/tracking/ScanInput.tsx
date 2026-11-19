'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff } from 'lucide-react'

/** The same label seen again within this time is one scan, not two. */
const REPEAT_SCAN_MS = 3000

/** Reads a code from a handheld scanner, the phone camera or the keyboard. */
export function ScanInput({ id, label, placeholder, buttonLabel = 'Find', busy = false, autoFocus = false, onScan }: {
  id: string
  label: string
  placeholder?: string
  buttonLabel?: string
  busy?: boolean
  autoFocus?: boolean
  onScan: (code: string) => void | Promise<void>
}) {
  const [code, setCode] = useState('')
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const lastScan = useRef({ text: '', at: 0 })
  const handler = useRef(onScan)

  useEffect(() => {
    handler.current = onScan
  }, [onScan])

  const submit = async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    setCode('')
    await handler.current(trimmed)
    inputRef.current?.focus()
  }

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
            const now = Date.now()
            if (text && (text !== lastScan.current.text || now - lastScan.current.at > REPEAT_SCAN_MS)) {
              lastScan.current = { text, at: now }
              void handler.current(text)
            }
          },
        )
        if (cancelled) controls.stop()
        else stop = () => controls.stop()
      } catch {
        if (!cancelled) {
          setCameraError('The camera could not start. Allow camera access, or use a handheld scanner or type the code.')
          setCameraOn(false)
        }
      }
    })()
    return () => {
      cancelled = true
      stop?.()
    }
  }, [cameraOn])

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void submit(code) }}
      className="space-y-3"
    >
      <label className="block text-sm font-medium text-gray-700" htmlFor={id}>{label}</label>
      <div className="flex gap-2">
        <input
          id={id}
          ref={inputRef}
          autoFocus={autoFocus}
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
        />
        <button type="submit" disabled={busy || !code.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {buttonLabel}
        </button>
      </div>
      <button
        type="button"
        onClick={() => { setCameraError(''); setCameraOn((on) => !on) }}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        {cameraOn ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
        {cameraOn ? 'Stop camera' : 'Use camera'}
      </button>
      {cameraOn && <video ref={videoRef} muted playsInline className="aspect-video w-full rounded-lg bg-black object-cover" />}
      {cameraError && <p className="text-sm text-red-600">{cameraError}</p>}
    </form>
  )
}
