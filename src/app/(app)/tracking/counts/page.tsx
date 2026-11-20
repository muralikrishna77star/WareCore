import { requirePageRole } from '@/lib/auth/requirePageRole'
import { TRACKING_ROLES } from '@/lib/tracking/constants'
import { StockCountList } from '@/components/tracking/StockCounts'

export default async function StockCountsPage() {
  await requirePageRole(TRACKING_ROLES.view)
  return <StockCountList />
}
