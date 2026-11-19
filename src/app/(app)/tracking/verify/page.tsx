import { requirePageRole } from '@/lib/auth/requirePageRole'
import { TRACKING_ROLES } from '@/lib/tracking/constants'
import { VerifyStock } from '@/components/tracking/VerifyStock'

export default async function TrackingVerifyPage() {
  await requirePageRole(TRACKING_ROLES.manage, '/tracking/scan')
  return <VerifyStock />
}
