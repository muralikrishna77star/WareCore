'use client'

import { useEffect, useState } from 'react'
import { APP_VERSION } from '@/lib/version'

/** Only renders in the desktop (embedded Postgres) build — invisible on the
 * web deployment, where /api/desktop/status reports isDesktop: false. Gives
 * the kiosk window (no browser chrome at all) a recognizable app shell and
 * a way to fully exit, since Alt+F4 alone only closes the window, leaving
 * the server/Postgres running. */
export function DesktopTitleBar() {
  const [isDesktop, setIsDesktop] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    fetch('/api/desktop/status')
      .then((res) => res.json())
      .then((data) => setIsDesktop(!!data.isDesktop))
      .catch(() => {})
  }, [])

  // The bar is `fixed`, not part of normal document flow, so reserve its
  // height with body padding instead — relying on flex containers further
  // down the tree (the (app) layout's sidebar/header) to "push down"
  // correctly is fragile across nested layouts; an explicit body padding
  // is correct regardless of what any descendant does with its own height.
  useEffect(() => {
    if (!isDesktop) return
    document.body.style.paddingTop = '2.5rem'
    return () => {
      document.body.style.paddingTop = ''
    }
  }, [isDesktop])

  if (!isDesktop) return null

  const handleClose = async () => {
    if (!confirm('Close WareCore? This will stop the local app and database.')) return
    setClosing(true)
    try {
      await fetch('/api/desktop/shutdown', { method: 'POST' })
    } catch {
      // server is going down — fetch may fail/abort, that's expected
    }
    window.close()
  }

  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex h-10 items-center justify-between border-b-2 border-cyan-300 bg-gradient-to-r from-indigo-700 via-blue-600 to-cyan-600 px-3 shadow-sm select-none">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-white/15 text-xs font-bold text-white">W</span>
        <span className="text-sm font-semibold text-white">WareCore</span>
        <span className="text-xs text-white/60">v{APP_VERSION} · Desktop</span>
      </div>
      <button
        type="button"
        onClick={handleClose}
        disabled={closing}
        className="inline-flex items-center gap-1 rounded-md bg-red-600/90 px-2.5 py-1 text-xs font-medium text-white shadow-sm hover:bg-red-600 disabled:opacity-50"
      >
        ✕ {closing ? 'Closing…' : 'Close'}
      </button>
    </div>
  )
}
