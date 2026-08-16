export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth/session'
import { hasuraQuery, hasuraRunSql } from '@/lib/hasura/server'
import { fetchPurchaseLineRateMap } from '@/lib/purchaseLineRates'
import {
  ITEM_STOCK_LEDGER_QUERY,
  ITEM_STOCK_AT_VENDORS_QUERY,
  JOB_WORK_ORDERS_VENDOR_LOOKUP_QUERY,
  VENDOR_JOB_WORK_TRANSFERS_QUERY,
  ACTIVE_ITEM_MASTER_QUERY,
  ACTIVE_COMPANIES_QUERY,
  ACTIVE_WAREHOUSES_QUERY,
  ACTIVE_MATERIAL_SIZES_QUERY,
} from '@/lib/hasura/queries'
import { PrintButton } from '@/components/PrintButton'
import { ProfessionalExportButton } from '@/components/ProfessionalExportButton'
import { ItemLedgerItemSizeFields } from '@/components/ItemLedgerItemSizeFields'
import { ItemLedgerRows } from '@/components/ItemLedgerRows'
import Link from 'next/link'
import { ArrowLeft, BookOpen } from 'lucide-react'
import { VENDOR_MOVEMENT_TYPES } from '@/lib/stockLedger'
import { QTY_FMT, MONEY_FMT, type ProfessionalSheetSpec } from '@/lib/exportProfessionalExcel'

// Direct ledger row deletion is raw data surgery — same role gate as
// /api/stock/ledger-entries.
const LEDGER_MANAGE_ROLES = new Set(['admin', 'developer'])

