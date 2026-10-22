'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

/** Re-runs the About page's server render, so the live usage figures are read
 * from the database again. */
export function RefreshUsageButton({ fetchedAt }: { fetchedAt: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500">
        Usage as of {new Date(fetchedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
      </span>
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} />
        {pending ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  )
}
