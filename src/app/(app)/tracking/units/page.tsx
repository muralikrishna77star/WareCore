import { TrackedUnits } from '@/components/tracking/TrackedUnits'
import { LIFECYCLE_LABELS } from '@/lib/tracking/constants'

export default async function TrackedUnitsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams
  const initial = status && (status in LIFECYCLE_LABELS || status === 'VOIDED') ? status : ''
  return <TrackedUnits initialStatus={initial} />
}
