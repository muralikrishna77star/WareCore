'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'

type Ripple = { id: number; x: number; y: number }

let rippleId = 0

export function CopilotButton({ isOpen, onClick }: { isOpen: boolean; onClick: () => void }) {
  const [ripples, setRipples] = useState<Ripple[]>([])

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const id = ++rippleId
    setRipples((prev) => [...prev, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }])
    setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), 600)
    onClick()
  }

  return (
    <div className="fixed bottom-24 right-0 z-50 lg:bottom-16 print:hidden">
      <div className="group relative">
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-1/2 right-full mr-3 translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
        >
          Ask WareCore Copilot
        </span>
        <button
          type="button"
          onClick={handleClick}
          aria-label="Ask WareCore Copilot"
          className={`relative flex h-20 w-10 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-l-2xl border border-r-0 border-white/20 bg-gradient-to-b from-blue-500 to-blue-700 shadow-lg backdrop-blur-sm transition-transform hover:-translate-x-1 ${
            isOpen ? '' : 'animate-copilot-pulse'
          }`}
        >
          <Sparkles className="h-5 w-5 shrink-0 text-white" />
          <span className="text-[10px] font-semibold tracking-wide text-white [writing-mode:vertical-rl]">
            AI
          </span>
          {ripples.map((r) => (
            <span
              key={r.id}
              className="animate-copilot-ripple pointer-events-none absolute h-4 w-4 rounded-full bg-white/60"
              style={{ left: r.x - 8, top: r.y - 8 }}
            />
          ))}
        </button>
      </div>
    </div>
  )
}
