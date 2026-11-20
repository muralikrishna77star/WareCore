import { trackingRoute } from '@/lib/tracking/http'
import { offlineSnapshot } from '@/lib/tracking/offline'

/** What the Offline Scan screen keeps on the phone for one warehouse. */
export const GET = trackingRoute('operate', async ({ request, actor }) =>
  offlineSnapshot(actor, request.nextUrl.searchParams.get('warehouse_id')))
