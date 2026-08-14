// Resolves parsed rows against current master data (exact match only, case-
// insensitive + trimmed — no fuzzy matching, no auto-creating new master
// records, per the explicit product decision), groups rows into bills, and
// assigns bill_number/purchase_line_id using the exact same generators the
// manual entry form uses (src/lib/purchaseIds.ts) so IDs can never collide
// between manual and imported bills.
//
// All-or-nothing: if ANY row in the file has an error, `bills` comes back
// empty — nothing is partially resolved. `resolveImport()` is the single
// authoritative gate used both by the legacy one-shot path's tests and by
// the staging workflow's final-import step (see
// src/app/api/bills/import/batches/[id]/import/route.ts) — it is never
// re-implemented a second time.
//
// resolveRow() (bail-on-first-error per row) and resolveRowIndependent()
// (collect every error on a row at once, for the correction-review screen)
// share the SAME per-field matcher functions below so the two can never
// disagree about whether a given value matches master data — see
// tests/purchaseImport/resolve.test.ts's "no drift" test, which asserts
// exactly that.
import { calculateLineTax } from '@/lib/purchaseTax'
import { generatePurchaseId, generatePurchaseLineId, generateItemCode, getMMYY } from '@/lib/purchaseIds'
import type { MasterDataSnapshot, NewItemMaster, ParsedRow, ResolvedBill, ResolvedLine, RowError } from './types'

function norm(s: string): string {
  return s.trim().toLowerCase()
}

// ─── Shared per-field matchers ──────────────────────────────────────────────
// Exact match only (case-insensitive + trimmed via norm()). Warehouse/Size
// are scoped to their resolved parent when one is known; when the parent
// isn't known (only relevant to resolveRowIndependent — resolveRow always
// has a resolved parent by the time it checks these, since it bails
// earlier otherwise) they're matched unscoped across ALL parents and
// flagged ambiguous if more than one candidate matches, rather than
// silently picking one or dead-ending with no signal at all.

function findCompany(row: ParsedRow, snapshot: MasterDataSnapshot) {
  return snapshot.companies.find((c) => norm(c.name) === norm(row.company) || norm(c.code) === norm(row.company)) ?? null
}

function findWarehouse(
  row: ParsedRow, snapshot: MasterDataSnapshot, companyId: string | null
): { warehouse: MasterDataSnapshot['warehouses'][number] | null; ambiguous: boolean } {
  if (companyId) {
    const warehouse = snapshot.warehouses.find((w) => w.company_id === companyId && norm(w.name) === norm(row.warehouse)) ?? null
    return { warehouse, ambiguous: false }
  }
  const matches = snapshot.warehouses.filter((w) => norm(w.name) === norm(row.warehouse))
  if (matches.length === 1) return { warehouse: matches[0], ambiguous: false }
  if (matches.length > 1) return { warehouse: null, ambiguous: true }
  return { warehouse: null, ambiguous: false }
}

function findSupplier(row: ParsedRow, snapshot: MasterDataSnapshot) {
  return snapshot.suppliers.find((s) => norm(s.name) === norm(row.supplier)) ?? null
}

function findMaterialType(row: ParsedRow, snapshot: MasterDataSnapshot) {
  return snapshot.materialTypes.find((m) => norm(m.code) === norm(row.materialType) || norm(m.description) === norm(row.materialType)) ?? null
}

function findSize(
  row: ParsedRow, snapshot: MasterDataSnapshot, materialTypeId: string | null
): { size: MasterDataSnapshot['materialSizes'][number] | null; ambiguous: boolean } {
  if (materialTypeId) {
    const size = snapshot.materialSizes.find((s) => s.material_type_id === materialTypeId && norm(s.size_label) === norm(row.size)) ?? null
    return { size, ambiguous: false }
  }
  const matches = snapshot.materialSizes.filter((s) => norm(s.size_label) === norm(row.size))
  if (matches.length === 1) return { size: matches[0], ambiguous: false }
  if (matches.length > 1) return { size: null, ambiguous: true }
  return { size: null, ambiguous: false }
}

function findTaxRate(row: ParsedRow, snapshot: MasterDataSnapshot) {
  return snapshot.taxRates.find((t) => norm(t.name) === norm(row.taxRate)) ?? null
}

// ─── resolveRow(): bail on first error, used by resolveImport() ────────────

