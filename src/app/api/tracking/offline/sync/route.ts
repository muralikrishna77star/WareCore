import { readJson, trackingRoute } from '@/lib/tracking/http'
import { syncOfflineActions } from '@/lib/tracking/offline'

// Open to every tracking role: a scan from someone who has since lost the
// right to scan is recorded as refused, not left waiting on the phone forever.
export const POST = trackingRoute('view', async ({ request, actor }) => {
  const body = await readJson(request)
  return { results: await syncOfflineActions(actor, body.device_id, body.actions) }
})
