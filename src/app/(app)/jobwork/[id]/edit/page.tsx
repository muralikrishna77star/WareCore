'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import {
  ACTIVE_COMPANIES_QUERY, ACTIVE_SUPPLIERS_QUERY, ACTIVE_WAREHOUSES_QUERY,
  ACTIVE_MATERIAL_TYPES_QUERY, ACTIVE_MATERIAL_SIZES_QUERY, ACTIVE_ITEM_MASTER_QUERY,
  GET_JOB_WORK_ORDER_FOR_EDIT_QUERY,
  ITEM_PURCHASE_LINES_QUERY, PURCHASE_LINES_STOCK_QUERY,
  ALL_PURCHASE_BILL_ITEM_LINES_QUERY, ALL_STOCK_BY_PURCHASE_LINE_QUERY,
  ALL_JOB_WORK_LINE_IDS_QUERY,
  CREATE_ITEM_MASTER_MUTATION, CREATE_MATERIAL_SIZE_MUTATION,
} from '@/lib/hasura/queries'
import type { Company, Supplier, Warehouse, MaterialType, MaterialSize, ItemMaster } from '@/types'
import { DropdownPortal } from '@/components/DropdownPortal'

const UNITS = ['MT', 'KG', 'Nos', 'Sheets', 'Meters']

// ─── Job Line ID generation (format JW-DDMM-NNNN) ─────────────────────────────

function getDDMM(date: Date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  return `${dd}${mm}`
}

