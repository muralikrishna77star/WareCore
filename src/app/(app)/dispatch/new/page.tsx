'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import MissingMasterDataBanner from '@/components/MissingMasterDataBanner'
import {
  ACTIVE_COMPANIES_QUERY, ACTIVE_WAREHOUSES_QUERY, ACTIVE_CUSTOMERS_QUERY,
  ACTIVE_MATERIAL_TYPES_QUERY, ACTIVE_MATERIAL_SIZES_QUERY,
  ACTIVE_ITEM_MASTER_QUERY,
  CREATE_DISPATCH_ORDER_MUTATION, CREATE_DISPATCH_ITEMS_MUTATION,
  ACTIVE_SALES_TAX_RATES_QUERY,
  CREATE_MATERIAL_TYPE_MUTATION, CREATE_MATERIAL_SIZE_MUTATION,
  ALL_INVOICE_NUMBERS_QUERY, ALL_SALE_LINE_IDS_QUERY,
  PURCHASE_BILL_ITEMS_FOR_DISPATCH_QUERY, STOCK_LEDGER_LINE_QUANTITIES_QUERY,
} from '@/lib/hasura/queries'
import type { Company, Warehouse, Customer, MaterialType, MaterialSize, ItemMaster, TaxRate } from '@/types'

type AvailablePurchaseLine = {
  purchase_line_id: string
  item_name: string | null
  item_master_id: string | null
  material_type_id: string
  material_size_id: string | null
  size_label: string | null
  available_quantity: number
}

type DispatchLine = {
  item_master_id: string
  sale_line_id: string
  purchase_line_id: string
  available_quantity: string
  item_name: string
  material_type_id: string
  material_size_id: string
  size_label: string
  quantity: string
  rate: string
  amount: string
  notes: string
  tax_rate_id: string
  taxable_value: number
  cgst_rate: number
  cgst_amount: number
  sgst_rate: number
  sgst_amount: number
  tcs_rate: number
  tcs_amount: number
  total_with_tax: number
}

// ─── ID generation helpers ────────────────────────────────────────────────────

function getMMYY(date: Date = new Date()): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yy = String(date.getFullYear()).slice(-2)
  return `${mm}${yy}`
}

function computeNextSeq(ids: string[], pattern: RegExp): number {
  return ids.reduce((max, id) => {
    if (!id) return max
    const m = id.match(pattern)
    return m ? Math.max(max, parseInt(m[1], 10)) : max
  }, 0)
}

function generateSaleId(existingInvoiceNumbers: string[]): string {
  const seq = computeNextSeq(existingInvoiceNumbers, /^\d{4}-(\d+)$/)
  return `${getMMYY()}-${String(seq + 1).padStart(4, '0')}`
}

function generateSaleLineId(typeCode: string, allLineIds: string[]): string {
  const seq = computeNextSeq(allLineIds, /^[A-Z]{2}\d{4}-(\d+)$/)
  const prefix = typeCode.slice(0, 2).toUpperCase()
  return `${prefix}${getMMYY()}-${String(seq + 1).padStart(4, '0')}`
}

// ─────────────────────────────────────────────────────────────────────────────

function calcSalesTax(line: DispatchLine, taxRates: TaxRate[]): Partial<DispatchLine> {
  const taxable = (parseFloat(line.quantity) || 0) * (parseFloat(line.rate) || 0)
  if (!line.tax_rate_id) return { taxable_value: taxable, cgst_amount: 0, sgst_amount: 0, tcs_amount: 0, total_with_tax: taxable }
  const tr = taxRates.find((t) => t.id === line.tax_rate_id)
  if (!tr) return { taxable_value: taxable }
  const cgst = (taxable * Number(tr.cgst_rate)) / 100
  const sgst = (taxable * Number(tr.sgst_rate)) / 100
  const tcsBase = taxable + cgst + sgst
  const tcs = (tcsBase * Number(tr.tcs_rate)) / 100
  return {
    taxable_value: taxable,
    cgst_rate: Number(tr.cgst_rate), cgst_amount: cgst,
    sgst_rate: Number(tr.sgst_rate), sgst_amount: sgst,
    tcs_rate: Number(tr.tcs_rate), tcs_amount: tcs,
    total_with_tax: taxable + cgst + sgst + tcs,
  }
}

