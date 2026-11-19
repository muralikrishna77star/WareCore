import { requirePageRole } from '@/lib/auth/requirePageRole'
import { TRACKING_ROLES } from '@/lib/tracking/constants'
import { Locations } from '@/components/tracking/Locations'

export default async function TrackingLocationsPage() {
  const session = await requirePageRole(TRACKING_ROLES.view)
  return <Locations canManage={TRACKING_ROLES.manage.has(session.role)} />
}
