import { readJson, trackingRoute } from '@/lib/tracking/http'
import { createReceipt, jobWorkOptions, listReceipts, receiptCandidates, searchItems } from '@/lib/tracking/jobwork'

export const GET = trackingRoute('view', async ({ request, actor }) => {
  const params = request.nextUrl.searchParams
  const items = params.get('items')
  if (items !== null) return { items: await searchItems(items) }
  if (params.get('vendor')) return receiptCandidates(actor, params.get('company'), params.get('vendor'))
  return { receipts: await listReceipts(actor, params.get('search') ?? ''), ...(await jobWorkOptions(actor)) }
})

export const POST = trackingRoute('manage', async ({ request, actor }) => createReceipt(actor, await readJson(request)))
