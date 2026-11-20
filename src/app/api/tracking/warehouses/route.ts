import { trackingRoute } from '@/lib/tracking/http'
import { trackingWarehouses } from '@/lib/tracking/offline'

/** Warehouses with tracking switched on that this person can see, for the dashboard and report filters. */
export const GET = trackingRoute('view', async ({ actor }) => ({ warehouses: await trackingWarehouses(actor) }))
