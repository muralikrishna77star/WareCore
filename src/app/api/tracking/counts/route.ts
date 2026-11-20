import { trackingRoute } from '@/lib/tracking/http'
import { listCounts } from '@/lib/tracking/counts'

export const GET = trackingRoute('view', async ({ request, actor }) => ({
  counts: await listCounts(actor, request.nextUrl.searchParams.get('status')),
}))
