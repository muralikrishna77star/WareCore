import { requirePageRole } from '@/lib/auth/requirePageRole'
import { TRACKING_ROLES } from '@/lib/tracking/constants'
import { PickupDetail } from '@/components/tracking/PickupDetail'

export default async function TrackingPickupPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageRole(TRACKING_ROLES.view)
  const { id } = await params
  return (
    <PickupDetail
      pickupId={id}
      canShare={TRACKING_ROLES.pickup.has(session.role)}
      canOperate={TRACKING_ROLES.operate.has(session.role)}
      canManage={TRACKING_ROLES.manage.has(session.role)}
    />
  )
}
