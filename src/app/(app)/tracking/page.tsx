import { redirect } from 'next/navigation'
import { requirePageRole } from '@/lib/auth/requirePageRole'
import { TRACKING_ROLES } from '@/lib/tracking/constants'

export default async function TrackingHomePage() {
  await requirePageRole(TRACKING_ROLES.view)
  redirect('/tracking/dashboard')
}
