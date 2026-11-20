import { requirePageRole } from '@/lib/auth/requirePageRole'
import { TRACKING_ROLES } from '@/lib/tracking/constants'
import { TrackingDashboard } from '@/components/tracking/TrackingDashboard'

export default async function TrackingDashboardPage() {
  await requirePageRole(TRACKING_ROLES.view)
  return <TrackingDashboard />
}
