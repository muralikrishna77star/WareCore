'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import MissingMasterDataBanner from '@/components/MissingMasterDataBanner'
import {
  ACTIVE_COMPANIES_QUERY, ACTIVE_WAREHOUSES_QUERY, ACTIVE_SUPPLIERS_QUERY,
  ACTIVE_MATERIAL_TYPES_QUERY, ACTIVE_MATERIAL_SIZES_QUERY, ACTIVE_ITEM_MASTER_QUERY,
  ACTIVE_PURCHASE_TAX_RATES_QUERY,
  ALL_BILL_NUMBERS_QUERY, ALL_PURCHASE_LINE_IDS_QUERY,
  CREATE_PURCHASE_BILL_MUTATION, CREATE_PURCHASE_BILL_ITEMS_MUTATION,
  CREATE_MATERIAL_TYPE_MUTATION, CREATE_MATERIAL_SIZE_MUTATION,
  CREATE_ITEM_MASTER_MUTATION,
  CREATE_COMPANY_MUTATION, CREATE_WAREHOUSE_MUTATION, CREATE_SUPPLIER_MUTATION,
} from '@/lib/hasura/queries'
import type { Company, Warehouse, Supplier, MaterialType, MaterialSize, ItemMaster, TaxRate } from '@/types'

type LineItem = {
  rowId: string
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

function generatePurchaseId(existingBillNumbers: string[], dateStr?: string): string {
  const seq = computeNextSeq(existingBillNumbers, /^\d{4}-(\d+)$/)
  const date = dateStr ? new Date(dateStr + 'T00:00:00') : new Date()
  return `${getMMYY(date)}-${String(seq + 1).padStart(4, '0')}`
}

function generatePurchaseLineId(groupCode: string, mmyy: string, allLineIds: string[]): string {
  const prefix = `${groupCode.slice(0, 2).toUpperCase()}${mmyy}-`
  const count = allLineIds.filter(id => id && id.startsWith(prefix)).length
  return `${prefix}${String(count + 1).padStart(4, '0')}`
}

// ─────────────────────────────────────────────────────────────────────────────

const emptyLine = (): LineItem => ({
  rowId: Math.random().toString(36).slice(2, 8),
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

export default function NewBillPage() {
  const router = useRouter()

  // ── Master data ──────────────────────────────────────────────────────────
  const [companies, setCompanies] = useState<Company[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([])
  const [materialSizes, setMaterialSizes] = useState<MaterialSize[]>([])
  const [itemMasters, setItemMasters] = useState<ItemMaster[]>([])
  const [taxRates, setTaxRates] = useState<TaxRate[]>([])

  // Existing IDs for sequence computation
  const [existingBillNumbers, setExistingBillNumbers] = useState<string[]>([])
  const [existingLineIds, setExistingLineIds] = useState<string[]>([])

  // ── Header form state ────────────────────────────────────────────────────
  const [companyId, setCompanyId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [billNumber, setBillNumber] = useState('')
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineItem[]>([emptyLine()])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [masterDataLoading, setMasterDataLoading] = useState(true)

  // ── New Company dialog ───────────────────────────────────────────────────
  const [showNewCompanyDialog, setShowNewCompanyDialog] = useState(false)
  const [newCoName, setNewCoName] = useState('')
  const [newCoCode, setNewCoCode] = useState('')
  const [newCoShortName, setNewCoShortName] = useState('')
  const [newCoGstin, setNewCoGstin] = useState('')
  const [newCoLoading, setNewCoLoading] = useState(false)

  // ── New Warehouse dialog ─────────────────────────────────────────────────
  const [showNewWarehouseDialog, setShowNewWarehouseDialog] = useState(false)
  const [newWhName, setNewWhName] = useState('')
  const [newWhCompanyId, setNewWhCompanyId] = useState('')
  const [newWhLoading, setNewWhLoading] = useState(false)

  // ── New Supplier dialog ──────────────────────────────────────────────────
  const [showNewSupplierDialog, setShowNewSupplierDialog] = useState(false)
  const [newSpName, setNewSpName] = useState('')
  const [newSpPhone, setNewSpPhone] = useState('')
  const [newSpGstin, setNewSpGstin] = useState('')
  const [newSpLoading, setNewSpLoading] = useState(false)

  // ── Material Type dialog ─────────────────────────────────────────────────
  const [showMaterialTypeDialog, setShowMaterialTypeDialog] = useState(false)
  const [newMaterialTypeCode, setNewMaterialTypeCode] = useState('')
  const [newMaterialTypeDescription, setNewMaterialTypeDescription] = useState('')
  const [newMaterialTypeUnit, setNewMaterialTypeUnit] = useState('tons')
  const [materialTypeDialogLoading, setMaterialTypeDialogLoading] = useState(false)

  // ── Size dialog ──────────────────────────────────────────────────────────
  const [showSizeDialog, setShowSizeDialog] = useState(false)
  const [newSizeMaterialTypeId, setNewSizeMaterialTypeId] = useState('')
  const [newSizeLabel, setNewSizeLabel] = useState('')
  const [newSizeThickness, setNewSizeThickness] = useState('')
  const [newSizeWidth, setNewSizeWidth] = useState('')
  const [sizeDialogLoading, setSizeDialogLoading] = useState(false)

  // ── New Item dialog ──────────────────────────────────────────────────────
  const [showNewItemDialog, setShowNewItemDialog] = useState(false)
  const [newItemLineIndex, setNewItemLineIndex] = useState<number | null>(null)
  const [newItemMaterialTypeId, setNewItemMaterialTypeId] = useState('')
  const [newItemMaterialSizeId, setNewItemMaterialSizeId] = useState('')
  const [newItemName, setNewItemName] = useState('')
  const [newItemUnit, setNewItemUnit] = useState('tons')
  const [newItemDescription, setNewItemDescription] = useState('')
  const [newItemCode, setNewItemCode] = useState('')
  const [newItemDialogLoading, setNewItemDialogLoading] = useState(false)

  // ── Autocomplete search state ────────────────────────────────────────────
  const [companySearch, setCompanySearch] = useState('')
  const [warehouseSearch, setWarehouseSearch] = useState('')
  const [supplierSearch, setSupplierSearch] = useState('')
  const [companyOpen, setCompanyOpen] = useState(false)
  const [warehouseOpen, setWarehouseOpen] = useState(false)
  const [supplierOpen, setSupplierOpen] = useState(false)

  const [itemSearch, setItemSearch] = useState<Record<string, string>>({})
  const [itemOpen, setItemOpen] = useState<Record<string, boolean>>({})
  const [itemHighlight, setItemHighlight] = useState<Record<string, number>>({})
  const [materialTypeSearch, setMaterialTypeSearch] = useState<Record<string, string>>({})
  const [materialTypeOpen, setMaterialTypeOpen] = useState<Record<string, boolean>>({})
  const [sizeSearch, setSizeSearch] = useState<Record<string, string>>({})
  const [sizeOpen, setSizeOpen] = useState<Record<string, boolean>>({})
  const [taxRateSearch, setTaxRateSearch] = useState<Record<string, string>>({})
  const [taxRateOpen, setTaxRateOpen] = useState<Record<string, boolean>>({})

  // ── Load master data ─────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const [c, w, s, mt, ms, im, tr, bns, lis] = await Promise.all([
        hasuraFetch(ACTIVE_COMPANIES_QUERY),
        hasuraFetch(ACTIVE_WAREHOUSES_QUERY),
        hasuraFetch(ACTIVE_SUPPLIERS_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_TYPES_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_SIZES_QUERY),
        hasuraFetch(ACTIVE_ITEM_MASTER_QUERY),
        hasuraFetch(ACTIVE_PURCHASE_TAX_RATES_QUERY),
        hasuraFetch(ALL_BILL_NUMBERS_QUERY),
        hasuraFetch(ALL_PURCHASE_LINE_IDS_QUERY),
      ])
      setCompanies((c.data as any)?.companies ?? [])
      setWarehouses((w.data as any)?.warehouses ?? [])
      setSuppliers((s.data as any)?.suppliers ?? [])
      setMaterialTypes((mt.data as any)?.material_types ?? [])
      setMaterialSizes((ms.data as any)?.material_sizes ?? [])
      setItemMasters((im.data as any)?.item_master ?? [])
      setTaxRates((tr.data as any)?.tax_rates ?? [])

      const bills: string[] = ((bns.data as any)?.purchase_bills ?? []).map((b: any) => b.bill_number)
      const lineIds: string[] = ((lis.data as any)?.purchase_bill_items ?? [])
        .map((i: any) => i.purchase_line_id).filter(Boolean)

      setExistingBillNumbers(bills)
      setExistingLineIds(lineIds)
      setBillNumber(generatePurchaseId(bills, new Date().toISOString().split('T')[0]))
      setMasterDataLoading(false)
    }
    load()
  }, [])

  const filteredWarehouses = companyId
    ? warehouses.filter((w) => w.company_id === companyId || !w.company_id)
    : warehouses

  useEffect(() => {
    const mt = materialTypes.find(m => m.id === newItemMaterialTypeId)
    if (mt) setNewItemUnit(mt.unit || 'tons')
    if (!newItemMaterialTypeId) setNewItemMaterialSizeId('')
    if (!mt?.code) { setNewItemCode(''); return }
    const prefix = mt.code.trim().toUpperCase()
    const safePrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const sequence = itemMasters.reduce((max, item) => {
      if (!item.item_code?.startsWith(prefix)) return max
      const match = item.item_code.match(new RegExp(`^${safePrefix}(\\d+)$`))
      if (!match) return max
      const n = Number(match[1])
      return Number.isFinite(n) ? Math.max(max, n) : max
    }, 0)
    setNewItemCode(`${prefix}${String(sequence + 1).padStart(5, '0')}`)
  }, [newItemMaterialTypeId, materialTypes, itemMasters])

  const selectedNewItemSize = materialSizes.find((s) => s.id === newItemMaterialSizeId)

  // ── updateLine ───────────────────────────────────────────────────────────
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
        if (updated[index].item_master_id) {
          const sel = itemMasters.find((im) => im.id === updated[index].item_master_id)
          if (!sel || (sel.material_size_id && sel.material_size_id !== value)) {
            updated[index].item_master_id = ''
            updated[index].item_name = ''
            updated[index].item_code = ''
            updated[index].purchase_line_id = ''
          }
        }
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

  // ── Inline Company creation ──────────────────────────────────────────────
  const handleCreateCompany = async () => {
    if (!newCoName.trim() || !newCoCode.trim()) { alert('Name and Code are required'); return }
    setNewCoLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_companies_one: Company }>(CREATE_COMPANY_MUTATION, {
      name: newCoName.trim(), code: newCoCode.trim().toUpperCase(),
      short_name: newCoShortName || null, gstin: newCoGstin || null,
    })
    setNewCoLoading(false)
    if (err) { alert(`Error: ${err.message}`); return }
    const created = data?.insert_companies_one
    if (created) {
      setCompanies(prev => [...prev, created])
      setCompanyId(created.id)
      setNewCoName(''); setNewCoCode(''); setNewCoShortName(''); setNewCoGstin('')
      setShowNewCompanyDialog(false)
    }
  }

  // ── Inline Warehouse creation ────────────────────────────────────────────
  const handleCreateWarehouse = async () => {
    if (!newWhName.trim()) { alert('Warehouse name is required'); return }
    const effectiveCompanyId = newWhCompanyId || companyId
    if (!effectiveCompanyId) { alert('Please select a company first or pick one above'); return }
    setNewWhLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_warehouses_one: Warehouse }>(CREATE_WAREHOUSE_MUTATION, {
      name: newWhName.trim(), company_id: effectiveCompanyId,
    })
    setNewWhLoading(false)
    if (err) { alert(`Error: ${err.message}`); return }
    const created = data?.insert_warehouses_one
    if (created) {
      setWarehouses(prev => [...prev, { ...created, company_id: effectiveCompanyId, is_active: true, created_at: '', updated_at: '' }])
      setWarehouseId(created.id)
      setNewWhName(''); setNewWhCompanyId('')
      setShowNewWarehouseDialog(false)
    }
  }

  // ── Inline Supplier creation ─────────────────────────────────────────────
  const handleCreateSupplier = async () => {
    if (!newSpName.trim()) { alert('Supplier name is required'); return }
    setNewSpLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_suppliers_one: Supplier }>(CREATE_SUPPLIER_MUTATION, {
      name: newSpName.trim(), phone: newSpPhone || null, gstin: newSpGstin || null,
    })
    setNewSpLoading(false)
    if (err) { alert(`Error: ${err.message}`); return }
    const created = data?.insert_suppliers_one
    if (created) {
      setSuppliers(prev => [...prev, created])
      setSupplierId(created.id)
      setNewSpName(''); setNewSpPhone(''); setNewSpGstin('')
      setShowNewSupplierDialog(false)
    }
  }

  // ── Material Type creation ───────────────────────────────────────────────
  const handleCreateMaterialType = async () => {
    const code = newMaterialTypeCode.trim().toUpperCase()
    if (code.length !== 2) { alert('Code must be exactly 2 characters'); return }
    if (!newMaterialTypeDescription.trim()) { alert('Description is required'); return }
    setMaterialTypeDialogLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_material_types_one: MaterialType }>(CREATE_MATERIAL_TYPE_MUTATION, {
      code, description: newMaterialTypeDescription, unit: newMaterialTypeUnit,
    })
    setMaterialTypeDialogLoading(false)
    if (err) { alert(`Error: ${err.message}`); return }
    const newMT = data?.insert_material_types_one
    if (newMT) {
      setMaterialTypes(prev => [...prev, newMT])
      setNewMaterialTypeCode(''); setNewMaterialTypeDescription(''); setNewMaterialTypeUnit('tons')
      setShowMaterialTypeDialog(false)
    }
  }

  // ── Size creation ────────────────────────────────────────────────────────
  const handleCreateSize = async () => {
    if (!newSizeMaterialTypeId || !newSizeLabel.trim()) { alert('Material Type and Size Label are required'); return }
    setSizeDialogLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_material_sizes_one: MaterialSize }>(CREATE_MATERIAL_SIZE_MUTATION, {
      material_type_id: newSizeMaterialTypeId, size_label: newSizeLabel,
      thickness: newSizeThickness ? parseFloat(newSizeThickness) : null,
      width: newSizeWidth ? parseFloat(newSizeWidth) : null,
    })
    setSizeDialogLoading(false)
    if (err) { alert(`Error: ${err.message}`); return }
    const newSize = data?.insert_material_sizes_one
    if (newSize) {
      setMaterialSizes(prev => [...prev, newSize])
      setNewSizeMaterialTypeId(''); setNewSizeLabel(''); setNewSizeThickness(''); setNewSizeWidth('')
      setShowSizeDialog(false)
    }
  }

  // ── New Item creation ────────────────────────────────────────────────────
  const handleCreateNewItem = async () => {
    if (!newItemMaterialTypeId || !newItemName.trim()) {
      alert('Material type and item name are required.')
      return
    }
    if (!newItemCode) { alert('Select a material type first to generate an item code.'); return }
    setNewItemDialogLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_item_master_one: ItemMaster }>(CREATE_ITEM_MASTER_MUTATION, {
      item_code: newItemCode, item_name: newItemName,
      material_type_id: newItemMaterialTypeId,
      material_size_id: newItemMaterialSizeId || null,
      size_label: selectedNewItemSize?.size_label || null,
      unit: newItemUnit, description: newItemDescription || null,
    })
    setNewItemDialogLoading(false)
    if (err) { alert(`Error: ${err.message}`); return }
    const created = data?.insert_item_master_one
    if (created) {
      setItemMasters(prev => [...prev, created])
      if (newItemLineIndex !== null) {
        const mt = materialTypes.find(m => m.id === newItemMaterialTypeId)
        setLines(prev => {
          const updated = [...prev]
          const currentAssigned = prev.filter((_, i) => i !== newItemLineIndex).map(l => l.purchase_line_id).filter(Boolean)
          updated[newItemLineIndex] = {
            ...updated[newItemLineIndex],
            item_master_id: created.id, item_name: created.item_name,
            item_code: created.item_code, material_type_id: newItemMaterialTypeId,
            material_size_id: created.material_size_id || '',
            size_label: created.size_label || '',
            purchase_line_id: mt?.code
              ? generatePurchaseLineId(mt.code, getMMYY(new Date(billDate + 'T00:00:00')), [...existingLineIds, ...currentAssigned])
              : '',
          }
          return updated
        })
      }
      setShowNewItemDialog(false)
      setNewItemLineIndex(null); setNewItemMaterialTypeId(''); setNewItemMaterialSizeId('')
      setNewItemName(''); setNewItemUnit('tons'); setNewItemDescription(''); setNewItemCode('')
    }
  }

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError(null)

    const validLines = lines.filter((l) => l.material_type_id && l.quantity)
    if (!validLines.length) { setError('Add at least one line item with material type and quantity.'); setLoading(false); return }

    for (let i = 0; i < validLines.length; i++) {
      if (!validLines[i].item_name.trim()) {
        setError(`Line ${i + 1}: Item Name is required.`); setLoading(false); return
      }
    }
    if (!warehouseId) { setError('Please select a warehouse before saving.'); setLoading(false); return }
    if (!billNumber.trim()) { setError('Purchase ID is required.'); setLoading(false); return }

    const { data: billData, error: billError } = await hasuraFetch<any>(CREATE_PURCHASE_BILL_MUTATION, {
      company_id: companyId || null, warehouse_id: warehouseId || null,
      supplier_id: supplierId || null, bill_number: billNumber,
      bill_date: billDate, total_quantity: totalQty, total_amount: totalAmt, notes: notes || null,
    })
    const bill = billData?.insert_purchase_bills_one
    if (billError || !bill) { setError(billError?.message ?? 'Failed to create bill'); setLoading(false); return }

    const items = validLines.map((l) => ({
      bill_id: bill.id,
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
    const { error: itemsError } = await hasuraFetch(CREATE_PURCHASE_BILL_ITEMS_MUTATION, { items })
    if (itemsError) { setError(itemsError.message); setLoading(false); return }

    router.push('/bills')
    router.refresh()
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-[1.4375rem] font-bold text-gray-900">New Purchase Bill</h1>
        <p className="mt-1 text-[0.9375rem] text-gray-500">Record a new inward purchase</p>
      </div>

      <MissingMasterDataBanner
        loading={masterDataLoading}
        checks={[
          { label: 'Companies', count: companies.length, adminPath: '/admin/companies/new' },
          { label: 'Warehouses', count: warehouses.length, adminPath: '/admin/warehouses/new' },
          { label: 'Suppliers', count: suppliers.length, adminPath: '/admin/suppliers/new' },
          { label: 'Material Types', count: materialTypes.length, adminPath: '/admin/materials/new' },
        ]}
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ── Header ─────────────────────────────────────────────────────── */}
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
                  placeholder="Search company..."
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none"
                />
                {companyOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 border border-gray-300 bg-white rounded-md shadow-lg z-50 max-h-48 overflow-y-auto">
                    <button type="button"
                      onClick={() => { setShowNewCompanyDialog(true); setCompanyOpen(false) }}
                      className="w-full text-left px-3 py-2 text-[0.9375rem] text-blue-600 hover:bg-blue-50 font-semibold border-b border-gray-100">
                      + New Company
                    </button>
                    {companies
                      .filter(c => c.name.toLowerCase().includes(companySearch.toLowerCase()) || c.code.toLowerCase().includes(companySearch.toLowerCase()))
                      .map(c => (
                        <button key={c.id} type="button"
                          onClick={() => {
                            setCompanyId(c.id)
                            setCompanySearch(c.name)
                            setCompanyOpen(false)
                          }}
                          className="w-full text-left px-3 py-2 text-[0.9375rem] hover:bg-gray-100 flex justify-between">
                          <span>{c.name}</span>
                          <span className="text-gray-500">{c.code}</span>
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
                  placeholder="Search warehouse..."
                  required
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none"
                />
                {warehouseOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 border border-gray-300 bg-white rounded-md shadow-lg z-50 max-h-48 overflow-y-auto">
                    <button type="button"
                      onClick={() => { setNewWhCompanyId(companyId); setShowNewWarehouseDialog(true); setWarehouseOpen(false) }}
                      className="w-full text-left px-3 py-2 text-[0.9375rem] text-blue-600 hover:bg-blue-50 font-semibold border-b border-gray-100">
                      + New Warehouse
                    </button>
                    {filteredWarehouses
                      .filter(w => w.name.toLowerCase().includes(warehouseSearch.toLowerCase()))
                      .map(w => (
                        <button key={w.id} type="button"
                          onClick={() => {
                            setWarehouseId(w.id)
                            setWarehouseSearch(w.name)
                            setWarehouseOpen(false)
                          }}
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
                  placeholder="Search supplier..."
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none"
                />
                {supplierOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 border border-gray-300 bg-white rounded-md shadow-lg z-50 max-h-48 overflow-y-auto">
                    <button type="button"
                      onClick={() => { setShowNewSupplierDialog(true); setSupplierOpen(false) }}
                      className="w-full text-left px-3 py-2 text-[0.9375rem] text-blue-600 hover:bg-blue-50 font-semibold border-b border-gray-100">
                      + New Supplier
                    </button>
                    {suppliers
                      .filter(s => s.name.toLowerCase().includes(supplierSearch.toLowerCase()))
                      .map(s => (
                        <button key={s.id} type="button"
                          onClick={() => {
                            setSupplierId(s.id)
                            setSupplierSearch(s.name)
                            setSupplierOpen(false)
                          }}
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
              <label className="block text-[0.9375rem] font-medium text-gray-700 mb-1">
                Purchase ID <span className="ml-1 text-[0.6875rem] font-normal text-gray-400">(auto-generated)</span>
              </label>
              <div className="flex gap-2">
                <input type="text" value={billNumber} onChange={(e) => setBillNumber(e.target.value)}
                  placeholder={masterDataLoading ? 'Loading…' : 'MMYY-NNNN'}
                  className="block flex-1 rounded-md border border-gray-300 px-3 py-2 text-[0.9375rem] font-mono focus:border-blue-500 focus:outline-none" />
                <button type="button" onClick={() => setBillNumber(generatePurchaseId(existingBillNumbers, billDate))}
                  className="rounded-md border border-gray-300 px-3 py-2 text-[0.6875rem] text-gray-600 hover:bg-gray-50">↻ New ID</button>
              </div>
            </div>

            {/* Bill Date */}
            <div>
              <label className="block text-[0.9375rem] font-medium text-gray-700 mb-1">Bill Date</label>
              <input type="date" value={billDate} onChange={(e) => {
                const newDate = e.target.value
                setBillDate(newDate)
                if (newDate) {
                  const newBillNum = generatePurchaseId(existingBillNumbers, newDate)
                  setBillNumber(newBillNum)
                  setLines(prev => {
                    const newLines = [...prev]
                    const newlyAssigned: string[] = []
                    for (let i = 0; i < newLines.length; i++) {
                      const line = newLines[i]
                      if (!line.item_master_id) continue
                      const item = itemMasters.find(im => im.id === line.item_master_id)
                      if (!item) continue
                      const mt = materialTypes.find(m => m.id === item.material_type_id)
                      if (!mt?.code) continue
                      const newLineId = generatePurchaseLineId(mt.code, getMMYY(new Date(newDate + 'T00:00:00')), [...existingLineIds, ...newlyAssigned])
                      newLines[i] = { ...line, purchase_line_id: newLineId }
                      newlyAssigned.push(newLineId)
                    }
                    return newLines
                  })
                }
              }} required
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

        {/* ── Line Items ─────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border p-6 flex-1 min-h-[28rem]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[0.9375rem] font-semibold text-gray-800">Line Items</h2>
            <button type="button" onClick={addLine} className="text-[0.9375rem] text-blue-600 hover:text-blue-800 font-medium">+ Add Line</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[0.9375rem]">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500">Item Name <span className="text-red-500">*</span></th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500">Line ID</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500">Item Code</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500">Material Type</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500">Size</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500">Qty</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500">Rate (₹)</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500">Taxable (₹)</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500">Tax Rate</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500 text-right">CGST</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500 text-right">SGST</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500 text-right">TDS</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500 text-right">Total</th>
                  <th className="pb-2 pr-3 text-[0.6875rem] font-medium text-gray-500">Notes</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lines.map((line, i) => {
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
                  const materialTypeSearchValue = materialTypeSearch[line.rowId] ?? (materialTypes.find(mt => mt.id === line.material_type_id)?.description ?? '')
                  const sizeSearchValue = sizeSearch[line.rowId] ?? (materialSizes.find(s => s.id === line.material_size_id)?.size_label ?? '')
                  const taxRateSearchValue = taxRateSearch[line.rowId] ?? (taxRates.find(tr => tr.id === line.tax_rate_id)?.name ?? '')
                  return (
                    <tr key={i} className="py-1">
                      {/* Item Name */}
                      <td className="pr-3 py-2">
                        <div className="relative">
                          <input type="text" value={itemSearchValue}
                            onChange={(e) => {
                              const val = e.target.value
                              setItemSearch((prev) => ({ ...prev, [line.rowId]: val }))
                              setItemOpen((prev) => ({ ...prev, [line.rowId]: true }))
                              setItemHighlight((prev) => ({ ...prev, [line.rowId]: -1 }))
                              if (val && !line.material_type_id) {
                                const q = val.toLowerCase()
                                const matches = itemMasters.filter(im =>
                                  im.item_name.toLowerCase().includes(q) || im.item_code.toLowerCase().startsWith(q)
                                )
                                const typeIds = [...new Set(matches.map(im => im.material_type_id))]
                                if (typeIds.length === 1) updateLine(i, 'material_type_id', typeIds[0])
                              }
                            }}
                            onKeyDown={(e) => {
                              const count = filteredDropdownItems.length
                              const cur = itemHighlight[line.rowId] ?? -1
                              if (e.key === 'ArrowDown') {
                                e.preventDefault()
                                if (!itemOpen[line.rowId]) {
                                  setItemOpen(prev => ({ ...prev, [line.rowId]: true }))
                                  setItemHighlight(prev => ({ ...prev, [line.rowId]: 0 }))
                                  return
                                }
                                const next = Math.min(cur + 1, count - 1)
                                setItemHighlight(prev => ({ ...prev, [line.rowId]: next }))
                                document.getElementById(`item-opt-${line.rowId}-${next}`)?.scrollIntoView({ block: 'nearest' })
                              } else if (e.key === 'ArrowUp') {
                                e.preventDefault()
                                const next = Math.max(cur - 1, 0)
                                setItemHighlight(prev => ({ ...prev, [line.rowId]: next }))
                                document.getElementById(`item-opt-${line.rowId}-${next}`)?.scrollIntoView({ block: 'nearest' })
                              } else if (e.key === 'Enter') {
                                e.preventDefault()
                                if (cur >= 0 && cur < count) {
                                  const im = filteredDropdownItems[cur]
                                  updateLine(i, 'item_master_id', im.id)
                                  setItemSearch(prev => ({ ...prev, [line.rowId]: im.item_name }))
                                  setItemOpen(prev => ({ ...prev, [line.rowId]: false }))
                                  setItemHighlight(prev => ({ ...prev, [line.rowId]: -1 }))
                                }
                              } else if (e.key === 'Escape') {
                                setItemOpen(prev => ({ ...prev, [line.rowId]: false }))
                                setItemHighlight(prev => ({ ...prev, [line.rowId]: -1 }))
                              }
                            }}
                            onFocus={() => setItemOpen((prev) => ({ ...prev, [line.rowId]: true }))}
                            onBlur={() => setItemOpen((prev) => ({ ...prev, [line.rowId]: false }))}
                            placeholder="Search item..."
                            className={`block w-36 rounded border px-2 py-1.5 text-[0.8125rem] focus:outline-none ${
                              line.material_type_id && line.quantity && !line.item_name
                                ? 'border-red-400 bg-red-50' : 'border-gray-300 focus:border-blue-500'
                            }`} />
                          {itemOpen[line.rowId] && (
                            <div className="absolute z-50 mt-1 w-36 overflow-y-auto rounded-md border border-gray-300 bg-white shadow-lg max-h-40">
                              <button type="button" onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setNewItemLineIndex(i)
                                  setShowNewItemDialog(true)
                                  setNewItemMaterialTypeId(line.material_type_id)
                                  setNewItemMaterialSizeId(line.material_size_id)
                                  setNewItemName(''); setNewItemDescription(''); setNewItemCode('')
                                  setItemOpen((prev) => ({ ...prev, [line.rowId]: false }))
                                }}
                                className="w-full text-left px-2 py-2 text-[0.8125rem] text-blue-600 hover:bg-blue-50 font-semibold border-b border-gray-100">
                                + New Item
                              </button>
                              {filteredDropdownItems.map((im, idx) => (
                                  <button key={im.id} id={`item-opt-${line.rowId}-${idx}`} type="button" onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      updateLine(i, 'item_master_id', im.id)
                                      setItemSearch((prev) => ({ ...prev, [line.rowId]: im.item_name }))
                                      setItemOpen((prev) => ({ ...prev, [line.rowId]: false }))
                                      setItemHighlight((prev) => ({ ...prev, [line.rowId]: -1 }))
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
                      <td className="pr-3 py-2">
                        {line.purchase_line_id
                          ? <span className="inline-flex items-center rounded bg-blue-50 border border-blue-200 px-2 py-1.5 text-[0.6875rem] font-mono font-medium text-blue-700 whitespace-nowrap select-all">{line.purchase_line_id}</span>
                          : <span className="text-[0.6875rem] text-gray-400 italic">— select item —</span>}
                      </td>
                      {/* Item Code */}
                      <td className="pr-3 py-2">
                        <input type="text" value={line.item_code} readOnly placeholder="—"
                          className="block w-20 rounded border border-gray-300 px-2 py-1.5 text-[0.8125rem] bg-gray-50" />
                      </td>
                      {/* Material Type */}
                      <td className="pr-3 py-2">
                        <select value={line.material_type_id}
                          onChange={(e) => {
                            if (e.target.value === 'NEW') { setShowMaterialTypeDialog(true) }
                            else {
                              updateLine(i, 'material_type_id', e.target.value)
                              setItemSearch(prev => ({ ...prev, [line.rowId]: '' }))
                            }
                          }}
                          className="block w-28 rounded border border-gray-300 px-2 py-1.5 text-[0.8125rem] focus:border-blue-500 focus:outline-none">
                          <option value="">Select</option>
                          <option value="NEW" className="font-semibold">+ New Material Type</option>
                          {materialTypes.map(m => <option key={m.id} value={m.id}>{m.description}</option>)}
                        </select>
                      </td>
                      {/* Size */}
                      <td className="pr-3 py-2">
                        <select value={line.material_size_id}
                          onChange={(e) => {
                            if (e.target.value === 'NEW') { setNewSizeMaterialTypeId(line.material_type_id); setShowSizeDialog(true) }
                            else {
                              const size = materialSizes.find(s => s.id === e.target.value)
                              updateLine(i, 'material_size_id', e.target.value)
                              if (size) updateLine(i, 'size_label', size.size_label)
                            }
                          }}
                          className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-[0.8125rem] focus:border-blue-500 focus:outline-none">
                          <option value="">Select</option>
                          <option value="NEW" className="font-semibold">+ New Size</option>
                          {sizesForType.map(s => <option key={s.id} value={s.id}>{s.size_label}</option>)}
                        </select>
                      </td>
                      {/* Qty */}
                      <td className="pr-3 py-2">
                        <input type="number" value={line.quantity} onChange={(e) => updateLine(i, 'quantity', e.target.value)}
                          step="0.001" min="0" required placeholder="0.000"
                          className="block w-20 rounded border border-gray-300 px-2 py-1.5 text-[0.8125rem] focus:border-blue-500 focus:outline-none" />
                      </td>
                      {/* Rate */}
                      <td className="pr-3 py-2">
                        <input type="number" value={line.rate} onChange={(e) => updateLine(i, 'rate', e.target.value)}
                          step="0.01" min="0" placeholder="0.00"
                          className="block w-20 rounded border border-gray-300 px-2 py-1.5 text-[0.8125rem] focus:border-blue-500 focus:outline-none" />
                      </td>
                      {/* Taxable */}
                      <td className="pr-3 py-2">
                        <span className="block w-24 rounded border border-gray-100 bg-gray-50 px-2 py-1.5 text-[0.9375rem] text-gray-700 text-right">
                          {line.taxable_value > 0 ? `₹${line.taxable_value.toFixed(2)}` : '—'}
                        </span>
                      </td>
                      {/* Tax Rate */}
                      <td className="pr-3 py-2">
                        <select value={line.tax_rate_id} onChange={(e) => updateLine(i, 'tax_rate_id', e.target.value)}
                          className="block w-32 rounded border border-gray-300 px-2 py-1.5 text-[0.8125rem] focus:border-blue-500 focus:outline-none">
                          <option value="">No Tax</option>
                          {taxRates.map(tr => <option key={tr.id} value={tr.id}>{tr.name}</option>)}
                        </select>
                      </td>
                      {/* CGST */}
                      <td className="pr-3 py-2 text-right">
                        {line.cgst_amount > 0
                          ? <span className="text-[0.6875rem] text-orange-700"><span className="block text-gray-400">{line.cgst_rate}%</span>₹{line.cgst_amount.toFixed(2)}</span>
                          : <span className="text-gray-300 text-[0.6875rem]">—</span>}
                      </td>
                      {/* SGST */}
                      <td className="pr-3 py-2 text-right">
                        {line.sgst_amount > 0
                          ? <span className="text-[0.6875rem] text-orange-700"><span className="block text-gray-400">{line.sgst_rate}%</span>₹{line.sgst_amount.toFixed(2)}</span>
                          : <span className="text-gray-300 text-[0.6875rem]">—</span>}
                      </td>
                      {/* TDS */}
                      <td className="pr-3 py-2 text-right">
                        {line.tds_amount > 0
                          ? <span className="text-[0.6875rem] text-red-700"><span className="block text-gray-400">{line.tds_rate}%</span>−₹{line.tds_amount.toFixed(2)}</span>
                          : <span className="text-gray-300 text-[0.6875rem]">—</span>}
                      </td>
                      {/* Total */}
                      <td className="pr-3 py-2 text-right">
                        <span className="text-[0.9375rem] font-semibold text-gray-900">
                          {line.total_with_tax > 0 ? `₹${line.total_with_tax.toFixed(2)}` : '—'}
                        </span>
                      </td>
                      {/* Notes */}
                      <td className="pr-3 py-2">
                        <input type="text" value={line.notes} onChange={(e) => updateLine(i, 'notes', e.target.value)}
                          placeholder="Notes"
                          className="block w-24 rounded border border-gray-300 px-2 py-1.5 text-[0.8125rem] focus:border-blue-500 focus:outline-none" />
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
                  <td colSpan={5} className="py-3 text-[0.9375rem] font-semibold text-gray-700 text-right pr-3">Totals:</td>
                  <td className="py-3 pr-3 text-[0.9375rem] font-bold text-gray-900">{totalQty.toFixed(3)}</td>
                  <td className="py-3 pr-3"></td>
                  <td className="py-3 pr-3 text-[0.9375rem] text-gray-600">₹{lines.reduce((s,l)=>s+l.taxable_value,0).toFixed(2)}</td>
                  <td className="py-3 pr-3"></td>
                  <td className="py-3 pr-3 text-right text-[0.9375rem] text-orange-700">₹{lines.reduce((s,l)=>s+l.cgst_amount,0).toFixed(2)}</td>
                  <td className="py-3 pr-3 text-right text-[0.9375rem] text-orange-700">₹{lines.reduce((s,l)=>s+l.sgst_amount,0).toFixed(2)}</td>
                  <td className="py-3 pr-3 text-right text-[0.9375rem] text-red-700">{lines.some(l=>l.tds_amount>0)?`−₹${lines.reduce((s,l)=>s+l.tds_amount,0).toFixed(2)}`:'—'}</td>
                  <td className="py-3 pr-3 text-right text-[0.9375rem] font-bold text-gray-900">₹{lines.reduce((s,l)=>s+(l.total_with_tax||0),0).toFixed(2)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {error && <div className="rounded-md bg-red-50 border border-red-200 p-4"><p className="text-[0.9375rem] text-red-800">{error}</p></div>}

        <div className="flex gap-3">
          <button type="submit" disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-[0.9375rem] font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {loading ? 'Saving...' : '✓ Save Bill'}
          </button>
          <button type="button" onClick={() => router.back()}
            className="rounded-lg border border-gray-300 px-6 py-2.5 text-[0.9375rem] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
        </div>
      </form>

      {/* ════════════════════════════════════════════════════════════════════
          INLINE CREATION DIALOGS
          ════════════════════════════════════════════════════════════════════ */}

      {/* ── New Company ─────────────────────────────────────────────────── */}
      {showNewCompanyDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4">
            <h2 className="text-[1.1875rem] font-bold text-gray-900">Create New Company</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[0.6875rem] font-medium text-gray-700 mb-1">Company Name *</label>
                <input type="text" value={newCoName} onChange={(e) => setNewCoName(e.target.value)} autoFocus
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none" placeholder="e.g. ABC Steels Ltd" />
              </div>
              <div>
                <label className="block text-[0.6875rem] font-medium text-gray-700 mb-1">Code *</label>
                <input type="text" value={newCoCode} onChange={(e) => setNewCoCode(e.target.value.toUpperCase())}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none" placeholder="e.g. ABC" />
              </div>
              <div>
                <label className="block text-[0.6875rem] font-medium text-gray-700 mb-1">Short Name</label>
                <input type="text" value={newCoShortName} onChange={(e) => setNewCoShortName(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none" placeholder="Optional" />
              </div>
              <div>
                <label className="block text-[0.6875rem] font-medium text-gray-700 mb-1">GSTIN</label>
                <input type="text" value={newCoGstin} onChange={(e) => setNewCoGstin(e.target.value.toUpperCase())}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none" placeholder="Optional" />
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => { setShowNewCompanyDialog(false); setNewCoName(''); setNewCoCode('') }}
                className="rounded border border-gray-300 px-4 py-2 text-[0.9375rem] font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleCreateCompany} disabled={newCoLoading}
                className="rounded bg-blue-600 px-4 py-2 text-[0.9375rem] font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {newCoLoading ? 'Creating...' : 'Create Company'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Warehouse ────────────────────────────────────────────────── */}
      {showNewWarehouseDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4">
            <h2 className="text-[1.1875rem] font-bold text-gray-900">Create New Warehouse</h2>
            <div>
              <label className="block text-[0.6875rem] font-medium text-gray-700 mb-1">Warehouse Name *</label>
              <input type="text" value={newWhName} onChange={(e) => setNewWhName(e.target.value)} autoFocus
                className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none" placeholder="e.g. Main Warehouse" />
            </div>
            <div>
              <label className="block text-[0.6875rem] font-medium text-gray-700 mb-1">Company *</label>
              <select value={newWhCompanyId || companyId} onChange={(e) => setNewWhCompanyId(e.target.value)}
                className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none">
                <option value="">— Select Company —</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
              </select>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => { setShowNewWarehouseDialog(false); setNewWhName(''); setNewWhCompanyId('') }}
                className="rounded border border-gray-300 px-4 py-2 text-[0.9375rem] font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleCreateWarehouse} disabled={newWhLoading}
                className="rounded bg-blue-600 px-4 py-2 text-[0.9375rem] font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {newWhLoading ? 'Creating...' : 'Create Warehouse'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Supplier ─────────────────────────────────────────────────── */}
      {showNewSupplierDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4">
            <h2 className="text-[1.1875rem] font-bold text-gray-900">Create New Supplier</h2>
            <div>
              <label className="block text-[0.6875rem] font-medium text-gray-700 mb-1">Supplier Name *</label>
              <input type="text" value={newSpName} onChange={(e) => setNewSpName(e.target.value)} autoFocus
                className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none" placeholder="e.g. Steel Supplies Co." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[0.6875rem] font-medium text-gray-700 mb-1">Phone</label>
                <input type="text" value={newSpPhone} onChange={(e) => setNewSpPhone(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none" placeholder="Optional" />
              </div>
              <div>
                <label className="block text-[0.6875rem] font-medium text-gray-700 mb-1">GSTIN</label>
                <input type="text" value={newSpGstin} onChange={(e) => setNewSpGstin(e.target.value.toUpperCase())}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none" placeholder="Optional" />
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => { setShowNewSupplierDialog(false); setNewSpName(''); setNewSpPhone(''); setNewSpGstin('') }}
                className="rounded border border-gray-300 px-4 py-2 text-[0.9375rem] font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleCreateSupplier} disabled={newSpLoading}
                className="rounded bg-blue-600 px-4 py-2 text-[0.9375rem] font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {newSpLoading ? 'Creating...' : 'Create Supplier'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Material Type ────────────────────────────────────────────────── */}
      {showMaterialTypeDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4">
            <h2 className="text-[1.1875rem] font-bold text-gray-900">Create New Material Type</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[0.9375rem] font-medium text-gray-700 mb-1">Code * (2 chars)</label>
                <input type="text" value={newMaterialTypeCode} maxLength={2}
                  onChange={(e) => setNewMaterialTypeCode(e.target.value.toUpperCase())}
                  placeholder="e.g. GA" autoFocus
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] font-mono uppercase focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-[0.9375rem] font-medium text-gray-700 mb-1">Description *</label>
                <input type="text" value={newMaterialTypeDescription} onChange={(e) => setNewMaterialTypeDescription(e.target.value)}
                  placeholder="e.g. GA Sheet, CR Coil"
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none" />
              </div>
            </div>
            <div>
              <label className="block text-[0.9375rem] font-medium text-gray-700 mb-1">Unit</label>
              <select value={newMaterialTypeUnit} onChange={(e) => setNewMaterialTypeUnit(e.target.value)}
                className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none">
                <option value="tons">Tons</option>
                <option value="kg">Kilograms</option>
                <option value="units">Units</option>
                <option value="meters">Meters</option>
              </select>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => { setShowMaterialTypeDialog(false); setNewMaterialTypeCode(''); setNewMaterialTypeDescription(''); setNewMaterialTypeUnit('tons') }}
                className="rounded border border-gray-300 px-4 py-2 text-[0.9375rem] font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleCreateMaterialType} disabled={materialTypeDialogLoading}
                className="rounded bg-blue-600 px-4 py-2 text-[0.9375rem] font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {materialTypeDialogLoading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Size ─────────────────────────────────────────────────────────── */}
      {showSizeDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4">
            <h2 className="text-[1.1875rem] font-bold text-gray-900">Create New Size</h2>
            <div>
              <label className="block text-[0.9375rem] font-medium text-gray-700 mb-1">Material Type</label>
              <select value={newSizeMaterialTypeId} onChange={(e) => setNewSizeMaterialTypeId(e.target.value)}
                className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none">
                <option value="">— Select —</option>
                {materialTypes.map(mt => <option key={mt.id} value={mt.id}>{mt.description}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[0.9375rem] font-medium text-gray-700 mb-1">Size Label</label>
              <input type="text" value={newSizeLabel} onChange={(e) => setNewSizeLabel(e.target.value)} placeholder="e.g., 0.80x121"
                className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[0.9375rem] font-medium text-gray-700 mb-1">Thickness</label>
                <input type="number" value={newSizeThickness} onChange={(e) => setNewSizeThickness(e.target.value)} step="0.01" placeholder="Optional"
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-[0.9375rem] font-medium text-gray-700 mb-1">Width</label>
                <input type="number" value={newSizeWidth} onChange={(e) => setNewSizeWidth(e.target.value)} step="0.01" placeholder="Optional"
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none" />
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setShowSizeDialog(false)}
                className="rounded border border-gray-300 px-4 py-2 text-[0.9375rem] font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleCreateSize} disabled={sizeDialogLoading}
                className="rounded bg-blue-600 px-4 py-2 text-[0.9375rem] font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {sizeDialogLoading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Item ────────────────────────────────────────────────────── */}
      {showNewItemDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full p-6 space-y-4">
            <h2 className="text-[1.1875rem] font-bold text-gray-900">Create New Item</h2>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[0.6875rem] font-medium text-gray-700 mb-1">Material Type *</label>
                <select value={newItemMaterialTypeId} onChange={(e) => setNewItemMaterialTypeId(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-2 py-1.5 text-[0.9375rem] focus:border-blue-500 focus:outline-none">
                  <option value="">— Select —</option>
                  {materialTypes.map(mt => <option key={mt.id} value={mt.id}>{mt.code} — {mt.description}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[0.6875rem] font-medium text-gray-700 mb-1">Item Code</label>
                <input readOnly value={newItemCode} placeholder="Auto-generated from type"
                  className="block w-full rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-[0.9375rem] font-mono" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[0.6875rem] font-medium text-gray-700 mb-1">Item Name *</label>
                <input type="text" value={newItemName} onChange={(e) => setNewItemName(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-[0.6875rem] font-medium text-gray-700 mb-1">Size</label>
                <select value={newItemMaterialSizeId} onChange={(e) => setNewItemMaterialSizeId(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none">
                  <option value="">— None —</option>
                  {materialSizes.filter(s => s.material_type_id === newItemMaterialTypeId).map(s => <option key={s.id} value={s.id}>{s.size_label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[0.6875rem] font-medium text-gray-700 mb-1">Unit</label>
                <input type="text" value={newItemUnit} onChange={(e) => setNewItemUnit(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-[0.6875rem] font-medium text-gray-700 mb-1">Description</label>
                <input type="text" value={newItemDescription} onChange={(e) => setNewItemDescription(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none" />
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button type="button"
                onClick={() => {
                  setShowNewItemDialog(false); setNewItemLineIndex(null)
                  setNewItemMaterialTypeId(''); setNewItemMaterialSizeId('')
                  setNewItemName(''); setNewItemUnit('tons'); setNewItemDescription(''); setNewItemCode('')
                }}
                className="rounded border border-gray-300 px-4 py-2 text-[0.9375rem] font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={handleCreateNewItem} disabled={newItemDialogLoading}
                className="rounded bg-blue-600 px-4 py-2 text-[0.9375rem] font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {newItemDialogLoading ? 'Creating...' : 'Create Item'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