interface RowResolution {
  row: ParsedRow
  companyId: string
  companyLabel: string
  warehouseId: string
  warehouseLabel: string
  supplierId: string
  supplierLabel: string
  materialTypeId: string
  materialTypeCode: string
  materialSizeId: string | null
  sizeLabel: string | null
  unit: string
  taxRateId: string | null
}

function resolveRow(row: ParsedRow, snapshot: MasterDataSnapshot, errors: RowError[]): RowResolution | null {
  const before = errors.length

  if (!row.company) errors.push({ rowNumber: row.rowNumber, column: 'Company', message: 'Company is required.' })
  if (!row.warehouse) errors.push({ rowNumber: row.rowNumber, column: 'Warehouse', message: 'Warehouse is required.' })
  if (!row.supplier) errors.push({ rowNumber: row.rowNumber, column: 'Supplier', message: 'Supplier is required.' })
  if (!row.materialType) errors.push({ rowNumber: row.rowNumber, column: 'Material Type', message: 'Material Type is required.' })
  if (!row.billDateRaw) errors.push({ rowNumber: row.rowNumber, column: 'Bill Date', message: 'Bill Date is required.' })
  if (row.quantityRaw === '') errors.push({ rowNumber: row.rowNumber, column: 'Quantity', message: 'Quantity is required.' })
  else if (row.quantity !== null && row.quantity <= 0) errors.push({ rowNumber: row.rowNumber, column: 'Quantity', message: 'Quantity must be greater than 0.' })
  if (row.rateRaw === '') errors.push({ rowNumber: row.rowNumber, column: 'Rate', message: 'Rate is required.' })
  else if (row.rate !== null && row.rate < 0) errors.push({ rowNumber: row.rowNumber, column: 'Rate', message: 'Rate cannot be negative.' })
  // Unreadable-date/quantity/rate errors were already added by parseWorkbook.

  if (errors.length > before) return null // don't cascade into FK lookups on obviously incomplete rows

  const company = findCompany(row, snapshot)
  if (!company) {
    errors.push({ rowNumber: row.rowNumber, column: 'Company', message: `Unknown company "${row.company}" — check spelling against the Reference Data sheet.` })
    return null
  }

  const { warehouse } = findWarehouse(row, snapshot, company.id)
  if (!warehouse) {
    errors.push({ rowNumber: row.rowNumber, column: 'Warehouse', message: `Unknown warehouse "${row.warehouse}" for company "${company.name}".` })
    return null
  }

  const supplier = findSupplier(row, snapshot)
  if (!supplier) {
    errors.push({ rowNumber: row.rowNumber, column: 'Supplier', message: `Unknown supplier "${row.supplier}" — check spelling against the Reference Data sheet.` })
    return null
  }

  const materialType = findMaterialType(row, snapshot)
  if (!materialType) {
    errors.push({ rowNumber: row.rowNumber, column: 'Material Type', message: `Unknown material type "${row.materialType}" — check spelling against the Reference Data sheet.` })
    return null
  }

  let materialSizeId: string | null = null
  let sizeLabel: string | null = null
  if (row.size) {
    const { size } = findSize(row, snapshot, materialType.id)
    if (!size) {
      errors.push({ rowNumber: row.rowNumber, column: 'Size', message: `Unknown size "${row.size}" for material type "${materialType.description}".` })
      return null
    }
    materialSizeId = size.id
    sizeLabel = size.size_label
  }

  let taxRateId: string | null = null
  if (row.taxRate) {
    const taxRate = findTaxRate(row, snapshot)
    if (!taxRate) {
      errors.push({ rowNumber: row.rowNumber, column: 'Tax Rate', message: `Unknown tax rate "${row.taxRate}" — check spelling against the Reference Data sheet.` })
      return null
    }
    taxRateId = taxRate.id
  }

  const unit = row.unit || materialType.unit

  return {
    row,
    companyId: company.id, companyLabel: company.name,
    warehouseId: warehouse.id, warehouseLabel: warehouse.name,
    supplierId: supplier.id, supplierLabel: supplier.name,
    materialTypeId: materialType.id, materialTypeCode: materialType.code,
    materialSizeId, sizeLabel, unit, taxRateId,
  }
}

// ─── resolveRowIndependent(): collect every error on a row at once ─────────
// Used by the staging workflow (create-batch, per-field correction,
// re-validation) — a correction screen needs to show a row's Company AND
// Material Type AND Quantity problems together, not one bail-out at a time.

