'use client'

import { usePathname } from 'next/navigation'
import { getPageSuggestions } from '@/lib/ai/pageSuggestions'

export function SuggestionCards({ onPick }: { onPick: (text: string) => void }) {
  const pathname = usePathname()
  const { label, suggestions } = getPageSuggestions(pathname)

  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase text-gray-400">Suggested for {label}</p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
