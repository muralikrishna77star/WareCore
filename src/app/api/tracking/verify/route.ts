import { readJson, trackingRoute } from '@/lib/tracking/http'
import { listVerifiableLines, verifyExistingStock } from '@/lib/tracking/floor'

export const GET = trackingRoute('manage', async ({ request, actor }) => ({
  lines: await listVerifiableLines(actor, request.nextUrl.searchParams.get('search') ?? ''),
}))

export const POST = trackingRoute('manage', async ({ request, actor }) => ({
  units: await verifyExistingStock(actor, await readJson(request)),
}))
