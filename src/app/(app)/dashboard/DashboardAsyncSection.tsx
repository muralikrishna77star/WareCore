'use client'

import type { ReactNode } from 'react'

/**
 * Shared loading / empty / error chrome for Classic & Modern dashboard sections,
 * so each card/panel doesn't hand-roll its own skeleton and error markup.
 */
export function DashboardAsyncSection({
  loading,
  error,
  isEmpty,
  emptyMessage = 'No data available yet.',
  skeletonRows = 3,
  children,
}: {
  loading: boolean
  error: string | null
  isEmpty?: boolean
  emptyMessage?: string
  skeletonRows?: number
  children: ReactNode
}) {
  if (loading) {
    return (
      <div className="space-y-2" role="status" aria-live="polite" aria-label="Loading">
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <div key={i} className="h-8 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
        Couldn&apos;t load this data: {error}
      </p>
    )
  }

  if (isEmpty) {
    return <p className="py-6 text-center text-sm text-gray-500">{emptyMessage}</p>
  }

  return <>{children}</>
}
