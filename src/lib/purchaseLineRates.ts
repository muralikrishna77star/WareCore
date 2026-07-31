import { hasuraQuery } from '@/lib/hasura/server'
import { PURCHASE_LINE_RATES_QUERY } from '@/lib/hasura/queries'

/**
 * stock_ledger carries no price — resolves a batch of purchase_line_id
 * values back to their billed rate for exports that need a Rate column.
 */
export async function fetchPurchaseLineRateMap(lineIds: (string | null | undefined)[]): Promise<Map<string, number>> {
  const unique = Array.from(new Set(lineIds.filter((id): id is string => !!id)))
  const map = new Map<string, number>()
  if (unique.length === 0) return map

  const result = await hasuraQuery(PURCHASE_LINE_RATES_QUERY, { line_ids: unique })
  for (const item of result.purchase_bill_items ?? []) {
    if (item.purchase_line_id && item.rate != null && !map.has(item.purchase_line_id)) {
      map.set(item.purchase_line_id, Number(item.rate))
    }
  }
  return map
}
