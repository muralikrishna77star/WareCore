import { readJson, trackingRoute } from '@/lib/tracking/http'
import { requestPrint } from '@/lib/tracking/service'

export const POST = trackingRoute('label', async ({ request, actor }) => {
  const body = await readJson(request)
  return requestPrint(actor, String(body.unit_id ?? ''), body.printer_id, body.reason)
})
