import type Anthropic from '@anthropic-ai/sdk'
import { hasuraQuery } from '@/lib/hasura/server'
import { ACTIVE_ITEM_MASTER_QUERY, ITEM_STOCK_LEDGER_QUERY } from '@/lib/hasura/queries'

const ITEM_BY_ID_QUERY = `
  query GetItemById($id: uuid!) {
    item_master(where: { id: { _eq: $id } }, limit: 1) {
      id item_code item_name material_type_id material_size_id size_label unit
      material_types { description unit }
      material_sizes { size_label }
    }
  }
`

const ENTRY_TYPE_LABELS: Record<string, string> = {
  PURCHASE_IN: 'Purchase In',
  VENDOR_RETURN_IN: 'Vendor Return In',
  SALE_OUT: 'Sale / Dispatch',
  SALE_CANCEL: 'Sale Cancelled',
  PURCHASE_CANCEL: 'Purchase Cancelled',
  TRANSFER_OUT: 'Transfer Out',
  TRANSFER_IN: 'Transfer In',
  JOB_WORK_OUT: 'Job Work Out',
  JOB_WORK_RETURN_IN: 'Job Work Return In',
  JOB_WORK_OUTPUT_IN: 'Job Work Output In',
  JOB_WORK_CANCEL: 'Job Work Cancelled',
  ADJUSTMENT_IN: 'Adjustment In',
  ADJUSTMENT_OUT: 'Adjustment Out',
}

export type LedgerRow = {
  date: string
  type: string
  reference: string
  company: string
  warehouse: string
  quantity: number
  balance: number
}

export type LedgerBlock = {
  itemLabel: string
  unit: string
  fromDate: string
  toDate: string
  openingBalance: number
  closingBalance: number
  entries: LedgerRow[]
  truncated: boolean
  itemId: string
}

export const SYSTEM_PROMPT = `You are WareCore Copilot, an assistant embedded in WareCore, a warehouse
management system for steel coil/sheet trading. You help staff look up inventory data.

You have two tools:
- find_item(query): resolves a fuzzy item description (item code, name, material type, size) to
  candidate items in the catalog. Item descriptions are ambiguous on their own — e.g. a size like
  "0.70X121" exists under several different material types (Cold Rolled, Galvanized Iron,
  Galvannealed Steel, Other). Always combine every distinguishing detail from the user's question
  (material type wording, size, code) into the query.
- get_item_ledger(item_id, from_date, to_date): returns the opening balance, dated transactions, and
  closing balance for one item over a date range. Convert any date the user gives you (e.g. "1st Mar
  2024") to YYYY-MM-DD before calling this.

Rules:
- Always call find_item before get_item_ledger unless you already have a confirmed item_id from
  earlier in the conversation.
- If find_item returns more than one plausible match, do NOT guess — ask the user a short
  clarifying question listing the candidates instead of calling get_item_ledger.
- If find_item returns exactly one clear match, proceed directly.
- The ledger data itself is rendered separately in the UI as a table — do not restate every row in
  your reply. Give a brief (1-3 sentence) summary: what item, the date range, opening/closing
  balance, and anything notable (e.g. no activity in range).
- Be concise. This is a chat panel, not a report.`

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'find_item',
    description:
      'Search the item catalog for items matching a fuzzy description (code, name, material type, size). Returns up to 8 candidates.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search text combining every distinguishing detail mentioned by the user.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_item_ledger',
    description:
      'Get the opening balance, transactions, and closing balance for one item between two dates.',
    input_schema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'The item id returned by find_item.' },
        from_date: { type: 'string', description: 'Start date, YYYY-MM-DD.' },
        to_date: { type: 'string', description: 'End date, YYYY-MM-DD.' },
      },
      required: ['item_id', 'from_date', 'to_date'],
    },
  },
]

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter((t) => t.length >= 2)
}

function scoreItem(searchText: string, searchWords: string[], queryTokens: string[]): number {
  let matched = 0
  for (const qt of queryTokens) {
    if (searchText.includes(qt)) {
      matched++
      continue
    }
    // Prefix-stem fallback (e.g. "rolling" ~ "rolled") only applies to purely
    // alphabetic tokens — for tokens with digits (sizes, codes), a shared
    // numeric prefix like "0.70" is meaningless and matches too many items.
    if (qt.length >= 4 && /^[a-z]+$/.test(qt) && searchWords.some((w) => w.length >= 4 && w.slice(0, 4) === qt.slice(0, 4))) {
      matched++
    }
  }
  return matched / queryTokens.length
}

