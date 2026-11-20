import { trackingRoute } from '@/lib/tracking/http'
import { listSyncProblems } from '@/lib/tracking/offline'

export const GET = trackingRoute('view', async ({ request, actor }) => ({
  problems: await listSyncProblems(actor, request.nextUrl.searchParams.get('show')),
}))