export interface RowResolutionResult {
  errors: RowError[]
  isValid: boolean
  resolved: {
    companyId: string | null
    companyLabel: string | null
    warehouseId: string | null
    warehouseLabel: string | null
    warehouseAmbiguous: boolean
    supplierId: string | null
    supplierLabel: string | null
    materialTypeId: string | null
    materialTypeLabel: string | null
    materialTypeCode: string | null
    materialSizeId: string | null
    sizeLabel: string | null
    sizeAmbiguous: boolean
    taxRateId: string | null
    unit: string | null
  }
}

export function resolveRowIndependent(row: ParsedRow, snapshot: MasterDataSnapshot): RowResolutionResult {
  const errors: RowError[] = []
  const resolved: RowResolutionResult['resolved'] = {
    companyId: null, companyLabel: null,
    warehouseId: null, warehouseLabel: null, warehouseAmbiguous: false,
    supplierId: null, supplierLabel: null,
    materialTypeId: null, materialTypeLabel: null, materialTypeCode: null,
    materialSizeId: null, sizeLabel: null, sizeAmbiguous: false,
    taxRateId: null, unit: null,
  }

  if (!row.company) errors.push({ rowNumber: row.rowNumber, column: 'Company', message: 'Company is required.' })
  if (!row.warehouse) errors.push({ rowNumber: row.rowNumber, column: 'Warehouse', message: 'Warehouse is required.' })
  if (!row.supplier) errors.push({ rowNumber: row.rowNumber, column: 'Supplier', message: 'Supplier is required.' })
  if (!row.materialType) errors.push({ rowNumber: row.rowNumber, column: 'Material Type', message: 'Material Type is required.' })
  if (!row.billDateRaw) errors.push({ rowNumber: row.rowNumber, column: 'Bill Date', message: 'Bill Date is required.' })
  if (row.quantityRaw === '') errors.push({ rowNumber: row.rowNumber, column: 'Quantity', message: 'Quantity is required.' })
  else if (row.quantity !== null && row.quantity <= 0) errors.push({ rowNumber: row.rowNumber, column: 'Quantity', message: 'Quantity must be greater than 0.' })
  if (row.rateRaw === '') errors.push({ rowNumber: row.rowNumber, column: 'Rate', message: 'Rate is required.' })
  else if (row.rate !== null && row.rate < 0) errors.push({ rowNumber: row.rowNumber, column: 'Rate', message: 'Rate cannot be negative.' })

  // Every FK check below runs regardless of the others' outcome — a row
  // missing Rate and having an unknown Supplier shows both problems at once.
  if (row.company) {
    const company = findCompany(row, snapshot)
    if (company) { resolved.companyId = company.id; resolved.companyLabel = company.name }
    else errors.push({ rowNumber: row.rowNumber, column: 'Company', message: `Unknown company "${row.company}" — check spelling against the Reference Data sheet.` })
  }

  if (row.warehouse) {
    const { warehouse, ambiguous } = findWarehouse(row, snapshot, resolved.companyId)
    if (warehouse) {
      resolved.warehouseId = warehouse.id
      resolved.warehouseLabel = warehouse.name
    } else if (ambiguous) {
      resolved.warehouseAmbiguous = true
      errors.push({ rowNumber: row.rowNumber, column: 'Warehouse', message: `Warehouse "${row.warehouse}" matches more than one company's warehouse — fix Company first.` })
    } else {
      errors.push({
        rowNumber: row.rowNumber, column: 'Warehouse',
        message: resolved.companyLabel ? `Unknown warehouse "${row.warehouse}" for company "${resolved.companyLabel}".` : `Unknown warehouse "${row.warehouse}".`,
      })
    }
  }

  if (row.supplier) {
    const supplier = findSupplier(row, snapshot)
    if (supplier) { resolved.supplierId = supplier.id; resolved.supplierLabel = supplier.name }
    else errors.push({ rowNumber: row.rowNumber, column: 'Supplier', message: `Unknown supplier "${row.supplier}" — check spelling against the Reference Data sheet.` })
  }

  if (row.materialType) {
    const materialType = findMaterialType(row, snapshot)
    if (materialType) {
      resolved.materialTypeId = materialType.id
      resolved.materialTypeLabel = materialType.description
      resolved.materialTypeCode = materialType.code
      resolved.unit = row.unit || materialType.unit
    } else {
      errors.push({ rowNumber: row.rowNumber, column: 'Material Type', message: `Unknown material type "${row.materialType}" — check spelling against the Reference Data sheet.` })
    }
  }

  if (row.size) {
    const { size, ambiguous } = findSize(row, snapshot, resolved.materialTypeId)
    if (size) {
      resolved.materialSizeId = size.id
      resolved.sizeLabel = size.size_label
    } else if (ambiguous) {
      resolved.sizeAmbiguous = true
      errors.push({ rowNumber: row.rowNumber, column: 'Size', message: `Size "${row.size}" matches more than one material type — fix Material Type first.` })
    } else {
      errors.push({
        rowNumber: row.rowNumber, column: 'Size',
        message: resolved.materialTypeLabel ? `Unknown size "${row.size}" for material type "${resolved.materialTypeLabel}".` : `Unknown size "${row.size}".`,
      })
    }
  }

  if (row.taxRate) {
    const taxRate = findTaxRate(row, snapshot)
    if (taxRate) resolved.taxRateId = taxRate.id
    else errors.push({ rowNumber: row.rowNumber, column: 'Tax Rate', message: `Unknown tax rate "${row.taxRate}" — check spelling against the Reference Data sheet.` })
  }

  if (!resolved.unit) resolved.unit = row.unit || null

  return { errors, isValid: errors.length === 0, resolved }
}