function generateJobLineId(ddmm: string, allJobLineIds: string[]): string {
  const prefix = `JW-${ddmm}-`
  // Use the highest existing sequence number + 1, not the count of matching IDs —
  // counting breaks when sequences have gaps (e.g. an order's first line was removed,
  // leaving only "-0002"), which would regenerate that same "-0002" as "next".
  const maxSeq = allJobLineIds.reduce((max, id) => {
    if (!id || !id.startsWith(prefix)) return max
    const n = parseInt(id.slice(prefix.length), 10)
    return Number.isFinite(n) ? Math.max(max, n) : max
  }, 0)
  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`
}

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
  sub_purchase_line_id: string
  available_quantity: string
  quantity: string
  unit: string
  notes: string
  job_line_id: string
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
  job_line_id: string
}

const emptyInput = (): InputLine => ({
  item_master_id: '', item_name: '', item_code: '',
  material_type_id: '', material_size_id: '', size_label: '',
  purchase_line_options: [], purchase_lines_loading: false,
  purchase_line_id: '', sub_purchase_line_id: '', available_quantity: '',
  quantity: '', unit: 'MT', notes: '',
  job_line_id: '',
})

const emptyOutput = (): OutputLine => ({
  item_master_id: '', item_name: '', item_code: '',
  material_type_id: '', material_size_id: '', size_label: '',
  quantity: '', unit: 'MT', notes: '',
  job_line_id: '',
})

export default function EditJobWorkPage() {
  const router = useRouter()
  const params = useParams()
  const orderId = params.id as string

  const [pageLoading, setPageLoading] = useState(true)
  const [orderStatus, setOrderStatus] = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [hasReturns, setHasReturns] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const [companies, setCompanies] = useState<Company[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([])
  const [materialSizes, setMaterialSizes] = useState<MaterialSize[]>([])
  const [itemMasters, setItemMasters] = useState<ItemMaster[]>([])
  const [stockByItem, setStockByItem] = useState<Record<string, number>>({})
  const [existingJobLineIds, setExistingJobLineIds] = useState<string[]>([])

  // Item search state for inputs and outputs separately
  const [inputItemSearch, setInputItemSearch] = useState<Record<number, string>>({})
  const [inputItemOpen, setInputItemOpen] = useState<Record<number, boolean>>({})
  const inputItemRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const [outputItemSearch, setOutputItemSearch] = useState<Record<number, string>>({})
  const [outputItemOpen, setOutputItemOpen] = useState<Record<number, boolean>>({})
  const outputItemRefs = useRef<Record<number, HTMLDivElement | null>>({})

  // ── New Item dialog (input or output line) ──────────────────────────────
  const [showNewItemDialog, setShowNewItemDialog] = useState(false)
  const [newItemLineIndex, setNewItemLineIndex] = useState<number | null>(null)
  const [newItemLineType, setNewItemLineType] = useState<'input' | 'output'>('input')
  const [newItemMaterialTypeId, setNewItemMaterialTypeId] = useState('')
  const [newItemMaterialSizeId, setNewItemMaterialSizeId] = useState('')
  const [newItemName, setNewItemName] = useState('')
  const [newItemUnit, setNewItemUnit] = useState('MT')
  const [newItemDescription, setNewItemDescription] = useState('')
  const [newItemCode, setNewItemCode] = useState('')
  const [newItemDialogLoading, setNewItemDialogLoading] = useState(false)

  // ── Inline new size (within New Item dialog) ────────────────────────────
  const [showInlineNewSize, setShowInlineNewSize] = useState(false)
  const [inlineNewSizeLabel, setInlineNewSizeLabel] = useState('')
  const [inlineNewSizeThickness, setInlineNewSizeThickness] = useState('')
  const [inlineNewSizeWidth, setInlineNewSizeWidth] = useState('')
  const [inlineNewSizeLoading, setInlineNewSizeLoading] = useState(false)

  // Header fields
  const [companyId, setCompanyId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [dispatchDate, setDispatchDate] = useState(new Date().toISOString().split('T')[0])
  const [expectedReturnDate, setExpectedReturnDate] = useState('')
  const [workDescription, setWorkDescription] = useState('')
  const [notes, setNotes] = useState('')

  // Line items
  const [inputLines, setInputLines] = useState<InputLine[]>([])
  const [outputLines, setOutputLines] = useState<OutputLine[]>([])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshingItemMasters, setRefreshingItemMasters] = useState(false)

  // Fetch purchase line options for a given item master. When `preservePurchaseLineId`
  // is set (initial load of an existing line), keep that selection and add `extraQty`
  // (the net quantity this order currently holds out at the vendor) back onto its
  // available stock — that's what edit_job_work_order will restore on save.
  const fetchPurchaseLinesForItem = useCallback(async (
    itemMasterId: string,
    index: number,
    preservePurchaseLineId?: string,
    extraQty?: number,
  ) => {
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
      u[index] = { ...u[index], purchase_lines_loading: true, purchase_line_options: [] }
      if (!preservePurchaseLineId) {
        u[index].purchase_line_id = ''
        u[index].available_quantity = ''
      }
      return u
    })

    const { data: linesData } = await hasuraFetch<any>(ITEM_PURCHASE_LINES_QUERY, { item_master_id: itemMasterId })
    const purchaseLineIds: string[] = (linesData?.purchase_bill_items ?? [])
      .map((r: any) => r.purchase_line_id)
      .filter(Boolean)

    const stockMap: Record<string, number> = {}
    if (purchaseLineIds.length) {
      const { data: stockData } = await hasuraFetch<any>(PURCHASE_LINES_STOCK_QUERY, { purchase_line_ids: purchaseLineIds })
      for (const row of (stockData?.stock_ledger ?? []) as { purchase_line_id: string; quantity: number }[]) {
        if (row.purchase_line_id) {
          stockMap[row.purchase_line_id] = (stockMap[row.purchase_line_id] ?? 0) + Number(row.quantity)
        }
      }
    }

    const ids = new Set(purchaseLineIds)
    if (preservePurchaseLineId) ids.add(preservePurchaseLineId)

    const options: PurchaseLineOption[] = Array.from(ids)
      .map(id => {
        let qty = stockMap[id] ?? 0
        if (preservePurchaseLineId && id === preservePurchaseLineId) qty += extraQty ?? 0
        return { purchase_line_id: id, available_qty: Number(qty.toFixed(3)) }
      })
      .filter(opt => opt.available_qty > 0)
      .sort((a, b) => a.purchase_line_id.localeCompare(b.purchase_line_id))

    setInputLines(prev => {
      const u = [...prev]
      u[index] = { ...u[index], purchase_lines_loading: false, purchase_line_options: options }
      if (preservePurchaseLineId) {
        const opt = options.find(o => o.purchase_line_id === preservePurchaseLineId)
        u[index].purchase_line_id = preservePurchaseLineId
        u[index].available_quantity = opt ? opt.available_qty.toFixed(3) : ''
      }
      return u
    })
  }, [])

  useEffect(() => {
    const load = async () => {
      const [orderRes, c, s, w, mt, ms, im, billLines, stockRows, jli] = await Promise.all([
        hasuraFetch(GET_JOB_WORK_ORDER_FOR_EDIT_QUERY, { id: orderId }),
        hasuraFetch(ACTIVE_COMPANIES_QUERY),
        hasuraFetch(ACTIVE_SUPPLIERS_QUERY),
        hasuraFetch(ACTIVE_WAREHOUSES_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_TYPES_QUERY),
        hasuraFetch(ACTIVE_MATERIAL_SIZES_QUERY),
        hasuraFetch(ACTIVE_ITEM_MASTER_QUERY),
        hasuraFetch(ALL_PURCHASE_BILL_ITEM_LINES_QUERY),
        hasuraFetch(ALL_STOCK_BY_PURCHASE_LINE_QUERY),
        hasuraFetch(ALL_JOB_WORK_LINE_IDS_QUERY),
      ])

      const order = (orderRes.data as any)?.job_work_orders_by_pk
      if (!order) { setNotFound(true); setPageLoading(false); return }

      setOrderStatus(order.status)
      setReferenceNumber(order.reference_number ?? '')
      setCompanyId(order.company_id ?? '')
      setWarehouseId(order.warehouse_id ?? '')
      setVendorId(order.vendor_id ?? '')
      setDispatchDate(order.dispatch_date ?? new Date().toISOString().split('T')[0])
      setExpectedReturnDate(order.expected_return_date ?? '')
      setWorkDescription(order.work_description ?? '')
      setNotes(order.notes ?? '')

      const loadedItemMasters: ItemMaster[] = (im.data as any)?.item_master ?? []
      setCompanies((c.data as any)?.companies ?? [])
      setSuppliers((s.data as any)?.suppliers ?? [])
      setWarehouses((w.data as any)?.warehouses ?? [])
      setMaterialTypes((mt.data as any)?.material_types ?? [])
      setMaterialSizes((ms.data as any)?.material_sizes ?? [])
      setItemMasters(loadedItemMasters)

      // Exclude this order's own job line IDs so the sequence count isn't inflated by itself
      const ownLineIds = new Set<string>(
        (order.job_work_items ?? []).map((i: any) => i.job_line_id).filter(Boolean)
      )
      setExistingJobLineIds(
        ((jli.data as any)?.job_work_items ?? [])
          .map((r: any) => r.job_line_id)
          .filter((id: string) => id && !ownLineIds.has(id))
      )

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

      // Map existing input items
      const rawInputs: any[] = order.job_work_items ?? []
      let anyReturns = false
      const loadedInputs: (InputLine & { _net_qty: number })[] = rawInputs.map((it) => {
        const found = loadedItemMasters.find(x => x.id === it.item_master_id)
        if (Number(it.quantity_received) > 0) anyReturns = true
        return {
          item_master_id: it.item_master_id ?? '',
          item_name: it.item_name ?? '',
          item_code: found?.item_code ?? '',
          material_type_id: it.material_type_id ?? '',
          material_size_id: it.material_size_id ?? '',
          size_label: it.size_label ?? '',
          purchase_line_options: [],
          purchase_lines_loading: false,
          purchase_line_id: it.purchase_line_id ?? '',
          sub_purchase_line_id: it.sub_purchase_line_id ?? '',
          available_quantity: '',
          quantity: it.quantity_sent != null ? String(it.quantity_sent) : '',
          unit: it.unit || 'MT',
          notes: it.notes ?? '',
          job_line_id: it.job_line_id ?? '',
          _net_qty: (Number(it.quantity_sent) || 0) - (Number(it.quantity_received) || 0),
        }
      })
      setHasReturns(anyReturns)

      const finalInputs: InputLine[] = (loadedInputs.length ? loadedInputs : [{ ...emptyInput(), _net_qty: 0 }])
        .map(({ _net_qty, ...rest }) => rest)
      setInputLines(finalInputs)

      const inSearch: Record<number, string> = {}
      finalInputs.forEach((l, i) => { if (l.item_name) inSearch[i] = l.item_name })
      setInputItemSearch(inSearch)

      // Map existing output items
      const rawOutputs: any[] = order.job_work_output_items ?? []
      const finalOutputs: OutputLine[] = (rawOutputs.length ? rawOutputs : []).map((it) => {
        const found = loadedItemMasters.find(x => x.id === it.item_master_id)
        return {
          item_master_id: it.item_master_id ?? '',
          item_name: it.item_name ?? '',
          item_code: found?.item_code ?? '',
          material_type_id: it.material_type_id ?? '',
          material_size_id: it.material_size_id ?? '',
          size_label: it.size_label ?? '',
          quantity: it.quantity != null ? String(it.quantity) : '',
          unit: it.unit || 'MT',
          notes: it.notes ?? '',
          job_line_id: it.source_job_line_id ?? '',
        }
      })
      setOutputLines(finalOutputs.length ? finalOutputs : [emptyOutput()])

      const outSearch: Record<number, string> = {}
      finalOutputs.forEach((l, i) => { if (l.item_name) outSearch[i] = l.item_name })
      setOutputItemSearch(outSearch)

      setPageLoading(false)

      // Fetch purchase line options for each loaded input line, preserving its current selection
      loadedInputs.forEach((l, idx) => {
        if (l.item_master_id) {
          fetchPurchaseLinesForItem(l.item_master_id, idx, l.purchase_line_id || undefined, l._net_qty)
        }
      })
    }
    load()
  }, [orderId, fetchPurchaseLinesForItem])

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
          if (!u[index].job_line_id) {
            const ddmm = getDDMM(new Date(dispatchDate + 'T00:00:00'))
            const currentlyAssigned = u
              .filter((_, idx) => idx !== index)
              .map(l => l.job_line_id)
              .filter(Boolean)
            u[index].job_line_id = generateJobLineId(ddmm, [...existingJobLineIds, ...currentlyAssigned])
          }
        } else {
          u[index].item_name = ''
          u[index].item_code = ''
          u[index].material_type_id = ''
          u[index].material_size_id = ''
          u[index].size_label = ''
          u[index].job_line_id = ''
        }
        u[index].purchase_line_id = ''
        u[index].sub_purchase_line_id = ''
        u[index].available_quantity = ''
        u[index].purchase_line_options = []
      }

      if (field === 'purchase_line_id') {
        const opt = u[index].purchase_line_options.find(o => o.purchase_line_id === value)
        u[index].available_quantity = opt ? opt.available_qty.toFixed(3) : ''
        u[index].sub_purchase_line_id = ''
      }

      return u
    })

    if (field === 'item_master_id' && value) {
      fetchPurchaseLinesForItem(value, index)
    }
  }, [itemMasters, fetchPurchaseLinesForItem, dispatchDate, existingJobLineIds])

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

  // Clear stale Output Job Line ID references when their Input row's item is removed
  useEffect(() => {
    const validIds = new Set(inputLines.map(l => l.job_line_id).filter(Boolean))
    setOutputLines(prev => {
      let changed = false
      const next = prev.map(l => {
        if (l.job_line_id && !validIds.has(l.job_line_id)) {
          changed = true
          return { ...l, job_line_id: '' }
        }
        return l
      })
      return changed ? next : prev
    })
  }, [inputLines])

  // Auto-generate item code from material type prefix for the New Item dialog
  useEffect(() => {
    const mt = materialTypes.find(m => m.id === newItemMaterialTypeId)
    if (mt) setNewItemUnit(mt.unit || 'MT')
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

  const openNewItemDialog = (lineIndex: number, lineType: 'input' | 'output', materialTypeId: string, materialSizeId: string) => {
    setNewItemLineIndex(lineIndex)
    setNewItemLineType(lineType)
    setNewItemMaterialTypeId(materialTypeId)
    setNewItemMaterialSizeId(materialSizeId)
    setNewItemName(''); setNewItemDescription(''); setNewItemCode('')
    setShowNewItemDialog(true)
  }

  const closeNewItemDialog = () => {
    setShowNewItemDialog(false)
    setNewItemLineIndex(null); setNewItemMaterialTypeId(''); setNewItemMaterialSizeId('')
    setNewItemName(''); setNewItemUnit('MT'); setNewItemDescription(''); setNewItemCode('')
    setShowInlineNewSize(false); setInlineNewSizeLabel(''); setInlineNewSizeThickness(''); setInlineNewSizeWidth('')
  }

  // ── Inline New Size (within New Item dialog) ─────────────────────────────
  const handleCreateInlineNewSize = async () => {
    if (!newItemMaterialTypeId || !inlineNewSizeLabel.trim()) {
      setError('Material Type and Size Label are required')
      return
    }
    setInlineNewSizeLoading(true)
    const { data, error: err } = await hasuraFetch<{ insert_material_sizes_one: MaterialSize }>(CREATE_MATERIAL_SIZE_MUTATION, {
      material_type_id: newItemMaterialTypeId,
      size_label: inlineNewSizeLabel,
      thickness: inlineNewSizeThickness ? parseFloat(inlineNewSizeThickness) : null,
      width: inlineNewSizeWidth ? parseFloat(inlineNewSizeWidth) : null,
    })
    setInlineNewSizeLoading(false)
    if (err) { setError(err.message); return }
    const newSize = data?.insert_material_sizes_one
    if (newSize) {
      setMaterialSizes(prev => [...prev, newSize])
      setNewItemMaterialSizeId(newSize.id)
      setInlineNewSizeLabel(''); setInlineNewSizeThickness(''); setInlineNewSizeWidth('')
      setShowInlineNewSize(false)
    }
  }

  // ── New Item creation (input or output line) ─────────────────────────────
  const handleCreateNewItem = async () => {
    if (!newItemMaterialTypeId || !newItemName.trim()) {
      setError('Material type and item name are required.')
      return
    }
    if (!newItemCode) { setError('Select a material type first to generate an item code.'); return }
    setNewItemDialogLoading(true)
    const selectedSize = materialSizes.find(s => s.id === newItemMaterialSizeId)
    const { data, error: err } = await hasuraFetch<{ insert_item_master_one: ItemMaster }>(CREATE_ITEM_MASTER_MUTATION, {
      item_code: newItemCode, item_name: newItemName,
      material_type_id: newItemMaterialTypeId,
      material_size_id: newItemMaterialSizeId || null,
      size_label: selectedSize?.size_label || null,
      unit: newItemUnit, description: newItemDescription || null,
    })
    setNewItemDialogLoading(false)
    if (err) { setError(err.message); return }
    const created = data?.insert_item_master_one
    if (!created) return

    const newItemMasterEntry: ItemMaster = {
      ...created,
      material_type_id: newItemMaterialTypeId,
      unit: newItemUnit,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setItemMasters(prev => [...prev, newItemMasterEntry])

    if (newItemLineIndex !== null) {
      const lineIndex = newItemLineIndex
      if (newItemLineType === 'input') {
        setInputLines(prev => {
          const u = [...prev]
          u[lineIndex] = {
            ...u[lineIndex],
            item_master_id: created.id,
            item_name: created.item_name,
            item_code: created.item_code,
            material_type_id: newItemMaterialTypeId,
            material_size_id: created.material_size_id || '',
            size_label: created.size_label || '',
            unit: newItemUnit,
            purchase_line_id: '',
            sub_purchase_line_id: '',
            available_quantity: '',
            purchase_line_options: [],
          }
          if (!u[lineIndex].job_line_id) {
            const ddmm = getDDMM(new Date(dispatchDate + 'T00:00:00'))
            const currentlyAssigned = u.filter((_, idx) => idx !== lineIndex).map(l => l.job_line_id).filter(Boolean)
            u[lineIndex].job_line_id = generateJobLineId(ddmm, [...existingJobLineIds, ...currentlyAssigned])
          }
          return u
        })
        setInputItemSearch(p => ({ ...p, [lineIndex]: created.item_name }))
        setInputItemOpen(p => ({ ...p, [lineIndex]: false }))
        fetchPurchaseLinesForItem(created.id, lineIndex)
      } else {
        setOutputLines(prev => {
          const u = [...prev]
          u[lineIndex] = {
            ...u[lineIndex],
            item_master_id: created.id,
            item_name: created.item_name,
            item_code: created.item_code,
            material_type_id: newItemMaterialTypeId,
            material_size_id: created.material_size_id || '',
            size_label: created.size_label || '',
            unit: newItemUnit,
          }
          return u
        })
        setOutputItemSearch(p => ({ ...p, [lineIndex]: created.item_name }))
        setOutputItemOpen(p => ({ ...p, [lineIndex]: false }))
      }
    }

    closeNewItemDialog()
  }

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

    // Validate quantities against available stock (already adjusted for this order's own reversal)
    for (const line of validInputs) {
      if (line.available_quantity && parseFloat(line.quantity) > parseFloat(line.available_quantity)) {
        setError(`Quantity for "${line.item_name}" (${line.quantity}) exceeds available stock (${line.available_quantity}).`)
        setLoading(false)
        return
      }
    }

    // Validate output quantities don't exceed input quantities per Job Line ID
    for (const line of validInputs) {
      if (!line.job_line_id) continue
      const inputQty = parseFloat(line.quantity) || 0
      const allocated = outputLines
        .filter(o => o.job_line_id === line.job_line_id && o.item_master_id && o.quantity)
        .reduce((sum, o) => sum + (parseFloat(o.quantity) || 0), 0)
      if (allocated > inputQty + 0.0005) {
        setError(`Output quantity linked to ${line.job_line_id} (${line.item_name}) is ${allocated.toFixed(3)} ${line.unit}, exceeding the input quantity of ${inputQty.toFixed(3)} ${line.unit}.`)
        setLoading(false)
        return
      }
    }

    const validOutputs = outputLines.filter(l => l.item_master_id && l.quantity)

    const res = await fetch(`/api/jobwork/${orderId}/save-edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: companyId || null,
        warehouse_id: warehouseId || null,
        vendor_id: vendorId || null,
        dispatch_date: dispatchDate,
        expected_return_date: expectedReturnDate || null,
        work_description: workDescription || null,
        notes: notes || null,
        input_items: validInputs.map(l => ({
          purchase_line_id: l.purchase_line_id || null,
          sub_purchase_line_id: l.sub_purchase_line_id || null,
          job_line_id: l.job_line_id || null,
          item_master_id: l.item_master_id || null,
          item_name: l.item_name || null,
          material_type_id: l.material_type_id || null,
          material_size_id: l.material_size_id || null,
          size_label: l.size_label || null,
          quantity_sent: parseFloat(l.quantity),
          unit: l.unit || 'MT',
          notes: l.notes || null,
        })),
        output_items: validOutputs.map(l => ({
          item_master_id: l.item_master_id || null,
          item_name: l.item_name || null,
          material_type_id: l.material_type_id || null,
          material_size_id: l.material_size_id || null,
          size_label: l.size_label || null,
          quantity: parseFloat(l.quantity),
          unit: l.unit || 'MT',
          source_job_line_id: l.job_line_id || null,
          notes: l.notes || null,
        })),
      }),
    })

    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(json.error ?? 'Save failed')
      setLoading(false)
      return
    }

    router.push(`/jobwork/${orderId}`)
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

  if (pageLoading) {
    return <div className="max-w-[1800px] mx-auto py-12 text-center text-gray-500">Loading…</div>
  }

  if (notFound) {
    return (
      <div className="max-w-[1800px] mx-auto py-12 text-center">
        <p className="text-red-600 font-medium">Job work order not found.</p>
        <a href="/jobwork" className="mt-4 inline-block text-blue-600 hover:underline text-sm">← Back to Job Work</a>
      </div>
    )
  }

  if (orderStatus === 'cancelled' || orderStatus === 'completed') {
    return (
      <div className="max-w-[1800px] mx-auto py-12 text-center">
        <p className="text-red-600 font-medium">
          This order is {orderStatus} and cannot be edited.
        </p>
        <a href={`/jobwork/${orderId}`} className="mt-4 inline-block text-blue-600 hover:underline text-sm">← Back to order</a>
      </div>
    )
  }

  return (
    <div className="max-w-[1800px] mx-auto">

      <div className="mb-3">
        <a href={`/jobwork/${orderId}`} className="text-sm text-blue-600 hover:underline">← Back to order</a>
      </div>

      <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
        <p className="text-sm font-semibold text-amber-800">Editing will recalculate stock</p>
        <p className="text-xs text-amber-700 mt-0.5">
          Saving reverses the original stock movements for this order and re-applies them based on the updated items.
          {hasReturns && ' This order has recorded returns — quantity received will be reset to 0 for the new line items.'}
        </p>
      </div>

      {/* ── Single unified card ─────────────────────────────────────────── */}
      <form onSubmit={handleSubmit}>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

          {/* Title bar */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
            <h1 className="text-base font-semibold text-gray-900">
              Edit Job Work Order
              {referenceNumber && <span className="ml-2 font-mono text-sm text-gray-500">{referenceNumber}</span>}
            </h1>
            <div className="flex gap-2">
              <button type="button" onClick={() => router.push(`/jobwork/${orderId}`)}
                className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="submit" disabled={loading}
                className="rounded bg-blue-600 px-5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {loading ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>

          {/* ── Order Details ──────────────────────────────────────────────── */}
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 lg:grid-cols-7">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Company</label>
                <select value={companyId} onChange={e => {
                  const newCompanyId = e.target.value
                  setCompanyId(newCompanyId)
                  if (warehouseId && !warehouses.some(w => w.id === warehouseId && w.company_id === newCompanyId)) {
                    setWarehouseId('')
                  }
                }} className={selectCls}>
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
                  {(companyId ? warehouses.filter(w => w.company_id === companyId) : warehouses).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
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
              <table className="w-full text-sm min-w-[1150px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 w-72">
                      Item
                      <button type="button" onClick={refreshItemMasters} title="Refresh master items"
                        className="ml-1 text-gray-400 hover:text-blue-500 align-middle">
                        {refreshingItemMasters ? '…' : '↻'}
                      </button>
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 w-40">Job Line ID</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 w-44">Purchase Line ID</th>
                    <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 w-28">Avail Stock</th>
                    <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 w-28">Qty Consumed</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 w-24">Unit</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 w-32">Notes</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {inputLines.map((line, i) => (
                    <tr key={i} className="hover:bg-blue-50/30">
                      {/* Item */}
                      <td className="px-2 py-2">
                        <div className="relative" ref={el => { inputItemRefs.current[i] = el }}>
                          <input type="text"
                            value={inputItemSearch[i] ?? line.item_name}
                            onChange={e => { setInputItemSearch(p => ({ ...p, [i]: e.target.value })); setInputItemOpen(p => ({ ...p, [i]: true })) }}
                            onFocus={() => setInputItemOpen(p => ({ ...p, [i]: true }))}
                            onBlur={() => setInputItemOpen(p => ({ ...p, [i]: false }))}
                            placeholder="Search item…"
                            className={inputFieldCls} />
                          <DropdownPortal anchorEl={inputItemRefs.current[i]} open={!!inputItemOpen[i]} className="w-80 overflow-y-auto rounded-md border border-gray-300 bg-white shadow-lg max-h-56">
                              <button type="button" onMouseDown={e => e.preventDefault()}
                                onClick={() => openNewItemDialog(i, 'input', line.material_type_id, line.material_size_id)}
                                className="w-full text-left px-3 py-2 text-xs text-blue-600 hover:bg-blue-50 font-semibold border-b border-gray-100">
                                + New Item
                              </button>
                              {filteredInputItems(inputItemSearch[i] ?? '').map(im => (
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
                              {filteredInputItems(inputItemSearch[i] ?? '').length === 0 && (
                                <div className="px-3 py-2 text-xs text-gray-400">
                                  {(inputItemSearch[i] ?? '').length > 0 ? 'No matching items with stock' : 'No items with available stock'}
                                </div>
                              )}
                          </DropdownPortal>
                        </div>
                      </td>

                      {/* Job Line ID */}
                      <td className="px-2 py-2">
                        {line.job_line_id ? (
                          <>
                            <span className="inline-block text-[11px] font-mono px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                              {line.job_line_id}
                            </span>
                            {(() => {
                              const allocated = outputLines
                                .filter(o => o.job_line_id === line.job_line_id)
                                .reduce((s, o) => s + (parseFloat(o.quantity) || 0), 0)
                              const remaining = (parseFloat(line.quantity) || 0) - allocated
                              return remaining < -0.0005
                                ? <p className="text-[10px] text-red-500 mt-0.5">Over by {Math.abs(remaining).toFixed(3)} {line.unit}</p>
                                : <p className="text-[10px] text-green-600 mt-0.5">Remaining: {remaining.toFixed(3)} {line.unit}</p>
                            })()}
                          </>
                        ) : (
                          <span className="text-xs text-gray-300 italic">—</span>
                        )}
                      </td>

                      {/* Purchase Line ID */}
                      <td className="px-2 py-2">
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
                      <td className="px-2 py-2 text-right">
                        {line.available_quantity
                          ? <span className="text-sm font-semibold text-green-700">{Number(line.available_quantity).toFixed(3)} <span className="text-xs font-normal text-green-600">{line.unit}</span></span>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>

                      {/* Qty Consumed */}
                      <td className="px-2 py-2">
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
                      <td className="px-2 py-2">
                        <select value={line.unit} onChange={e => updateInputLine(i, 'unit', e.target.value)} className={selectCls}>
                          {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </td>

                      {/* Notes */}
                      <td className="px-2 py-2">
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
              <table className="w-full text-sm min-w-[850px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 w-72">
                      Produced Item
                      <button type="button" onClick={refreshItemMasters} title="Refresh master items"
                        className="ml-1 text-gray-400 hover:text-blue-500 align-middle">
                        {refreshingItemMasters ? '…' : '↻'}
                      </button>
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 w-40">Job Line ID</th>
                    <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 w-28">Qty Produced</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 w-24">Unit</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 w-32">Notes</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {outputLines.map((line, i) => (
                    <tr key={i} className="hover:bg-emerald-50/30">
                      {/* Item */}
                      <td className="px-2 py-2">
                        <div className="relative" ref={el => { outputItemRefs.current[i] = el }}>
                          <input type="text"
                            value={outputItemSearch[i] ?? line.item_name}
                            onChange={e => { setOutputItemSearch(p => ({ ...p, [i]: e.target.value })); setOutputItemOpen(p => ({ ...p, [i]: true })) }}
                            onFocus={() => setOutputItemOpen(p => ({ ...p, [i]: true }))}
                            onBlur={() => setOutputItemOpen(p => ({ ...p, [i]: false }))}
                            placeholder="Search produced item…"
                            className={inputFieldCls} />
                          <DropdownPortal anchorEl={outputItemRefs.current[i]} open={!!outputItemOpen[i]} className="w-80 overflow-y-auto rounded-md border border-gray-300 bg-white shadow-lg max-h-56">
                              <button type="button" onMouseDown={e => e.preventDefault()}
                                onClick={() => openNewItemDialog(i, 'output', line.material_type_id, line.material_size_id)}
                                className="w-full text-left px-3 py-2 text-xs text-blue-600 hover:bg-blue-50 font-semibold border-b border-gray-100">
                                + New Item
                              </button>
                              {filteredAllItems(outputItemSearch[i] ?? '').map(im => (
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
                              {filteredAllItems(outputItemSearch[i] ?? '').length === 0 && (
                                <div className="px-3 py-2 text-xs text-gray-400">No items found</div>
                              )}
                          </DropdownPortal>
                        </div>
                      </td>

                      <td className="px-2 py-2">
                        <select value={line.job_line_id} onChange={e => updateOutputLine(i, 'job_line_id', e.target.value)} className={selectCls + ' font-mono'}>
                          <option value="">— none —</option>
                          {inputLines.filter(l => l.item_master_id && l.job_line_id).map(l => (
                            <option key={l.job_line_id} value={l.job_line_id}>
                              {l.job_line_id} — {l.item_name} ({l.quantity || '0'} {l.unit})
                            </option>
                          ))}
                        </select>
                      </td>

                      <td className="px-2 py-2">
                        <input type="number" value={line.quantity} onChange={e => updateOutputLine(i, 'quantity', e.target.value)}
                          step="0.001" min="0" placeholder="0.000"
                          className="block w-full rounded border border-gray-300 px-2 py-2 text-sm text-right focus:border-blue-500 focus:outline-none" />
                      </td>

                      <td className="px-2 py-2">
                        <select value={line.unit} onChange={e => updateOutputLine(i, 'unit', e.target.value)} className={selectCls}>
                          {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </td>

                      <td className="px-2 py-2">
                        <input type="text" value={line.notes} onChange={e => updateOutputLine(i, 'notes', e.target.value)} className={inputFieldCls} />
                      </td>

                      <td className="px-2 py-2 text-center">
                        {outputLines.length > 1 && (
                          <button type="button" onClick={() => setOutputLines(p => p.filter((_, idx) => idx !== i))}
                            className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
                        )}
                      </td>
                    </tr>
                  ))}
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
                <label className="block text-[0.6875rem] font-medium text-gray-700 mb-1">
                  Size
                  {newItemMaterialTypeId && (
                    <button type="button" onClick={() => setShowInlineNewSize(v => !v)}
                      className="ml-2 text-blue-600 hover:text-blue-800 text-[0.6875rem] font-normal">
                      {showInlineNewSize ? '− Cancel' : '+ New Size'}
                    </button>
                  )}
                </label>
                <select value={newItemMaterialSizeId} onChange={(e) => setNewItemMaterialSizeId(e.target.value)}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-[0.9375rem] focus:border-blue-500 focus:outline-none">
                  <option value="">— None —</option>
                  {materialSizes.filter(s => s.material_type_id === newItemMaterialTypeId).map(s => <option key={s.id} value={s.id}>{s.size_label}</option>)}
                </select>
                {showInlineNewSize && (
                  <div className="mt-2 rounded border border-blue-200 bg-blue-50 p-3 space-y-2">
                    <p className="text-[0.6875rem] font-semibold text-blue-700 uppercase tracking-wide">New Size</p>
                    <input type="text" value={inlineNewSizeLabel} onChange={(e) => setInlineNewSizeLabel(e.target.value)}
                      placeholder="Size Label (e.g. 0.80x121) *"
                      className="block w-full rounded border border-gray-300 px-2 py-1.5 text-[0.8125rem] focus:border-blue-500 focus:outline-none" />
                    <div className="grid grid-cols-2 gap-2">
                      <input type="number" value={inlineNewSizeThickness} onChange={(e) => setInlineNewSizeThickness(e.target.value)}
                        step="0.01" placeholder="Thickness (optional)"
                        className="block w-full rounded border border-gray-300 px-2 py-1.5 text-[0.8125rem] focus:border-blue-500 focus:outline-none" />
                      <input type="number" value={inlineNewSizeWidth} onChange={(e) => setInlineNewSizeWidth(e.target.value)}
                        step="0.01" placeholder="Width (optional)"
                        className="block w-full rounded border border-gray-300 px-2 py-1.5 text-[0.8125rem] focus:border-blue-500 focus:outline-none" />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button type="button" onClick={() => { setShowInlineNewSize(false); setInlineNewSizeLabel(''); setInlineNewSizeThickness(''); setInlineNewSizeWidth('') }}
                        className="rounded border border-gray-300 px-3 py-1 text-[0.8125rem] text-gray-600 hover:bg-gray-50">Cancel</button>
                      <button type="button" onClick={handleCreateInlineNewSize} disabled={inlineNewSizeLoading}
                        className="rounded bg-blue-600 px-3 py-1 text-[0.8125rem] text-white hover:bg-blue-700 disabled:opacity-50">
                        {inlineNewSizeLoading ? 'Saving...' : 'Add Size'}
                      </button>
                    </div>
                  </div>
                )}
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
              <button type="button" onClick={closeNewItemDialog}
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
