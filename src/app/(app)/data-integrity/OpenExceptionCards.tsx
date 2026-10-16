'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, ChevronDown, Search } from 'lucide-react'
import { ItemLedgerLink } from '@/components/ReportLinks'
import { ExceptionReviewPanel } from './ExceptionReviewPanel'

export interface OpenExceptionCard {
  id: string
  exceptionNumber: string
  severity: string
  status: string
  ruleCode: string
  ruleName: string
  company: string | null
  material: string | null
  sizeLabel: string | null
  items: { id: string; code: string; name: string }[]
  summary: string
  // REC-005 only: today's balance for the scope (the summary is as first detected).
  liveMin: number | null
  liveCurrent: number | null
  firstDetected: string
  occurrences: number
}

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-800',
  HIGH: 'bg-orange-100 text-orange-800',
  MEDIUM: 'bg-amber-100 text-amber-800',
  LOW: 'bg-gray-100 text-gray-700',
  INFO: 'bg-blue-100 text-blue-700',
}
const SEVERITY_BORDER: Record<string, string> = {
  CRITICAL: 'border-l-red-500',
  HIGH: 'border-l-orange-400',
  MEDIUM: 'border-l-amber-400',
}

// The Data Integrity dashboard's list of open exceptions: each one's details,
// then Review & Fix (expands the known-cause findings and their fixes) and a
// link to the full exception page.
export function OpenExceptionCards({ exceptions, canFix }: { exceptions: OpenExceptionCard[]; canFix: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Kept here because a fixed exception that resolves drops out of the list
  // on refresh, taking its card (and message) with it.
  const [notices, setNotices] = useState<string[]>([])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="divide-y divide-gray-100">
      {notices.length > 0 && (
        <div className="space-y-1 bg-green-50 px-4 py-3">
          {notices.map((n, i) => (
            <p key={i} className="flex items-start gap-1 text-sm text-green-800"><Check className="mt-0.5 h-4 w-4 shrink-0" /> {n}</p>
          ))}
        </div>
      )}
      {!exceptions.length && <p className="p-4 text-sm text-green-700">No open exceptions — every check is clear.</p>}
      {exceptions.map((e) => {
        const isOpen = expanded.has(e.id)
        return (
          <div key={e.id} className={`border-l-4 ${SEVERITY_BORDER[e.severity] ?? 'border-l-gray-300'} p-4`}>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/data-integrity/exceptions/${e.id}`} className="font-semibold text-gray-900 hover:underline">{e.exceptionNumber}</Link>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_COLOR[e.severity] ?? 'bg-gray-100'}`}>{e.severity}</span>
              <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{e.status}</span>
              <span className="text-xs text-gray-500">{e.ruleCode} — {e.ruleName}</span>
            </div>

            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              {e.company && (<><dt className="text-gray-500">Company</dt><dd className="text-gray-900">{e.company}</dd></>)}
              {(e.material || e.sizeLabel) && (
                <>
                  <dt className="text-gray-500">Material</dt>
                  <dd className="text-gray-900">{[e.material, e.sizeLabel].filter(Boolean).join(' · ')}</dd>
                </>
              )}
              {e.items.length > 0 && (
                <>
                  <dt className="text-gray-500">Item{e.items.length > 1 ? 's' : ''}</dt>
                  <dd className="text-gray-900">
                    {e.items.map((it, i) => (
                      <span key={it.id}>
                        {i > 0 && ', '}
                        <ItemLedgerLink itemMasterId={it.id}>{it.code}</ItemLedgerLink> {it.name}
                      </span>
                    ))}
                  </dd>
                </>
              )}
              <dt className="text-gray-500">Problem</dt>
              <dd className="font-medium text-gray-900">{e.summary}</dd>
              {e.liveCurrent !== null && (
                <>
                  <dt className="text-gray-500">Today</dt>
                  <dd className={e.liveCurrent < -0.0005 || (e.liveMin ?? 0) < -0.0005 ? 'text-red-700' : 'text-green-700'}>
                    {(e.liveMin ?? 0) < -0.0005
                      ? `Stock is ${e.liveCurrent.toFixed(3)} MT (lowest ever ${e.liveMin!.toFixed(3)} MT)`
                      : `Stock is ${e.liveCurrent.toFixed(3)} MT and never goes negative now — the next scan will close this`}
                  </dd>
                </>
              )}
              <dt className="text-gray-500">Seen</dt>
              <dd className="text-gray-600">since {new Date(e.firstDetected).toLocaleDateString()} · {e.occurrences} scan{e.occurrences !== 1 ? 's' : ''}</dd>
            </dl>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => toggle(e.id)}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                <Search className="h-3.5 w-3.5" /> Review &amp; Fix
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              <Link
                href={`/data-integrity/exceptions/${e.id}`}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Full details <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {isOpen && (
              <div className="mt-3">
                <ExceptionReviewPanel
                  exceptionId={e.id}
                  exceptionNumber={e.exceptionNumber}
                  canFix={canFix}
                  onFixed={(summary) => setNotices((prev) => [...prev, `${e.exceptionNumber}: ${summary}`])}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