// ─── resolveImport(): whole-file, all-or-nothing, grouping + ID assignment ─

export function resolveImport(rows: ParsedRow[], snapshot: MasterDataSnapshot): { bills: ResolvedBill[]; errors: RowError[] } {
  const errors: RowError[] = []
  const resolutions: RowResolution[] = []
  for (const row of rows) {
    const resolution = resolveRow(row, snapshot, errors)
    if (resolution) resolutions.push(resolution)
  }

  if (errors.length > 0) return { bills: [], errors }

  // Group into bills, preserving first-appearance order.
  const groups = new Map<string, RowResolution[]>()
  const groupOrder: string[] = []
  for (const r of resolutions) {
    const key = [r.companyId, r.warehouseId, r.supplierId, r.row.billDate, norm(r.row.billRef)].join('|')
    if (!groups.has(key)) {
      groups.set(key, [])
      groupOrder.push(key)
    }
    groups.get(key)!.push(r)
  }

  // In-file duplicate-line guard: same material/size/quantity/rate more than
  // once within the same bill is almost always a copy-paste mistake.
  for (const key of groupOrder) {
    const seen = new Map<string, number>() // signature -> first rowNumber
    for (const r of groups.get(key)!) {
      const sig = [r.materialTypeId, r.materialSizeId ?? '', r.row.quantity, r.row.rate].join('|')
      const firstRow = seen.get(sig)
      if (firstRow) {
        errors.push({ rowNumber: r.row.rowNumber, message: `Duplicate line: same material/size/quantity/rate as row ${firstRow} in the same bill.` })
      } else {
        seen.set(sig, r.row.rowNumber)
      }
    }
  }
  if (errors.length > 0) return { bills: [], errors }

  const allBillNumbers = [...snapshot.existingBillNumbers]
  const allLineIds = [...snapshot.existingLineIds]
  const bills: ResolvedBill[] = []

  for (const key of groupOrder) {
    const groupRows = groups.get(key)!
    const first = groupRows[0]
    const billNumber = generatePurchaseId(allBillNumbers, first.row.billDate)
    allBillNumbers.push(billNumber)

    const lines: ResolvedLine[] = groupRows.map((r) => {
      const purchaseLineId = generatePurchaseLineId(r.materialTypeCode, getMMYY(new Date(r.row.billDate + 'T00:00:00')), allLineIds)
      allLineIds.push(purchaseLineId)

      const quantity = r.row.quantity as number
      const rate = r.row.rate as number
      const taxRate = r.taxRateId ? snapshot.taxRates.find((t) => t.id === r.taxRateId) ?? null : null

      const materialType = snapshot.materialTypes.find((m) => m.id === r.materialTypeId)!
      const itemName = r.sizeLabel ? `${materialType.description} - ${r.sizeLabel}` : materialType.description

      return {
        rowNumber: r.row.rowNumber,
        materialTypeId: r.materialTypeId,
        materialSizeId: r.materialSizeId,
        sizeLabel: r.sizeLabel,
        itemName,
        quantity, unit: r.unit, rate,
        amount: Number((quantity * rate).toFixed(2)),
        taxRateId: r.taxRateId,
        notes: r.row.lineNotes || null,
        purchaseLineId,
        tax: calculateLineTax(quantity, rate, taxRate),
      }
    })

    const billNotes = groupRows.find((r) => r.row.billNotes)?.row.billNotes || null

    bills.push({
      groupKey: key,
      companyId: first.companyId, companyLabel: first.companyLabel,
      warehouseId: first.warehouseId, warehouseLabel: first.warehouseLabel,
      supplierId: first.supplierId, supplierLabel: first.supplierLabel,
      billDate: first.row.billDate,
      billNumber,
      notes: billNotes,
      lines,
      totalQuantity: Number(lines.reduce((s, l) => s + l.quantity, 0).toFixed(3)),
      totalAmount: Number(lines.reduce((s, l) => s + l.amount, 0).toFixed(2)),
    })
  }

  return { bills, errors: [] }
}

