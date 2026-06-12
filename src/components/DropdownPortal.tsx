'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Renders dropdown content into document.body as a fixed-position overlay,
// so it escapes any overflow:auto/hidden ancestor (e.g. sticky-header table
// wrappers) and always renders above everything else. Flips above the anchor
// when there isn't enough room below in the viewport.
export function DropdownPortal({
  anchorEl,
  open,
  className = '',
  children,
  matchWidth = false,
  maxHeight = 240,
}: {
  anchorEl: HTMLElement | null
  open: boolean
  className?: string
  children: React.ReactNode
  matchWidth?: boolean
  maxHeight?: number
}) {
  const [mounted, setMounted] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties | null>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!open || !anchorEl) { setStyle(null); return }

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
  }, [open, anchorEl, matchWidth, maxHeight])

  if (!mounted || !open || !anchorEl || !style) return null

  return createPortal(
    <div style={style} className={className}>{children}</div>,
    document.body
  )
}
