'use client'

import { cn } from '@/lib/utils'
import { type DashboardView } from '@/lib/dashboardViewPreference'
import { useDashboardView } from '@/components/DashboardViewProvider'

const VIEW_OPTIONS: { value: DashboardView; label: string }[] = [
  { value: 'existing', label: 'Existing' },
  { value: 'classic', label: 'Classic' },
  { value: 'modern', label: 'Modern' },
]

export function DashboardViewToggle() {
  const { view, setView } = useDashboardView()

  return (
    <div role="group" aria-label="App appearance" className="inline-flex rounded-lg border border-gray-200 bg-gray-100 p-1">
      {VIEW_OPTIONS.map((option) => {
        const isSelected = view === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            onClick={() => setView(option.value)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600',
              isSelected ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
