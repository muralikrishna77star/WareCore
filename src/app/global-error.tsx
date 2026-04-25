'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[WareCore] Global error:', error.message)
  }, [error])

  return (
    <html>
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center bg-gray-50">
          <div className="rounded-2xl border bg-white p-10 shadow-sm max-w-md w-full">
            <div className="text-5xl mb-4">💥</div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Application error</h1>
            <p className="text-gray-500 text-sm mb-4">
              Something went wrong at the application level.
            </p>
            <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-left mb-6">
              <p className="text-xs font-medium text-red-700 mb-1">Error detail</p>
              <p className="text-xs text-red-600 font-mono break-all">{error.message}</p>
            </div>
            <button
              onClick={reset}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
