export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import {
  VENDOR_JOB_WORK_LEDGER_QUERY,
  VENDOR_JOB_WORK_ITEM_BALANCES_QUERY,
  VENDOR_JOB_WORK_TRANSFERS_QUERY,
  JOB_WORK_ORDERS_VENDOR_INFO_QUERY,
  JOB_WORK_ORDERS_INPUT_MATERIALS_QUERY,
  DISPATCH_ORDERS_VENDOR_INFO_QUERY,
  ACTIVE_COMPANIES_QUERY,
  ACTIVE_SUPPLIERS_QUERY,
  ACTIVE_ITEM_MASTER_QUERY,
  VENDOR_MOVEMENT_PURCHASE_RATES_QUERY,
} from '@/lib/hasura/queries'
import { VENDOR_MOVEMENT_TYPES, isVendorMovementRow, vendorOutputOrderKey } from '@/lib/stockLedger'
import { PrintButton } from '@/components/PrintButton'
import { ProfessionalExportButton } from '@/components/ProfessionalExportButton'
import { ItemComboBox, type ComboOption } from '@/components/ItemComboBox'
import VendorMovementsTable, { type Transaction } from './VendorMovementsTable'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { QTY_FMT, MONEY_FMT, type ProfessionalSheetSpec } from '@/lib/exportProfessionalExcel'

const fmtC = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const NOT_AVAILABLE = 'Not Available'
const readableName = (v: string | null | undefined) => (v && v !== '—' ? v : NOT_AVAILABLE)

// Mirrors VendorMovementsTable's sourceDestinationFor so the Excel export and
// the on-screen transaction drill-down always agree.
function sourceDestinationFor(
  type: Transaction['type'],
  vendorName: string,
  companyName: string,
  counterpartyVendor: string | null | undefined,
  customerName?: string | null
): { source: string; destination: string } {
  switch (type) {
    case 'Job Work Out':
      return { source: readableName(companyName), destination: readableName(vendorName) }
    case 'Transfer Out':
      return { source: readableName(vendorName), destination: readableName(counterpartyVendor) }
    case 'Transfer In':
      return { source: readableName(counterpartyVendor), destination: readableName(vendorName) }
    case 'Return':
    case 'Return (paired with direct sale)':
      return { source: readableName(vendorName), destination: readableName(companyName) }
    case 'Direct Sale':
      return { source: readableName(vendorName), destination: readableName(customerName) }
    default:
      return { source: NOT_AVAILABLE, destination: NOT_AVAILABLE }
  }
}

// Vendor-stock-movement sign of each transaction type (mirrors
// VendorMovementsTable's runningBalanceEffect) — Job Work Out and Transfer
// In increase the vendor's held stock, Return / Direct Sale / Transfer Out
// decrease it. Independent of the underlying ledger row's own sign
// convention, so the Excel export's Quantity/Running Balance columns always
// agree with the on-screen drill-down.
const runningBalanceEffect: Record<Transaction['type'], 1 | -1> = {
  'Job Work Out': 1,
  'Transfer In': 1,
  Return: -1,
  'Return (paired with direct sale)': -1,
  'Direct Sale': -1,
  'Transfer Out': -1,
}

type ItemOption = ComboOption & {
  material_type_id: string
  material_size_id: string | null
}

// The filterable Transaction Type values, matching the labels used in the
// transaction drill-down (Transaction['type']) — "Return" covers both the
// genuine-Return and paired-virtual-Return variants, since both post as
// JOB_WORK_RETURN_IN ledger entries.
const TRANSACTION_TYPE_OPTIONS = ['Job Work Out', 'Direct Sale', 'Return', 'Transfer Out', 'Transfer In'] as const
type TransactionTypeFilter = (typeof TRANSACTION_TYPE_OPTIONS)[number]

interface Company {
  id: string
  name: string
  code?: string | null
}

interface Supplier {
  id: string
  name: string
}

interface ItemMasterRow {
  id: string
  item_code: string
  item_name: string
  material_type_id: string
  material_size_id: string | null
  size_label?: string | null
  material_sizes?: { size_label: string } | null
}

interface VendorLedgerRow {
  id: string
  entry_type: string
  quantity: number | string
  entry_date: string
  created_at: string
  reference_id: string | null
  reference_number: string | null
  notes: string | null
  company_id: string | null
  material_type_id: string
  material_size_id: string | null
  purchase_line_id: string | null
  sub_purchase_line_id: string | null
  companies: { id: string; name: string; code?: string | null } | null
  material_types: { description: string | null; unit?: string | null } | null
  material_sizes: { size_label: string | null } | null
}

interface VendorJobWorkTransfer {
  transfer_number: string
  from_job_work_order_id: string | null
  to_job_work_order_id: string | null
  from_vendor: { name: string } | null
  to_vendor: { name: string } | null
  job_work_transfer_items: {
    purchase_line_id: string | null
    sub_purchase_line_id: string | null
    quantity_transferred: number | string
  }[]
}

interface JobWorkItemBalanceRow {
  quantity_sent: number | string | null
  is_transfer_line: boolean | null
  material_type_id: string
  material_size_id: string | null
  size_label: string | null
  material_types: { description: string | null; unit?: string | null } | null
  material_sizes: { size_label: string | null } | null
  job_work_orders: {
    vendor_id: string | null
    dispatch_date: string
    status: string
    suppliers: { name: string } | null
    companies: { name: string } | null
  } | null
}

// Common subset of fields ensureGroup() needs, satisfied by both
// VendorLedgerRow (stock_ledger rows) and JobWorkItemBalanceRow
// (job_work_items rows) — the two heterogeneous row shapes it's called with.
interface GroupSourceRow {
  material_type_id: string
  material_size_id?: string | null
  material_types?: { description: string | null; unit?: string | null } | null
  material_sizes?: { size_label: string | null } | null
  size_label?: string | null
}

type GroupRow = {
  key: string
  vendorId: string
  vendorName: string
  companyName: string
  materialTypeId: string
  materialSizeId: string | null
  materialName: string
  sizeLabel: string
  unit: string
  jobWorkOut: number
  directSales: number
  returns: number
  balance: number
  openingBalance: number
  rate: number | null
  purchaseDate: string | null
  transactions: Transaction[]
  transferOutQty: number
  transferOutTo: string[]
  transferInQty: number
  transferInFrom: string[]
}

