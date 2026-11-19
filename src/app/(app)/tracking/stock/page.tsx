import { requirePageRole } from '@/lib/auth/requirePageRole'
import { TRACKING_ROLES } from '@/lib/tracking/constants'
import { StockFloor } from '@/components/tracking/StockFloor'

export default async function TrackingStockPage() {
  const session = await requirePageRole(TRACKING_ROLES.operate, '/tracking/scan')
  return <StockFloor canManage={TRACKING_ROLES.manage.has(session.role)} />
}
