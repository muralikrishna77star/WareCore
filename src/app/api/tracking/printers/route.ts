import { trackingRoute } from '@/lib/tracking/http'
import { listPrinters } from '@/lib/tracking/service'

export const GET = trackingRoute('label', async ({ actor }) => ({
  printers: (await listPrinters(actor)).filter((printer) => printer.is_active),
}))
