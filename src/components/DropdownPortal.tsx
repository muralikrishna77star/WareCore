'use client'

import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react'
import { createPortal } from 'react-dom'

// No-op subscribe: there is nothing to subscribe to — this is only used to
// get an SSR-safe "have we hydrated on the client yet" flag without setState
// in an effect (see useSyncExternalStore docs for this exact pattern).
const noopSubscribe = () => () => {}

// Renders dropdown content into document.body as a fixed-position overlay,
// so it escapes any overflow:auto/hidden ancestor (e.g. sticky-header table
// wrappers) and always renders above everything else. Flips above the anchor
// when there isn't enough room below in the viewport.
export function DropdownPortal({
  anchorRef,
  open,
  className = '',
  children,
  matchWidth = false,
  maxHeight = 240,
}: {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  className?: string
  children: React.ReactNode
  matchWidth?: boolean
  maxHeight?: number
}) {
  // true only once hydrated on the client; false during SSR — avoids calling
  // createPortal() before document.body exists, without setState in an effect.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const [style, setStyle] = useState<React.CSSProperties | null>(null)

  useEffect(() => {
    const anchorEl = anchorRef.current
    if (!open || !anchorEl) return

    const update = () => {
      const rect = anchorEl.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      const openUp = spaceBelow < maxHeight + 16 && spaceAbove > spaceBelow

      setStyle({
        position: 'fixed',
        left: rect.left,
        zIndex: 9999,
        ...(matchWidth ? { width: rect.width } : {}),
        ...(openUp
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      })
    }

    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, anchorRef, matchWidth, maxHeight])

  if (!mounted || !open || !style) return null

  return createPortal(
    <div style={style} className={className}>{children}</div>,
    document.body
  )
}
