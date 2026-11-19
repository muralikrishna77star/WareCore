import { readJson, trackingRoute } from '@/lib/tracking/http'
import { createPickup, listPickups, pickupOptions } from '@/lib/tracking/pickups'

export const GET = trackingRoute('view', async ({ request, actor }) => {
  const params = request.nextUrl.searchParams
  return {
    pickups: await listPickups(actor, { search: params.get('search') ?? '', status: params.get('status') ?? '' }),
    ...(await pickupOptions(actor)),
  }
})

export const POST = trackingRoute('pickup', async ({ request, actor }) => ({
  pickup: await createPickup(actor, await readJson(request)),
}))
