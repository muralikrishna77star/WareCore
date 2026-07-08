export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import {
  VENDOR_JOB_WORK_LEDGER_QUERY,
  JOB_WORK_ORDERS_VENDOR_INFO_QUERY,
  DISPATCH_ORDERS_VENDOR_INFO_QUERY,
  JOB_WORK_ORDER_IDS_QUERY,
  ACTIVE_COMPANIES_QUERY,
  ACTIVE_SUPPLIERS_QUERY,
  ACTIVE_ITEM_MASTER_QUERY,
} from '@/lib/hasura/queries'
import { PrintButton } from '@/components/PrintButton'
import { ExportExcelButton } from '@/components/ExportExcelButton'
import { ItemComboBox, type ComboOption } from '@/components/ItemComboBox'
import VendorMovementsTable, { type Transaction } from './VendorMovementsTable'
import Link from 'next/link'

type ItemOption = ComboOption & {
  material_type_id: string
  material_size_id: string | null
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
  transactions: Transaction[]
}

export default async function VendorMovementsPage({
  searchParams,
}: {
  searchParams: Promise<{
    company?: string
    vendor?: string
    item?: string
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

  const [compResult, supResult, itemResult] = await Promise.all([
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
    hasuraQuery(ACTIVE_SUPPLIERS_QUERY),
    hasuraQuery(ACTIVE_ITEM_MASTER_QUERY),
  ])

  const companies: any[] = compResult.companies ?? []
  const suppliers: any[] = supResult.suppliers ?? []
  const itemRows: any[] = itemResult.item_master ?? []
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

  const [periodJobWorkResult, cumulativeJobWorkResult, periodSaleResult] = await Promise.all([
    hasuraQuery(VENDOR_JOB_WORK_LEDGER_QUERY, {
      where: {
        _and: [
          ...baseConditions,
          { entry_type: { _in: ['JOB_WORK_OUT', 'JOB_WORK_RETURN_IN'] } },
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
          { entry_type: { _in: ['JOB_WORK_OUT', 'JOB_WORK_RETURN_IN'] } },
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
  ])

  const periodJobWork: any[] = periodJobWorkResult.stock_ledger ?? []
  const cumulativeJobWork: any[] = cumulativeJobWorkResult.stock_ledger ?? []
  const periodSales: any[] = periodSaleResult.stock_ledger ?? []

  // Resolve dispatch orders behind the SALE_OUT entries to find which were
  // vendor-direct (sold straight from the vendor's site, never returned to a
  // warehouse) and which job work order they're sourced from.
  const dispatchIds = Array.from(new Set(periodSales.map((m) => m.reference_id).filter(Boolean)))
  const dispatchInfoResult = dispatchIds.length > 0
    ? await hasuraQuery(DISPATCH_ORDERS_VENDOR_INFO_QUERY, { ids: dispatchIds })
    : { dispatch_orders: [] }
  const dispatchInfoById = new Map<string, { is_vendor_direct: boolean; source_job_work_order_id: string | null }>()
  for (const d of dispatchInfoResult.dispatch_orders ?? []) {
    dispatchInfoById.set(d.id, { is_vendor_direct: d.is_vendor_direct, source_job_work_order_id: d.source_job_work_order_id })
  }

  // Collect every job work order id we need vendor info for: those directly
  // referenced by job-work ledger entries, plus those backing vendor-direct sales.
  const jobWorkOrderIds = new Set<string>()
  for (const m of [...periodJobWork, ...cumulativeJobWork]) {
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

  const ensureGroup = (vendorId: string, vendorName: string, companyName: string, m: any): GroupRow => {
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
        transactions: [],
      }
      groups.set(key, g)
    }
    return g
  }

  // Period job work out / return in (drives the Job Work Out + Returns columns,
  // pending Direct Sales subtraction below).
  const periodReturnInByKey = new Map<string, number>()
  for (const m of periodJobWork) {
    const info = jwoInfoById.get(m.reference_id)
    if (!info) continue
    if (vendorFilter && info.vendor_id !== vendorFilter) continue
    const g = ensureGroup(info.vendor_id, info.vendor_name, info.company_name, m)
    if (m.entry_type === 'JOB_WORK_OUT') {
      g.jobWorkOut += Math.abs(Number(m.quantity))
      g.transactions.push({
        id: m.id, date: m.entry_date, type: 'Job Work Out',
        quantity: Number(m.quantity), reference_number: m.reference_number, notes: m.notes,
      })
    } else if (m.entry_type === 'JOB_WORK_RETURN_IN') {
      const key = groupKey(info.vendor_id, m.material_type_id, m.material_size_id ?? null)
      periodReturnInByKey.set(key, (periodReturnInByKey.get(key) ?? 0) + Number(m.quantity))
      const isVirtual = (m.notes || '').toLowerCase().includes('virtual return')
      g.transactions.push({
        id: m.id, date: m.entry_date,
        type: isVirtual ? 'Return (paired with direct sale)' : 'Return',
        quantity: Number(m.quantity), reference_number: m.reference_number, notes: m.notes,
      })
    }
  }

  // Direct sales: SALE_OUT entries on vendor-direct dispatches, attributed back
  // to the vendor that held the material.
  for (const m of periodSales) {
    const dispatch = dispatchInfoById.get(m.reference_id)
    if (!dispatch?.is_vendor_direct || !dispatch.source_job_work_order_id) continue
    const info = jwoInfoById.get(dispatch.source_job_work_order_id)
    if (!info) continue
    if (vendorFilter && info.vendor_id !== vendorFilter) continue
    const g = ensureGroup(info.vendor_id, info.vendor_name, info.company_name, m)
    g.directSales += Math.abs(Number(m.quantity))
    g.transactions.push({
      id: m.id, date: m.entry_date, type: 'Direct Sale',
      quantity: Number(m.quantity), reference_number: m.reference_number, notes: m.notes,
    })
  }

  // Returns shown to the user are genuine physical returns only — the ledger's
  // JOB_WORK_RETURN_IN total also includes a "virtual return" leg paired with
  // each direct sale, which nets out via the Direct Sales column instead.
  for (const [key, rawReturnIn] of periodReturnInByKey) {
    const g = groups.get(key)
    if (g) g.returns = Math.max(0, rawReturnIn - g.directSales)
  }

  // Cumulative-to-date balance (as of the To date), independent of the From date.
  const cumulativeOutByKey = new Map<string, number>()
  const cumulativeReturnInByKey = new Map<string, number>()
  for (const m of cumulativeJobWork) {
    const info = jwoInfoById.get(m.reference_id)
    if (!info) continue
    if (vendorFilter && info.vendor_id !== vendorFilter) continue
    ensureGroup(info.vendor_id, info.vendor_name, info.company_name, m)
    const key = groupKey(info.vendor_id, m.material_type_id, m.material_size_id ?? null)
    if (m.entry_type === 'JOB_WORK_OUT') {
      cumulativeOutByKey.set(key, (cumulativeOutByKey.get(key) ?? 0) + Math.abs(Number(m.quantity)))
    } else if (m.entry_type === 'JOB_WORK_RETURN_IN') {
      cumulativeReturnInByKey.set(key, (cumulativeReturnInByKey.get(key) ?? 0) + Number(m.quantity))
    }
  }
  for (const g of groups.values()) {
    g.balance = (cumulativeOutByKey.get(g.key) ?? 0) - (cumulativeReturnInByKey.get(g.key) ?? 0)
  }

  let rows = Array.from(groups.values()).filter(
    (g) => g.jobWorkOut > 0 || g.directSales > 0 || g.returns > 0 || Math.abs(g.balance) > 0.0005
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
    job_work_out: (g) => g.jobWorkOut,
    direct_sales: (g) => g.directSales,
    returns: (g) => g.returns,
    balance: (g) => g.balance,
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
      jobWorkOut: acc.jobWorkOut + g.jobWorkOut,
      directSales: acc.directSales + g.directSales,
      returns: acc.returns + g.returns,
      balance: acc.balance + g.balance,
    }),
    { jobWorkOut: 0, directSales: 0, returns: 0, balance: 0 }
  )

  const sortHref = (column: string) => {
    const next = new URLSearchParams()
    if (params.company) next.set('company', params.company)
    if (params.vendor) next.set('vendor', params.vendor)
    if (params.item) next.set('item', params.item)
    next.set('from', fromDate)
    next.set('to', toDate)
    next.set('sort', column)
    next.set('dir', activeSort === column && activeDir === 'asc' ? 'desc' : 'asc')
    return `/reports/vendor-movements?${next.toString()}`
  }
  const sortHrefs = Object.fromEntries(
    ['vendor', 'company', 'item', 'size', 'job_work_out', 'direct_sales', 'returns', 'balance'].map((c) => [c, sortHref(c)])
  )

  const tableRows = rows.map((g) => ({
    key: g.key,
    vendorName: g.vendorName,
    companyName: g.companyName,
    itemLabel: itemLabelFor(g.materialTypeId, g.materialSizeId, g.materialName),
    sizeLabel: g.sizeLabel,
    unit: g.unit,
    jobWorkOut: g.jobWorkOut,
    directSales: g.directSales,
    returns: g.returns,
    balance: g.balance,
    transactions: g.transactions,
  }))

  const exportRows = tableRows.map((r) => ({
    'Vendor': r.vendorName,
    'Company': r.companyName,
    'Item': r.itemLabel,
    'Size': r.sizeLabel || '',
    'Job Work Out': r.jobWorkOut,
    'Direct Sales': r.directSales,
    'Returns': r.returns,
    'Balance': r.balance,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendorwise Stock Movement</h1>
          <p className="text-sm text-gray-500 mt-1">Job work out, direct sales, returns and pending balance, by vendor</p>
        </div>
        <div className="flex items-center gap-2">
          {tableRows.length > 0 && (
            <ExportExcelButton rows={exportRows} filename={`vendor-movements-${fromDate}-to-${toDate}`} sheetName="Vendor Movements" />
          )}
          <PrintButton />
          <Link href="/reports" className="text-sm text-blue-600 hover:underline">← Reports</Link>
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
              {companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Vendor</label>
            <select name="vendor" defaultValue={params.vendor || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none">
              <option value="">All Vendors</option>
              {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
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
        <div className="rounded-xl border bg-purple-50 p-4">
          <p className="text-xs text-gray-500">Job Work Out</p>
          <p className="text-xl font-bold text-purple-800">{totals.jobWorkOut.toFixed(3)}</p>
        </div>
        <div className="rounded-xl border bg-red-50 p-4">
          <p className="text-xs text-gray-500">Direct Sales</p>
          <p className="text-xl font-bold text-red-700">{totals.directSales.toFixed(3)}</p>
        </div>
        <div className="rounded-xl border bg-teal-50 p-4">
          <p className="text-xs text-gray-500">Returns</p>
          <p className="text-xl font-bold text-teal-800">{totals.returns.toFixed(3)}</p>
        </div>
        <div className="rounded-xl border bg-orange-50 p-4">
          <p className="text-xs text-gray-500">Balance at Vendors</p>
          <p className="text-xl font-bold text-orange-800">{totals.balance.toFixed(3)}</p>
        </div>
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
