'use client'

import { useEffect } from 'react'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[WareCore] Page error:', error.message)
  }, [error])

  const isHasuraError =
    error.message.toLowerCase().includes('hasura') ||
    error.message.toLowerCase().includes('graphql') ||
    error.message.toLowerCase().includes('field') ||
    error.message.toLowerCase().includes('table')

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="rounded-2xl border bg-white p-10 shadow-sm max-w-lg w-full">
        <div className="text-5xl mb-4">⚠️</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h1>

        {isHasuraError ? (
          <div className="mb-6">
            <p className="text-gray-500 text-sm mb-3">
              There was a problem connecting to the database. This usually means a table or
              relationship is not tracked in Hasura yet.
            </p>
            <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-left">
              <p className="text-xs font-medium text-red-700 mb-1">Error detail</p>
              <p className="text-xs text-red-600 font-mono break-all">{error.message}</p>
            </div>
            <div className="mt-4 rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-left">
              <p className="text-xs font-semibold text-blue-800 mb-1">How to fix</p>
              <ol className="text-xs text-blue-700 space-y-1 list-decimal list-inside">
                <li>Open Hasura Console → Data tab</li>
                <li>Track any untracked tables</li>
                <li>Track all suggested foreign-key relationships</li>
                <li>Come back and try again</li>
              </ol>
            </div>
          </div>
        ) : (
          <div className="mb-6">
            <p className="text-gray-500 text-sm mb-3">An unexpected error occurred on this page.</p>
            <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-left">
              <p className="text-xs font-medium text-red-700 mb-1">Error detail</p>
              <p className="text-xs text-red-600 font-mono break-all">{error.message}</p>
            </div>
          </div>
        )}

        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="rounded-lg border px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Go to Dashboard
          </a>
        </div>
      </div>
    </div>
  )
}
