import { requirePageRole } from '@/lib/auth/requirePageRole'
import { TRACKING_ROLES } from '@/lib/tracking/constants'
import { Outputs } from '@/components/tracking/Outputs'

export default async function TrackingOutputsPage() {
  const session = await requirePageRole(TRACKING_ROLES.view)
  return <Outputs canReceive={TRACKING_ROLES.manage.has(session.role)} />
}