export async function findItem(query: string) {
  const result = await hasuraQuery(ACTIVE_ITEM_MASTER_QUERY)
  const items = (result.item_master ?? []) as {
    id: string
    item_code: string
    item_name: string
    material_types?: { description: string } | null
    material_sizes?: { size_label: string } | null
    size_label?: string | null
    unit: string
  }[]

  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return []

  const scored = items.map((item) => {
    const size = item.material_sizes?.size_label || item.size_label || ''
    const materialDesc = item.material_types?.description || ''
    const searchText = `${item.item_code} ${item.item_name} ${materialDesc} ${size}`.toLowerCase()
    const searchWords = tokenize(searchText)
    return {
      item,
      size,
      materialDesc,
      score: scoreItem(searchText, searchWords, queryTokens),
    }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((s) => ({
      id: s.item.id,
      label: `${s.item.item_code} — ${s.item.item_name}${s.materialDesc ? ` (${s.materialDesc}${s.size ? `, ${s.size}` : ''})` : ''}`,
      unit: s.item.unit,
    }))
}

export async function getItemLedger(
  itemId: string,
  fromDate: string,
  toDate: string
): Promise<LedgerBlock> {
  const itemResult = await hasuraQuery(ITEM_BY_ID_QUERY, { id: itemId })
  const item = itemResult.item_master?.[0]
  if (!item) throw new Error(`Item ${itemId} not found`)

  const materialDesc = item.material_types?.description || '?'
  const size = item.material_sizes?.size_label || item.size_label
  const itemLabel = `${item.item_code} — ${item.item_name}${size ? ` (${size})` : ''}`
  const unit = item.material_types?.unit || item.unit

  const baseConditions: Record<string, unknown>[] = [
    { material_type_id: { _eq: item.material_type_id } },
    item.material_size_id
      ? { material_size_id: { _eq: item.material_size_id } }
      : { material_size_id: { _is_null: true } },
    // Cancellations have their own dedicated pages — keep chat answers focused on net movements,
    // same default as the Item Stock Ledger report for non-admin viewers.
    { entry_type: { _nin: ['PURCHASE_CANCEL', 'SALE_CANCEL', 'JOB_WORK_CANCEL'] } },
  ]

  const openingWhere = { _and: [...baseConditions, { entry_date: { _lt: fromDate } }] }
  const periodWhere = {
    _and: [...baseConditions, { entry_date: { _gte: fromDate } }, { entry_date: { _lte: toDate } }],
  }

  const result = await hasuraQuery(ITEM_STOCK_LEDGER_QUERY, {
    opening_where: openingWhere,
    period_where: periodWhere,
  })

  const openingBalance = Number(result.opening_agg?.aggregate?.sum?.quantity ?? 0)
  const rawEntries = (result.entries ?? []) as {
    id: string
    entry_type: string
    quantity: number | string
    entry_date: string
    reference_number?: string | null
    companies?: { name: string } | null
    warehouses?: { name: string } | null
  }[]

  const MAX_ROWS = 200
  const truncated = rawEntries.length > MAX_ROWS
  const limitedEntries = truncated ? rawEntries.slice(0, MAX_ROWS) : rawEntries

  let running = openingBalance
  const entries: LedgerRow[] = limitedEntries.map((e) => {
    running += Number(e.quantity)
    return {
      date: e.entry_date,
      type: ENTRY_TYPE_LABELS[e.entry_type] ?? e.entry_type,
      reference: e.reference_number || '—',
      company: e.companies?.name || '—',
      warehouse: e.warehouses?.name || '—',
      quantity: Number(e.quantity),
      balance: running,
    }
  })

  // Closing balance reflects the FULL period (not just the truncated display rows).
  const closingBalance =
    openingBalance + rawEntries.reduce((sum, e) => sum + Number(e.quantity), 0)

  return { itemLabel, unit, fromDate, toDate, openingBalance, closingBalance, entries, truncated, itemId }
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<{ result: unknown; ledgerBlock?: LedgerBlock }> {
  if (name === 'find_item') {
    const matches = await findItem(String(input.query ?? ''))
    return { result: { matches } }
  }
  if (name === 'get_item_ledger') {
    const ledger = await getItemLedger(
      String(input.item_id),
      String(input.from_date),
      String(input.to_date)
    )
    // Don't hand the full (potentially 200-row) entry list back into Claude's context —
    // it only needs enough to write a short summary; the UI renders the real table from ledgerBlock.
    const summary = {
      itemLabel: ledger.itemLabel,
      unit: ledger.unit,
      fromDate: ledger.fromDate,
      toDate: ledger.toDate,
      openingBalance: ledger.openingBalance,
      closingBalance: ledger.closingBalance,
      entryCount: ledger.entries.length,
      truncated: ledger.truncated,
    }
    return { result: summary, ledgerBlock: ledger }
  }
  throw new Error(`Unknown tool: ${name}`)
}
