import { trackingRoute } from '@/lib/tracking/http'
import { dashboardCard, dashboardFigures, readFilters } from '@/lib/tracking/reports'

export const GET = trackingRoute('view', async ({ request, actor }) =>
  request.nextUrl.searchParams.get('card') !== null
    ? dashboardCard(actor)
    : dashboardFigures(actor, readFilters(request.nextUrl.searchParams)))