// ─── resolveNewItems(): Item Master auto-creation for the commit step ───────
// Company/Warehouse/Supplier/Material Type/Size matching above is
// deliberately exact-only with no auto-creation (see file header) — that
// policy is about not silently inventing a record from what might be a
// typo. This is a different situation: materialTypeId/materialSizeId are
// already exact, validated matches by the time resolveImport() succeeds:
// there is no ambiguity to accidentally paper over, only a genuinely
// missing Item Master row for a real, already-confirmed material/size
// combination — the review screen has no item_master FK to correct against
// in the first place (see ParsedRow/ResolvedLine — no itemCode field).
// Without this, purchases post fine to stock_ledger by material/size, but
// stay permanently unreachable from any Item Master-driven screen (the
// Item Stock Ledger report's item picker) since nothing ever creates the
// Item.
//
// Dedupes by material_type_id + material_size_id across every line in
// every bill (many lines can share one combo) and allocates codes with the
// same per-prefix sequence algorithm as the manual "+ Add Item" form
// (generateItemCode), advancing the in-memory running list so two new
// items sharing a material type in the same file never collide.
export function resolveNewItems(bills: ResolvedBill[], snapshot: MasterDataSnapshot): NewItemMaster[] {
  const existingCodes = snapshot.itemMaster.map((i) => i.item_code)
  const existingCombos = new Set(snapshot.itemMaster.map((i) => `${i.material_type_id}|${i.material_size_id ?? ''}`))
  const seenThisImport = new Set<string>()
  const newItems: NewItemMaster[] = []

  for (const bill of bills) {
    for (const line of bill.lines) {
      const comboKey = `${line.materialTypeId}|${line.materialSizeId ?? ''}`
      if (existingCombos.has(comboKey) || seenThisImport.has(comboKey)) continue
      seenThisImport.add(comboKey)

      const materialType = snapshot.materialTypes.find((m) => m.id === line.materialTypeId)
      if (!materialType) continue // Can't happen — resolveImport() already validated this line.

      const itemCode = generateItemCode(materialType.code, existingCodes)
      existingCodes.push(itemCode) // so the next new item under the same prefix advances past it

      newItems.push({
        itemCode,
        itemName: line.itemName,
        materialTypeId: line.materialTypeId,
        materialSizeId: line.materialSizeId,
        sizeLabel: line.sizeLabel,
        unit: materialType.unit,
      })
    }
  }

  return newItems
}

// ─── findDuplicateLines(): standalone, reusable cross-row duplicate check ───
// Same signature logic resolveImport() enforces at commit time, but usable
// standalone by the "get batch" endpoint to show a non-blocking warning on
// the review screen BEFORE the user hits Import — built from each row's
// currently-resolved ids (from resolveRowIndependent()), not from the
// private RowResolution shape above, so it has no dependency on resolveRow's
// internals.
export interface DuplicateCheckEntry {
  rowNumber: number
  companyId: string
  warehouseId: string
  supplierId: string
  billDate: string
  billRef: string
  materialTypeId: string
  materialSizeId: string | null
  quantity: number
  rate: number
}

export function findDuplicateLines(entries: DuplicateCheckEntry[]): RowError[] {
  const groups = new Map<string, DuplicateCheckEntry[]>()
  for (const e of entries) {
    const key = [e.companyId, e.warehouseId, e.supplierId, e.billDate, norm(e.billRef)].join('|')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(e)
  }

  const found: RowError[] = []
  for (const groupEntries of groups.values()) {
    const seen = new Map<string, number>()
    for (const e of groupEntries) {
      const sig = [e.materialTypeId, e.materialSizeId ?? '', e.quantity, e.rate].join('|')
      const firstRow = seen.get(sig)
      if (firstRow) {
        found.push({ rowNumber: e.rowNumber, message: `Duplicate line: same material/size/quantity/rate as row ${firstRow} in the same bill.` })
      } else {
        seen.set(sig, e.rowNumber)
      }
    }
  }
  return found
}
