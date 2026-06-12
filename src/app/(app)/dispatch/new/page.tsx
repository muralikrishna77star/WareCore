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
  _key: string
  id: string
  purchase_line_id: string | null
  item_name: string | null
  item_master_id: string | null
  material_type_id: string
  material_size_id: string | null
  size_label: string | null
  available_quantity: number
}

type DispatchLine = {
  rowId: string
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
  rowId: Math.random().toString(36).slice(2, 8),
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
  const [availablePurchaseLines, setAvailablePurchaseLines] = useState<AvailablePurchaseLine[]>([])
  const [existingInvoiceNumbers, setExistingInvoiceNumbers] = useState<string[]>([])
  const [existingLineIds, setExistingLineIds] = useState<string[]>([])

  // Item combo state (per rowId)
  const [itemSearch, setItemSearch] = useState<Record<string, string>>({})
  const [itemOpen, setItemOpen] = useState<Record<string, boolean>>({})
  const [itemHighlight, setItemHighlight] = useState<Record<string, number>>({})

  // ── Refresh loading state ────────────────────────────────────────────────
  const [refreshingItems, setRefreshingItems] = useState(false)
  const [refreshingPurchaseLines, setRefreshingPurchaseLines] = useState(false)
  const [refreshingMaterialTypes, setRefreshingMaterialTypes] = useState(false)
  const [refreshingSizes, setRefreshingSizes] = useState(false)
  const [refreshingTaxRates, setRefreshingTaxRates] = useState(false)

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
  const [saleRefId, setSaleRefId] = useState('')
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

      const stockByLine: Record<string, number> = {}
      const stockByMaterial: Record<string, number> = {}
      for (const entry of (slRes.data as any)?.stock_ledger ?? []) {
        if (entry.purchase_line_id) {
          stockByLine[entry.purchase_line_id] = (stockByLine[entry.purchase_line_id] ?? 0) + Number(entry.quantity)
        } else {
          const mk = `${entry.material_type_id}|${entry.material_size_id ?? ''}|${entry.size_label ?? ''}`
          stockByMaterial[mk] = (stockByMaterial[mk] ?? 0) + Number(entry.quantity)
        }
      }

      const seen = new Set<string>()
      const avail: AvailablePurchaseLine[] = []
      for (const item of (pbiRes.data as any)?.purchase_bill_items ?? []) {
        let qty: number
        let key: string
        if (item.purchase_line_id) {
          if (seen.has(item.purchase_line_id)) continue
          qty = stockByLine[item.purchase_line_id] ?? 0
          key = item.purchase_line_id
        } else {
          const mk = `${item.material_type_id}|${item.material_size_id ?? ''}|${item.size_label ?? ''}`
          if (seen.has(mk)) continue
          qty = stockByMaterial[mk] ?? 0
          key = `ID:${item.id}`
        }
        if (qty > 0) {
          seen.add(item.purchase_line_id ?? `${item.material_type_id}|${item.material_size_id ?? ''}|${item.size_label ?? ''}`)
          avail.push({ ...item, _key: key, available_quantity: qty })
        }
      }
      setAvailablePurchaseLines(avail)
      setMasterDataLoading(false)
    }
    load()
  }, [])

  const refreshItems = async () => {
    setRefreshingItems(true)
    const res = await hasuraFetch(ACTIVE_ITEM_MASTER_QUERY)
    setItemMasters((res.data as any)?.item_master ?? [])
    setRefreshingItems(false)
  }

  const refreshPurchaseLines = async () => {
    setRefreshingPurchaseLines(true)
    const [pbiRes, slRes] = await Promise.all([
      hasuraFetch(PURCHASE_BILL_ITEMS_FOR_DISPATCH_QUERY),
      hasuraFetch(STOCK_LEDGER_LINE_QUANTITIES_QUERY),
    ])
    const stockByLine: Record<string, number> = {}
    const stockByMaterial: Record<string, number> = {}
    for (const entry of (slRes.data as any)?.stock_ledger ?? []) {
      if (entry.purchase_line_id) {
        stockByLine[entry.purchase_line_id] = (stockByLine[entry.purchase_line_id] ?? 0) + Number(entry.quantity)
      } else {
        const mk = `${entry.material_type_id}|${entry.material_size_id ?? ''}|${entry.size_label ?? ''}`
        stockByMaterial[mk] = (stockByMaterial[mk] ?? 0) + Number(entry.quantity)
      }
    }
    const seen = new Set<string>()
    const avail: AvailablePurchaseLine[] = []
    for (const item of (pbiRes.data as any)?.purchase_bill_items ?? []) {
      let qty: number
      let key: string
      if (item.purchase_line_id) {
        if (seen.has(item.purchase_line_id)) continue
        qty = stockByLine[item.purchase_line_id] ?? 0
        key = item.purchase_line_id
      } else {
        const mk = `${item.material_type_id}|${item.material_size_id ?? ''}|${item.size_label ?? ''}`
        if (seen.has(mk)) continue
        qty = stockByMaterial[mk] ?? 0
        key = `ID:${item.id}`
      }
      if (qty > 0) {
        seen.add(item.purchase_line_id ?? `${item.material_type_id}|${item.material_size_id ?? ''}|${item.size_label ?? ''}`)
        avail.push({ ...item, _key: key, available_quantity: qty })
      }
    }
    setAvailablePurchaseLines(avail)
    setRefreshingPurchaseLines(false)
  }

  const refreshMaterialTypes = async () => {
    setRefreshingMaterialTypes(true)
    const res = await hasuraFetch(ACTIVE_MATERIAL_TYPES_QUERY)
    setMaterialTypes((res.data as any)?.material_types ?? [])
    setRefreshingMaterialTypes(false)
  }

  const refreshSizes = async () => {
    setRefreshingSizes(true)
    const res = await hasuraFetch(ACTIVE_MATERIAL_SIZES_QUERY)
    setMaterialSizes((res.data as any)?.material_sizes ?? [])
    setRefreshingSizes(false)
  }

  const refreshTaxRates = async () => {
    setRefreshingTaxRates(true)
    const res = await hasuraFetch(ACTIVE_SALES_TAX_RATES_QUERY)
    setTaxRates((res.data as any)?.tax_rates ?? [])
    setRefreshingTaxRates(false)
  }

  const updateLine = useCallback((index: number, field: keyof DispatchLine, value: string) => {
    setLines((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }

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
          const currentPL = updated[index].purchase_line_id
          if (currentPL) {
            const pl = availablePurchaseLines.find((l) => l._key === currentPL)
            if (!pl || (pl.item_master_id && pl.item_master_id !== value)) {
              updated[index].purchase_line_id = ''
              updated[index].available_quantity = ''
            }
          }
        } else {
          updated[index].item_name          = ''
          updated[index].material_type_id   = ''
          updated[index].material_size_id   = ''
          updated[index].size_label         = ''
          updated[index].sale_line_id       = ''
          updated[index].purchase_line_id   = ''
          updated[index].available_quantity = ''
        }
      }

      if (field === 'purchase_line_id') {
        const pl = availablePurchaseLines.find((l) => l._key === value)
        if (pl) {
          updated[index].available_quantity = pl.available_quantity.toFixed(3)
          updated[index].material_type_id   = pl.material_type_id || ''
          updated[index].material_size_id   = pl.material_size_id || ''
          updated[index].size_label         = pl.size_label || ''
          if (!updated[index].sale_line_id) {
            const mt = materialTypes.find(m => m.id === pl.material_type_id)
            if (mt?.code) {
              const currentAssigned = prev.filter((_, i) => i !== index).map((l) => l.sale_line_id).filter(Boolean)
              updated[index].sale_line_id = generateSaleLineId(mt.code, [...existingLineIds, ...currentAssigned])
            }
          }
        } else {
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

  const handleSave = async (status: 'active' | 'draft') => {
    setLoading(true)
    setError(null)

    const validLines = lines.filter((l) => l.material_type_id && l.quantity)
    if (status === 'active' && !validLines.length) {
      setError('Add at least one line item.')
      setLoading(false)
      return
    }

    if (!saleId.trim()) {
      setError('Sale ID is required.')
      setLoading(false)
      return
    }

    // Refetch invoice numbers right before saving to catch any IDs added/cancelled since page load
    const freshInvRes = await hasuraFetch(ALL_INVOICE_NUMBERS_QUERY)
    const freshInvoiceNumbers: string[] = ((freshInvRes.data as any)?.dispatch_orders ?? [])
      .map((o: any) => o.invoice_number).filter(Boolean)
    setExistingInvoiceNumbers(freshInvoiceNumbers)

    let invoiceToUse = saleId.trim()
    if (freshInvoiceNumbers.includes(invoiceToUse)) {
      // ID is taken (e.g. by a cancelled order) — generate a fresh one
      invoiceToUse = generateSaleId(freshInvoiceNumbers)
      setSaleId(invoiceToUse)
      setError(`Sale ID "${saleId}" was already taken — new ID "${invoiceToUse}" assigned. Review and save again.`)
      setLoading(false)
      return
    }

    const { data: orderData, error: oErr } = await hasuraFetch<any>(
      CREATE_DISPATCH_ORDER_MUTATION, {
        company_id: companyId || null,
        warehouse_id: warehouseId || null,
        customer_id: customerId || null,
        invoice_number: invoiceToUse,
        dispatch_date: dispatchDate,
        vehicle_number: vehicleNumber || null,
        driver_name: driverName || null,
        total_quantity: totalQty,
        total_amount: totalAmt || null,
        notes: notes || null,
        status,
        sale_ref_id: saleRefId || null,
      }
    )
    const order = orderData?.insert_dispatch_orders_one
    if (oErr || !order) {
      setError(oErr?.message ?? 'Failed to create dispatch')
      setLoading(false)
      return
    }

    if (validLines.length) {
      const objects = validLines.map((l) => ({
        dispatch_order_id: order.id,
        item_master_id: l.item_master_id || null,
        sale_line_id: l.sale_line_id || null,
        purchase_line_id: l.purchase_line_id && !l.purchase_line_id.startsWith('ID:') ? l.purchase_line_id : null,
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
      const { error: iErr } = await hasuraFetch(CREATE_DISPATCH_ITEMS_MUTATION, { objects })
      if (iErr) {
        setError(iErr.message)
        setLoading(false)
        return
      }
    }

    router.push('/dispatch')
    router.refresh()
  }

  const fieldCls = "block w-full rounded border border-gray-300 px-2 py-2 text-sm focus:border-blue-500 focus:outline-none"

  return (
    <div className="max-w-[1800px] mx-auto">

      <MissingMasterDataBanner
        loading={masterDataLoading}
        checks={[
          { label: 'Companies', count: companies.length, adminPath: '/admin/companies/new' },
          { label: 'Warehouses', count: warehouses.length, adminPath: '/admin/warehouses/new' },
          { label: 'Customers', count: customers.length, adminPath: '/admin/customers/new' },
          { label: 'Material Types', count: materialTypes.length, adminPath: '/admin/materials/new' },
        ]}
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
          <h1 className="text-base font-semibold text-gray-900">New Sale Entry</h1>
          <div className="flex gap-2">
            <button type="button" onClick={() => router.back()}
              className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100">
              Cancel
            </button>
            <button type="button" onClick={() => handleSave('draft')} disabled={loading}
              className="rounded border border-amber-400 bg-amber-50 px-4 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50">
              {loading ? 'Saving…' : 'Save Draft'}
            </button>
            <button type="button" onClick={() => handleSave('active')} disabled={loading}
              className="rounded bg-blue-600 px-5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Saving…' : 'Create Sale'}
            </button>
          </div>
        </div>

        {/* ── Dispatch Details ───────────────────────────────────────────── */}
        <div className="px-4 py-3 border-b border-gray-200">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-8">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Company</label>
              <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={fieldCls}>
                <option value="">— Select —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Warehouse</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={fieldCls}>
                <option value="">— Select —</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Customer</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={fieldCls}>
                <option value="">— Select —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Sale ID</label>
              <div className="flex gap-1">
                <input type="text" value={saleId} onChange={(e) => setSaleId(e.target.value)}
                  placeholder={masterDataLoading ? 'Loading…' : 'MMYY-NNNN'}
                  className="block flex-1 min-w-0 rounded border border-gray-300 px-2 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none" />
                <button type="button" onClick={() => setSaleId(generateSaleId(existingInvoiceNumbers))}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">↻</button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Dispatch Date</label>
              <input type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Vehicle No.</label>
              <input type="text" value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)}
                placeholder="MH-01-AB-1234" className={fieldCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Driver</label>
              <input type="text" value={driverName} onChange={(e) => setDriverName(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className={fieldCls} />
            </div>
          </div>
        </div>

        {/* ── Items band ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-2 bg-blue-50 border-b border-blue-100">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Items</span>
            {availablePurchaseLines.length > 0 && (
              <span className="text-[10px] text-blue-600">{availablePurchaseLines.length} lines with stock</span>
            )}
          </div>
          <button type="button" onClick={addLine}
            className="text-xs font-medium text-blue-700 hover:text-blue-900 border border-blue-300 rounded px-2 py-0.5 hover:bg-blue-100">
            + Add Line
          </button>
        </div>

        <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-2 text-xs font-medium text-gray-500 whitespace-nowrap">
                    Item
                    <button type="button" onClick={refreshItems} title="Refresh items"
                      className="ml-1 text-gray-400 hover:text-blue-500 align-middle">
                      {refreshingItems ? '…' : '↻'}
                    </button>
                  </th>
                  <th className="pb-2 pr-2 text-xs font-medium text-gray-500 whitespace-nowrap">
                    Purchase Line
                    <button type="button" onClick={refreshPurchaseLines} title="Refresh available stock"
                      className="ml-1 text-gray-400 hover:text-blue-500 align-middle">
                      {refreshingPurchaseLines ? '…' : '↻'}
                    </button>
                  </th>
                  <th className="pb-2 pr-2 text-xs font-medium text-gray-500 whitespace-nowrap">
                    Material
                    <button type="button" onClick={refreshMaterialTypes} title="Refresh material types"
                      className="ml-1 text-gray-400 hover:text-blue-500 align-middle">
                      {refreshingMaterialTypes ? '…' : '↻'}
                    </button>
                  </th>
                  <th className="pb-2 pr-2 text-xs font-medium text-gray-500 whitespace-nowrap">
                    Size
                    <button type="button" onClick={refreshSizes} title="Refresh sizes"
                      className="ml-1 text-gray-400 hover:text-blue-500 align-middle">
                      {refreshingSizes ? '…' : '↻'}
                    </button>
                  </th>
                  <th className="pb-2 pr-2 text-xs font-medium text-gray-500">Qty</th>
                  <th className="pb-2 pr-2 text-xs font-medium text-gray-500">Rate (₹)</th>
                  <th className="pb-2 pr-2 text-xs font-medium text-gray-500">Taxable (₹)</th>
                  <th className="pb-2 pr-2 text-xs font-medium text-gray-500 whitespace-nowrap">
                    Tax Rate
                    <button type="button" onClick={refreshTaxRates} title="Refresh tax rates"
                      className="ml-1 text-gray-400 hover:text-blue-500 align-middle">
                      {refreshingTaxRates ? '…' : '↻'}
                    </button>
                  </th>
                  <th className="pb-2 pr-2 text-xs font-medium text-gray-500 text-right">CGST</th>
                  <th className="pb-2 pr-2 text-xs font-medium text-gray-500 text-right">SGST</th>
                  <th className="pb-2 pr-2 text-xs font-medium text-gray-500 text-right">TCS</th>
                  <th className="pb-2 pr-2 text-xs font-medium text-gray-500 text-right">Total</th>
                  <th className="pb-2 pr-2 text-xs font-medium text-gray-500">Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lines.map((line, i) => {
                  const sizesForType = materialSizes.filter((s) => !s.material_type_id || s.material_type_id === line.material_type_id)
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

                  // Item combo search — searchable by item_name or item_code
                  const itemSearchValue = itemSearch[line.rowId] ?? line.item_name
                  const filteredItems = itemSearchValue
                    ? itemMasters.filter(im => {
                        const q = itemSearchValue.toLowerCase()
                        return im.item_name.toLowerCase().includes(q) || (im.item_code && im.item_code.toLowerCase().startsWith(q))
                      })
                    : itemMasters

                  return (
                    <tr key={line.rowId}>
                      {/* ── Item — combo search ── */}
                      <td className="pr-2 py-2">
                        <div className="space-y-1">
                          <div className="relative">
                            <input
                              type="text"
                              value={itemSearchValue}
                              onChange={(e) => {
                                const val = e.target.value
                                setItemSearch(prev => ({ ...prev, [line.rowId]: val }))
                                setItemOpen(prev => ({ ...prev, [line.rowId]: true }))
                                setItemHighlight(prev => ({ ...prev, [line.rowId]: -1 }))
                                // Clear item master selection if user starts typing new search
                                if (line.item_master_id && val !== line.item_name) {
                                  updateLine(i, 'item_master_id', '')
                                }
                              }}
                              onKeyDown={(e) => {
                                const items = filteredItems
                                const count = items.length
                                const cur = itemHighlight[line.rowId] ?? -1
                                if (e.key === 'ArrowDown') {
                                  e.preventDefault()
                                  if (!itemOpen[line.rowId]) {
                                    setItemOpen(prev => ({ ...prev, [line.rowId]: true }))
                                    setItemHighlight(prev => ({ ...prev, [line.rowId]: 0 }))
                                    return
                                  }
                                  setItemHighlight(prev => ({ ...prev, [line.rowId]: Math.min(cur + 1, count - 1) }))
                                } else if (e.key === 'ArrowUp') {
                                  e.preventDefault()
                                  setItemHighlight(prev => ({ ...prev, [line.rowId]: Math.max(cur - 1, 0) }))
                                } else if (e.key === 'Enter') {
                                  e.preventDefault()
                                  if (cur >= 0 && cur < count) {
                                    const im = items[cur]
                                    updateLine(i, 'item_master_id', im.id)
                                    setItemSearch(prev => ({ ...prev, [line.rowId]: im.item_name }))
                                    setItemOpen(prev => ({ ...prev, [line.rowId]: false }))
                                    setItemHighlight(prev => ({ ...prev, [line.rowId]: -1 }))
                                  }
                                } else if (e.key === 'Escape') {
                                  setItemOpen(prev => ({ ...prev, [line.rowId]: false }))
                                }
                              }}
                              onFocus={() => setItemOpen(prev => ({ ...prev, [line.rowId]: true }))}
                              onBlur={() => setItemOpen(prev => ({ ...prev, [line.rowId]: false }))}
                              placeholder="Search item..."
                              className="block w-56 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                            />
                            {itemOpen[line.rowId] && (
                              <div className="absolute z-50 mt-1 w-64 overflow-y-auto rounded-md border border-gray-300 bg-white shadow-lg max-h-48">
                                {filteredItems.map((im, idx) => (
                                  <button
                                    key={im.id}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      updateLine(i, 'item_master_id', im.id)
                                      setItemSearch(prev => ({ ...prev, [line.rowId]: im.item_name }))
                                      setItemOpen(prev => ({ ...prev, [line.rowId]: false }))
                                      setItemHighlight(prev => ({ ...prev, [line.rowId]: -1 }))
                                    }}
                                    className={`w-full text-left px-2 py-2 text-xs ${itemHighlight[line.rowId] === idx ? 'bg-blue-100 text-blue-800' : 'hover:bg-gray-100'}`}
                                  >
                                    <span className="block font-medium">{im.item_name}</span>
                                    {im.item_code && <span className="text-gray-400">{im.item_code}</span>}
                                  </button>
                                ))}
                                {filteredItems.length === 0 && (
                                  <div className="px-2 py-2 text-xs text-gray-400">No items found</div>
                                )}
                              </div>
                            )}
                          </div>
                          {line.sale_line_id ? (
                            <span className="inline-flex items-center rounded bg-green-50 border border-green-200 px-2 py-1 text-[10px] font-mono font-medium text-green-700 whitespace-nowrap select-all">
                              {line.sale_line_id}
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-400 italic">no line ID yet</span>
                          )}
                        </div>
                      </td>
                      {/* ── Purchase Line ── */}
                      <td className="pr-2 py-2">
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
                              <option key={pl._key} value={pl._key}>
                                {pl.purchase_line_id
                                  ? `${pl.purchase_line_id} (${pl.available_quantity.toFixed(2)})`
                                  : `[Stock] ${pl.item_name || pl.size_label || 'General'} (${pl.available_quantity.toFixed(2)})`
                                }
                              </option>
                            ))}
                          </select>
                          {line.available_quantity ? (
                            <p className="text-[10px] text-green-600 mt-0.5 font-medium">✓ {line.available_quantity} avail</p>
                          ) : line.item_master_id && purchaseLinesForRow.length === 0 && !masterDataLoading ? (
                            <p className="text-[10px] text-amber-600 mt-0.5">No stock for this item</p>
                          ) : null}
                        </div>
                      </td>
                      {/* ── Material ── */}
                      <td className="pr-2 py-2">
                        {line.item_master_id || line.purchase_line_id ? (
                          <span className="block text-sm text-gray-700 px-1 font-mono">
                            {materialTypes.find(m => m.id === line.material_type_id)?.code || '—'}
                          </span>
                        ) : (
                          <select value={line.material_type_id} onChange={(e) => {
                            if (e.target.value === 'NEW_TYPE') {
                              setActiveLineIndexForNewType(i); setShowMaterialTypeDialog(true); return
                            }
                            updateLine(i, 'material_type_id', e.target.value)
                            updateLine(i, 'material_size_id', '')
                            updateLine(i, 'size_label', '')
                          }}
                            className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none">
                            <option value="">Select</option>
                            {materialTypes.map((m) => <option key={m.id} value={m.id}>{m.description}</option>)}
                            <option value="NEW_TYPE" className="font-semibold">+ New Material Type</option>
                          </select>
                        )}
                      </td>
                      {/* ── Size ── */}
                      <td className="pr-2 py-2">
                        {line.item_master_id || line.purchase_line_id ? (
                          <span className="block text-sm text-gray-700 px-1">{line.size_label || '—'}</span>
                        ) : (
                          <select value={line.material_size_id}
                            onChange={(e) => {
                              if (e.target.value === 'NEW_SIZE') {
                                setActiveLineIndexForNewSize(i); setNewSizeMaterialTypeId(line.material_type_id); setShowSizeDialog(true); return
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
                      <td className="pr-2 py-2">
                        <input type="number" value={line.quantity} onChange={(e) => updateLine(i, 'quantity', e.target.value)}
                          step="0.001" min="0" placeholder="0.000"
                          className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
                      </td>
                      {/* ── Rate ── */}
                      <td className="pr-2 py-2">
                        <input type="number" value={line.rate} onChange={(e) => updateLine(i, 'rate', e.target.value)}
                          step="0.01" min="0" placeholder="0.00"
                          className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
                      </td>
                      <td className="pr-2 py-2">
                        <span className="block w-24 rounded border border-gray-100 bg-gray-50 px-2 py-1.5 text-sm text-gray-700 text-right">
                          {line.taxable_value > 0 ? `₹${line.taxable_value.toFixed(2)}` : '—'}
                        </span>
                      </td>
                      <td className="pr-2 py-2">
                        <select value={line.tax_rate_id} onChange={(e) => updateLine(i, 'tax_rate_id', e.target.value)}
                          className="block w-32 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none">
                          <option value="">No Tax</option>
                          {taxRates.map((tr) => <option key={tr.id} value={tr.id}>{tr.name}</option>)}
                        </select>
                      </td>
                      <td className="pr-2 py-2 text-right">
                        {line.cgst_amount > 0 ? (
                          <span className="text-xs text-orange-700">
                            <span className="block text-gray-400">{line.cgst_rate}%</span>
                            ₹{line.cgst_amount.toFixed(2)}
                          </span>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="pr-2 py-2 text-right">
                        {line.sgst_amount > 0 ? (
                          <span className="text-xs text-orange-700">
                            <span className="block text-gray-400">{line.sgst_rate}%</span>
                            ₹{line.sgst_amount.toFixed(2)}
                          </span>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="pr-2 py-2 text-right">
                        {line.tcs_amount > 0 ? (
                          <span className="text-xs text-blue-700">
                            <span className="block text-gray-400">{line.tcs_rate}%</span>
                            +₹{line.tcs_amount.toFixed(2)}
                          </span>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="pr-2 py-2 text-right">
                        <span className="text-sm font-semibold text-gray-900">
                          {line.total_with_tax > 0 ? `₹${line.total_with_tax.toFixed(2)}` : '—'}
                        </span>
                      </td>
                      <td className="pr-2 py-2">
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
                  <td colSpan={7}></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {error && (
            <div className="border-t border-red-200 bg-red-50 px-4 py-2">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

        </div>
      {/* ── New Material Type modal ─────────────────────────────────────── */}
      {showMaterialTypeDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4">
            <h2 className="text-base font-bold text-gray-900">Create New Material Type</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Code * (2 chars)</label>
                <input value={newMaterialTypeCode} maxLength={2}
                  onChange={(e) => setNewMaterialTypeCode(e.target.value.toUpperCase())} autoFocus
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono uppercase focus:border-blue-500 focus:outline-none"
                  placeholder="e.g. GA" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Description *</label>
                <input value={newMaterialTypeDescription} onChange={(e) => setNewMaterialTypeDescription(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="e.g. GA Sheet" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Unit</label>
                <input value={newMaterialTypeUnit} onChange={(e) => setNewMaterialTypeUnit(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="tons" />
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button type="button" onClick={() => { setShowMaterialTypeDialog(false); setActiveLineIndexForNewType(null) }}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={handleCreateMaterialType} disabled={materialTypeDialogLoading}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {materialTypeDialogLoading ? 'Creating…' : 'Create Material Type'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Size modal ──────────────────────────────────────────────── */}
      {showSizeDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4">
            <h2 className="text-base font-bold text-gray-900">Create New Size</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Material Type</label>
                <select value={newSizeMaterialTypeId} onChange={(e) => setNewSizeMaterialTypeId(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                  <option value="">— Select —</option>
                  {materialTypes.map((m) => <option key={m.id} value={m.id}>{m.description}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Size Label</label>
                <input value={newSizeLabel} onChange={(e) => setNewSizeLabel(e.target.value)} autoFocus
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Thickness</label>
                <input value={newSizeThickness} onChange={(e) => setNewSizeThickness(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" placeholder="Optional" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Width</label>
                <input value={newSizeWidth} onChange={(e) => setNewSizeWidth(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" placeholder="Optional" />
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button type="button" onClick={() => { setShowSizeDialog(false); setActiveLineIndexForNewSize(null) }}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={handleCreateSize} disabled={sizeDialogLoading}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {sizeDialogLoading ? 'Creating…' : 'Create Size'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
