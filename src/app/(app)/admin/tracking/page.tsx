import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePageRole } from '@/lib/auth/requirePageRole'
import { isTrackingMasterEnabled, TRACKING_ROLES } from '@/lib/tracking/constants'
import { TrackingSettings } from '@/components/tracking/TrackingSettings'

export default async function TrackingSettingsPage() {
  if (!isTrackingMasterEnabled()) notFound()
  await requirePageRole(TRACKING_ROLES.settings)
  return (
    <div className="space-y-6">
      <div>
        <Link href="/tracking" className="text-sm text-blue-600 hover:underline">Back to QR Tracking</Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">QR Tracking Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Tracking is optional. Each company chooses when to switch it on, and existing work carries on either way.
        </p>
      </div>
      <TrackingSettings />
    </div>
  )
}
