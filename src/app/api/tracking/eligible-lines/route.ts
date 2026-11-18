import { trackingRoute } from '@/lib/tracking/http'
import { listEligibleLines } from '@/lib/tracking/service'

export const GET = trackingRoute('label', async ({ request, actor }) => ({
  lines: await listEligibleLines(actor, request.nextUrl.searchParams.get('search') ?? ''),
}))
