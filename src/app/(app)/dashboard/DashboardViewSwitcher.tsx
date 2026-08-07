'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  type DashboardView,
  readStoredDashboardView,
  writeStoredDashboardView,
} from './dashboardViewPreference'

const ClassicDashboard = dynamic(() => import('./ClassicDashboard').then((m) => m.ClassicDashboard), {
  ssr: false,
  loading: () => <DashboardViewLoading />,
})

const ModernDashboard = dynamic(() => import('./ModernDashboard').then((m) => m.ModernDashboard), {
  ssr: false,
  loading: () => <DashboardViewLoading />,
})

const VIEW_OPTIONS: { value: DashboardView; label: string }[] = [
  { value: 'existing', label: 'Existing' },
  { value: 'classic', label: 'Classic' },
  { value: 'modern', label: 'Modern' },
]

function DashboardViewLoading() {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-label="Loading dashboard">
      <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
      <div className="h-40 animate-pulse rounded-lg bg-gray-100" />
    </div>
  )
}

export function DashboardViewSwitcher({ existingView }: { existingView: ReactNode }) {
  // First paint is always Existing (matches server render, avoids hydration mismatch);
  // any stored Classic/Modern preference is applied right after mount.
  const [view, setView] = useState<DashboardView>('existing')

  useEffect(() => {
    setView(readStoredDashboardView())
  }, [])

  const handleSelect = (next: DashboardView) => {
    setView(next)
    writeStoredDashboardView(next)
  }

  return (
    <div className="space-y-4">
      <div
        role="group"
        aria-label="Dashboard view"
        className="inline-flex rounded-lg border border-gray-200 bg-gray-100 p-1"
      >
        {VIEW_OPTIONS.map((option) => {
          const isSelected = view === option.value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => handleSelect(option.value)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600',
                isSelected ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>

      {view === 'existing' && existingView}
      {view === 'classic' && <ClassicDashboard />}
      {view === 'modern' && <ModernDashboard />}
    </div>
  )
}
