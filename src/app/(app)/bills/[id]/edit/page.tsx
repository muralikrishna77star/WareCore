'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import {
  ACTIVE_COMPANIES_QUERY, ACTIVE_WAREHOUSES_QUERY, ACTIVE_SUPPLIERS_QUERY,
  ACTIVE_MATERIAL_TYPES_QUERY, ACTIVE_MATERIAL_SIZES_QUERY, ACTIVE_ITEM_MASTER_QUERY,
  ACTIVE_PURCHASE_TAX_RATES_QUERY,
  ALL_BILL_NUMBERS_QUERY, ALL_PURCHASE_LINE_IDS_QUERY,
  PURCHASE_BILL_FOR_EDIT_QUERY,
  UPDATE_PURCHASE_BILL_MUTATION,
  DELETE_PURCHASE_BILL_ITEMS_MUTATION,
  CREATE_PURCHASE_BILL_ITEMS_MUTATION,
  CHECK_PURCHASE_LINE_USAGE_QUERY,
} from '@/lib/hasura/queries'
import type { Company, Warehouse, Supplier, MaterialType, MaterialSize, ItemMaster, TaxRate } from '@/types'

type LineItem = {
  rowId: string
  dbItemId: string
  isLocked: boolean
  purchase_line_id: string
  item_master_id: string
  item_name: string
  item_code: string
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
  tds_rate: number
  tds_amount: number
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

function generatePurchaseLineId(groupCode: string, mmyy: string, allLineIds: string[]): string {
  const prefix = `${groupCode.slice(0, 2).toUpperCase()}${mmyy}-`
  const count = allLineIds.filter(id => id && id.startsWith(prefix)).length
  return `${prefix}${String(count + 1).padStart(4, '0')}`
}

const emptyLine = (): LineItem => ({
  rowId: Math.random().toString(36).slice(2, 8),
  dbItemId: '', isLocked: false,
  purchase_line_id: '', item_master_id: '', item_name: '', item_code: '',
  material_type_id: '', material_size_id: '', size_label: '',
  quantity: '', rate: '', amount: '', notes: '',
  tax_rate_id: '', taxable_value: 0,
  cgst_rate: 0, cgst_amount: 0, sgst_rate: 0, sgst_amount: 0,
  tds_rate: 0, tds_amount: 0, total_with_tax: 0,
})

function calcTax(line: LineItem, taxRates: TaxRate[]): Partial<LineItem> {
  const taxable = (parseFloat(line.quantity) || 0) * (parseFloat(line.rate) || 0)
  if (!line.tax_rate_id) return { taxable_value: taxable, cgst_amount: 0, sgst_amount: 0, tds_amount: 0, total_with_tax: taxable }
  const tr = taxRates.find((t) => t.id === line.tax_rate_id)
  if (!tr) return { taxable_value: taxable }
  const cgst = (taxable * Number(tr.cgst_rate)) / 100
  const sgst = (taxable * Number(tr.sgst_rate)) / 100
  const tdsBase = taxable + cgst + sgst
  const tds = (tdsBase * Number(tr.tds_rate)) / 100
  return {
    taxable_value: taxable,
    cgst_rate: Number(tr.cgst_rate), cgst_amount: cgst,
    sgst_rate: Number(tr.sgst_rate), sgst_amount: sgst,
    tds_rate: Number(tr.tds_rate), tds_amount: tds,
    total_with_tax: taxable + cgst + sgst - tds,
  }
}

export default function EditBillPage() {
  const router = useRouter()
  const params = useParams()
  const billId = params.id as string

  const [companies, setCompanies] = useState<Company[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([])
  const [materialSizes, setMaterialSizes] = useState<MaterialSize[]>([])
  const [itemMasters, setItemMasters] = useState<ItemMaster[]>([])
  const [taxRates, setTaxRates] = useState<TaxRate[]>([])
  const [existingLineIds, setExistingLineIds] = useState<string[]>([])

  const [companyId, setCompanyId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [billNumber, setBillNumber] = useState('')
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineItem[]>([emptyLine(), emptyLine(), emptyLine()])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pageLoading, setPageLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [billStatus, setBillStatus] = useState<'draft' | 'active'>('draft')
  const [originalFreeItemIds, setOriginalFreeItemIds] = useState<string[]>([])

  const [companySearch, setCompanySearch] = useState('')
  const [warehouseSearch, setWarehouseSearch] = useState('')
  const [supplierSearch, setSupplierSearch] = useState('')
  const [companyOpen, setCompanyOpen] = useState(false)
  const [warehouseOpen, setWarehouseOpen] = useState(false)
  const [supplierOpen, setSupplierOpen] = useState(false)

  const [itemSearch, setItemSearch] = useState<Record<string, string>>({})
  const [itemOpen, setItemOpen] = useState<Record<string, boolean>>({})
  const [itemHighlight, setItemHighlight] = useState<Record<string, number>>({})

  useEffect(() => {
    const load = async () => {
      const [c, w, s, mt, ms, im, tr, lis, billRes] = await Promise.all([
        hasuraFetch(ACTIVE_COMPANIES_QUERY),
        hasuraFetch(ACTIVE_WAREHOUSES_QUERY),
        hasuraFetch(ACTIVE_SUPPLIERS_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_TYPES_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_SIZES_QUERY),
        hasuraFetch(ACTIVE_ITEM_MASTER_QUERY),
        hasuraFetch(ACTIVE_PURCHASE_TAX_RATES_QUERY),
        hasuraFetch(ALL_PURCHASE_LINE_IDS_QUERY),
        hasuraFetch(PURCHASE_BILL_FOR_EDIT_QUERY, { id: billId }),
      ])

      const loadedCompanies: Company[] = (c.data as any)?.companies ?? []
      const loadedWarehouses: Warehouse[] = (w.data as any)?.warehouses ?? []
      const loadedSuppliers: Supplier[] = (s.data as any)?.suppliers ?? []
      const loadedMaterialTypes: MaterialType[] = (mt.data as any)?.material_types ?? []
      const loadedMaterialSizes: MaterialSize[] = (ms.data as any)?.material_sizes ?? []
      const loadedItemMasters: ItemMaster[] = (im.data as any)?.item_master ?? []
      const loadedTaxRates: TaxRate[] = (tr.data as any)?.tax_rates ?? []

      setCompanies(loadedCompanies)
      setWarehouses(loadedWarehouses)
      setSuppliers(loadedSuppliers)
      setMaterialTypes(loadedMaterialTypes)
      setMaterialSizes(loadedMaterialSizes)
      setItemMasters(loadedItemMasters)
      setTaxRates(loadedTaxRates)

      const allLineIds: string[] = ((lis.data as any)?.purchase_bill_items ?? [])
        .map((i: any) => i.purchase_line_id).filter(Boolean)
      setExistingLineIds(allLineIds)

      const bill = (billRes.data as any)?.purchase_bills_by_pk
      if (!bill || bill.status === 'cancelled') { setNotFound(true); setPageLoading(false); return }

      setBillStatus(bill.status as 'draft' | 'active')
      setBillNumber(bill.bill_number)
      setBillDate(bill.bill_date)
      setNotes(bill.notes ?? '')
      if (bill.company_id) {
        setCompanyId(bill.company_id)
        const co = loadedCompanies.find(c => c.id === bill.company_id)
        if (co) setCompanySearch(co.name)
      }
      if (bill.warehouse_id) {
        setWarehouseId(bill.warehouse_id)
        const wh = loadedWarehouses.find(w => w.id === bill.warehouse_id)
        if (wh) setWarehouseSearch(wh.name)
      }
      if (bill.supplier_id) {
        setSupplierId(bill.supplier_id)
        const sp = loadedSuppliers.find(s => s.id === bill.supplier_id)
        if (sp) setSupplierSearch(sp.name)
      }

      const loadedLines: LineItem[] = (bill.purchase_bill_items ?? []).map((item: any) => {
        const itemMaster = loadedItemMasters.find(im => im.id === item.item_master_id)
        return {
          rowId: Math.random().toString(36).slice(2, 8),
          dbItemId: item.id ?? '',
          isLocked: false,
          purchase_line_id: item.purchase_line_id ?? '',
          item_master_id: item.item_master_id ?? '',
          item_name: item.item_name ?? '',
          item_code: itemMaster?.item_code ?? '',
          material_type_id: item.material_type_id ?? '',
          material_size_id: item.material_size_id ?? '',
          size_label: item.size_label ?? '',
          quantity: item.quantity != null ? String(item.quantity) : '',
          rate: item.rate != null ? String(item.rate) : '',
          amount: item.amount != null ? String(item.amount) : '',
          notes: item.notes ?? '',
          tax_rate_id: item.tax_rate_id ?? '',
          taxable_value: Number(item.taxable_value) || 0,
          cgst_rate: Number(item.cgst_rate) || 0,
          cgst_amount: Number(item.cgst_amount) || 0,
          sgst_rate: Number(item.sgst_rate) || 0,
          sgst_amount: Number(item.sgst_amount) || 0,
          tds_rate: Number(item.tds_rate) || 0,
          tds_amount: Number(item.tds_amount) || 0,
          total_with_tax: Number(item.total_with_tax) || 0,
        }
      })

      // For active bills, determine which lines are locked (used in dispatch/job work)
      if (bill.status === 'active') {
        const lineIds = loadedLines.map(l => l.purchase_line_id).filter(Boolean)
        if (lineIds.length) {
          const usageRes = await hasuraFetch(CHECK_PURCHASE_LINE_USAGE_QUERY, { line_ids: lineIds })
          const usedLineIds = new Set<string>([
            ...((usageRes.data as any)?.dispatch_items ?? []).map((d: any) => d.purchase_line_id),
            ...((usageRes.data as any)?.job_work_items ?? []).map((j: any) => j.purchase_line_id),
          ])
          loadedLines.forEach(l => {
            if (l.purchase_line_id && usedLineIds.has(l.purchase_line_id)) l.isLocked = true
          })
        }
        // Track free item DB IDs for stock reversal on save
        setOriginalFreeItemIds(loadedLines.filter(l => !l.isLocked && l.dbItemId).map(l => l.dbItemId))
      }

      // For drafts: pad to at least 3 lines. For active: ensure at least 1 editable line.
      if (bill.status === 'draft') {
        while (loadedLines.length < 3) loadedLines.push(emptyLine())
      } else {
        const editableCount = loadedLines.filter(l => !l.isLocked).length
        if (editableCount === 0) loadedLines.push(emptyLine())
      }
      setLines(loadedLines)
      setPageLoading(false)
    }
    load()
  }, [billId])

  const filteredWarehouses = companyId
    ? warehouses.filter((w) => w.company_id === companyId || !w.company_id)
    : warehouses

  const updateLine = useCallback((index: number, field: keyof LineItem, value: string) => {
    setLines((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }

      if (field === 'item_master_id') {
        if (value) {
          const item = itemMasters.find((im) => im.id === value)
          if (item) {
            updated[index].item_name = item.item_name
            updated[index].item_code = item.item_code
            updated[index].material_type_id = item.material_type_id
            updated[index].material_size_id = item.material_size_id || ''
            updated[index].size_label = item.size_label || ''
            const mt = materialTypes.find(m => m.id === item.material_type_id)
            if (mt?.code) {
              const currentAssigned = prev.filter((_, i) => i !== index).map((l) => l.purchase_line_id).filter(Boolean)
              updated[index].purchase_line_id = generatePurchaseLineId(
                mt.code, getMMYY(new Date(billDate + 'T00:00:00')), [...existingLineIds, ...currentAssigned]
              )
            }
          }
        } else {
          updated[index].item_name = ''
          updated[index].item_code = ''
          updated[index].purchase_line_id = ''
        }
      }

      if (field === 'material_type_id') {
        updated[index].material_size_id = ''
        updated[index].size_label = ''
        updated[index].item_master_id = ''
        updated[index].item_name = ''
        updated[index].item_code = ''
        updated[index].purchase_line_id = ''
      }

      if (field === 'material_size_id') {
        const sz = materialSizes.find((s) => s.id === value)
        updated[index].size_label = sz?.size_label || ''
      }

      if (field === 'quantity' || field === 'rate') {
        const qty = parseFloat(field === 'quantity' ? value : updated[index].quantity) || 0
        const rate = parseFloat(field === 'rate' ? value : updated[index].rate) || 0
        updated[index].amount = (qty * rate).toFixed(2)
      }
      if (field === 'quantity' || field === 'rate' || field === 'tax_rate_id') {
        Object.assign(updated[index], calcTax(updated[index], taxRates))
      }
      return updated
    })
  }, [itemMasters, materialTypes, materialSizes, taxRates, existingLineIds, billDate])

  const addLine = () => setLines((prev) => [...prev, emptyLine()])
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i))
  const totalQty = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0)
  const totalAmt = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)

  const [refreshing, setRefreshing] = useState(false)
  const refreshMasterData = async () => {
    setRefreshing(true)
    const [c, w, s, mt, ms, im, tr] = await Promise.all([
      hasuraFetch(ACTIVE_COMPANIES_QUERY), hasuraFetch(ACTIVE_WAREHOUSES_QUERY),
      hasuraFetch(ACTIVE_SUPPLIERS_QUERY), hasuraFetch(ACTIVE_MATERIAL_TYPES_QUERY),
      hasuraFetch(ACTIVE_MATERIAL_SIZES_QUERY), hasuraFetch(ACTIVE_ITEM_MASTER_QUERY),
      hasuraFetch(ACTIVE_PURCHASE_TAX_RATES_QUERY),
    ])
    setCompanies((c.data as any)?.companies ?? [])
    setWarehouses((w.data as any)?.warehouses ?? [])
    setSuppliers((s.data as any)?.suppliers ?? [])
    setMaterialTypes((mt.data as any)?.material_types ?? [])
    setMaterialSizes((ms.data as any)?.material_sizes ?? [])
    setItemMasters((im.data as any)?.item_master ?? [])
    setTaxRates((tr.data as any)?.tax_rates ?? [])
    setRefreshing(false)
  }

  const saveBill = async (status: 'active' | 'draft') => {
    setLoading(true); setError(null)
    if (!billNumber.trim()) { setError('Purchase ID is required.'); setLoading(false); return }
    if (status === 'active') {
      if (!warehouseId) { setError('Warehouse is required to submit.'); setLoading(false); return }
      const validLines = lines.filter(l => !l.isLocked && l.material_type_id && parseFloat(l.quantity) > 0)
      if (!validLines.length) { setError('Add at least one line item with material type and quantity.'); setLoading(false); return }
      for (let i = 0; i < validLines.length; i++) {
        if (!validLines[i].item_name.trim()) { setError(`Line ${i + 1}: Item Name is required.`); setLoading(false); return }
      }
    }

    // Active bill: call save-edit API (handles stock reversal for free items)
    if (billStatus === 'active') {
      const freeLines = lines.filter(l => !l.isLocked && l.material_type_id && parseFloat(l.quantity) > 0)
      const newItems = freeLines.map(l => ({
        purchase_line_id: l.purchase_line_id || null,
        item_name: l.item_name || null,
        item_master_id: l.item_master_id || null,
        material_type_id: l.material_type_id || null,
        material_size_id: l.material_size_id || null,
        size_label: l.size_label || null,
        quantity: parseFloat(l.quantity),
        rate: l.rate ? parseFloat(l.rate) : null,
        amount: l.amount ? parseFloat(l.amount) : null,
        notes: l.notes || null,
        tax_rate_id: l.tax_rate_id || null,
        taxable_value: l.taxable_value || null,
        cgst_rate: l.cgst_rate || null, cgst_amount: l.cgst_amount || null,
        sgst_rate: l.sgst_rate || null, sgst_amount: l.sgst_amount || null,
        tds_rate: l.tds_rate || null, tds_amount: l.tds_amount || null,
        total_with_tax: l.total_with_tax || null,
      }))
      const res = await fetch(`/api/bills/${billId}/save-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId || null,
          warehouse_id: warehouseId || null,
          supplier_id: supplierId || null,
          bill_number: billNumber,
          bill_date: billDate,
          notes: notes || null,
          free_item_ids: originalFreeItemIds,
          new_items: newItems,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to save.'); setLoading(false); return }
      router.push(`/bills/${billId}`)
      router.refresh()
      return
    }

    // Draft bill: direct GraphQL update
    const { error: updateError } = await hasuraFetch<any>(UPDATE_PURCHASE_BILL_MUTATION, {
      id: billId,
      company_id: companyId || null, warehouse_id: warehouseId || null,
      supplier_id: supplierId || null, bill_number: billNumber,
      bill_date: billDate, notes: notes || null, status,
    })
    if (updateError) { setError(updateError.message); setLoading(false); return }

    const { error: deleteError } = await hasuraFetch<any>(DELETE_PURCHASE_BILL_ITEMS_MUTATION, { bill_id: billId })
    if (deleteError) { setError(deleteError.message); setLoading(false); return }

    const itemsToSave = lines.filter(l => l.material_type_id && parseFloat(l.quantity) > 0)
    if (itemsToSave.length) {
      const objects = itemsToSave.map((l) => ({
        bill_id: billId,
        purchase_line_id: l.purchase_line_id || null, item_name: l.item_name || null,
        item_master_id: l.item_master_id || null, material_type_id: l.material_type_id || null,
        material_size_id: l.material_size_id || null, size_label: l.size_label || null,
        quantity: parseFloat(l.quantity), rate: l.rate ? parseFloat(l.rate) : null,
        amount: l.amount ? parseFloat(l.amount) : null, notes: l.notes || null,
        tax_rate_id: l.tax_rate_id || null, taxable_value: l.taxable_value || null,
        cgst_rate: l.cgst_rate || null, cgst_amount: l.cgst_amount || null,
        sgst_rate: l.sgst_rate || null, sgst_amount: l.sgst_amount || null,
        tds_rate: l.tds_rate || null, tds_amount: l.tds_amount || null,
        total_with_tax: l.total_with_tax || null,
      }))
      const { error: itemsError } = await hasuraFetch(CREATE_PURCHASE_BILL_ITEMS_MUTATION, { objects })
      if (itemsError) { setError(itemsError.message); setLoading(false); return }
    }

    router.push(`/bills/${billId}`)
    router.refresh()
  }

  if (pageLoading) {
    return <div className="max-w-6xl mx-auto p-6 text-gray-500">Loading bill…</div>
  }

  if (notFound) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <p className="text-red-600 font-medium">Bill not found or cannot be edited.</p>
        <a href="/bills" className="mt-2 text-blue-600 hover:underline text-sm block">← Back to Bills</a>
      </div>
    )
  }

  const isActiveBill = billStatus === 'active'

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <a href={`/bills/${billId}`} className="text-[0.9375rem] text-blue-600 hover:underline mb-1 block">
          ← Back to {isActiveBill ? 'Bill' : 'Draft'}
        </a>
        <h1 className="text-[1.4375rem] font-bold text-gray-900">{isActiveBill ? 'Edit Bill' : 'Edit Draft'}</h1>
        <p className="mt-1 text-[0.9375rem] text-gray-500">Purchase ID: {billNumber}</p>
        {isActiveBill && (
          <p className="mt-1 text-[0.8125rem] text-amber-600">Lines used in dispatch or job work are locked and cannot be edited.</p>
        )}
      </div>

      <div className="space-y-6">
        {/* Header */}
        <div className="bg-white rounded-xl border px-4 py-3">
          <h2 className="text-[0.875rem] font-semibold text-gray-800 mb-2">Bill Details</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">

            {/* Company */}
            <div>
              <label className="block text-[0.9375rem] font-medium text-gray-700 mb-1">My Companies</label>
              <div className="relative">
                <input type="text" value={companySearch}
                  onChange={(e) => setCompanySearch(e.target.value)}
                  onFocus={() => setCompanyOpen(true)}
                  onBlur={() => setCompanyOpen(false)}
                  placeholder="Search company..."
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none"
                />
                {companyOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 border border-gray-300 bg-white rounded-md shadow-lg z-50 max-h-48 overflow-y-auto">
                    <button type="button" onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { window.open('/admin/companies/new', '_blank'); setCompanyOpen(false) }}
                      className="w-full text-left px-3 py-2 text-[0.9375rem] text-blue-600 hover:bg-blue-50 font-semibold border-b border-gray-100">
                      + New Company
                    </button>
                    {companies
                      .filter(c => c.name.toLowerCase().includes(companySearch.toLowerCase()) || c.code.toLowerCase().includes(companySearch.toLowerCase()))
                      .map(c => (
                        <button key={c.id} type="button" onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { setCompanyId(c.id); setCompanySearch(c.name); setCompanyOpen(false) }}
                          className="w-full text-left px-3 py-2 text-[0.9375rem] hover:bg-gray-100 flex justify-between">
                          <span>{c.name}</span><span className="text-gray-500">{c.code}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>

            {/* Warehouse */}
            <div>
              <label className="block text-[0.9375rem] font-medium text-gray-700 mb-1">Warehouse</label>
              <div className="relative">
                <input type="text" value={warehouseSearch}
                  onChange={(e) => setWarehouseSearch(e.target.value)}
                  onFocus={() => setWarehouseOpen(true)}
                  onBlur={() => setWarehouseOpen(false)}
                  placeholder="Search warehouse..."
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none"
                />
                {warehouseOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 border border-gray-300 bg-white rounded-md shadow-lg z-50 max-h-48 overflow-y-auto">
                    <button type="button" onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { window.open('/admin/warehouses/new', '_blank'); setWarehouseOpen(false) }}
                      className="w-full text-left px-3 py-2 text-[0.9375rem] text-blue-600 hover:bg-blue-50 font-semibold border-b border-gray-100">
                      + New Warehouse
                    </button>
                    {filteredWarehouses
                      .filter(w => w.name.toLowerCase().includes(warehouseSearch.toLowerCase()))
                      .map(w => (
                        <button key={w.id} type="button" onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { setWarehouseId(w.id); setWarehouseSearch(w.name); setWarehouseOpen(false) }}
                          className="w-full text-left px-3 py-2 text-[0.9375rem] hover:bg-gray-100">
                          {w.name}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>

            {/* Supplier */}
            <div>
              <label className="block text-[0.9375rem] font-medium text-gray-700 mb-1">Supplier</label>
              <div className="relative">
                <input type="text" value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  onFocus={() => setSupplierOpen(true)}
                  onBlur={() => setSupplierOpen(false)}
                  placeholder="Search supplier..."
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none"
                />
                {supplierOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 border border-gray-300 bg-white rounded-md shadow-lg z-50 max-h-48 overflow-y-auto">
                    <button type="button" onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { window.open('/admin/suppliers/new', '_blank'); setSupplierOpen(false) }}
                      className="w-full text-left px-3 py-2 text-[0.9375rem] text-blue-600 hover:bg-blue-50 font-semibold border-b border-gray-100">
                      + New Supplier
                    </button>
                    {suppliers
                      .filter(s => s.name.toLowerCase().includes(supplierSearch.toLowerCase()))
                      .map(s => (
                        <button key={s.id} type="button" onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { setSupplierId(s.id); setSupplierSearch(s.name); setSupplierOpen(false) }}
                          className="w-full text-left px-3 py-2 text-[0.9375rem] hover:bg-gray-100">
                          {s.name}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>

            {/* Purchase ID */}
            <div>
              <label className="block text-[0.9375rem] font-medium text-gray-700 mb-1">Purchase ID</label>
              <input type="text" value={billNumber} onChange={(e) => setBillNumber(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-[0.9375rem] font-mono focus:border-blue-500 focus:outline-none" />
            </div>

            {/* Bill Date */}
            <div>
              <label className="block text-[0.9375rem] font-medium text-gray-700 mb-1">Bill Date</label>
              <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none" />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-[0.9375rem] font-medium text-gray-700 mb-1">Notes</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none" />
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-xl border p-6 flex-1 min-h-[28rem]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[0.9375rem] font-semibold text-gray-800">Line Items</h2>
            <button type="button" onClick={refreshMasterData} disabled={refreshing}
              className="text-[0.8125rem] text-gray-500 hover:text-blue-600 disabled:opacity-50 transition-colors"
              title="Reload master data after creating new items/materials">
              {refreshing ? 'Refreshing...' : '↻ Refresh master data'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[0.9375rem]">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500">Material Type</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500">Item Name</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500">Line ID</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500">Item Code</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500">Size</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500">Qty</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500">Rate (₹)</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500">Tax Rate</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500 text-right">Total</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500">Notes</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(() => {
                  const editableLineCount = lines.filter(l => !l.isLocked).length
                  const lastEditableIdx = lines.reduce((last, l, idx) => !l.isLocked ? idx : last, -1)
                  return lines.map((line, i) => {
                  const sizesForType = materialSizes.filter(s => !s.material_type_id || s.material_type_id === line.material_type_id)
                  const itemsForType = line.material_type_id
                    ? itemMasters.filter(im =>
                        im.material_type_id === line.material_type_id &&
                        (!line.material_size_id || !im.material_size_id || im.material_size_id === line.material_size_id)
                      )
                    : itemMasters
                  const itemSearchValue = itemSearch[line.rowId] ?? line.item_name
                  const filteredDropdownItems = itemSearchValue
                    ? itemMasters.filter(im => {
                        const q = itemSearchValue.toLowerCase()
                        return im.item_name.toLowerCase().includes(q) || im.item_code.toLowerCase().startsWith(q)
                      })
                    : itemsForType

                  if (line.isLocked) {
                    const mt = materialTypes.find(m => m.id === line.material_type_id)
                    const sz = materialSizes.find(s => s.id === line.material_size_id)
                    return (
                      <tr key={line.rowId} className="bg-gray-50 opacity-70">
                        <td className="pr-2 py-1 text-[0.8125rem] text-gray-500">{mt ? `${mt.code} — ${mt.description}` : '—'}</td>
                        <td className="pr-2 py-1">
                          <span className="text-[0.8125rem] text-gray-600">{line.item_name || '—'}</span>
                          <span className="ml-2 inline-flex items-center rounded bg-orange-50 border border-orange-200 px-1.5 py-0.5 text-[0.625rem] font-medium text-orange-700">🔒 Locked</span>
                        </td>
                        <td className="pr-2 py-1">
                          <span className="inline-flex items-center rounded bg-gray-100 border border-gray-300 px-2 py-1 text-[0.6875rem] font-mono text-gray-500">{line.purchase_line_id || '—'}</span>
                        </td>
                        <td className="pr-2 py-1 text-[0.8125rem] text-gray-500">{line.item_code || '—'}</td>
                        <td className="pr-2 py-1 text-[0.8125rem] text-gray-500">{sz?.size_label || line.size_label || '—'}</td>
                        <td className="pr-2 py-1 text-[0.8125rem] text-gray-600">{line.quantity}</td>
                        <td className="pr-2 py-1 text-[0.8125rem] text-gray-600">{line.rate}</td>
                        <td className="pr-2 py-1 text-[0.8125rem] text-gray-500">—</td>
                        <td className="pr-2 py-1 text-right text-[0.8125rem] text-gray-600">
                          {line.total_with_tax > 0 ? `₹${line.total_with_tax.toFixed(2)}` : line.amount ? `₹${parseFloat(line.amount).toFixed(2)}` : '—'}
                        </td>
                        <td className="pr-2 py-1 text-[0.8125rem] text-gray-500">{line.notes}</td>
                        <td></td>
                      </tr>
                    )
                  }

                  return (
                    <tr key={line.rowId}>
                      {/* Material Type */}
                      <td className="pr-2 py-0">
                        <select value={line.material_type_id}
                          onChange={(e) => {
                            if (e.target.value === 'NEW') { window.open('/admin/materials/new', '_blank'); return }
                            updateLine(i, 'material_type_id', e.target.value)
                          }}
                          className="block w-36 rounded border border-gray-300 px-2 py-px text-[0.8125rem] h-7 focus:border-blue-500 focus:outline-none">
                          <option value="">Select</option>
                          <option value="NEW" className="font-semibold">+ New Material Type</option>
                          {materialTypes.map(m => <option key={m.id} value={m.id}>{m.code} — {m.description}</option>)}
                        </select>
                      </td>
                      {/* Item Name */}
                      <td className="pr-2 py-0">
                        <div className="relative">
                          <input type="text" value={itemSearchValue}
                            onChange={(e) => {
                              setItemSearch(prev => ({ ...prev, [line.rowId]: e.target.value }))
                              setItemOpen(prev => ({ ...prev, [line.rowId]: true }))
                              setItemHighlight(prev => ({ ...prev, [line.rowId]: -1 }))
                            }}
                            onKeyDown={(e) => {
                              const count = filteredDropdownItems.length
                              const cur = itemHighlight[line.rowId] ?? -1
                              if (e.key === 'ArrowDown') {
                                e.preventDefault()
                                setItemOpen(prev => ({ ...prev, [line.rowId]: true }))
                                setItemHighlight(prev => ({ ...prev, [line.rowId]: Math.min(cur + 1, count - 1) }))
                              } else if (e.key === 'ArrowUp') {
                                e.preventDefault()
                                setItemHighlight(prev => ({ ...prev, [line.rowId]: Math.max(cur - 1, 0) }))
                              } else if (e.key === 'Enter' && cur >= 0 && cur < count) {
                                e.preventDefault()
                                const im = filteredDropdownItems[cur]
                                updateLine(i, 'item_master_id', im.id)
                                setItemSearch(prev => ({ ...prev, [line.rowId]: im.item_name }))
                                setItemOpen(prev => ({ ...prev, [line.rowId]: false }))
                                setItemHighlight(prev => ({ ...prev, [line.rowId]: -1 }))
                              } else if (e.key === 'Escape') {
                                setItemOpen(prev => ({ ...prev, [line.rowId]: false }))
                              }
                            }}
                            onFocus={() => setItemOpen(prev => ({ ...prev, [line.rowId]: true }))}
                            onBlur={() => setItemOpen(prev => ({ ...prev, [line.rowId]: false }))}
                            placeholder="Search item..."
                            className="block w-36 rounded border border-gray-300 px-2 py-px text-[0.8125rem] h-7 focus:border-blue-500 focus:outline-none"
                          />
                          {itemOpen[line.rowId] && (
                            <div className="absolute z-50 mt-1 w-36 overflow-y-auto rounded-md border border-gray-300 bg-white shadow-lg max-h-40">
                              <button type="button" onMouseDown={(e) => e.preventDefault()}
                                onClick={() => { window.open('/admin/items/new', '_blank'); setItemOpen(prev => ({ ...prev, [line.rowId]: false })) }}
                                className="w-full text-left px-2 py-2 text-[0.8125rem] text-blue-600 hover:bg-blue-50 font-semibold border-b border-gray-100">
                                + New Item
                              </button>
                              {filteredDropdownItems.map((im, idx) => (
                                <button key={im.id} type="button" onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    updateLine(i, 'item_master_id', im.id)
                                    setItemSearch(prev => ({ ...prev, [line.rowId]: im.item_name }))
                                    setItemOpen(prev => ({ ...prev, [line.rowId]: false }))
                                    setItemHighlight(prev => ({ ...prev, [line.rowId]: -1 }))
                                  }}
                                  className={`w-full text-left px-2 py-2 text-[0.8125rem] ${itemHighlight[line.rowId] === idx ? 'bg-blue-100 text-blue-800' : 'hover:bg-gray-100'}`}>
                                  {im.item_name}
                                </button>
                              ))}
                              {filteredDropdownItems.length === 0 && (
                                <div className="px-2 py-2 text-[0.8125rem] text-gray-500">No items found</div>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      {/* Line ID */}
                      <td className="pr-2 py-0">
                        {line.purchase_line_id
                          ? <span className="inline-flex items-center rounded bg-blue-50 border border-blue-200 px-2 py-1.5 text-[0.6875rem] font-mono font-medium text-blue-700 whitespace-nowrap">{line.purchase_line_id}</span>
                          : <span className="text-[0.6875rem] text-gray-400 italic">—</span>}
                      </td>
                      {/* Item Code */}
                      <td className="pr-2 py-0">
                        <input type="text" value={line.item_code} readOnly placeholder="—"
                          className="block w-20 rounded border border-gray-300 px-2 py-px text-[0.8125rem] h-7 bg-gray-50" />
                      </td>
                      {/* Size */}
                      <td className="pr-2 py-0">
                        <select value={line.material_size_id}
                          onChange={(e) => {
                            if (e.target.value === 'NEW') { window.open('/admin/sizes/new', '_blank'); return }
                            const size = materialSizes.find(s => s.id === e.target.value)
                            updateLine(i, 'material_size_id', e.target.value)
                            if (size) updateLine(i, 'size_label', size.size_label)
                          }}
                          className="block w-24 rounded border border-gray-300 px-2 py-px text-[0.8125rem] h-7 focus:border-blue-500 focus:outline-none">
                          <option value="">Select</option>
                          <option value="NEW" className="font-semibold">+ New Size</option>
                          {sizesForType.map(s => <option key={s.id} value={s.id}>{s.size_label}</option>)}
                        </select>
                      </td>
                      {/* Qty */}
                      <td className="pr-2 py-0">
                        <input type="number" value={line.quantity} onChange={(e) => updateLine(i, 'quantity', e.target.value)}
                          step="0.001" min="0" placeholder="0.000"
                          className="block w-20 rounded border border-gray-300 px-2 py-px text-[0.8125rem] h-7 focus:border-blue-500 focus:outline-none" />
                      </td>
                      {/* Rate */}
                      <td className="pr-2 py-0">
                        <input type="number" value={line.rate} onChange={(e) => updateLine(i, 'rate', e.target.value)}
                          step="0.01" min="0" placeholder="0.00"
                          className="block w-20 rounded border border-gray-300 px-2 py-px text-[0.8125rem] h-7 focus:border-blue-500 focus:outline-none" />
                      </td>
                      {/* Tax Rate */}
                      <td className="pr-2 py-0">
                        <select value={line.tax_rate_id} onChange={(e) => updateLine(i, 'tax_rate_id', e.target.value)}
                          className="block w-32 rounded border border-gray-300 px-2 py-px text-[0.8125rem] h-7 focus:border-blue-500 focus:outline-none">
                          <option value="">No Tax</option>
                          {taxRates.map(tr => <option key={tr.id} value={tr.id}>{tr.name}</option>)}
                        </select>
                      </td>
                      {/* Total */}
                      <td className="pr-2 py-0 text-right">
                        <span className="text-[0.9375rem] font-semibold text-gray-900">
                          {line.total_with_tax > 0 ? `₹${line.total_with_tax.toFixed(2)}` : line.amount ? `₹${parseFloat(line.amount).toFixed(2)}` : '—'}
                        </span>
                      </td>
                      {/* Notes */}
                      <td className="pr-2 py-0">
                        <input type="text" value={line.notes} onChange={(e) => updateLine(i, 'notes', e.target.value)}
                          placeholder="Notes"
                          className="block w-24 rounded border border-gray-300 px-2 py-px text-[0.8125rem] h-7 focus:border-blue-500 focus:outline-none" />
                      </td>
                      <td className="py-2">
                        <div className="flex gap-1 items-center">
                          {i === lastEditableIdx && (
                            <button type="button" onClick={addLine}
                              className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200 font-bold text-base leading-none">+</button>
                          )}
                          {editableLineCount > 1 && (
                            <button type="button" onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600 font-bold px-1">×</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                }) })()}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200">
                  <td colSpan={5} className="py-3 text-[0.9375rem] font-semibold text-gray-700 text-right pr-3">Totals:</td>
                  <td className="py-3 pr-3 text-[0.9375rem] font-bold text-gray-900">{totalQty.toFixed(3)}</td>
                  <td colSpan={2} className="py-3 pr-3"></td>
                  <td className="py-3 pr-3 text-right text-[0.9375rem] font-bold text-gray-900">₹{totalAmt.toFixed(2)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {error && <div className="rounded-md bg-red-50 border border-red-200 p-4"><p className="text-[0.9375rem] text-red-800">{error}</p></div>}

        <div className="flex gap-3">
          {isActiveBill ? (
            <button type="button" onClick={() => saveBill('active')} disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-[0.9375rem] font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {loading ? 'Saving...' : '✓ Save Changes'}
            </button>
          ) : (
            <>
              <button type="button" onClick={() => saveBill('active')} disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-6 py-2.5 text-[0.9375rem] font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors">
                {loading ? 'Saving...' : '✓ Submit Bill'}
              </button>
              <button type="button" onClick={() => saveBill('draft')} disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-6 py-2.5 text-[0.9375rem] font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition-colors">
                {loading ? 'Saving...' : '⎘ Save Draft'}
              </button>
            </>
          )}
          <button type="button" onClick={() => router.back()}
            className="rounded-lg border border-gray-300 px-6 py-2.5 text-[0.9375rem] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
