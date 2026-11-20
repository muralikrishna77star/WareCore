import { requirePageRole } from '@/lib/auth/requirePageRole'
import { TRACKING_ROLES } from '@/lib/tracking/constants'
import { StockCountDetail } from '@/components/tracking/StockCounts'

export default async function StockCountPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageRole(TRACKING_ROLES.view)
  const { id } = await params
  return <StockCountDetail countId={id} canManage={TRACKING_ROLES.manage.has(session.role)} canOperate={TRACKING_ROLES.operate.has(session.role)} />
}
