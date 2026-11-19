import { requirePageRole } from '@/lib/auth/requirePageRole'
import { TRACKING_ROLES } from '@/lib/tracking/constants'
import { Pickups } from '@/components/tracking/Pickups'

export default async function TrackingPickupsPage() {
  const session = await requirePageRole(TRACKING_ROLES.view)
  return <Pickups canCreate={TRACKING_ROLES.pickup.has(session.role)} />
}
