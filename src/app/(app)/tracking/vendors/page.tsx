import { requirePageRole } from '@/lib/auth/requirePageRole'
import { TRACKING_ROLES } from '@/lib/tracking/constants'
import { VendorStock } from '@/components/tracking/VendorStock'

export default async function TrackingVendorsPage() {
  const session = await requirePageRole(TRACKING_ROLES.view)
  return <VendorStock canOperate={TRACKING_ROLES.operate.has(session.role)} />
}
