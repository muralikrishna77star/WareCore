import { trackingRoute } from '@/lib/tracking/http'
import { gpsCompanyIds } from '@/lib/tracking/service'

/** Tells the scanning screens which companies have GPS switched on. */
export const GET = trackingRoute('view', async () => ({ gpsCompanies: await gpsCompanyIds() }))
