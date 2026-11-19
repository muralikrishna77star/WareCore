import { readJson, trackingRoute } from '@/lib/tracking/http'
import { createUnits, listUnits } from '@/lib/tracking/service'

export const GET = trackingRoute('view', async ({ request, actor }) => ({
  units: await listUnits(actor, {
    search: request.nextUrl.searchParams.get('search') ?? '',
    status: request.nextUrl.searchParams.get('status') ?? '',
    lifecycle: request.nextUrl.searchParams.get('lifecycle') ?? '',
  }),
}))

export const POST = trackingRoute('label', async ({ request, actor }) => {
  const body = await readJson(request)
  return { units: await createUnits(actor, body.purchase_line_id, body.bundles) }
})
