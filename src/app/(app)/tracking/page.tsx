import { redirect } from 'next/navigation'
import { requirePageRole } from '@/lib/auth/requirePageRole'
import { TRACKING_ROLES } from '@/lib/tracking/constants'

export default async function TrackingHomePage() {
  const session = await requirePageRole(TRACKING_ROLES.view)
  redirect(TRACKING_ROLES.label.has(session.role) ? '/tracking/receive' : '/tracking/scan')
}
