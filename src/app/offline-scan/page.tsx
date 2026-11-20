import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requirePageRole } from '@/lib/auth/requirePageRole'
import { isTrackingMasterEnabled, TRACKING_ROLES } from '@/lib/tracking/constants'
import { OfflineScan } from '@/components/tracking/OfflineScan'

export const metadata: Metadata = { title: 'Offline Scan · WareCore' }

/**
 * A standalone screen, outside the main app shell, so the service worker can
 * keep it on the phone and open it with no signal. The checks below run
 * whenever it is loaded from the network.
 */
export default async function OfflineScanPage() {
  if (!isTrackingMasterEnabled()) notFound()
  await requirePageRole(TRACKING_ROLES.operate)
  return (
    <main className="min-h-screen bg-gray-50">
      <OfflineScan />
    </main>
  )
}