const emptyLine = (): DispatchLine => ({
  item_master_id: '',
  sale_line_id: '',
  purchase_line_id: '',
  available_quantity: '',
  item_name: '',
  material_type_id: '',
  material_size_id: '',
  size_label: '',
  quantity: '',
  rate: '',
  amount: '',
  notes: '',
  tax_rate_id: '',
  taxable_value: 0,
  cgst_rate: 0,
  cgst_amount: 0,
  sgst_rate: 0,
  sgst_amount: 0,
  tcs_rate: 0,
  tcs_amount: 0,
  total_with_tax: 0,
})

export default function NewDispatchPage() {
  const router = useRouter()

  const [companies, setCompanies] = useState<Company[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([])
  const [materialSizes, setMaterialSizes] = useState<MaterialSize[]>([])
  const [itemMasters, setItemMasters] = useState<ItemMaster[]>([])
  const [taxRates, setTaxRates] = useState<TaxRate[]>([])

  // Pre-loaded purchase lines with available stock > 0
  const [availablePurchaseLines, setAvailablePurchaseLines] = useState<AvailablePurchaseLine[]>([])

  // Existing IDs for sequence computation
  const [existingInvoiceNumbers, setExistingInvoiceNumbers] = useState<string[]>([])
  const [existingLineIds, setExistingLineIds] = useState<string[]>([])

  const [showMaterialTypeDialog, setShowMaterialTypeDialog] = useState(false)
  const [newMaterialTypeCode, setNewMaterialTypeCode] = useState('')
  const [newMaterialTypeDescription, setNewMaterialTypeDescription] = useState('')
  const [newMaterialTypeUnit, setNewMaterialTypeUnit] = useState('tons')
  const [materialTypeDialogLoading, setMaterialTypeDialogLoading] = useState(false)
  const [activeLineIndexForNewType, setActiveLineIndexForNewType] = useState<number | null>(null)

  const [showSizeDialog, setShowSizeDialog] = useState(false)
  const [newSizeMaterialTypeId, setNewSizeMaterialTypeId] = useState('')
  const [newSizeLabel, setNewSizeLabel] = useState('')
  const [newSizeThickness, setNewSizeThickness] = useState('')
  const [newSizeWidth, setNewSizeWidth] = useState('')
  const [sizeDialogLoading, setSizeDialogLoading] = useState(false)
  const [activeLineIndexForNewSize, setActiveLineIndexForNewSize] = useState<number | null>(null)

  const [companyId, setCompanyId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [saleId, setSaleId] = useState('')
  const [dispatchDate, setDispatchDate] = useState(new Date().toISOString().split('T')[0])
  const [vehicleNumber, setVehicleNumber] = useState('')
  const [driverName, setDriverName] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DispatchLine[]>([emptyLine()])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [masterDataLoading, setMasterDataLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [c, w, cu, mt, ms, im, tr, invs, slis, pbiRes, slRes] = await Promise.all([
        hasuraFetch(ACTIVE_COMPANIES_QUERY),
        hasuraFetch(ACTIVE_WAREHOUSES_QUERY),
        hasuraFetch(ACTIVE_CUSTOMERS_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_TYPES_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_SIZES_QUERY),
        hasuraFetch(ACTIVE_ITEM_MASTER_QUERY),
        hasuraFetch(ACTIVE_SALES_TAX_RATES_QUERY),
        hasuraFetch(ALL_INVOICE_NUMBERS_QUERY),
        hasuraFetch(ALL_SALE_LINE_IDS_QUERY),
        hasuraFetch(PURCHASE_BILL_ITEMS_FOR_DISPATCH_QUERY),
        hasuraFetch(STOCK_LEDGER_LINE_QUANTITIES_QUERY),
      ])
      setCompanies((c.data as any)?.companies ?? [])
      setWarehouses((w.data as any)?.warehouses ?? [])
      setCustomers((cu.data as any)?.customers ?? [])
      setMaterialTypes((mt.data as any)?.material_types ?? [])
      setMaterialSizes((ms.data as any)?.material_sizes ?? [])
      setItemMasters((im.data as any)?.item_master ?? [])
      setTaxRates((tr.data as any)?.tax_rates ?? [])

      const invoiceNums: string[] = ((invs.data as any)?.dispatch_orders ?? []).map((o: any) => o.invoice_number).filter(Boolean)
      const lineIds: string[] = ((slis.data as any)?.dispatch_items ?? []).map((i: any) => i.sale_line_id).filter(Boolean)

      setExistingInvoiceNumbers(invoiceNums)
      setExistingLineIds(lineIds)
      setSaleId(generateSaleId(invoiceNums))

      // Compute available stock per purchase_line_id
      const stockMap: Record<string, number> = {}
      for (const entry of (slRes.data as any)?.stock_ledger ?? []) {
        if (!entry.purchase_line_id) continue
        stockMap[entry.purchase_line_id] = (stockMap[entry.purchase_line_id] ?? 0) + Number(entry.quantity)
      }

      // Build available purchase lines: unique by purchase_line_id, stock > 0
      const seen = new Set<string>()
      const avail: AvailablePurchaseLine[] = []
      for (const item of (pbiRes.data as any)?.purchase_bill_items ?? []) {
        if (!item.purchase_line_id || seen.has(item.purchase_line_id)) continue
        const qty = stockMap[item.purchase_line_id] ?? 0
        if (qty > 0) {
          seen.add(item.purchase_line_id)
          avail.push({ ...item, available_quantity: qty })
        }
      }
      setAvailablePurchaseLines(avail)
      setMasterDataLoading(false)
    }
    load()
  }, [])

  const updateLine = useCallback((index: number, field: keyof DispatchLine, value: string) => {
    setLines((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }

      // Item selected first: populate all fields and generate sale_line_id
      if (field === 'item_master_id') {
        if (value) {
          const item = itemMasters.find((im) => im.id === value)
          if (item) {
            updated[index].item_name        = item.item_name
            updated[index].material_type_id = item.material_type_id
            updated[index].material_size_id = item.material_size_id || ''
            updated[index].size_label       = item.size_label || ''
            const mt = materialTypes.find(m => m.id === item.material_type_id)
            if (mt?.code) {
              const currentAssigned = prev.filter((_, i) => i !== index).map((l) => l.sale_line_id).filter(Boolean)
              updated[index].sale_line_id = generateSaleLineId(mt.code, [...existingLineIds, ...currentAssigned])
            }
          }
          // Clear purchase_line_id if it no longer matches the selected item
          const currentPL = updated[index].purchase_line_id
          if (currentPL) {
            const pl = availablePurchaseLines.find((l) => l.purchase_line_id === currentPL)
            if (!pl || (pl.item_master_id && pl.item_master_id !== value)) {
              updated[index].purchase_line_id = ''
              updated[index].available_quantity = ''
            }
          }
        } else {
          // Item cleared — reset everything
          updated[index].item_name          = ''
          updated[index].material_type_id   = ''
          updated[index].material_size_id   = ''
          updated[index].size_label         = ''
          updated[index].sale_line_id       = ''
          updated[index].purchase_line_id   = ''
          updated[index].available_quantity = ''
        }
      }

      // Purchase line selected second: set available qty + refine material/size
      if (field === 'purchase_line_id') {
        const pl = availablePurchaseLines.find((l) => l.purchase_line_id === value)
        if (pl) {
          updated[index].available_quantity = pl.available_quantity.toFixed(3)
          updated[index].material_type_id   = pl.material_type_id || ''
          updated[index].material_size_id   = pl.material_size_id || ''
          updated[index].size_label         = pl.size_label || ''
          // Generate sale_line_id only if not already set by item selection
          if (!updated[index].sale_line_id) {
            const mt = materialTypes.find(m => m.id === pl.material_type_id)
            if (mt?.code) {
              const currentAssigned = prev.filter((_, i) => i !== index).map((l) => l.sale_line_id).filter(Boolean)
              updated[index].sale_line_id = generateSaleLineId(mt.code, [...existingLineIds, ...currentAssigned])
            }
          }
        } else {
          // Cleared — restore material/size from item if still selected
          updated[index].available_quantity = ''
          const selItem = updated[index].item_master_id
            ? itemMasters.find(im => im.id === updated[index].item_master_id)
            : null
          if (selItem) {
            updated[index].material_type_id = selItem.material_type_id
            updated[index].material_size_id = selItem.material_size_id || ''
            updated[index].size_label       = selItem.size_label || ''
          } else {
            updated[index].material_type_id = ''
            updated[index].material_size_id = ''
            updated[index].size_label       = ''
            updated[index].sale_line_id     = ''
          }
        }
      }

      if (field === 'material_type_id') {
        const mt = materialTypes.find((m) => m.id === value)
        if (mt && !updated[index].item_name) updated[index].item_name = mt.description
      }
      if (field === 'quantity' || field === 'rate') {
        const qty = parseFloat(field === 'quantity' ? value : updated[index].quantity) || 0
        const rate = parseFloat(field === 'rate' ? value : updated[index].rate) || 0
        updated[index].amount = (qty * rate).toFixed(2)
      }
      if (field === 'quantity' || field === 'rate' || field === 'tax_rate_id') {
        Object.assign(updated[index], calcSalesTax(updated[index], taxRates))
      }
      return updated
    })
  }, [itemMasters, materialTypes, taxRates, existingLineIds, availablePurchaseLines])

  const addLine = () => setLines((prev) => [...prev, emptyLine()])
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i))
  const totalQty = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0)
  const totalAmt = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)

  const handleCreateMaterialType = async () => {
    const code = newMaterialTypeCode.trim().toUpperCase()
    if (code.length !== 2) { setError('Material type code must be exactly 2 characters'); return }
    if (!newMaterialTypeDescription.trim()) return
    setMaterialTypeDialogLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_material_types_one: MaterialType }>(CREATE_MATERIAL_TYPE_MUTATION, {
      code, description: newMaterialTypeDescription.trim(), unit: newMaterialTypeUnit.trim() || null,
    })
    if (err) { setError(err.message); setMaterialTypeDialogLoading(false); return }
    const newType = data?.insert_material_types_one
    if (newType) {
      setMaterialTypes((prev) => [...prev, newType])
      if (activeLineIndexForNewType !== null) {
        updateLine(activeLineIndexForNewType, 'material_type_id', newType.id)
        updateLine(activeLineIndexForNewType, 'material_size_id', '')
        updateLine(activeLineIndexForNewType, 'size_label', '')
      }
      setShowMaterialTypeDialog(false); setNewMaterialTypeDescription(''); setNewMaterialTypeUnit('tons'); setActiveLineIndexForNewType(null)
    }
    setMaterialTypeDialogLoading(false)
  }

  const handleCreateSize = async () => {
    const materialTypeId = newSizeMaterialTypeId || (activeLineIndexForNewSize !== null ? lines[activeLineIndexForNewSize].material_type_id : '')
    if (!materialTypeId || !newSizeLabel.trim()) return
    setSizeDialogLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_material_sizes_one: MaterialSize }>(CREATE_MATERIAL_SIZE_MUTATION, {
      material_type_id: materialTypeId, size_label: newSizeLabel.trim(),
      thickness: newSizeThickness ? parseFloat(newSizeThickness) : null,
      width: newSizeWidth ? parseFloat(newSizeWidth) : null,
    })
    if (err) { setError(err.message); setSizeDialogLoading(false); return }
    const newSize = data?.insert_material_sizes_one
    if (newSize) {
      setMaterialSizes((prev) => [...prev, newSize])
      if (activeLineIndexForNewSize !== null) {
        updateLine(activeLineIndexForNewSize, 'material_size_id', newSize.id)
        updateLine(activeLineIndexForNewSize, 'size_label', newSize.size_label)
      }
      setShowSizeDialog(false); setNewSizeMaterialTypeId(''); setNewSizeLabel(''); setNewSizeThickness(''); setNewSizeWidth(''); setActiveLineIndexForNewSize(null)
    }
    setSizeDialogLoading(false)
  }

  const handleCancelNewType = () => {
    setShowMaterialTypeDialog(false); setNewMaterialTypeDescription(''); setNewMaterialTypeUnit('tons'); setActiveLineIndexForNewType(null)
  }

  const handleCancelNewSize = () => {
    setShowSizeDialog(false); setNewSizeMaterialTypeId(''); setNewSizeLabel(''); setNewSizeThickness(''); setNewSizeWidth(''); setActiveLineIndexForNewSize(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const validLines = lines.filter((l) => l.material_type_id && l.quantity)
    if (!validLines.length) {
      setError('Add at least one line item.')
      setLoading(false)
      return
    }

    if (!saleId.trim()) {
      setError('Sale ID is required.')
      setLoading(false)
      return
    }

    const { data: orderData, error: oErr } = await hasuraFetch<any>(
      CREATE_DISPATCH_ORDER_MUTATION, {
        company_id: companyId || null,
        warehouse_id: warehouseId || null,
        customer_id: customerId || null,
        invoice_number: saleId,
        dispatch_date: dispatchDate,
        vehicle_number: vehicleNumber || null,
        driver_name: driverName || null,
        total_quantity: totalQty,
        total_amount: totalAmt || null,
        notes: notes || null,
      }
    )
    const order = orderData?.insert_dispatch_orders_one
    if (oErr || !order) {
      setError(oErr?.message ?? 'Failed to create dispatch')
      setLoading(false)
      return
    }

    const items = validLines.map((l) => ({
      dispatch_order_id: order.id,
      item_master_id: l.item_master_id || null,
      sale_line_id: l.sale_line_id || null,
      purchase_line_id: l.purchase_line_id || null,
      item_name: l.item_name || null,
      material_type_id: l.material_type_id || null,
      material_size_id: l.material_size_id || null,
      size_label: l.size_label || null,
      quantity: parseFloat(l.quantity),
      rate: l.rate ? parseFloat(l.rate) : null,
      amount: l.amount ? parseFloat(l.amount) : null,
      notes: l.notes || null,
      tax_rate_id: l.tax_rate_id || null,
      taxable_value: l.taxable_value || null,
      cgst_rate: l.cgst_rate || null,
      cgst_amount: l.cgst_amount || null,
      sgst_rate: l.sgst_rate || null,
      sgst_amount: l.sgst_amount || null,
      tcs_rate: l.tcs_rate || null,
      tcs_amount: l.tcs_amount || null,
      total_with_tax: l.total_with_tax || null,
    }))
    const { error: iErr } = await hasuraFetch(CREATE_DISPATCH_ITEMS_MUTATION, { items })
    if (iErr) {
      setError(iErr.message)
      setLoading(false)
      return
    }

    router.push('/dispatch')
    router.refresh()
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">New Sale Entry</h1>
        <p className="mt-1 text-sm text-gray-500">Create a new sale invoice / customer dispatch</p>
      </div>

      <MissingMasterDataBanner
        loading={masterDataLoading}
        checks={[
          { label: 'Companies', count: companies.length, adminPath: '/admin/companies/new' },
          { label: 'Warehouses', count: warehouses.length, adminPath: '/admin/warehouses/new' },
          { label: 'Customers', count: customers.length, adminPath: '/admin/customers/new' },
          { label: 'Material Types', count: materialTypes.length, adminPath: '/admin/materials/new' },
        ]}
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Dispatch Details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
              <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                <option value="">— Select —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                <option value="">— Select —</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                <option value="">— Select —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sale ID
                <span className="ml-2 text-xs font-normal text-gray-400">(auto-generated — edit to override)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={saleId}
                  onChange={(e) => setSaleId(e.target.value)}
                  placeholder={masterDataLoading ? 'Loading…' : 'MMYY-NNNN'}
                  className="block flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setSaleId(generateSaleId(existingInvoiceNumbers))}
                  title="Generate new Sale ID"
                  className="rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 whitespace-nowrap"
                >
                  ↻ New ID
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dispatch Date</label>
              <input type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} required
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Number</label>
              <input type="text" value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)}
                placeholder="e.g. MH-01-AB-1234"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Driver Name</label>
              <input type="text" value={driverName} onChange={(e) => setDriverName(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-800">Items</h2>
              {availablePurchaseLines.length > 0 && (
                <p className="text-xs text-gray-500 mt-0.5">{availablePurchaseLines.length} purchase line{availablePurchaseLines.length !== 1 ? 's' : ''} with available stock</p>
              )}
            </div>
            <button type="button" onClick={addLine} className="text-sm text-blue-600 hover:text-blue-800 font-medium">+ Add Line</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Item</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Purchase Line</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Material</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Size</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Qty</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Rate (₹)</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Taxable (₹)</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Tax Rate</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500 text-right">CGST</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500 text-right">SGST</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500 text-right">TCS</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500 text-right">Total</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-gray-500">Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lines.map((line, i) => {
                  const sizesForType = materialSizes.filter((s) => !s.material_type_id || s.material_type_id === line.material_type_id)

                  // Filter purchase lines by selected item.
                  // Priority: exact item_master_id match → fall back to material_type + size match.
                  // This handles purchases done without item_master_id, or with a different item_master_id.
                  const selectedItem = line.item_master_id ? itemMasters.find(im => im.id === line.item_master_id) : null
                  const purchaseLinesForRow = selectedItem
                    ? availablePurchaseLines.filter(pl =>
                        pl.item_master_id === selectedItem.id ||
                        (
                          pl.material_type_id === selectedItem.material_type_id &&
                          (
                            !selectedItem.material_size_id ||
                            pl.material_size_id === selectedItem.material_size_id ||
                            (pl.size_label && selectedItem.size_label && pl.size_label === selectedItem.size_label)
                          )
                        )
                      )
                    : availablePurchaseLines

                  return (
                    <tr key={i}>
                      {/* ── Item — FIRST column (always a dropdown) ── */}
                      <td className="pr-3 py-2">
                        <div className="space-y-1">
                          <select
                            value={line.item_master_id}
                            onChange={(e) => updateLine(i, 'item_master_id', e.target.value)}
                            className="block w-36 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                          >
                            <option value="">Select Item</option>
                            {itemMasters.map((im) => (
                              <option key={im.id} value={im.id}>{im.item_name}</option>
                            ))}
                          </select>
                          {line.sale_line_id ? (
                            <span className="inline-flex items-center rounded bg-green-50 border border-green-200 px-2 py-1 text-[10px] font-mono font-medium text-green-700 whitespace-nowrap select-all">
                              {line.sale_line_id}
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-400 italic">no line ID yet</span>
                          )}
                        </div>
                      </td>
                      {/* ── Purchase Line — SECOND column (filtered by item) ── */}
                      <td className="pr-3 py-2">
                        <div>
                          <select
                            value={line.purchase_line_id}
                            onChange={(e) => updateLine(i, 'purchase_line_id', e.target.value)}
                            className={`block w-44 rounded border px-2 py-1.5 text-sm focus:outline-none ${
                              line.item_master_id && purchaseLinesForRow.length === 0
                                ? 'border-gray-200 bg-gray-50 text-gray-400'
                                : 'border-gray-300 focus:border-blue-500'
                            }`}
                          >
                            <option value="">— Select —</option>
                            {purchaseLinesForRow.map((pl) => (
                              <option key={pl.purchase_line_id} value={pl.purchase_line_id}>
                                {pl.purchase_line_id} ({pl.available_quantity.toFixed(2)})
                              </option>
                            ))}
                          </select>
                          {line.available_quantity ? (
                            <p className="text-[10px] text-green-600 mt-0.5 font-medium">
                              ✓ {line.available_quantity} avail
                            </p>
                          ) : line.item_master_id && purchaseLinesForRow.length === 0 && !masterDataLoading ? (
                            <p className="text-[10px] text-amber-600 mt-0.5">No stock for this item</p>
                          ) : null}
                        </div>
                      </td>
                      {/* ── Material ── */}
                      <td className="pr-3 py-2">
                        {line.item_master_id || line.purchase_line_id ? (
                          <span className="block text-sm text-gray-700 px-1 font-mono">
                            {materialTypes.find(m => m.id === line.material_type_id)?.code || '—'}
                          </span>
                        ) : (
                          <select value={line.material_type_id} onChange={(e) => {
                            if (e.target.value === 'NEW_TYPE') {
                              setActiveLineIndexForNewType(i)
                              setShowMaterialTypeDialog(true)
                              return
                            }
                            updateLine(i, 'material_type_id', e.target.value)
                            updateLine(i, 'material_size_id', '')
                            updateLine(i, 'size_label', '')
                          }} required
                            className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none">
                            <option value="">Select</option>
                            {materialTypes.map((m) => <option key={m.id} value={m.id}>{m.description}</option>)}
                            <option value="NEW_TYPE" className="font-semibold">+ New Material Type</option>
                          </select>
                        )}
                      </td>
                      {/* ── Size ── */}
                      <td className="pr-3 py-2">
                        {line.item_master_id || line.purchase_line_id ? (
                          <span className="block text-sm text-gray-700 px-1">
                            {line.size_label || '—'}
                          </span>
                        ) : (
                          <select value={line.material_size_id}
                            onChange={(e) => {
                              if (e.target.value === 'NEW_SIZE') {
                                setActiveLineIndexForNewSize(i)
                                setNewSizeMaterialTypeId(line.material_type_id)
                                setShowSizeDialog(true)
                                return
                              }
                              const sz = materialSizes.find(s => s.id === e.target.value)
                              updateLine(i, 'material_size_id', e.target.value)
                              if (sz) updateLine(i, 'size_label', sz.size_label)
                            }}
                            className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none">
                            <option value="">Select</option>
                            {sizesForType.map((s) => <option key={s.id} value={s.id}>{s.size_label}</option>)}
                            <option value="NEW_SIZE" className="font-semibold">+ New Size</option>
                          </select>
                        )}
                      </td>
                      {/* ── Qty ── */}
                      <td className="pr-3 py-2">
                        <input type="number" value={line.quantity} onChange={(e) => updateLine(i, 'quantity', e.target.value)}
                          step="0.001" min="0" required placeholder="0.000"
                          className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
                      </td>
                      {/* ── Rate ── */}
                      <td className="pr-3 py-2">
                        <input type="number" value={line.rate} onChange={(e) => updateLine(i, 'rate', e.target.value)}
                          step="0.01" min="0" placeholder="0.00"
                          className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
                      </td>
                      {/* Taxable value */}
                      <td className="pr-3 py-2">
                        <span className="block w-24 rounded border border-gray-100 bg-gray-50 px-2 py-1.5 text-sm text-gray-700 text-right">
                          {line.taxable_value > 0 ? `₹${line.taxable_value.toFixed(2)}` : '—'}
                        </span>
                      </td>
                      {/* Tax Rate */}
                      <td className="pr-3 py-2">
                        <select
                          value={line.tax_rate_id}
                          onChange={(e) => updateLine(i, 'tax_rate_id', e.target.value)}
                          className="block w-32 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">No Tax</option>
                          {taxRates.map((tr) => (
                            <option key={tr.id} value={tr.id}>{tr.name}</option>
                          ))}
                        </select>
                      </td>
                      {/* CGST */}
                      <td className="pr-3 py-2 text-right">
                        {line.cgst_amount > 0 ? (
                          <span className="text-xs text-orange-700">
                            <span className="block text-gray-400">{line.cgst_rate}%</span>
                            ₹{line.cgst_amount.toFixed(2)}
                          </span>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      {/* SGST */}
                      <td className="pr-3 py-2 text-right">
                        {line.sgst_amount > 0 ? (
                          <span className="text-xs text-orange-700">
                            <span className="block text-gray-400">{line.sgst_rate}%</span>
                            ₹{line.sgst_amount.toFixed(2)}
                          </span>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      {/* TCS */}
                      <td className="pr-3 py-2 text-right">
                        {line.tcs_amount > 0 ? (
                          <span className="text-xs text-blue-700">
                            <span className="block text-gray-400">{line.tcs_rate}%</span>
                            +₹{line.tcs_amount.toFixed(2)}
                          </span>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      {/* Total with tax */}
                      <td className="pr-3 py-2 text-right">
                        <span className="text-sm font-semibold text-gray-900">
                          {line.total_with_tax > 0 ? `₹${line.total_with_tax.toFixed(2)}` : '—'}
                        </span>
                      </td>
                      <td className="pr-3 py-2">
                        <input type="text" value={line.notes} onChange={(e) => updateLine(i, 'notes', e.target.value)}
                          className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
                      </td>
                      <td className="py-2">
                        {lines.length > 1 && (
                          <button type="button" onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600 font-bold px-2">×</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200">
                  <td colSpan={4} className="py-3 text-sm font-semibold text-right pr-3">Totals:</td>
                  <td className="py-3 pr-3 text-sm font-bold">{totalQty.toFixed(3)}</td>
                  <td></td>
                  <td className="py-3 pr-3 text-sm font-bold">₹{totalAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {showMaterialTypeDialog && (
          <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50 p-5 mb-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-blue-900">Create New Material Type</h2>
                <p className="text-sm text-blue-700">Add a material type and assign it to the current line.</p>
              </div>
              <button type="button" onClick={handleCancelNewType} className="text-sm text-blue-700 hover:text-blue-900">Cancel</button>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-blue-900 mb-1">Code * (2 chars)</label>
                <input value={newMaterialTypeCode} maxLength={2}
                  onChange={(e) => setNewMaterialTypeCode(e.target.value.toUpperCase())}
                  className="block w-full rounded border border-blue-300 bg-white px-3 py-2 text-sm font-mono uppercase focus:border-blue-500 focus:outline-none"
                  placeholder="e.g. GA" />
              </div>
              <div>
                <label className="block text-sm font-medium text-blue-900 mb-1">Description *</label>
                <input value={newMaterialTypeDescription} onChange={(e) => setNewMaterialTypeDescription(e.target.value)}
                  className="block w-full rounded border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="e.g. GA Sheet" />
              </div>
              <div>
                <label className="block text-sm font-medium text-blue-900 mb-1">Unit</label>
                <input value={newMaterialTypeUnit} onChange={(e) => setNewMaterialTypeUnit(e.target.value)}
                  className="block w-full rounded border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="tons" />
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={handleCreateMaterialType} disabled={materialTypeDialogLoading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {materialTypeDialogLoading ? 'Creating…' : 'Create Material Type'}
              </button>
            </div>
          </div>
        )}
        {showSizeDialog && (
          <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50 p-5 mb-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-blue-900">Create New Size</h2>
                <p className="text-sm text-blue-700">Add a size for the selected material type.</p>
              </div>
              <button type="button" onClick={handleCancelNewSize} className="text-sm text-blue-700 hover:text-blue-900">Cancel</button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-blue-900 mb-1">Material Type</label>
                <select value={newSizeMaterialTypeId} onChange={(e) => setNewSizeMaterialTypeId(e.target.value)}
                  className="block w-full rounded border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                  <option value="">— Select Material Type —</option>
                  {materialTypes.map((m) => <option key={m.id} value={m.id}>{m.description}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-blue-900 mb-1">Size Label</label>
                <input value={newSizeLabel} onChange={(e) => setNewSizeLabel(e.target.value)}
                  className="block w-full rounded border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="Enter size label" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 mt-4">
              <div>
                <label className="block text-sm font-medium text-blue-900 mb-1">Thickness</label>
                <input value={newSizeThickness} onChange={(e) => setNewSizeThickness(e.target.value)}
                  className="block w-full rounded border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="Optional" />
              </div>
              <div>
                <label className="block text-sm font-medium text-blue-900 mb-1">Width</label>
                <input value={newSizeWidth} onChange={(e) => setNewSizeWidth(e.target.value)}
                  className="block w-full rounded border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="Optional" />
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={handleCreateSize} disabled={sizeDialogLoading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {sizeDialogLoading ? 'Creating…' : 'Create Size'}
              </button>
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button type="submit" disabled={loading}
            className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {loading ? 'Saving...' : '✓ Create Sale'}
          </button>
          <button type="button" onClick={() => router.back()}
            className="rounded-lg border border-gray-300 px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