export default async function VendorMovementsPage({
  searchParams,
}: {
  searchParams: Promise<{
    company?: string
    vendor?: string
    item?: string
    type?: string
    from?: string
    to?: string
    sort?: string
    dir?: string
  }>
}) {
  const params = await searchParams
  const today = new Date().toISOString().split('T')[0]
  const fromDate = params.from || today
  const toDate = params.to || today
  const typeFilter: TransactionTypeFilter | null =
    params.type && (TRANSACTION_TYPE_OPTIONS as readonly string[]).includes(params.type)
      ? (params.type as TransactionTypeFilter)
      : null

  const [compResult, supResult, itemResult] = await Promise.all([
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
    hasuraQuery(ACTIVE_SUPPLIERS_QUERY),
    hasuraQuery(ACTIVE_ITEM_MASTER_QUERY),
  ])

  const companies = (compResult.companies ?? []) as Company[]
  const suppliers = (supResult.suppliers ?? []) as Supplier[]
  const itemRows = (itemResult.item_master ?? []) as ItemMasterRow[]
  const itemOptions: ItemOption[] = itemRows.map((i) => {
    const size = i.material_sizes?.size_label || i.size_label
    return {
      id: i.id,
      label: `${i.item_code} — ${i.item_name}${size ? ` (${size})` : ''}`,
      search: `${i.item_code} ${i.item_name} ${size ?? ''}`.toLowerCase(),
      material_type_id: i.material_type_id,
      material_size_id: i.material_size_id,
    }
  })
  const selectedItem = params.item ? itemOptions.find((i) => i.id === params.item) : undefined
  const itemLookup = new Map<string, { item_code: string; item_name: string }>()
  for (const i of itemRows) {
    itemLookup.set(`${i.material_type_id}|${i.material_size_id ?? ''}`, { item_code: i.item_code, item_name: i.item_name })
  }
  const itemLabelFor = (materialTypeId: string, materialSizeId: string | null, fallback: string) => {
    const info = itemLookup.get(`${materialTypeId}|${materialSizeId ?? ''}`)
    return info ? `${info.item_code} — ${info.item_name}` : fallback
  }

  const baseConditions: Record<string, unknown>[] = []
  if (params.company) baseConditions.push({ company_id: { _eq: params.company } })
  if (selectedItem) {
    baseConditions.push({ material_type_id: { _eq: selectedItem.material_type_id } })
    if (selectedItem.material_size_id) {
      baseConditions.push({ material_size_id: { _eq: selectedItem.material_size_id } })
    }
  }

  // Purchase rate lookup: same result set resolves both the exact purchase
  // behind a specific movement's purchase_line_id, and the latest purchase
  // (date + rate) per material_type + size for the summary row's valuation.
  const rateConditions: Record<string, unknown>[] = [
    { rate: { _is_null: false } },
    { purchase_bill: { status: { _eq: 'active' }, bill_date: { _lte: toDate } } },
  ]
  if (params.company) rateConditions.push({ purchase_bill: { company_id: { _eq: params.company } } })
  if (selectedItem) {
    rateConditions.push({ material_type_id: { _eq: selectedItem.material_type_id } })
    if (selectedItem.material_size_id) {
      rateConditions.push({ material_size_id: { _eq: selectedItem.material_size_id } })
    }
  }
  const rateWhere = { _and: rateConditions }

  const [periodJobWorkResult, cumulativeJobWorkResult, periodSaleResult, periodTransfersResult, jobWorkItemBalanceResult, purchaseRatesResult, transferAuditResult] = await Promise.all([
    hasuraQuery(VENDOR_JOB_WORK_LEDGER_QUERY, {
      where: {
        _and: [
          ...baseConditions,
          { entry_type: { _in: ['JOB_WORK_OUT', 'JOB_WORK_RETURN_IN', 'JOB_WORK_CANCEL', 'JOB_WORK_OUTPUT_IN'] } },
          { reference_type: { _eq: 'job_work' } },
          { entry_date: { _gte: fromDate } },
          { entry_date: { _lte: toDate } },
        ],
      },
    }),
    hasuraQuery(VENDOR_JOB_WORK_LEDGER_QUERY, {
      where: {
        _and: [
          ...baseConditions,
          { entry_type: { _in: [...VENDOR_MOVEMENT_TYPES, 'JOB_WORK_OUTPUT_IN'] } },
          { reference_type: { _eq: 'job_work' } },
          { entry_date: { _lte: toDate } },
        ],
      },
    }),
    hasuraQuery(VENDOR_JOB_WORK_LEDGER_QUERY, {
      where: {
        _and: [
          ...baseConditions,
          { entry_type: { _eq: 'SALE_OUT' } },
          { reference_type: { _eq: 'dispatch' } },
          { entry_date: { _gte: fromDate } },
          { entry_date: { _lte: toDate } },
        ],
      },
    }),
    hasuraQuery(VENDOR_JOB_WORK_LEDGER_QUERY, {
      where: {
        _and: [
          ...baseConditions,
          { entry_type: { _in: ['JOB_WORK_TRANSFER_OUT', 'JOB_WORK_TRANSFER_IN'] } },
          { reference_type: { _eq: 'job_work' } },
          { entry_date: { _gte: fromDate } },
          { entry_date: { _lte: toDate } },
        ],
      },
    }),
    hasuraQuery(VENDOR_JOB_WORK_ITEM_BALANCES_QUERY, {
      where: {
        _and: [
          ...baseConditions,
          { job_work_orders: { status: { _neq: 'cancelled' } } },
          { job_work_orders: { dispatch_date: { _lte: toDate } } },
        ],
      },
    }),
    hasuraQuery(VENDOR_MOVEMENT_PURCHASE_RATES_QUERY, { where: rateWhere }),
    hasuraQuery(VENDOR_JOB_WORK_TRANSFERS_QUERY),
  ])

  const periodJobWork = (periodJobWorkResult.stock_ledger ?? []) as VendorLedgerRow[]
  const cumulativeJobWork = (cumulativeJobWorkResult.stock_ledger ?? []) as VendorLedgerRow[]
  const periodSales = (periodSaleResult.stock_ledger ?? []) as VendorLedgerRow[]
  const periodTransfers = (periodTransfersResult.stock_ledger ?? []) as VendorLedgerRow[]
  const jobWorkItemBalances = (jobWorkItemBalanceResult.job_work_items ?? []) as JobWorkItemBalanceRow[]

  // A JOB_WORK_OUTPUT_IN row only counts as a vendor movement when its
  // order's Output Materials line matches one of that order's own INPUT
  // lines' material — no real conversion happened, so it's really the
  // vendor-return leg (migration 123). Same authoritative check as the
  // Stock Statement / Item Stock Ledger reports (isVendorMovementRow).
  const outputOrderIds = Array.from(
    new Set(
      [...periodJobWork, ...cumulativeJobWork]
        .filter((r) => r.entry_type === 'JOB_WORK_OUTPUT_IN' && r.reference_id)
        .map((r) => r.reference_id as string)
    )
  )
  const sameMaterialOutputKeys = new Set<string>()
  if (outputOrderIds.length > 0) {
    const matchingInputResult = await hasuraQuery(JOB_WORK_ORDERS_INPUT_MATERIALS_QUERY, { ids: outputOrderIds })
    const rowsIn: { job_work_order_id: string; material_type_id: string; material_size_id: string | null }[] =
      matchingInputResult.job_work_items ?? []
    for (const r of rowsIn) sameMaterialOutputKeys.add(vendorOutputOrderKey(r.job_work_order_id, r.material_type_id, r.material_size_id))
  }
  const isCountedVendorRow = (m: VendorLedgerRow) =>
    isVendorMovementRow(m.entry_type, m.reference_id, m.material_type_id, m.material_size_id, sameMaterialOutputKeys)

  // Counterparty vendor lookup for a JOB_WORK_TRANSFER_OUT/IN ledger row —
  // the ledger row only carries one side of the movement (the order it's
  // posted against), so the other vendor's name comes from the transfer
  // audit trail (job_work_transfers/job_work_transfer_items), matched by
  // order + line + quantity. Table is tiny, so an exact-quantity match is
  // reliable enough for a display-only label (dates/quantities shown to
  // the user always come from the ledger row itself, never from here).
  const transferOutCounterparty = new Map<string, { vendorName: string; transferNumber: string }>()
  const transferInCounterparty = new Map<string, { vendorName: string; transferNumber: string }>()
  for (const t of (transferAuditResult.job_work_transfers ?? []) as VendorJobWorkTransfer[]) {
    for (const item of t.job_work_transfer_items ?? []) {
      const lineId = item.sub_purchase_line_id || item.purchase_line_id
      if (!lineId) continue
      const qtyKey = Number(item.quantity_transferred).toFixed(3)
      if (t.from_job_work_order_id) {
        transferOutCounterparty.set(`${t.from_job_work_order_id}|${lineId}|${qtyKey}`, {
          vendorName: t.to_vendor?.name || '—',
          transferNumber: t.transfer_number,
        })
      }
      if (t.to_job_work_order_id) {
        transferInCounterparty.set(`${t.to_job_work_order_id}|${lineId}|${qtyKey}`, {
          vendorName: t.from_vendor?.name || '—',
          transferNumber: t.transfer_number,
        })
      }
    }
  }

  // Newest-first order: first hit per purchase_line_id is that exact line;
  // first hit per material_type_id|material_size_id is the latest purchase.
  const lineDateRateMap = new Map<string, { rate: number; date: string }>()
  const latestByMaterialMap = new Map<string, { rate: number; date: string }>()
  for (const row of (purchaseRatesResult.purchase_bill_items ?? []) as {
    purchase_line_id: string | null
    material_type_id: string
    material_size_id: string | null
    rate: number | string
    purchase_bill: { bill_date: string } | null
  }[]) {
    const rate = Number(row.rate)
    const date = row.purchase_bill?.bill_date
    if (!date) continue
    if (row.purchase_line_id && !lineDateRateMap.has(row.purchase_line_id)) {
      lineDateRateMap.set(row.purchase_line_id, { rate, date })
    }
    const materialKey = `${row.material_type_id}|${row.material_size_id ?? ''}`
    if (!latestByMaterialMap.has(materialKey)) {
      latestByMaterialMap.set(materialKey, { rate, date })
    }
  }

  // Resolve dispatch orders behind the SALE_OUT entries to find which were
  // vendor-direct (sold straight from the vendor's site, never returned to a
  // warehouse) and which job work order they're sourced from.
  const dispatchIds = Array.from(new Set(periodSales.map((m) => m.reference_id).filter(Boolean)))
  const dispatchInfoResult = dispatchIds.length > 0
    ? await hasuraQuery(DISPATCH_ORDERS_VENDOR_INFO_QUERY, { ids: dispatchIds })
    : { dispatch_orders: [] }
  const dispatchInfoById = new Map<string, { is_vendor_direct: boolean; source_job_work_order_id: string | null; customerName: string | null }>()
  for (const d of dispatchInfoResult.dispatch_orders ?? []) {
    dispatchInfoById.set(d.id, {
      is_vendor_direct: d.is_vendor_direct,
      source_job_work_order_id: d.source_job_work_order_id,
      customerName: d.customers?.name ?? null,
    })
  }

  // Collect every job work order id we need vendor info for: those directly
  // referenced by job-work ledger entries, plus those backing vendor-direct sales.
  const jobWorkOrderIds = new Set<string>()
  for (const m of [...periodJobWork, ...cumulativeJobWork, ...periodTransfers]) {
    if (m.reference_id) jobWorkOrderIds.add(m.reference_id)
  }
  for (const info of dispatchInfoById.values()) {
    if (info.is_vendor_direct && info.source_job_work_order_id) jobWorkOrderIds.add(info.source_job_work_order_id)
  }

  const jwoInfoResult = jobWorkOrderIds.size > 0
    ? await hasuraQuery(JOB_WORK_ORDERS_VENDOR_INFO_QUERY, { ids: Array.from(jobWorkOrderIds) })
    : { job_work_orders: [] }
  const jwoInfoById = new Map<string, { vendor_id: string; vendor_name: string; company_name: string }>()
  for (const o of jwoInfoResult.job_work_orders ?? []) {
    jwoInfoById.set(o.id, {
      vendor_id: o.vendor_id,
      vendor_name: o.suppliers?.name || '—',
      company_name: o.companies?.name || '—',
    })
  }

  const vendorFilter = params.vendor || null

  const groups = new Map<string, GroupRow>()
  const groupKey = (vendorId: string, materialTypeId: string, materialSizeId: string | null) =>
    `${vendorId}|${materialTypeId}|${materialSizeId ?? ''}`

  const ensureGroup = (vendorId: string, vendorName: string, companyName: string, m: GroupSourceRow): GroupRow => {
    const key = groupKey(vendorId, m.material_type_id, m.material_size_id ?? null)
    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        vendorId,
        vendorName,
        companyName,
        materialTypeId: m.material_type_id,
        materialSizeId: m.material_size_id ?? null,
        materialName: m.material_types?.description || '—',
        sizeLabel: m.size_label || m.material_sizes?.size_label || '—',
        unit: m.material_types?.unit || '',
        jobWorkOut: 0,
        directSales: 0,
        returns: 0,
        balance: 0,
        openingBalance: 0,
        rate: null,
        purchaseDate: null,
        transactions: [],
        transferOutQty: 0,
        transferOutTo: [],
        transferInQty: 0,
        transferInFrom: [],
      }
      groups.set(key, g)
    }
    return g
  }

  // Period job work out / return in (drives the Job Work Out + Returns columns,
  // pending Direct Sales subtraction below). Gated by the Transaction Type
  // filter — "Job Work Out" keeps only JOB_WORK_OUT rows, "Return" keeps
  // JOB_WORK_RETURN_IN plus the same-material-return categories below, any
  // other selected type excludes this query's rows entirely.
  const jobWorkEntryAllowed = (entryType: string) => {
    if (!typeFilter) return true
    if (typeFilter === 'Job Work Out') return entryType === 'JOB_WORK_OUT'
    if (typeFilter === 'Return') return entryType === 'JOB_WORK_RETURN_IN' || entryType === 'JOB_WORK_CANCEL' || entryType === 'JOB_WORK_OUTPUT_IN'
    return false
  }
  const periodReturnInByKey = new Map<string, number>()
  // Material returned via an "Output Materials" line recorded against the
  // same material as sent (migration 123), and any JOB_WORK_CANCEL rows
  // correcting a mis-entered one of those — neither posts a
  // JOB_WORK_RETURN_IN row, so both are invisible to the Returns column
  // unless tracked separately here. Netted per key (not pushed as raw
  // transactions) so a mistaken Output Materials entry that got corrected
  // within the period shows as one rolled-up Return, not a double-counted
  // pair.
  const periodOutputCorrectionByKey = new Map<string, { qty: number; date: string }>()
  for (const m of periodJobWork) {
    const info = m.reference_id ? jwoInfoById.get(m.reference_id) : undefined
    if (!info) continue
    if (vendorFilter && info.vendor_id !== vendorFilter) continue
    if (!jobWorkEntryAllowed(m.entry_type)) continue
    if (m.entry_type === 'JOB_WORK_OUTPUT_IN' && !isCountedVendorRow(m)) continue
    const purchaseInfo = m.purchase_line_id ? lineDateRateMap.get(m.purchase_line_id) : undefined
    if (m.entry_type === 'JOB_WORK_OUT') {
      const g = ensureGroup(info.vendor_id, info.vendor_name, info.company_name, m)
      g.jobWorkOut += Math.abs(Number(m.quantity))
      g.transactions.push({
        id: m.id, date: m.entry_date, type: 'Job Work Out',
        quantity: Number(m.quantity), reference_number: m.reference_number, notes: m.notes,
        purchaseDate: purchaseInfo?.date ?? null, rate: purchaseInfo?.rate ?? null,
      })
    } else if (m.entry_type === 'JOB_WORK_RETURN_IN') {
      const g = ensureGroup(info.vendor_id, info.vendor_name, info.company_name, m)
      const key = groupKey(info.vendor_id, m.material_type_id, m.material_size_id ?? null)
      periodReturnInByKey.set(key, (periodReturnInByKey.get(key) ?? 0) + Number(m.quantity))
      const isVirtual = (m.notes || '').toLowerCase().includes('virtual return')
      g.transactions.push({
        id: m.id, date: m.entry_date,
        type: isVirtual ? 'Return (paired with direct sale)' : 'Return',
        quantity: Number(m.quantity), reference_number: m.reference_number, notes: m.notes,
        purchaseDate: purchaseInfo?.date ?? null, rate: purchaseInfo?.rate ?? null,
      })
    } else {
      // JOB_WORK_CANCEL or a same-material JOB_WORK_OUTPUT_IN.
      ensureGroup(info.vendor_id, info.vendor_name, info.company_name, m)
      const key = groupKey(info.vendor_id, m.material_type_id, m.material_size_id ?? null)
      const running = periodOutputCorrectionByKey.get(key) ?? { qty: 0, date: m.entry_date }
      running.qty += Number(m.quantity)
      if (m.entry_date > running.date) running.date = m.entry_date
      periodOutputCorrectionByKey.set(key, running)
    }
  }
  for (const [key, { qty, date }] of periodOutputCorrectionByKey) {
    if (qty <= 0.0005) continue
    periodReturnInByKey.set(key, (periodReturnInByKey.get(key) ?? 0) + qty)
    const g = Array.from(groups.values()).find((row) => row.key === key)
    g?.transactions.push({
      id: `output-return-${key}`, date, type: 'Return',
      quantity: qty, reference_number: null,
      notes: 'Returned via Output Materials (same material as sent)',
      purchaseDate: null, rate: null,
    })
  }

  // Vendor-to-vendor transfers: shown on *both* sides — a Transfer Out row
  // under the source vendor and a Transfer In row under the destination
  // vendor — so a transfer is visible wherever the material is being
  // tracked, not just baked silently into the Balance column.
  const transferEntryAllowed = (entryType: string) => {
    if (!typeFilter) return true
    if (typeFilter === 'Transfer Out') return entryType === 'JOB_WORK_TRANSFER_OUT'
    if (typeFilter === 'Transfer In') return entryType === 'JOB_WORK_TRANSFER_IN'
    return false
  }
  for (const m of periodTransfers) {
    const info = m.reference_id ? jwoInfoById.get(m.reference_id) : undefined
    if (!info) continue
    if (vendorFilter && info.vendor_id !== vendorFilter) continue
    if (!transferEntryAllowed(m.entry_type)) continue
    const g = ensureGroup(info.vendor_id, info.vendor_name, info.company_name, m)
    const lineId = m.sub_purchase_line_id || m.purchase_line_id
    const qtyKey = Math.abs(Number(m.quantity)).toFixed(3)
    if (m.entry_type === 'JOB_WORK_TRANSFER_OUT') {
      const counterparty = lineId ? transferOutCounterparty.get(`${m.reference_id}|${lineId}|${qtyKey}`) : undefined
      g.transactions.push({
        id: m.id, date: m.entry_date, type: 'Transfer Out',
        quantity: Number(m.quantity), reference_number: m.reference_number,
        notes: counterparty ? `Transferred to ${counterparty.vendorName} (${counterparty.transferNumber})` : m.notes,
        purchaseDate: null, rate: null,
        counterpartyVendor: counterparty?.vendorName ?? null,
      })
      g.transferOutQty += Math.abs(Number(m.quantity))
      if (counterparty && !g.transferOutTo.includes(counterparty.vendorName)) g.transferOutTo.push(counterparty.vendorName)
    } else if (m.entry_type === 'JOB_WORK_TRANSFER_IN') {
      const counterparty = lineId ? transferInCounterparty.get(`${m.reference_id}|${lineId}|${qtyKey}`) : undefined
      g.transactions.push({
        id: m.id, date: m.entry_date, type: 'Transfer In',
        quantity: Number(m.quantity), reference_number: m.reference_number,
        notes: counterparty ? `Transferred from ${counterparty.vendorName} (${counterparty.transferNumber})` : m.notes,
        purchaseDate: null, rate: null,
        counterpartyVendor: counterparty?.vendorName ?? null,
      })
      g.transferInQty += Math.abs(Number(m.quantity))
      if (counterparty && !g.transferInFrom.includes(counterparty.vendorName)) g.transferInFrom.push(counterparty.vendorName)
    }
  }

  // Direct sales: SALE_OUT entries on vendor-direct dispatches, attributed back
  // to the vendor that held the material.
  for (const m of periodSales) {
    if (typeFilter && typeFilter !== 'Direct Sale') continue
    const dispatch = m.reference_id ? dispatchInfoById.get(m.reference_id) : undefined
    if (!dispatch?.is_vendor_direct || !dispatch.source_job_work_order_id) continue
    const info = jwoInfoById.get(dispatch.source_job_work_order_id)
    if (!info) continue
    if (vendorFilter && info.vendor_id !== vendorFilter) continue
    const g = ensureGroup(info.vendor_id, info.vendor_name, info.company_name, m)
    g.directSales += Math.abs(Number(m.quantity))
    const purchaseInfo = m.purchase_line_id ? lineDateRateMap.get(m.purchase_line_id) : undefined
    g.transactions.push({
      id: m.id, date: m.entry_date, type: 'Direct Sale',
      quantity: Number(m.quantity), reference_number: m.reference_number, notes: m.notes,
      purchaseDate: purchaseInfo?.date ?? null, rate: purchaseInfo?.rate ?? null,
      customerName: dispatch.customerName,
    })
  }

  // Returns shown to the user are genuine physical returns only — the ledger's
  // JOB_WORK_RETURN_IN total also includes a "virtual return" leg paired with
  // each direct sale, which nets out via the Direct Sales column instead.
  for (const [key, rawReturnIn] of periodReturnInByKey) {
    const g = groups.get(key)
    if (g) g.returns = Math.max(0, rawReturnIn - g.directSales)
  }

  // Cumulative-to-date balance (as of the To date), independent of the From
  // date. Ledger JOB_WORK_OUT rows are the primary source for the outbound
  // side — same inclusion/sign rules as vw_current_vendor_stock (090/123),
  // so this agrees with Stock Statement's "Stock at Vendor" by construction.
  // job_work_items.quantity_sent is kept only as a floor beneath that
  // (Math.max below), for the rare historic/imported line whose matching
  // JOB_WORK_OUT ledger row was never posted (migration 125) — transfer-
  // destination lines (is_transfer_line = true) are excluded from that floor
  // since their quantity_sent is already covered by the explicit
  // JOB_WORK_TRANSFER_IN addition below, and double-counting it would
  // otherwise inflate the receiving vendor's balance. ensureGroup() is
  // called directly from the jobWorkItemBalances loop (not just from the
  // ledger loop) so a vendor+material combo whose only activity is a
  // transfer still gets a row instead of being silently dropped.
  const cumulativeOutByKey = new Map<string, number>()
  const cumulativeLedgerOutByKey = new Map<string, number>()
  const cumulativeReductionByKey = new Map<string, number>() // RETURN_IN + CANCEL + same-material OUTPUT_IN, raw signed qty
  const cumulativeTransferOutByKey = new Map<string, number>()
  const cumulativeTransferInByKey = new Map<string, number>()
  for (const item of jobWorkItemBalances) {
    const order = item.job_work_orders
    if (!order?.vendor_id) continue
    if (vendorFilter && order.vendor_id !== vendorFilter) continue
    ensureGroup(order.vendor_id, order.suppliers?.name || '—', order.companies?.name || '—', item)
    if (item.is_transfer_line) continue
    const key = groupKey(order.vendor_id, item.material_type_id, item.material_size_id ?? null)
    cumulativeOutByKey.set(key, (cumulativeOutByKey.get(key) ?? 0) + Number(item.quantity_sent ?? 0))
  }
  for (const m of cumulativeJobWork) {
    const info = m.reference_id ? jwoInfoById.get(m.reference_id) : undefined
    if (!info) continue
    if (vendorFilter && info.vendor_id !== vendorFilter) continue
    if (!isCountedVendorRow(m)) continue
    ensureGroup(info.vendor_id, info.vendor_name, info.company_name, m)
    const key = groupKey(info.vendor_id, m.material_type_id, m.material_size_id ?? null)
    const qty = Number(m.quantity)
    if (m.entry_type === 'JOB_WORK_OUT') {
      cumulativeLedgerOutByKey.set(key, (cumulativeLedgerOutByKey.get(key) ?? 0) + Math.abs(qty))
    } else if (m.entry_type === 'JOB_WORK_TRANSFER_OUT') {
      cumulativeTransferOutByKey.set(key, (cumulativeTransferOutByKey.get(key) ?? 0) + Math.abs(qty))
    } else if (m.entry_type === 'JOB_WORK_TRANSFER_IN') {
      cumulativeTransferInByKey.set(key, (cumulativeTransferInByKey.get(key) ?? 0) + qty)
    } else {
      // JOB_WORK_RETURN_IN, JOB_WORK_CANCEL, same-material JOB_WORK_OUTPUT_IN.
      cumulativeReductionByKey.set(key, (cumulativeReductionByKey.get(key) ?? 0) + qty)
    }
  }
  // Opening balance (as of the day before the From date): the same
  // cumulative formula as the closing balance above, just re-summed over
  // the already-fetched jobWorkItemBalances/cumulativeJobWork datasets
  // restricted to activity strictly before fromDate — both datasets are
  // fetched unbounded-below (dispatch_date/entry_date <= toDate only), so
  // no extra query is needed to isolate the pre-period slice.
  const openingOutByKey = new Map<string, number>()
  const openingLedgerOutByKey = new Map<string, number>()
  const openingReductionByKey = new Map<string, number>()
  const openingTransferOutByKey = new Map<string, number>()
  const openingTransferInByKey = new Map<string, number>()
  for (const item of jobWorkItemBalances) {
    const order = item.job_work_orders
    if (!order?.vendor_id || order.dispatch_date >= fromDate || item.is_transfer_line) continue
    if (vendorFilter && order.vendor_id !== vendorFilter) continue
    const key = groupKey(order.vendor_id, item.material_type_id, item.material_size_id ?? null)
    openingOutByKey.set(key, (openingOutByKey.get(key) ?? 0) + Number(item.quantity_sent ?? 0))
  }
  for (const m of cumulativeJobWork) {
    if (m.entry_date >= fromDate) continue
    const info = m.reference_id ? jwoInfoById.get(m.reference_id) : undefined
    if (!info) continue
    if (vendorFilter && info.vendor_id !== vendorFilter) continue
    if (!isCountedVendorRow(m)) continue
    const key = groupKey(info.vendor_id, m.material_type_id, m.material_size_id ?? null)
    const qty = Number(m.quantity)
    if (m.entry_type === 'JOB_WORK_OUT') {
      openingLedgerOutByKey.set(key, (openingLedgerOutByKey.get(key) ?? 0) + Math.abs(qty))
    } else if (m.entry_type === 'JOB_WORK_TRANSFER_OUT') {
      openingTransferOutByKey.set(key, (openingTransferOutByKey.get(key) ?? 0) + Math.abs(qty))
    } else if (m.entry_type === 'JOB_WORK_TRANSFER_IN') {
      openingTransferInByKey.set(key, (openingTransferInByKey.get(key) ?? 0) + qty)
    } else {
      openingReductionByKey.set(key, (openingReductionByKey.get(key) ?? 0) + qty)
    }
  }

  for (const g of groups.values()) {
    const outQty = Math.max(cumulativeLedgerOutByKey.get(g.key) ?? 0, cumulativeOutByKey.get(g.key) ?? 0)
    const openingOutQty = Math.max(openingLedgerOutByKey.get(g.key) ?? 0, openingOutByKey.get(g.key) ?? 0)
    g.balance =
      outQty +
      (cumulativeTransferInByKey.get(g.key) ?? 0) -
      (cumulativeReductionByKey.get(g.key) ?? 0) -
      (cumulativeTransferOutByKey.get(g.key) ?? 0)
    g.openingBalance =
      openingOutQty +
      (openingTransferInByKey.get(g.key) ?? 0) -
      (openingReductionByKey.get(g.key) ?? 0) -
      (openingTransferOutByKey.get(g.key) ?? 0)
    const latest = latestByMaterialMap.get(`${g.materialTypeId}|${g.materialSizeId ?? ''}`)
    if (latest) {
      g.rate = latest.rate
      g.purchaseDate = latest.date
    }
  }

  // Exclude a row only when every quantity-related column on it is zero —
  // job work out, direct sales, returns, both transfer directions, and the
  // cumulative balance. A row with movement in any one of these stays
  // visible even if, say, its closing balance nets to zero.
  const isNonZeroQty = (n: number) => Math.abs(n) > 0.0005
  let rows = Array.from(groups.values()).filter((g) =>
    [g.jobWorkOut, g.directSales, g.returns, g.transferOutQty, g.transferInQty, g.balance].some(isNonZeroQty)
  )
  for (const g of rows) {
    g.transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  }

  // Sorting
  const sortGetters: Record<string, (g: GroupRow) => string | number> = {
    vendor: (g) => g.vendorName,
    company: (g) => g.companyName,
    item: (g) => itemLabelFor(g.materialTypeId, g.materialSizeId, g.materialName),
    size: (g) => g.sizeLabel,
    opening_balance: (g) => g.openingBalance,
    job_work_out: (g) => g.jobWorkOut,
    direct_sales: (g) => g.directSales,
    returns: (g) => g.returns,
    balance: (g) => g.balance,
    purchase_date: (g) => g.purchaseDate ?? '',
    rate: (g) => g.rate ?? 0,
    valuation: (g) => (g.rate ? g.balance * g.rate : 0),
  }
  const activeSort = params.sort && sortGetters[params.sort] ? params.sort : 'vendor'
  const activeDir = params.dir === 'desc' ? 'desc' : 'asc'
  rows = rows.sort((a, b) => {
    const av = sortGetters[activeSort](a)
    const bv = sortGetters[activeSort](b)
    const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
    return activeDir === 'desc' ? -cmp : cmp
  })

  const totals = rows.reduce(
    (acc, g) => ({
      openingBalance: acc.openingBalance + g.openingBalance,
      jobWorkOut: acc.jobWorkOut + g.jobWorkOut,
      directSales: acc.directSales + g.directSales,
      returns: acc.returns + g.returns,
      transferOutQty: acc.transferOutQty + g.transferOutQty,
      transferInQty: acc.transferInQty + g.transferInQty,
      balance: acc.balance + g.balance,
      valuation: acc.valuation + (g.rate ? g.balance * g.rate : 0),
    }),
    { openingBalance: 0, jobWorkOut: 0, directSales: 0, returns: 0, transferOutQty: 0, transferInQty: 0, balance: 0, valuation: 0 }
  )

  // Reconciliation check: the closing balance must equal opening balance plus
  // every visible movement category — Job Work Out and Transfers In increase
  // vendor stock, Returns/Direct Sales/Transfers Out decrease it. A non-zero
  // gap here means a movement category is missing or mis-signed somewhere
  // upstream, not just an isolated rounding difference.
  const derivedClosing =
    totals.openingBalance + totals.jobWorkOut + totals.transferInQty - totals.returns - totals.directSales - totals.transferOutQty
  const reconciliationDiff = totals.balance - derivedClosing
  const isReconciled = Math.abs(reconciliationDiff) < 0.0005

  const sortHref = (column: string) => {
    const next = new URLSearchParams()
    if (params.company) next.set('company', params.company)
    if (params.vendor) next.set('vendor', params.vendor)
    if (params.item) next.set('item', params.item)
    if (typeFilter) next.set('type', typeFilter)
    next.set('from', fromDate)
    next.set('to', toDate)
    next.set('sort', column)
    next.set('dir', activeSort === column && activeDir === 'asc' ? 'desc' : 'asc')
    return `/reports/vendor-movements?${next.toString()}`
  }
  const sortHrefs = Object.fromEntries(
    ['vendor', 'company', 'item', 'size', 'opening_balance', 'job_work_out', 'direct_sales', 'returns', 'balance', 'purchase_date', 'rate', 'valuation'].map((c) => [c, sortHref(c)])
  )

  const tableRows = rows.map((g) => ({
    key: g.key,
    vendorName: g.vendorName,
    companyName: g.companyName,
    itemLabel: itemLabelFor(g.materialTypeId, g.materialSizeId, g.materialName),
    sizeLabel: g.sizeLabel,
    unit: g.unit,
    openingBalance: g.openingBalance,
    jobWorkOut: g.jobWorkOut,
    directSales: g.directSales,
    returns: g.returns,
    transferOutQty: g.transferOutQty,
    transferInQty: g.transferInQty,
    balance: g.balance,
    rate: g.rate,
    purchaseDate: g.purchaseDate,
    transactions: g.transactions,
  }))

  const exportMeta = {
    companyName: companies.find((c) => c.id === params.company)?.name || 'All Companies',
    fromDate,
    toDate,
    filterLine: [
      `Vendor: ${suppliers.find((s) => s.id === params.vendor)?.name || 'All Vendors'}`,
      `Item: ${selectedItem?.label || 'All Items'}`,
      `Transaction Type: ${typeFilter || 'All Types'}`,
    ].join('   |   '),
    generatedBy: '',
  }
  const summarySheet: ProfessionalSheetSpec = {
    sheetName: 'Vendor Movements',
    title: 'Vendorwise Stock Movement — Summary',
    emptyMessage: 'No vendor movements found for the selected period.',
    columns: [
      { header: 'Vendor', key: 'vendor', width: 22, align: 'left' },
      { header: 'Company', key: 'company', width: 18, align: 'left' },
      { header: 'Item', key: 'item', width: 26, align: 'left' },
      { header: 'Size', key: 'size', width: 12, align: 'left' },
      { header: `Opening Balance (${fromDate})`, key: 'openingBalance', width: 18, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Job Work Out', key: 'jobWorkOut', width: 16, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Direct Sales', key: 'directSales', width: 16, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Returns', key: 'returns', width: 14, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Transferred Out', key: 'transferOutQty', width: 16, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Transferred Out To', key: 'transferOutTo', width: 24, align: 'left' },
      { header: 'Transferred In', key: 'transferInQty', width: 16, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Transferred In From', key: 'transferInFrom', width: 24, align: 'left' },
      { header: `Closing Balance (${toDate})`, key: 'balance', width: 18, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum', negativeWarning: true },
      { header: 'Purchase Date', key: 'purchaseDate', width: 16, align: 'center', isDate: true },
      { header: 'Rate (₹)', key: 'rate', width: 12, align: 'right', numFmt: MONEY_FMT },
      { header: 'Valuation (₹)', key: 'valuation', width: 18, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
    ],
    rows: rows.map((g) => ({
      vendor: g.vendorName,
      company: g.companyName,
      item: itemLabelFor(g.materialTypeId, g.materialSizeId, g.materialName),
      size: g.sizeLabel || '',
      openingBalance: g.openingBalance,
      jobWorkOut: g.jobWorkOut,
      directSales: g.directSales,
      returns: g.returns,
      transferOutQty: g.transferOutQty || null,
      transferOutTo: g.transferOutTo.join('; '),
      transferInQty: g.transferInQty || null,
      transferInFrom: g.transferInFrom.join('; '),
      balance: g.balance,
      purchaseDate: g.purchaseDate || null,
      rate: g.rate || null,
      valuation: g.rate ? g.balance * g.rate : null,
    })),
  }
  const transactionDetailsSheet: ProfessionalSheetSpec = {
    sheetName: 'Transaction Details',
    title: 'Vendorwise Stock Movement — Transaction Details',
    emptyMessage: 'No vendor transactions found for the selected period.',
    columns: [
      { header: 'S.No.', key: 'sno', width: 8, align: 'center' },
      { header: 'Transaction Date', key: 'date', width: 16, align: 'center', isDate: true },
      { header: 'Transaction Type', key: 'type', width: 22, align: 'left' },
      { header: 'Source', key: 'source', width: 22, align: 'left' },
      { header: 'Destination', key: 'destination', width: 22, align: 'left' },
      { header: 'Vendor', key: 'vendor', width: 22, align: 'left' },
      { header: 'Company', key: 'company', width: 18, align: 'left' },
      { header: 'Item', key: 'item', width: 26, align: 'left' },
      { header: 'Size', key: 'size', width: 12, align: 'left' },
      { header: 'Quantity', key: 'quantity', width: 14, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Reference', key: 'reference', width: 18, align: 'left' },
      { header: 'Rate (₹)', key: 'rate', width: 12, align: 'right', numFmt: MONEY_FMT },
      { header: 'Running Balance', key: 'runningBalance', width: 16, align: 'right', numFmt: QTY_FMT },
      { header: 'Notes', key: 'notes', width: 30, align: 'left' },
    ],
    rows: rows.flatMap((g) => {
      let running = g.openingBalance
      return g.transactions.map((t) => {
        const { source, destination } = sourceDestinationFor(t.type, g.vendorName, g.companyName, t.counterpartyVendor, t.customerName)
        running += runningBalanceEffect[t.type] * Math.abs(t.quantity)
        return {
          date: t.date,
          vendor: g.vendorName,
          company: g.companyName,
          item: itemLabelFor(g.materialTypeId, g.materialSizeId, g.materialName),
          size: g.sizeLabel || '',
          type: t.type,
          source,
          destination,
          quantity: runningBalanceEffect[t.type] * Math.abs(t.quantity),
          reference: t.reference_number || '',
          rate: t.rate ?? null,
          runningBalance: running,
          notes: t.notes || '',
        }
      })
    }).map((row, idx) => ({ sno: idx + 1, ...row })),
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendorwise Stock Movement</h1>
          <p className="text-sm text-gray-500 mt-1">Job work out, direct sales, returns and pending balance, by vendor</p>
        </div>
        <div className="flex items-center gap-2">
          {tableRows.length > 0 && (
            <ProfessionalExportButton
              meta={exportMeta}
              sheets={[summarySheet, transactionDetailsSheet]}
              filenameBase="Vendor_Movements"
              successMessage="Vendor Movements exported successfully."
              errorMessage="Unable to export Vendor Movements. Please try again."
            />
          )}
          <PrintButton />
          <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"><ArrowLeft className="h-4 w-4" /> Reports</Link>
        </div>
      </div>

      <div className="hidden print:block text-center mb-4">
        <h1 className="text-xl font-bold">Vendorwise Stock Movement</h1>
        <p className="text-sm text-gray-600">{fromDate} to {toDate}</p>
      </div>

      {/* Filters */}
      <form className="bg-white rounded-xl border p-4 print:hidden">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Company</label>
            <select name="company" defaultValue={params.company || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none">
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Vendor</label>
            <select name="vendor" defaultValue={params.vendor || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none">
              <option value="">All Vendors</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="min-w-[14rem]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Item</label>
            <ItemComboBox
              name="item"
              defaultValue={params.item || ''}
              defaultLabel={selectedItem?.label || ''}
              placeholder="Search item…"
              options={itemOptions}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Transaction Type</label>
            <select name="type" defaultValue={typeFilter || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none">
              <option value="">All Types</option>
              {TRANSACTION_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
            <input type="date" name="from" defaultValue={fromDate} className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
            <input type="date" name="to" defaultValue={toDate} className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
          </div>
          <button type="submit" className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Apply</button>
          <a href="/reports/vendor-movements" className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Clear</a>
        </div>
      </form>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border bg-slate-50 p-4">
          <p className="text-xs text-gray-500">Opening Balance ({fromDate})</p>
          <p className="text-xl font-bold text-slate-800">{totals.openingBalance.toFixed(3)}</p>
        </div>
        <div className="rounded-xl border bg-purple-50 p-4">
          <p className="text-xs text-gray-500">Job Work Out</p>
          <p className="text-xl font-bold text-purple-800">{totals.jobWorkOut.toFixed(3)}</p>
        </div>
        <div className="rounded-xl border bg-indigo-50 p-4">
          <p className="text-xs text-gray-500">Transfers In</p>
          <p className="text-xl font-bold text-indigo-800">{totals.transferInQty.toFixed(3)}</p>
        </div>
        <div className="rounded-xl border bg-orange-50 p-4">
          <p className="text-xs text-gray-500">Transfers Out</p>
          <p className="text-xl font-bold text-orange-800">{totals.transferOutQty.toFixed(3)}</p>
        </div>
        <div className="rounded-xl border bg-teal-50 p-4">
          <p className="text-xs text-gray-500">Returns</p>
          <p className="text-xl font-bold text-teal-800">{totals.returns.toFixed(3)}</p>
        </div>
        <div className="rounded-xl border bg-red-50 p-4">
          <p className="text-xs text-gray-500">Direct Sales</p>
          <p className="text-xl font-bold text-red-700">{totals.directSales.toFixed(3)}</p>
        </div>
        <div className="rounded-xl border bg-blue-50 p-4">
          <p className="text-xs text-gray-500">Closing Balance ({toDate})</p>
          <p className="text-xl font-bold text-blue-800">{totals.balance.toFixed(3)}</p>
        </div>
        <div className="rounded-xl border bg-amber-50 p-4">
          <p className="text-xs text-gray-500">Valuation at Vendors</p>
          <p className="text-xl font-bold text-amber-800">{fmtC(totals.valuation)}</p>
        </div>
      </div>

      {/* Reconciliation strip — proves the closing balance above is derived
          entirely from the visible categories, not a hidden number. */}
      <div className={`rounded-xl border p-3 text-xs flex flex-wrap items-center gap-x-2 gap-y-1 print:hidden ${isReconciled ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
        <span className="font-semibold">{isReconciled ? '✓ Reconciled' : '⚠ Not reconciled'}:</span>
        <span>
          Opening {totals.openingBalance.toFixed(3)} + Job Work Out {totals.jobWorkOut.toFixed(3)} + Transfers In {totals.transferInQty.toFixed(3)}
          {' − '}Returns {totals.returns.toFixed(3)} − Direct Sales {totals.directSales.toFixed(3)} − Transfers Out {totals.transferOutQty.toFixed(3)}
          {' = '}{derivedClosing.toFixed(3)}
        </span>
        <span>vs. displayed Closing Balance {totals.balance.toFixed(3)}</span>
        {!isReconciled && <span className="font-semibold">(gap: {reconciliationDiff.toFixed(3)})</span>}
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-6 py-3 border-b bg-gray-50 flex justify-between items-center">
          <span className="font-semibold text-gray-700 text-sm">{fromDate} → {toDate}</span>
          <span className="text-xs text-gray-500">{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          <VendorMovementsTable rows={tableRows} sortHrefs={sortHrefs} activeSort={activeSort} activeDir={activeDir} />
        </div>
      </div>
    </div>
  )
}
