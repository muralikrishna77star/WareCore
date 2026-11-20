'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { QrCode } from 'lucide-react'
import { trackingApi } from './api'

interface Card {
  enabled: boolean
  notPutAway: number
  pickupsReady: number
  syncProblems: number
}

/** Shown on the main Dashboard only when QR tracking is on for a warehouse this person can see. */
export function TrackingDashboardCard() {
  const [card, setCard] = useState<Card | null>(null)

  useEffect(() => {
    let current = true
    trackingApi<Card>('dashboard?card')
      .then((data) => { if (current) setCard(data) })
      .catch(() => { /* No tracking access: the card stays hidden. */ })
    return () => { current = false }
  }, [])

  if (!card?.enabled) return null
  const figures = [
    { label: 'Not put away', value: card.notPutAway, href: '/tracking/stock' },
    { label: 'Pickups waiting', value: card.pickupsReady, href: '/tracking/pickups' },
    { label: 'Sync problems', value: card.syncProblems, href: '/tracking/sync-problems' },
  ]
  return (
    <section className="mb-4 flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 bg-white p-4">
      <Link href="/tracking/dashboard" className="flex items-center gap-2 font-semibold text-gray-900 hover:text-blue-700">
        <QrCode className="h-5 w-5 text-cyan-700" /> QR Tracking
      </Link>
      <div className="flex flex-1 flex-wrap gap-3">
        {figures.map((f) => (
          <Link key={f.label} href={f.href} className={`rounded-lg border px-3 py-1.5 text-sm ${f.value ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-gray-200 text-gray-600'}`}>
            <span className="font-semibold tabular-nums">{f.value}</span> {f.label}
          </Link>
        ))}
      </div>
    </section>
  )
}
