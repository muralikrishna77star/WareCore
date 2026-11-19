import { requirePageRole } from '@/lib/auth/requirePageRole'
import { TRACKING_ROLES } from '@/lib/tracking/constants'
import { DispatchDetail } from '@/components/tracking/DispatchDetail'

export default async function TrackingDispatchPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageRole(TRACKING_ROLES.view)
  const { id } = await params
  return (
    <DispatchDetail
      dispatchId={id}
      canOperate={TRACKING_ROLES.operate.has(session.role)}
      canManage={TRACKING_ROLES.manage.has(session.role)}
    />
  )
}
