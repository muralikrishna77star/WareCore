import { requirePageRole } from '@/lib/auth/requirePageRole'
import { TRACKING_ROLES } from '@/lib/tracking/constants'
import { Dispatches } from '@/components/tracking/Dispatches'

export default async function TrackingDispatchesPage() {
  const session = await requirePageRole(TRACKING_ROLES.view)
  return <Dispatches canCreate={TRACKING_ROLES.operate.has(session.role)} />
}
