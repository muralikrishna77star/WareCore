import { requirePageRole } from '@/lib/auth/requirePageRole'
import { TRACKING_ROLES } from '@/lib/tracking/constants'
import { SyncProblems } from '@/components/tracking/SyncProblems'

export default async function SyncProblemsPage() {
  const session = await requirePageRole(TRACKING_ROLES.view)
  return <SyncProblems canReview={TRACKING_ROLES.manage.has(session.role)} />
}
