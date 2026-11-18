import { requirePageRole } from '@/lib/auth/requirePageRole'
import { TRACKING_ROLES } from '@/lib/tracking/constants'
import { UnitDetail } from '@/components/tracking/UnitDetail'

export default async function TrackedUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageRole(TRACKING_ROLES.view)
  const { id } = await params
  return (
    <UnitDetail
      unitId={id}
      canPrint={TRACKING_ROLES.label.has(session.role)}
      canReprintOrVoid={TRACKING_ROLES.reprint_void.has(session.role)}
    />
  )
}
