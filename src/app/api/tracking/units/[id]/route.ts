import { trackingRoute } from '@/lib/tracking/http'
import { unitParts } from '@/lib/tracking/floor'
import { unitGenealogy } from '@/lib/tracking/jobwork'
import { getUnitDetail } from '@/lib/tracking/service'

export const GET = trackingRoute<{ id: string }>('view', async ({ actor, params }) => {
  const [detail, parts, genealogy] = await Promise.all([
    getUnitDetail(actor, params.id),
    unitParts(actor, params.id),
    unitGenealogy(actor, params.id),
  ])
  return { ...detail, parts, genealogy, warnings: [...detail.warnings, ...genealogy.warnings] }
})