// Tables that back each stock_ledger.reference_type, used to detect rows
// whose reference (bill/dispatch/job work/transfer) no longer exists.
const REFERENCE_TABLE_BY_TYPE: Record<string, string> = {
  purchase_bill: 'purchase_bills',
  dispatch: 'dispatch_orders',
  job_work: 'job_work_orders',
  transfer: 'transfers',
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A reference missing from the live table isn't necessarily orphaned — a
// cancelled-and-purged order moves to its archive table (original_*_id) and
// is still a legitimate record. Only flag a reference as orphaned when it's
// absent from both, same check used by /api/stock/verify's stale-records query.
async function findOrphanedReferences(pairs: { type: string; id: string }[]): Promise<Set<string>> {
  const valuesSql = pairs
    .filter((p) => REFERENCE_TABLE_BY_TYPE[p.type] && UUID_RE.test(p.id))
    .map((p) => `('${p.type}'::text, '${p.id}'::uuid)`)
    .join(',')
  if (!valuesSql) return new Set()

  const sql = `
    SELECT refs.reference_type, refs.reference_id::text
    FROM (VALUES ${valuesSql}) AS refs(reference_type, reference_id)
    WHERE
      (refs.reference_type = 'purchase_bill'
        AND NOT EXISTS (SELECT 1 FROM purchase_bills b WHERE b.id = refs.reference_id)
        AND NOT EXISTS (SELECT 1 FROM purchase_cancellations pc WHERE pc.original_bill_id = refs.reference_id))
      OR (refs.reference_type = 'dispatch'
        AND NOT EXISTS (SELECT 1 FROM dispatch_orders d WHERE d.id = refs.reference_id)
        AND NOT EXISTS (SELECT 1 FROM dispatch_cancellations dc WHERE dc.original_order_id = refs.reference_id))
      OR (refs.reference_type = 'job_work'
        AND NOT EXISTS (SELECT 1 FROM job_work_orders j WHERE j.id = refs.reference_id)
        AND NOT EXISTS (SELECT 1 FROM job_work_cancellations jc WHERE jc.original_order_id = refs.reference_id))
      OR (refs.reference_type = 'transfer' AND NOT EXISTS (SELECT 1 FROM transfers t WHERE t.id = refs.reference_id))
  `
  const result = await hasuraRunSql(sql)
  const rows = result.result?.slice(1) ?? []
  return new Set(rows.map(([type, id]) => `${type}|${id}`))
}

type ItemMaster = {
  id: string
  item_code: string
  item_name: string
  material_type_id: string
  material_size_id: string | null
  size_label?: string | null
  unit: string
  material_types?: { description: string; unit: string }
  material_sizes?: { size_label: string } | null
}

type LedgerEntry = {
  id: string
  entry_type: string
  quantity: number | string
  entry_date: string
  reference_number?: string | null
  reference_type?: string | null
  reference_id?: string | null
  purchase_line_id?: string | null
  sub_purchase_line_id?: string | null
  size_label?: string | null
  notes?: string | null
  companies?: { name: string; code: string } | null
  warehouses?: { name: string } | null
  material_types?: { description: string; unit: string } | null
  material_sizes?: { size_label: string } | null
}

export default async function ItemStockLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string; size?: string; company?: string; warehouse?: string; from?: string; to?: string; types?: string }>
}) {
  const params = await searchParams

  const cookieStore = await cookies()
  const token = cookieStore.get('wc_session')?.value
  const session = token ? verifySession(token) : null
  const canManage = !!session && LEDGER_MANAGE_ROLES.has(session.role)

  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const fromDate = params.from || firstOfMonth.toISOString().split('T')[0]
  const toDate = params.to || today.toISOString().split('T')[0]

  const [itemResult, compResult, whResult, sizeResult] = await Promise.all([
    hasuraQuery(ACTIVE_ITEM_MASTER_QUERY),
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
    hasuraQuery(ACTIVE_WAREHOUSES_QUERY),
    hasuraQuery(ACTIVE_MATERIAL_SIZES_QUERY),
  ])

  const items: ItemMaster[] = itemResult.item_master ?? []
  const companies: { id: string; name: string }[] = compResult.companies ?? []
  const allWarehouses: { id: string; name: string; company_id: string }[] = whResult.warehouses ?? []
  const allSizes: { id: string; material_type_id: string | null; size_label: string }[] = sizeResult.material_sizes ?? []
  const warehouses = params.company
    ? allWarehouses.filter((w) => w.company_id === params.company)
    : allWarehouses

  const selectedItem = params.item ? items.find((i) => i.id === params.item) ?? null : null

  const selectedSizeId = params.size || selectedItem?.material_size_id || ''

  let openingBalance = 0
  let vendorOpeningBalance = 0
  let entries: LedgerEntry[] = []
  let vendorStock: { vendor_name: string; pending_quantity: number | string; unit: string }[] = []

  if (selectedItem) {
    const baseConditions: Record<string, unknown>[] = [
      { material_type_id: { _eq: selectedItem.material_type_id } },
      selectedSizeId
        ? { material_size_id: { _eq: selectedSizeId } }
        : { material_size_id: { _is_null: true } },
    ]
    if (params.company) baseConditions.push({ company_id: { _eq: params.company } })
    if (params.warehouse) baseConditions.push({ warehouse_id: { _eq: params.warehouse } })
    // Cancellation rows are real, legitimate offsets against the
    // PURCHASE_IN/SALE_OUT/JOB_WORK_OUT they reverse — always fetched and
    // always shown inline (not just netted into the totals), so the running
    // Balance column never jumps without an explanatory row on screen.

    // Optional drill-down from Stock Statement: scope the visible entries to
    // one or more entry types (e.g. just PURCHASE_IN) without affecting the
    // opening balance, which is still the full running total up to fromDate.
    const typeFilter = params.types?.split(',').map((t) => t.trim()).filter(Boolean)
    const periodConditions = typeFilter?.length
      ? [...baseConditions, { entry_type: { _in: typeFilter } }]
      : baseConditions

    const openingWhere = { _and: [...baseConditions, { entry_date: { _lt: fromDate } }] }
    const vendorOpeningWhere = {
      _and: [...baseConditions, { entry_date: { _lt: fromDate } }, { entry_type: { _in: VENDOR_MOVEMENT_TYPES } }],
    }
    const periodWhere = {
      _and: [...periodConditions, { entry_date: { _gte: fromDate } }, { entry_date: { _lte: toDate } }],
    }

    const result = await hasuraQuery(ITEM_STOCK_LEDGER_QUERY, {
      opening_where: openingWhere,
      vendor_opening_where: vendorOpeningWhere,
      period_where: periodWhere,
    })
    openingBalance = Number(result.opening_agg?.aggregate?.sum?.quantity ?? 0)
    vendorOpeningBalance = -Number(result.vendor_opening_agg?.aggregate?.sum?.quantity ?? 0)
    entries = result.entries ?? []

    const selectedSizeLabel = selectedSizeId
      ? allSizes.find((s) => s.id === selectedSizeId)?.size_label ?? null
      : null
    const vendorWhere: Record<string, unknown> = { material_type_id: { _eq: selectedItem.material_type_id } }
    if (selectedSizeLabel) vendorWhere.size_label = { _eq: selectedSizeLabel }
    if (params.company) vendorWhere.company_id = { _eq: params.company }
    const vendorResult = await hasuraQuery(ITEM_STOCK_AT_VENDORS_QUERY, { where: vendorWhere })
    vendorStock = vendorResult.v_stock_at_vendors ?? []
  }

  let orphanedRefs = new Set<string>()
  if (canManage && entries.length) {
    const pairs = entries
      .filter((e) => e.reference_type && e.reference_id)
      .map((e) => ({ type: e.reference_type as string, id: e.reference_id as string }))
    orphanedRefs = await findOrphanedReferences(pairs)
  }

  // Vendor name per row — job-work movements (out/return/transfer/cancel) all
  // reference a job_work_orders.id, which carries the vendor. Batched once
  // per distinct order id rather than joined in the main query, since
  // reference_id is polymorphic across entry types.
  let vendorNameByJobWorkOrderId = new Map<string, string>()
  const jobWorkOrderIds = Array.from(
    new Set(entries.filter((e) => e.reference_type === 'job_work' && e.reference_id).map((e) => e.reference_id as string))
  )
  if (jobWorkOrderIds.length) {
    const vendorLookupResult = await hasuraQuery(JOB_WORK_ORDERS_VENDOR_LOOKUP_QUERY, { ids: jobWorkOrderIds })
    const rows: { id: string; suppliers?: { name: string } | null }[] = vendorLookupResult.job_work_orders ?? []
    vendorNameByJobWorkOrderId = new Map(rows.map((r) => [r.id, r.suppliers?.name ?? '']))
  }

  // Counterparty vendor for a JOB_WORK_TRANSFER_OUT/IN row — the row's own
  // reference_id only carries one side of the vendor-to-vendor transfer (the
  // order it's posted against), so the other vendor's name comes from the
  // transfer audit trail (job_work_transfers/job_work_transfer_items),
  // matched by order + line + quantity, same approach as Vendorwise Stock
  // Movement's Transfer Out/In display.
  const hasTransferEntries = entries.some((e) => e.entry_type === 'JOB_WORK_TRANSFER_OUT' || e.entry_type === 'JOB_WORK_TRANSFER_IN')
  const transferOutCounterparty = new Map<string, string>()
  const transferInCounterparty = new Map<string, string>()
  if (hasTransferEntries) {
    const transferAuditResult = await hasuraQuery(VENDOR_JOB_WORK_TRANSFERS_QUERY)
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
    for (const t of (transferAuditResult.job_work_transfers ?? []) as VendorJobWorkTransfer[]) {
      for (const item of t.job_work_transfer_items ?? []) {
        const lineId = item.sub_purchase_line_id || item.purchase_line_id
        if (!lineId) continue
        const qtyKey = Number(item.quantity_transferred).toFixed(3)
        if (t.from_job_work_order_id) {
          transferOutCounterparty.set(`${t.from_job_work_order_id}|${lineId}|${qtyKey}`, t.to_vendor?.name || '—')
        }
        if (t.to_job_work_order_id) {
          transferInCounterparty.set(`${t.to_job_work_order_id}|${lineId}|${qtyKey}`, t.from_vendor?.name || '—')
        }
      }
    }
  }

  // Rows sharing the same reference + line ID + entry type are flagged for
  // review — usually leftover PURCHASE_IN/CANCEL (or SALE_/JOB_WORK_) pairs
  // from repeated edits. entry_type must match too: a job work line's
  // original JOB_WORK_OUT and a later JOB_WORK_TRANSFER_OUT legitimately
  // share the same reference_id + purchase_line_id (the transfer-out is
  // recorded against the source order), and aren't duplicates.
  const dupKeyCounts = new Map<string, number>()
  for (const e of entries) {
    const lineId = e.sub_purchase_line_id || e.purchase_line_id
    if (!e.reference_id || !lineId) continue
    const key = `${e.reference_id}|${lineId}|${e.entry_type}`
    dupKeyCounts.set(key, (dupKeyCounts.get(key) ?? 0) + 1)
  }

  // Plain accumulators for a one-shot server-side computation — held in an
  // object (rather than reassigned `let`s) so the running totals are mutated
  // via property writes, not variable reassignment, inside the nested map.
  const runningBalance = { warehouse: openingBalance, vendor: vendorOpeningBalance }
  const ledgerRows = entries.map((e) => {
    runningBalance.warehouse += Number(e.quantity)
    if (VENDOR_MOVEMENT_TYPES.includes(e.entry_type)) runningBalance.vendor -= Number(e.quantity)
    const lineId = e.sub_purchase_line_id || e.purchase_line_id
    const dupKey = e.reference_id && lineId ? `${e.reference_id}|${lineId}|${e.entry_type}` : null
    const ownVendorName = e.reference_type === 'job_work' && e.reference_id ? vendorNameByJobWorkOrderId.get(e.reference_id) || null : null

    // Transfers show both sides ("Source → Destination"): the row's own
    // vendor already tells us which end it's posted at, and the audit-trail
    // lookup fills in the counterparty on the other end.
    let vendorName = ownVendorName
    if (lineId && e.reference_id) {
      const qtyKey = Math.abs(Number(e.quantity)).toFixed(3)
      if (e.entry_type === 'JOB_WORK_TRANSFER_OUT') {
        const counterparty = transferOutCounterparty.get(`${e.reference_id}|${lineId}|${qtyKey}`)
        if (counterparty) vendorName = `${ownVendorName || '—'} → ${counterparty}`
      } else if (e.entry_type === 'JOB_WORK_TRANSFER_IN') {
        const counterparty = transferInCounterparty.get(`${e.reference_id}|${lineId}|${qtyKey}`)
        if (counterparty) vendorName = `${counterparty} → ${ownVendorName || '—'}`
      }
    }

    return {
      ...e,
      balance: runningBalance.warehouse,
      vendorBalance: runningBalance.vendor,
      orphaned: e.reference_type && e.reference_id ? orphanedRefs.has(`${e.reference_type}|${e.reference_id}`) : false,
      duplicateCount: dupKey ? dupKeyCounts.get(dupKey) ?? 1 : 1,
      vendorName,
    }
  })
  const closingBalance = runningBalance.warehouse
  const vendorClosingBalance = runningBalance.vendor

  // Vendor-direct-sale pairs post as two separate ledger rows (a
  // JOB_WORK_RETURN_IN "virtual return" from the vendor + the SALE_OUT
  // dispatch) since they carry distinct references (job work order vs.
  // invoice) that must stay individually traceable in stock_ledger. But
  // shown as two rows they read as unrelated movements — merge them into
  // one display-only row here so the report reads as a single event
  // without touching the underlying data. Matched by shared line ID +
  // entry date + exactly-offsetting quantity.
  const VENDOR_DIRECT_SALE_NOTE = 'Vendor direct sale — virtual return'
  type DisplayRow = (typeof ledgerRows)[number] & {
    mergedIds?: string[]
    isVendorDirectSale?: boolean
    isJobWorkTransfer?: boolean
    jobWorkReferenceNumber?: string | null
    jobWorkReferenceType?: string | null
    jobWorkReferenceId?: string | null
    netQuantity?: number
  }
  const consumed = new Set<number>()
  const mergeAtLaterIndex = new Map<number, { saleIdx: number; returnIdx: number }>()
  for (let i = 0; i < ledgerRows.length; i++) {
    const row = ledgerRows[i]
    if (row.entry_type !== 'JOB_WORK_RETURN_IN' || row.notes !== VENDOR_DIRECT_SALE_NOTE) continue
    if (consumed.has(i)) continue
    const lineId = row.sub_purchase_line_id || row.purchase_line_id
    if (!lineId) continue
    const qty = Number(row.quantity)
    const j = ledgerRows.findIndex((r, idx) =>
      idx !== i &&
      !consumed.has(idx) &&
      r.entry_type === 'SALE_OUT' &&
      (r.sub_purchase_line_id || r.purchase_line_id) === lineId &&
      r.entry_date === row.entry_date &&
      Math.abs(Number(r.quantity) + qty) < 0.0005
    )
    if (j === -1) continue
    consumed.add(i)
    consumed.add(j)
    // Whichever of the pair is processed later in running-balance order
    // always lands back at the pre-pair balance/vendorBalance (the delta
    // nets to zero either way) — use its values regardless of which side
    // (return or sale) happens to sort first on a same-day tie.
    mergeAtLaterIndex.set(Math.max(i, j), { saleIdx: j, returnIdx: i })
  }

  // Job-work vendor-to-vendor transfers post as two separate ledger rows too
  // (JOB_WORK_TRANSFER_OUT on the source order + JOB_WORK_TRANSFER_IN on the
  // destination order), so they net to zero but otherwise read as two
  // unrelated movements — same problem as the vendor-direct-sale pair above,
  // same fix: merge into one display-only row. Matched by shared line ID +
  // entry date + exactly-offsetting quantity (both legs of a transfer always
  // share one business date, see fn_job_work_item_to_ledger()'s TRANSFER_OUT
  // date lookup).
  const mergeTransferAtLaterIndex = new Map<number, { outIdx: number; inIdx: number }>()
  for (let i = 0; i < ledgerRows.length; i++) {
    const row = ledgerRows[i]
    if (row.entry_type !== 'JOB_WORK_TRANSFER_OUT') continue
    if (consumed.has(i)) continue
    const lineId = row.sub_purchase_line_id || row.purchase_line_id
    if (!lineId) continue
    const qty = Number(row.quantity)
    const j = ledgerRows.findIndex((r, idx) =>
      idx !== i &&
      !consumed.has(idx) &&
      r.entry_type === 'JOB_WORK_TRANSFER_IN' &&
      (r.sub_purchase_line_id || r.purchase_line_id) === lineId &&
      r.entry_date === row.entry_date &&
      Math.abs(Number(r.quantity) + qty) < 0.0005
    )
    if (j === -1) continue
    consumed.add(i)
    consumed.add(j)
    mergeTransferAtLaterIndex.set(Math.max(i, j), { outIdx: i, inIdx: j })
  }

  const displayRows: DisplayRow[] = []
  for (let i = 0; i < ledgerRows.length; i++) {
    const merge = mergeAtLaterIndex.get(i)
    if (merge) {
      const saleRow = ledgerRows[merge.saleIdx]
      const returnRow = ledgerRows[merge.returnIdx]
      const laterRow = ledgerRows[i]
      displayRows.push({
        ...saleRow,
        id: `vds-${returnRow.id}-${saleRow.id}`,
        mergedIds: [returnRow.id, saleRow.id],
        isVendorDirectSale: true,
        entry_type: 'VENDOR_DIRECT_SALE',
        entry_date: laterRow.entry_date,
        quantity: saleRow.quantity,
        netQuantity: 0,
        jobWorkReferenceNumber: returnRow.reference_number,
        jobWorkReferenceType: returnRow.reference_type,
        jobWorkReferenceId: returnRow.reference_id,
        vendorName: returnRow.vendorName,
        balance: laterRow.balance,
        vendorBalance: laterRow.vendorBalance,
        orphaned: false,
        duplicateCount: 1,
        notes: 'Direct from vendor — no warehouse movement',
      })
      continue
    }
    const transferMerge = mergeTransferAtLaterIndex.get(i)
    if (transferMerge) {
      const outRow = ledgerRows[transferMerge.outIdx]
      const inRow = ledgerRows[transferMerge.inIdx]
      const laterRow = ledgerRows[i]
      const fromVendor = outRow.vendorName || '—'
      const toVendor = inRow.vendorName || '—'
      displayRows.push({
        ...inRow,
        id: `jwt-${outRow.id}-${inRow.id}`,
        mergedIds: [outRow.id, inRow.id],
        isJobWorkTransfer: true,
        entry_type: 'JOB_WORK_TRANSFER',
        entry_date: laterRow.entry_date,
        quantity: inRow.quantity,
        netQuantity: 0,
        jobWorkReferenceNumber: outRow.reference_number,
        jobWorkReferenceType: outRow.reference_type,
        jobWorkReferenceId: outRow.reference_id,
        // Vendor column shows only the current holder — where this row's
        // balance now sits — not both ends of the move; the full "from → to"
        // story stays in Notes.
        vendorName: toVendor,
        balance: laterRow.balance,
        vendorBalance: laterRow.vendorBalance,
        orphaned: false,
        duplicateCount: 1,
        notes: `Transfer from ${fromVendor} to ${toVendor}`,
      })
      continue
    }
    if (consumed.has(i)) continue
    displayRows.push(ledgerRows[i])
  }

  const totalIn = entries
    .filter((e) => Number(e.quantity) > 0)
    .reduce((s, e) => s + Number(e.quantity), 0)
  const totalOut = entries
    .filter((e) => Number(e.quantity) < 0)
    .reduce((s, e) => s + Math.abs(Number(e.quantity)), 0)

  const unit = selectedItem?.material_types?.unit || selectedItem?.unit || 'tons'
  const sizeLabel = selectedItem?.material_sizes?.size_label || selectedItem?.size_label
  const itemTitle = selectedItem
    ? `${selectedItem.item_code} — ${selectedItem.item_name}${sizeLabel ? ` (${sizeLabel})` : ''}`
    : null

  const fmtQ = (n: number) => n.toFixed(3)

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
    JOB_WORK_TRANSFER_OUT: 'Job Work Transfer Out',
    JOB_WORK_TRANSFER_IN: 'Job Work Transfer In',
    JOB_WORK_TRANSFER: 'Job Transfer',
    ADJUSTMENT_IN: 'Adjustment In',
    ADJUSTMENT_OUT: 'Adjustment Out',
  }
  const ledgerRateMap = await fetchPurchaseLineRateMap(displayRows.map((row) => row.purchase_line_id))
  const exportMeta = {
    companyName: companies.find((c) => c.id === params.company)?.name || 'All Companies',
    fromDate,
    toDate,
    filterLine: [
      `Warehouse: ${warehouses.find((w) => w.id === params.warehouse)?.name || 'All Warehouses'}`,
      `Item: ${itemTitle || '—'}`,
    ].join('   |   '),
    generatedBy: session?.fullName || '',
  }
  const ledgerSheet: ProfessionalSheetSpec | null = selectedItem
    ? {
        sheetName: 'Item Ledger',
        title: `Item Stock Ledger — ${itemTitle ?? ''}`,
        emptyMessage: 'No movements for this item in the selected period.',
        columns: [
          { header: 'S.No.', key: 'sno', width: 8, align: 'center' },
          { header: 'Transaction Date', key: 'date', width: 16, align: 'center', isDate: true },
          { header: 'Type', key: 'type', width: 22, align: 'left' },
          { header: 'Reference', key: 'reference', width: 20, align: 'left' },
          { header: 'Company', key: 'company', width: 16, align: 'left' },
          { header: 'Warehouse', key: 'warehouse', width: 16, align: 'left' },
          { header: 'Inward Quantity', key: 'in', width: 16, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
          { header: 'Outward Quantity', key: 'out', width: 16, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
          { header: 'Rate (₹)', key: 'rate', width: 12, align: 'right', numFmt: MONEY_FMT },
          { header: 'Balance', key: 'balance', width: 16, align: 'right', numFmt: QTY_FMT, negativeWarning: true },
          { header: 'Balance at Vendor', key: 'vendorBalance', width: 18, align: 'right', numFmt: QTY_FMT, negativeWarning: true },
          { header: 'Vendor', key: 'vendor', width: 24, align: 'left' },
          { header: 'Notes', key: 'notes', width: 24, align: 'left' },
        ],
        rows: [
          {
            sno: '',
            date: fromDate,
            type: 'OPENING BALANCE',
            reference: '',
            company: '',
            warehouse: '',
            in: null,
            out: null,
            rate: null,
            balance: openingBalance,
            vendorBalance: vendorOpeningBalance,
            vendor: '',
            notes: 'Opening balance as of the selected From Date',
          },
          ...displayRows.map((row, idx) => {
            const qty = Number(row.quantity)
            const typeLabel = row.isVendorDirectSale
              ? 'Vendor Direct Sale'
              : row.isJobWorkTransfer
              ? 'Job Transfer'
              : ENTRY_TYPE_LABELS[row.entry_type ?? ''] ?? row.entry_type ?? ''
            const referenceLabel = row.isVendorDirectSale || row.isJobWorkTransfer
              ? `${row.reference_number || ''}${row.jobWorkReferenceNumber ? ` (from ${row.jobWorkReferenceNumber})` : ''}`
              : row.reference_number || ''
            return {
              sno: idx + 1,
              date: row.entry_date,
              type: typeLabel,
              reference: referenceLabel,
              company: row.companies?.name || '',
              warehouse: row.warehouses?.name || '',
              in: qty > 0 ? qty : null,
              out: qty < 0 ? Math.abs(qty) : null,
              rate: row.purchase_line_id ? ledgerRateMap.get(row.purchase_line_id) ?? null : null,
              balance: row.balance,
              vendorBalance: row.vendorBalance,
              vendor: row.vendorName || '',
              notes: row.notes || '',
            }
          }),
        ],
        highlightRowIndexes: [0],
      }
    : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Item Stock Ledger</h1>
          <p className="text-sm text-gray-500 mt-1">
            Opening balance, movements, and running balance for a single item over a date range
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedItem && ledgerSheet && (
            <ProfessionalExportButton
              meta={exportMeta}
              sheets={[ledgerSheet]}
              filenameBase={`Item_Ledger_${selectedItem.item_code}`}
              successMessage="Item Ledger exported successfully."
              errorMessage="Unable to export the Item Ledger. Please try again."
            />
          )}
          {selectedItem && <PrintButton />}
          <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"><ArrowLeft className="h-4 w-4" /> Reports</Link>
        </div>
      </div>

      <div className="hidden print:block text-center mb-4">
        <h1 className="text-xl font-bold">Item Stock Ledger</h1>
        {itemTitle && <p className="text-sm text-gray-700 font-medium">{itemTitle}</p>}
        <p className="text-sm text-gray-600">{fromDate} to {toDate}</p>
      </div>

      {/* Filters */}
      <form className="bg-white rounded-xl border p-4 print:hidden">
        <div className="flex flex-wrap gap-3 items-end">
          <ItemLedgerItemSizeFields
            items={items.map((i) => ({
              id: i.id,
              item_code: i.item_code,
              item_name: i.item_name,
              material_type_id: i.material_type_id,
              material_size_id: i.material_size_id,
              size_label: i.material_sizes?.size_label || i.size_label,
            }))}
            allSizes={allSizes}
            defaultItemId={params.item || ''}
            defaultSizeId={selectedSizeId}
          />

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Company</label>
            <select
              name="company"
              defaultValue={params.company || ''}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Warehouse</label>
            <select
              name="warehouse"
              defaultValue={params.warehouse || ''}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Warehouses</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
            <input
              type="date"
              name="from"
              defaultValue={fromDate}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
            <input
              type="date"
              name="to"
              defaultValue={toDate}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Apply
          </button>
        </div>
      </form>

      <p className="text-xs text-gray-500 print:hidden">
        Every row below — including cancellations — affects the running Balance. For the full
        cancellation audit trail (who cancelled it, when), see{' '}
        <Link href="/purchase-cancellations" className="text-blue-600 hover:underline">Purchase</Link>,{' '}
        <Link href="/sale-cancellations" className="text-blue-600 hover:underline">Sale</Link>, or{' '}
        <Link href="/jobwork-cancellations" className="text-blue-600 hover:underline">Job Work</Link> Cancellations.
      </p>

      {!selectedItem ? (
        <div className="rounded-xl border bg-white p-12 text-center">
          <BookOpen className="mx-auto h-10 w-10 mb-3 text-gray-400" />
          <p className="text-gray-500 text-sm">Select an item above to view its stock ledger.</p>
        </div>
      ) : (
        <>
          {/* Item header */}
          <div className="rounded-xl border bg-white p-4 flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="font-semibold text-gray-900">{itemTitle}</p>
              <p className="text-sm text-gray-500">Unit: {unit}</p>
            </div>
            <p className="text-sm text-gray-500">{fromDate} → {toDate}</p>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <div className="rounded-xl border bg-blue-50 p-4">
              <p className="text-xs text-gray-500">Opening Balance</p>
              <p className={`text-xl font-bold ${openingBalance < 0 ? 'text-red-600' : 'text-blue-800'}`}>
                {fmtQ(openingBalance)}
              </p>
            </div>
            <div className="rounded-xl border bg-green-50 p-4">
              <p className="text-xs text-gray-500">Total In</p>
              <p className="text-xl font-bold text-green-700">+{fmtQ(totalIn)}</p>
            </div>
            <div className="rounded-xl border bg-red-50 p-4">
              <p className="text-xs text-gray-500">Total Out</p>
              <p className="text-xl font-bold text-red-700">-{fmtQ(totalOut)}</p>
            </div>
            <div className="rounded-xl border bg-gray-50 p-4">
              <p className="text-xs text-gray-500">Closing Balance</p>
              <p className={`text-xl font-bold ${closingBalance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {fmtQ(closingBalance)}
              </p>
            </div>
            <div className="rounded-xl border bg-purple-50 p-4">
              <p className="text-xs text-gray-500">At Vendor (Job Work)</p>
              <p className="text-xl font-bold text-purple-800">
                {fmtQ(vendorStock.reduce((s, v) => s + Number(v.pending_quantity), 0))}
              </p>
              {vendorStock.length > 1 && (
                <p className="text-[11px] text-gray-500 mt-1 leading-tight">
                  {vendorStock.map((v) => `${v.vendor_name}: ${fmtQ(Number(v.pending_quantity))}`).join(' · ')}
                </p>
              )}
              {vendorStock.length === 1 && (
                <p className="text-[11px] text-gray-500 mt-1">{vendorStock[0].vendor_name}</p>
              )}
            </div>
          </div>

          {/* Ledger table */}
          <div className="rounded-xl border bg-white overflow-hidden">
            <div className="px-6 py-3 border-b bg-gray-50 flex justify-between items-center">
              <span className="font-semibold text-gray-700 text-sm">Ledger Entries</span>
              <span className="text-xs text-gray-500">{displayRows.length} entr{displayRows.length !== 1 ? 'ies' : 'y'}</span>
            </div>
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  <tr className="bg-blue-50/50 font-medium">
                    <td className="px-4 py-3 text-gray-600" colSpan={canManage ? 8 : 7}>Opening Balance as of {fromDate}</td>
                    <td className={`px-4 py-3 text-right font-bold ${openingBalance < 0 ? 'text-red-600' : 'text-blue-800'}`}>
                      {fmtQ(openingBalance)}
                    </td>
                    <td className={`px-4 py-3 text-right font-bold ${vendorOpeningBalance < 0 ? 'text-red-600' : 'text-purple-800'}`}>
                      {fmtQ(vendorOpeningBalance)}
                    </td>
                    <td />
                    <td />
                  </tr>
                  {displayRows.length === 0 && (
                    <tr>
                      <td colSpan={canManage ? 12 : 11} className="px-4 py-8 text-center text-gray-400">
                        No movements for this item in the selected period.
                      </td>
                    </tr>
                  )}
                </tbody>
                <ItemLedgerRows rows={displayRows} canManage={canManage} />
                <tfoot>
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-sm">
                    <td className="px-4 py-3 text-gray-700" colSpan={canManage ? 6 : 5}>Closing Balance as of {toDate}</td>
                    <td className="px-4 py-3 text-right text-green-800">+{fmtQ(totalIn)}</td>
                    <td className="px-4 py-3 text-right text-red-800">-{fmtQ(totalOut)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${closingBalance < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                      {fmtQ(closingBalance)}
                    </td>
                    <td className={`px-4 py-3 text-right font-bold ${vendorClosingBalance < 0 ? 'text-red-700' : 'text-purple-900'}`}>
                      {fmtQ(vendorClosingBalance)}
                    </td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
