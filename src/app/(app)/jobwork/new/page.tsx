'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import MissingMasterDataBanner from '@/components/MissingMasterDataBanner'
import {
  ACTIVE_COMPANIES_QUERY, ACTIVE_SUPPLIERS_QUERY, ACTIVE_WAREHOUSES_QUERY,
  ACTIVE_MATERIAL_TYPES_QUERY, ACTIVE_MATERIAL_SIZES_QUERY, ACTIVE_ITEM_MASTER_QUERY,
  CREATE_JOB_WORK_ORDER_MUTATION, CREATE_JOB_WORK_ITEMS_MUTATION,
  CREATE_JOB_WORK_OUTPUT_ITEMS_MUTATION,
  ITEM_PURCHASE_LINES_QUERY, PURCHASE_LINES_STOCK_QUERY,
  ALL_PURCHASE_BILL_ITEM_LINES_QUERY, ALL_STOCK_BY_PURCHASE_LINE_QUERY,
} from '@/lib/hasura/queries'
import { generateReferenceNumber } from '@/lib/utils'
import type { Company, Supplier, Warehouse, MaterialType, MaterialSize, ItemMaster } from '@/types'

const UNITS = ['MT', 'KG', 'Nos', 'Sheets', 'Meters']

type PurchaseLineOption = { purchase_line_id: string; available_qty: number }

type InputLine = {
  item_master_id: string
  item_name: string
  item_code: string
  material_type_id: string
  material_size_id: string
  size_label: string
  purchase_line_options: PurchaseLineOption[]
  purchase_lines_loading: boolean
  purchase_line_id: string
  available_quantity: string
  quantity: string
  unit: string
  notes: string
}

type OutputLine = {
  item_master_id: string
  item_name: string
  item_code: string
  material_type_id: string
  material_size_id: string
  size_label: string
  quantity: string
  unit: string
  notes: string
}

const emptyInput = (): InputLine => ({
  item_master_id: '', item_name: '', item_code: '',
  material_type_id: '', material_size_id: '', size_label: '',
  purchase_line_options: [], purchase_lines_loading: false,
  purchase_line_id: '', available_quantity: '',
  quantity: '', unit: 'MT', notes: '',
})

const emptyOutput = (): OutputLine => ({
  item_master_id: '', item_name: '', item_code: '',
  material_type_id: '', material_size_id: '', size_label: '',
  quantity: '', unit: 'MT', notes: '',
})

