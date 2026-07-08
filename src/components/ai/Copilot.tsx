'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { CopilotButton } from '@/components/ai/CopilotButton'

// Lazy — the panel (and its chat/suggestion children) shouldn't add to the
// initial page bundle; it's only fetched once the user actually opens it.
const CopilotPanel = dynamic(() => import('@/components/ai/CopilotPanel'), { ssr: false })

export function Copilot() {
  const [isOpen, setIsOpen] = useState(false)
  const [hasOpened, setHasOpened] = useState(false)

  const toggle = () => {
    setHasOpened(true)
    setIsOpen((prev) => !prev)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        toggle()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <CopilotButton isOpen={isOpen} onClick={toggle} />
      {hasOpened && <CopilotPanel isOpen={isOpen} onClose={() => setIsOpen(false)} />}
    </>
  )
}
