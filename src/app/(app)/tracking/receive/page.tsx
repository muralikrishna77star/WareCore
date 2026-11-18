import { requirePageRole } from '@/lib/auth/requirePageRole'
import { TRACKING_ROLES } from '@/lib/tracking/constants'
import { ReceiveAndLabel } from '@/components/tracking/ReceiveAndLabel'

export default async function TrackingReceivePage() {
  await requirePageRole(TRACKING_ROLES.label, '/tracking/scan')
  return <ReceiveAndLabel />
}
