'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Wrench } from 'lucide-react'
import type { ExceptionFix, ExceptionReview } from '@/lib/dataIntegrity/review'

type FixState = { status: 'applying' | 'done' | 'error'; message: string }

// Review & Fix for one exception (migration 165): loads the known-cause
// findings and offers each finding's fix after a confirmation. Used under
// each card on the Data Integrity dashboard and on the exception page.
export function ExceptionReviewPanel({ exceptionId, exceptionNumber, canFix, onFixed }: {
  exceptionId: string
  exceptionNumber: string
  canFix: boolean
  onFixed?: (summary: string) => void
}) {
  const router = useRouter()
  const [review, setReview] = useState<ExceptionReview | 'loading' | 'error'>('loading')
  const [fixStates, setFixStates] = useState<Record<string, FixState>>({})

  const load = async () => {
    setReview('loading')
    try {
      const res = await fetch(`/api/data-integrity/exceptions/${exceptionId}/review`)
      const data = await res.json()
      setReview(res.ok ? (data as ExceptionReview) : 'error')
    } catch {
      setReview('error')
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [exceptionId])

  const applyFix = async (key: string, fix: ExceptionFix, label: string) => {
    if (!window.confirm(`${label} for ${exceptionNumber}?\n\nThis changes saved stock records. The database checks it again before saving, and it is recorded in the fix log.`)) return
    setFixStates((prev) => ({ ...prev, [key]: { status: 'applying', message: '' } }))
    try {
      const res = await fetch(`/api/data-integrity/exceptions/${exceptionId}/fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fix),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFixStates((prev) => ({ ...prev, [key]: { status: 'error', message: data.error || `Server error (${res.status})` } }))
        return
      }
      const summary = data.summary || 'Fixed.'
      setFixStates((prev) => ({ ...prev, [key]: { status: 'done', message: summary } }))
      onFixed?.(summary)
      await load()
      router.refresh()
    } catch (err) {
      setFixStates((prev) => ({ ...prev, [key]: { status: 'error', message: err instanceof Error ? err.message : 'Network error' } }))
    }
  }

  if (review === 'loading') return <p className="text-xs text-gray-500">Checking known causes…</p>
  if (review === 'error') return <p className="text-xs text-red-600">Couldn&apos;t run the review. Try again, or open the full details.</p>

  return (
    <div className="space-y-2">
      {review.findings.map((f, i) => {
        const key = f.fix?.kind === 'output_item' ? f.fix.outputItemId : f.fix?.kind ?? String(i)
        const fixState = fixStates[key]
        return (
          <div key={i} className={`rounded-lg border px-3 py-2 ${f.fix ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
            <p className="text-sm font-semibold text-gray-900">{f.title}</p>
            <p className="mt-0.5 text-xs text-gray-700">{f.detail}</p>
            {f.rows && f.rows.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500">
                      {f.rowHeaders?.map((h) => <th key={h} className="py-1 pr-4 font-medium">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {f.rows.map((row, ri) => (
                      <tr key={ri} className="border-t border-gray-200/70">
                        {row.map((cell, ci) => <td key={ci} className="py-1 pr-4 text-gray-800">{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {f.links && f.links.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {f.links.map((l) => (
                  <Link key={l.href} href={l.href} target="_blank" className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:underline">
                    {l.label} <ArrowRight className="h-3 w-3" />
                  </Link>
                ))}
              </div>
            )}
            {f.fix && fixState?.status !== 'done' && (
              canFix ? (
                <button
                  type="button"
                  disabled={fixState?.status === 'applying'}
                  onClick={() => applyFix(key, f.fix!, f.fixLabel ?? 'Apply fix')}
                  className="mt-2 inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  <Wrench className="h-3.5 w-3.5" /> {fixState?.status === 'applying' ? 'Fixing…' : f.fixLabel ?? 'Fix'}
                </button>
              ) : (
                <p className="mt-2 text-xs text-gray-500">An admin or developer can apply this fix.</p>
              )
            )}
            {fixState?.status === 'error' && <p className="mt-1 text-xs text-red-700">{fixState.message}</p>}
            {fixState?.status === 'done' && <p className="mt-1 text-xs text-green-700">{fixState.message}</p>}
          </div>
        )
      })}
    </div>
  )
}