export default function NewJobWorkPage() {
  const router = useRouter()

  const [companies, setCompanies] = useState<Company[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([])
  const [materialSizes, setMaterialSizes] = useState<MaterialSize[]>([])
  const [itemMasters, setItemMasters] = useState<ItemMaster[]>([])
  const [stockByItem, setStockByItem] = useState<Record<string, number>>({})
  const [masterDataLoading, setMasterDataLoading] = useState(true)

  // Item search state for inputs and outputs separately
  const [inputItemSearch, setInputItemSearch] = useState<Record<number, string>>({})
  const [inputItemOpen, setInputItemOpen] = useState<Record<number, boolean>>({})
  const [outputItemSearch, setOutputItemSearch] = useState<Record<number, string>>({})
  const [outputItemOpen, setOutputItemOpen] = useState<Record<number, boolean>>({})

  // Header fields
  const [companyId, setCompanyId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [dispatchDate, setDispatchDate] = useState(new Date().toISOString().split('T')[0])
  const [expectedReturnDate, setExpectedReturnDate] = useState('')
  const [workDescription, setWorkDescription] = useState('')
  const [notes, setNotes] = useState('')

  // Line items
  const [inputLines, setInputLines] = useState<InputLine[]>([emptyInput(), emptyInput(), emptyInput()])
  const [outputLines, setOutputLines] = useState<OutputLine[]>([emptyOutput(), emptyOutput(), emptyOutput()])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshingItemMasters, setRefreshingItemMasters] = useState(false)

  useEffect(() => {
    const load = async () => {
      const [c, s, w, mt, ms, im, billLines, stockRows] = await Promise.all([
        hasuraFetch(ACTIVE_COMPANIES_QUERY),
        hasuraFetch(ACTIVE_SUPPLIERS_QUERY),
        hasuraFetch(ACTIVE_WAREHOUSES_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_TYPES_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_SIZES_QUERY),
        hasuraFetch(ACTIVE_ITEM_MASTER_QUERY),
        hasuraFetch(ALL_PURCHASE_BILL_ITEM_LINES_QUERY),
        hasuraFetch(ALL_STOCK_BY_PURCHASE_LINE_QUERY),
      ])
      setCompanies((c.data as any)?.companies ?? [])
      setSuppliers((s.data as any)?.suppliers ?? [])
      setWarehouses((w.data as any)?.warehouses ?? [])
      setMaterialTypes((mt.data as any)?.material_types ?? [])
      setMaterialSizes((ms.data as any)?.material_sizes ?? [])
      setItemMasters((im.data as any)?.item_master ?? [])

      // Build stock-by-item map: aggregate stock_ledger by purchase_line_id,
      // then map purchase_line_id → item_master_id via purchase_bill_items
      const stockByLine: Record<string, number> = {}
      for (const row of (stockRows.data as any)?.stock_ledger ?? []) {
        stockByLine[row.purchase_line_id] = (stockByLine[row.purchase_line_id] ?? 0) + Number(row.quantity)
      }
      const itemStockMap: Record<string, number> = {}
      for (const pbi of (billLines.data as any)?.purchase_bill_items ?? []) {
        const qty = stockByLine[pbi.purchase_line_id] ?? 0
        itemStockMap[pbi.item_master_id] = (itemStockMap[pbi.item_master_id] ?? 0) + qty
      }
      setStockByItem(itemStockMap)

      setMasterDataLoading(false)
    }
    load()
  }, [])

  // Refresh item masters and their available stock (e.g. after adding a new item elsewhere)
  const refreshItemMasters = useCallback(async () => {
    setRefreshingItemMasters(true)
    const [im, billLines, stockRows] = await Promise.all([
      hasuraFetch(ACTIVE_ITEM_MASTER_QUERY),
      hasuraFetch(ALL_PURCHASE_BILL_ITEM_LINES_QUERY),
      hasuraFetch(ALL_STOCK_BY_PURCHASE_LINE_QUERY),
    ])
    setItemMasters((im.data as any)?.item_master ?? [])

    const stockByLine: Record<string, number> = {}
    for (const row of (stockRows.data as any)?.stock_ledger ?? []) {
      stockByLine[row.purchase_line_id] = (stockByLine[row.purchase_line_id] ?? 0) + Number(row.quantity)
    }
    const itemStockMap: Record<string, number> = {}
    for (const pbi of (billLines.data as any)?.purchase_bill_items ?? []) {
      const qty = stockByLine[pbi.purchase_line_id] ?? 0
      itemStockMap[pbi.item_master_id] = (itemStockMap[pbi.item_master_id] ?? 0) + qty
    }
    setStockByItem(itemStockMap)
    setRefreshingItemMasters(false)
  }, [])

  // Fetch purchase line options for a given item master
  const fetchPurchaseLinesForItem = useCallback(async (itemMasterId: string, index: number) => {
    if (!itemMasterId) {
      setInputLines(prev => {
        const u = [...prev]
        u[index] = { ...u[index], purchase_line_options: [], purchase_line_id: '', available_quantity: '' }
        return u
      })
      return
    }

    setInputLines(prev => {
      const u = [...prev]
      u[index] = { ...u[index], purchase_lines_loading: true, purchase_line_options: [], purchase_line_id: '', available_quantity: '' }
      return u
    })

    const { data: linesData } = await hasuraFetch<any>(ITEM_PURCHASE_LINES_QUERY, { item_master_id: itemMasterId })
    const purchaseLineIds: string[] = (linesData?.purchase_bill_items ?? [])
      .map((r: any) => r.purchase_line_id)
      .filter(Boolean)

    if (!purchaseLineIds.length) {
      setInputLines(prev => {
        const u = [...prev]
        u[index] = { ...u[index], purchase_lines_loading: false, purchase_line_options: [] }
        return u
      })
      return
    }

    const { data: stockData } = await hasuraFetch<any>(PURCHASE_LINES_STOCK_QUERY, { purchase_line_ids: purchaseLineIds })
    const ledgerRows: { purchase_line_id: string; quantity: number }[] = stockData?.stock_ledger ?? []

    // Aggregate per purchase_line_id in JS
    const stockMap: Record<string, number> = {}
    for (const row of ledgerRows) {
      if (row.purchase_line_id) {
        stockMap[row.purchase_line_id] = (stockMap[row.purchase_line_id] ?? 0) + Number(row.quantity)
      }
    }

    const options: PurchaseLineOption[] = purchaseLineIds
      .map(id => ({ purchase_line_id: id, available_qty: Number((stockMap[id] ?? 0).toFixed(3)) }))
      .filter(opt => opt.available_qty > 0)
      .sort((a, b) => a.purchase_line_id.localeCompare(b.purchase_line_id))

    setInputLines(prev => {
      const u = [...prev]
      u[index] = { ...u[index], purchase_lines_loading: false, purchase_line_options: options }
      return u
    })
  }, [])

  const updateInputLine = useCallback((index: number, field: keyof InputLine, value: string) => {
    setInputLines(prev => {
      const u = [...prev]
      u[index] = { ...u[index], [field]: value }

      if (field === 'item_master_id') {
        if (value) {
          const item = itemMasters.find(im => im.id === value)
          if (item) {
            u[index].item_name = item.item_name
            u[index].item_code = item.item_code
            u[index].material_type_id = item.material_type_id
            u[index].material_size_id = item.material_size_id || ''
            u[index].size_label = item.size_label || ''
            u[index].unit = item.unit || 'MT'
          }
        } else {
          u[index].item_name = ''
          u[index].item_code = ''
          u[index].material_type_id = ''
          u[index].material_size_id = ''
          u[index].size_label = ''
        }
        u[index].purchase_line_id = ''
        u[index].available_quantity = ''
        u[index].purchase_line_options = []
      }

      if (field === 'purchase_line_id') {
        const opt = u[index].purchase_line_options.find(o => o.purchase_line_id === value)
        u[index].available_quantity = opt ? opt.available_qty.toFixed(3) : ''
      }

      return u
    })

    if (field === 'item_master_id' && value) {
      fetchPurchaseLinesForItem(value, index)
    }
  }, [itemMasters, fetchPurchaseLinesForItem])

  const updateOutputLine = useCallback((index: number, field: keyof OutputLine, value: string) => {
    setOutputLines(prev => {
      const u = [...prev]
      u[index] = { ...u[index], [field]: value }

      if (field === 'item_master_id') {
        if (value) {
          const item = itemMasters.find(im => im.id === value)
          if (item) {
            u[index].item_name = item.item_name
            u[index].item_code = item.item_code
            u[index].material_type_id = item.material_type_id
            u[index].material_size_id = item.material_size_id || ''
            u[index].size_label = item.size_label || ''
            u[index].unit = item.unit || 'MT'
          }
        } else {
          u[index].item_name = ''
          u[index].item_code = ''
          u[index].material_type_id = ''
          u[index].material_size_id = ''
          u[index].size_label = ''
        }
      }

      return u
    })
  }, [itemMasters])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const validInputs = inputLines.filter(l => l.item_master_id && l.quantity)
    if (!validInputs.length) {
      setError('Add at least one input item with an item and quantity.')
      setLoading(false)
      return
    }

    // Validate quantities against available stock
    for (const line of validInputs) {
      if (line.available_quantity && parseFloat(line.quantity) > parseFloat(line.available_quantity)) {
        setError(`Quantity for "${line.item_name}" (${line.quantity}) exceeds available stock (${line.available_quantity}).`)
        setLoading(false)
        return
      }
    }

    // Create order
    const { data: orderData, error: oErr } = await hasuraFetch<any>(
      CREATE_JOB_WORK_ORDER_MUTATION, {
        reference_number: generateReferenceNumber('JW'),
        company_id: companyId || null,
        warehouse_id: warehouseId || null,
        vendor_id: vendorId || null,
        dispatch_date: dispatchDate,
        expected_return_date: expectedReturnDate || null,
        work_description: workDescription || null,
        status: 'dispatched',
        notes: notes || null,
      }
    )
    const order = orderData?.insert_job_work_orders_one
    if (oErr || !order) {
      setError(oErr?.message ?? 'Failed to create job work order')
      setLoading(false)
      return
    }

    // Create input items
    const inputItems = validInputs.map(l => ({
      job_work_order_id: order.id,
      purchase_line_id: l.purchase_line_id || null,
      item_master_id: l.item_master_id || null,
      item_name: l.item_name || null,
      material_type_id: l.material_type_id || null,
      material_size_id: l.material_size_id || null,
      size_label: l.size_label || null,
      quantity_sent: parseFloat(l.quantity),
      quantity_received: 0,
      unit: l.unit || 'MT',
    }))
    const { error: iErr } = await hasuraFetch(CREATE_JOB_WORK_ITEMS_MUTATION, { objects: inputItems })
    if (iErr) {
      setError(iErr.message)
      setLoading(false)
      return
    }

    // Collect source purchase line IDs for output traceability
    const sourcePurchaseLineIds = [...new Set(
      validInputs.map(l => l.purchase_line_id).filter(Boolean)
    )]

    // Create output items (if any)
    const validOutputs = outputLines.filter(l => l.item_master_id && l.quantity)
    if (validOutputs.length) {
      const outputItems = validOutputs.map(l => ({
        job_work_order_id: order.id,
        item_master_id: l.item_master_id || null,
        item_name: l.item_name || null,
        material_type_id: l.material_type_id || null,
        material_size_id: l.material_size_id || null,
        size_label: l.size_label || null,
        quantity: parseFloat(l.quantity),
        unit: l.unit || 'MT',
        source_purchase_line_ids: sourcePurchaseLineIds,
        notes: l.notes || null,
      }))
      const { error: outErr } = await hasuraFetch(CREATE_JOB_WORK_OUTPUT_ITEMS_MUTATION, { objects: outputItems })
      if (outErr) {
        setError(outErr.message)
        setLoading(false)
        return
      }
    }

    router.push('/jobwork')
    router.refresh()
  }

  // Items matching the search query, with stock quantities attached
  const matchingItems = (search: string) => {
    const q = search.toLowerCase()
    return itemMasters
      .filter(im => !q || im.item_name.toLowerCase().includes(q) || im.item_code.toLowerCase().startsWith(q))
      .map(im => ({ ...im, availableStock: stockByItem[im.id] ?? 0 }))
  }

  // Input combo: only items with stock > 0, sorted highest stock first
  const filteredInputItems = (search: string) =>
    matchingItems(search)
      .filter(im => im.availableStock > 0)
      .sort((a, b) => b.availableStock - a.availableStock)
      .slice(0, 40)

  // Output combo: all items (producing new stock), stock shown as context only
  const filteredAllItems = (search: string) =>
    matchingItems(search)
      .sort((a, b) => b.availableStock - a.availableStock || a.item_name.localeCompare(b.item_name))
      .slice(0, 40)

  const inputFieldCls = "block w-full rounded border border-gray-300 px-2 py-2 text-sm focus:border-blue-500 focus:outline-none"
  const selectCls    = "block w-full rounded border border-gray-300 px-2 py-2 text-sm focus:border-blue-500 focus:outline-none"

  return (
    <div className="max-w-[1800px] mx-auto">

      <MissingMasterDataBanner
        loading={masterDataLoading}
        checks={[
          { label: 'Companies', count: companies.length, adminPath: '/admin/companies/new' },
          { label: 'Warehouses', count: warehouses.length, adminPath: '/admin/warehouses/new' },
          { label: 'Suppliers', count: suppliers.length, adminPath: '/admin/suppliers/new' },
          { label: 'Material Types', count: materialTypes.length, adminPath: '/admin/materials/new' },
        ]}
      />

      {/* ── Single unified card ─────────────────────────────────────────── */}
      <form onSubmit={handleSubmit}>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

          {/* Title bar */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
            <h1 className="text-base font-semibold text-gray-900">New Job Work Order</h1>
            <div className="flex gap-2">
              <button type="button" onClick={() => router.back()}
                className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="submit" disabled={loading}
                className="rounded bg-blue-600 px-5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {loading ? 'Saving…' : 'Create Order'}
              </button>
            </div>
          </div>

          {/* ── Order Details ──────────────────────────────────────────────── */}
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 lg:grid-cols-7">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Company</label>
                <select value={companyId} onChange={e => setCompanyId(e.target.value)} className={selectCls}>
                  <option value="">— Select —</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Vendor / Job Worker</label>
                <select value={vendorId} onChange={e => setVendorId(e.target.value)} className={selectCls}>
                  <option value="">— Select —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Warehouse</label>
                <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className={selectCls}>
                  <option value="">— Select —</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Dispatch Date</label>
                <input type="date" value={dispatchDate} onChange={e => setDispatchDate(e.target.value)} required className={inputFieldCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Expected Return</label>
                <input type="date" value={expectedReturnDate} onChange={e => setExpectedReturnDate(e.target.value)} className={inputFieldCls} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Process / Work Description</label>
                <input type="text" value={workDescription} onChange={e => setWorkDescription(e.target.value)}
                  placeholder="e.g. Coil Slitting, Sheet Cutting" className={inputFieldCls} />
              </div>
              <div className="lg:col-span-1 sm:col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Remarks</label>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)} className={inputFieldCls} />
              </div>
            </div>
          </div>

          {/* ── Input Materials ────────────────────────────────────────────── */}
          <div className="border-b border-gray-200">
            {/* Section header band */}
            <div className="flex items-center justify-between px-4 py-2 bg-blue-50 border-b border-blue-100">
              <span className="text-xs font-semibold text-blue-800 uppercase tracking-wide">
                Input Materials <span className="font-normal normal-case text-blue-600">(Consumed — dispatched to vendor)</span>
              </span>
              <button type="button" onClick={() => setInputLines(p => [...p, emptyInput()])}
                className="text-xs font-medium text-blue-700 hover:text-blue-900 border border-blue-300 rounded px-2 py-0.5 hover:bg-blue-100">
                + Add Row
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-56">
                      Item
                      <button type="button" onClick={refreshItemMasters} title="Refresh master items"
                        className="ml-1 text-gray-400 hover:text-blue-500 align-middle">
                        {refreshingItemMasters ? '…' : '↻'}
                      </button>
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-44">Purchase Line ID</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-28">Avail Stock</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-28">Qty Consumed</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-24">Unit</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Notes</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {inputLines.map((line, i) => (
                    <tr key={i} className="hover:bg-blue-50/30">
                      {/* Item */}
                      <td className="px-3 py-2">
                        <div className="relative">
                          <input type="text"
                            value={inputItemSearch[i] ?? line.item_name}
                            onChange={e => { setInputItemSearch(p => ({ ...p, [i]: e.target.value })); setInputItemOpen(p => ({ ...p, [i]: true })) }}
                            onFocus={() => setInputItemOpen(p => ({ ...p, [i]: true }))}
                            onBlur={() => setInputItemOpen(p => ({ ...p, [i]: false }))}
                            placeholder="Search item…"
                            className={inputFieldCls} />
                          {inputItemOpen[i] && (
                            <div className="absolute z-50 mt-1 w-80 overflow-y-auto rounded-md border border-gray-300 bg-white shadow-lg max-h-56">
                              {masterDataLoading && <div className="px-3 py-2 text-xs text-gray-400">Loading…</div>}
                              {!masterDataLoading && filteredInputItems(inputItemSearch[i] ?? '').map(im => (
                                <button key={im.id} type="button"
                                  onMouseDown={e => e.preventDefault()}
                                  onClick={() => { updateInputLine(i, 'item_master_id', im.id); setInputItemSearch(p => ({ ...p, [i]: im.item_name })); setInputItemOpen(p => ({ ...p, [i]: false })) }}
                                  className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center justify-between gap-2 border-b border-gray-50 last:border-0">
                                  <div className="min-w-0 flex-1 truncate">
                                    <span className="font-mono text-blue-600 mr-1">{im.item_code}</span>
                                    <span className="text-gray-800">{im.item_name}</span>
                                    {im.size_label && <span className="text-gray-400 ml-1">{im.size_label}</span>}
                                  </div>
                                  <span className="shrink-0 text-[11px] font-mono bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5 whitespace-nowrap">
                                    {im.availableStock.toFixed(3)} {im.unit}
                                  </span>
                                </button>
                              ))}
                              {!masterDataLoading && filteredInputItems(inputItemSearch[i] ?? '').length === 0 && (
                                <div className="px-3 py-2 text-xs text-gray-400">
                                  {(inputItemSearch[i] ?? '').length > 0 ? 'No matching items with stock' : 'No items with available stock'}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Purchase Line ID */}
                      <td className="px-3 py-2">
                        {!line.item_master_id
                          ? <span className="text-xs text-gray-400 italic">Select item first</span>
                          : line.purchase_lines_loading
                          ? <span className="text-xs text-gray-400">Loading…</span>
                          : line.purchase_line_options.length === 0
                          ? <span className="text-xs text-red-500">No stock available</span>
                          : (
                            <select value={line.purchase_line_id}
                              onChange={e => updateInputLine(i, 'purchase_line_id', e.target.value)}
                              className={selectCls + ' font-mono'}>
                              <option value="">— Select —</option>
                              {line.purchase_line_options.map(opt => (
                                <option key={opt.purchase_line_id} value={opt.purchase_line_id}>
                                  {opt.purchase_line_id} ({opt.available_qty.toFixed(3)})
                                </option>
                              ))}
                            </select>
                          )}
                      </td>

                      {/* Avail Stock */}
                      <td className="px-3 py-2 text-right">
                        {line.available_quantity
                          ? <span className="text-sm font-semibold text-green-700">{Number(line.available_quantity).toFixed(3)} <span className="text-xs font-normal text-green-600">{line.unit}</span></span>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>

                      {/* Qty Consumed */}
                      <td className="px-3 py-2">
                        <input type="number" value={line.quantity}
                          onChange={e => updateInputLine(i, 'quantity', e.target.value)}
                          step="0.001" min="0" max={line.available_quantity || undefined} placeholder="0.000"
                          className={`block w-full rounded border px-2 py-2 text-sm text-right focus:outline-none focus:border-blue-500 ${
                            line.available_quantity && parseFloat(line.quantity) > parseFloat(line.available_quantity)
                              ? 'border-red-400 bg-red-50' : 'border-gray-300'}`} />
                        {line.available_quantity && line.quantity && parseFloat(line.quantity) > parseFloat(line.available_quantity) && (
                          <p className="text-[10px] text-red-500 mt-0.5 text-right">Exceeds stock</p>
                        )}
                      </td>

                      {/* Unit */}
                      <td className="px-3 py-2">
                        <select value={line.unit} onChange={e => updateInputLine(i, 'unit', e.target.value)} className={selectCls}>
                          {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </td>

                      {/* Notes */}
                      <td className="px-3 py-2">
                        <input type="text" value={line.notes} onChange={e => updateInputLine(i, 'notes', e.target.value)} className={inputFieldCls} />
                      </td>

                      <td className="px-2 py-2 text-center">
                        {inputLines.length > 1 && (
                          <button type="button" onClick={() => setInputLines(p => p.filter((_, idx) => idx !== i))}
                            className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Output Materials ───────────────────────────────────────────── */}
          <div>
            {/* Section header band */}
            <div className="flex items-center justify-between px-4 py-2 bg-emerald-50 border-b border-emerald-100">
              <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">
                Output Materials <span className="font-normal normal-case text-emerald-600">(Produced)</span>
              </span>
              <button type="button" onClick={() => setOutputLines(p => [...p, emptyOutput()])}
                className="text-xs font-medium text-emerald-700 hover:text-emerald-900 border border-emerald-300 rounded px-2 py-0.5 hover:bg-emerald-100">
                + Add Row
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-72">
                      Produced Item
                      <button type="button" onClick={refreshItemMasters} title="Refresh master items"
                        className="ml-1 text-gray-400 hover:text-blue-500 align-middle">
                        {refreshingItemMasters ? '…' : '↻'}
                      </button>
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-44">Source Line ID(s)</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-28">Qty Produced</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-24">Unit</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Notes</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(() => {
                    const sourceLineIds = [...new Set(inputLines.map(l => l.purchase_line_id).filter(Boolean))]
                    return outputLines.map((line, i) => (
                    <tr key={i} className="hover:bg-emerald-50/30">
                      {/* Item */}
                      <td className="px-3 py-2">
                        <div className="relative">
                          <input type="text"
                            value={outputItemSearch[i] ?? line.item_name}
                            onChange={e => { setOutputItemSearch(p => ({ ...p, [i]: e.target.value })); setOutputItemOpen(p => ({ ...p, [i]: true })) }}
                            onFocus={() => setOutputItemOpen(p => ({ ...p, [i]: true }))}
                            onBlur={() => setOutputItemOpen(p => ({ ...p, [i]: false }))}
                            placeholder="Search produced item…"
                            className={inputFieldCls} />
                          {outputItemOpen[i] && (
                            <div className="absolute z-50 mt-1 w-80 overflow-y-auto rounded-md border border-gray-300 bg-white shadow-lg max-h-56">
                              {masterDataLoading && <div className="px-3 py-2 text-xs text-gray-400">Loading…</div>}
                              {!masterDataLoading && filteredAllItems(outputItemSearch[i] ?? '').map(im => (
                                <button key={im.id} type="button"
                                  onMouseDown={e => e.preventDefault()}
                                  onClick={() => { updateOutputLine(i, 'item_master_id', im.id); setOutputItemSearch(p => ({ ...p, [i]: im.item_name })); setOutputItemOpen(p => ({ ...p, [i]: false })) }}
                                  className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center justify-between gap-2 border-b border-gray-50 last:border-0">
                                  <div className="min-w-0 flex-1 truncate">
                                    <span className="font-mono text-blue-600 mr-1">{im.item_code}</span>
                                    <span className="text-gray-800">{im.item_name}</span>
                                    {im.size_label && <span className="text-gray-400 ml-1">{im.size_label}</span>}
                                  </div>
                                  {im.availableStock > 0 && (
                                    <span className="shrink-0 text-[11px] font-mono bg-gray-50 text-gray-500 border border-gray-200 rounded px-1.5 py-0.5 whitespace-nowrap">
                                      {im.availableStock.toFixed(3)} {im.unit}
                                    </span>
                                  )}
                                </button>
                              ))}
                              {!masterDataLoading && filteredAllItems(outputItemSearch[i] ?? '').length === 0 && (
                                <div className="px-3 py-2 text-xs text-gray-400">No items found</div>
                              )}
                            </div>
                          )}
                        </div>
                      </td>

                      <td className="px-3 py-2">
                        {sourceLineIds.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {sourceLineIds.map(id => (
                              <span key={id} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">{id}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300 italic">—</span>
                        )}
                      </td>

                      <td className="px-3 py-2">
                        <input type="number" value={line.quantity} onChange={e => updateOutputLine(i, 'quantity', e.target.value)}
                          step="0.001" min="0" placeholder="0.000"
                          className="block w-full rounded border border-gray-300 px-2 py-2 text-sm text-right focus:border-blue-500 focus:outline-none" />
                      </td>

                      <td className="px-3 py-2">
                        <select value={line.unit} onChange={e => updateOutputLine(i, 'unit', e.target.value)} className={selectCls}>
                          {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </td>

                      <td className="px-3 py-2">
                        <input type="text" value={line.notes} onChange={e => updateOutputLine(i, 'notes', e.target.value)} className={inputFieldCls} />
                      </td>

                      <td className="px-2 py-2 text-center">
                        {outputLines.length > 1 && (
                          <button type="button" onClick={() => setOutputLines(p => p.filter((_, idx) => idx !== i))}
                            className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
                        )}
                      </td>
                    </tr>
                  ))
                  })()}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {error && (
          <div className="mt-3 rounded-md bg-red-50 border border-red-200 px-4 py-2">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

      </form>
    </div>
  )
}
