import { readJson, trackingRoute } from '@/lib/tracking/http'
import { createDispatch, jobWorkOptions, listDispatches } from '@/lib/tracking/jobwork'

export const GET = trackingRoute('view', async ({ request, actor }) => {
  const params = request.nextUrl.searchParams
  return {
    dispatches: await listDispatches(actor, { search: params.get('search') ?? '', status: params.get('status') ?? '' }),
    ...(await jobWorkOptions(actor)),
  }
})

export const POST = trackingRoute('operate', async ({ request, actor }) => ({
  dispatch: await createDispatch(actor, await readJson(request)),
}))
