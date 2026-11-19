import { readJson, trackingRoute } from '@/lib/tracking/http'
import { createLocation, listLocations } from '@/lib/tracking/floor'
import { pickupOptions } from '@/lib/tracking/pickups'

export const GET = trackingRoute('view', async ({ request, actor }) => ({
  locations: await listLocations(actor, request.nextUrl.searchParams.get('warehouse_id')),
  warehouses: (await pickupOptions(actor)).warehouses,
}))

export const POST = trackingRoute('manage', async ({ request, actor }) => ({
  location: await createLocation(actor, await readJson(request)),
}))
