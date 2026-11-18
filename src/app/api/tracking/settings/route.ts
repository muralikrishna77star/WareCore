import { readJson, trackingRoute } from '@/lib/tracking/http'
import { getSettings, requestTestPrint, savePrinter, setFeatureFlag, TrackingError } from '@/lib/tracking/service'

export const GET = trackingRoute('settings', async ({ actor }) => getSettings(actor))

export const POST = trackingRoute('settings', async ({ request, actor }) => {
  const body = await readJson(request)
  switch (body.action) {
    case 'set_flag':
      await setFeatureFlag(actor, body.company_id, body.warehouse_id, body.enabled)
      return { success: true }
    case 'save_printer':
      await savePrinter(actor, body)
      return { success: true }
    case 'test_print':
      return requestTestPrint(actor, body.printer_id)
    default:
      throw new TrackingError('Unknown action')
  }
})
