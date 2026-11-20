import { trackingRoute } from '@/lib/tracking/http'
import { isTrackingReportKey } from '@/lib/tracking/reportDefs'
import { readFilters, runTrackingReport } from '@/lib/tracking/reports'
import { TrackingError } from '@/lib/tracking/service'

export const GET = trackingRoute<{ key: string }>('view', async ({ request, actor, params }) => {
  if (!isTrackingReportKey(params.key)) throw new TrackingError('Report not found', 404)
  return runTrackingReport(actor, params.key, readFilters(request.nextUrl.searchParams))
})
