// Resolves parsed rows against current master data (exact match only, case-
// insensitive + trimmed — no fuzzy matching, no auto-creating new master
// records, per the explicit product decision), groups rows into bills, and
// assigns bill_number/purchase_line_id using the exact same generators the
// manual entry form uses (src/lib/purchaseIds.ts) so IDs can never collide
// between manual and imported bills.
//
// All-or-nothing: if ANY row in the file has an error, `bills` comes back
// empty — nothing is partially resolved, so there's no risk of the preview
// showing (or the commit route inserting) half of a broken file. This is
// the same contract at the resolve layer as at the commit layer.
import { calculateLineTax } from '@/lib/purchaseTax'
import { generatePurchaseId, generatePurchaseLineId, getMMYY } from '@/lib/purchaseIds'
import type { MasterDataSnapshot, ParsedRow, ResolvedBill, ResolvedLine, RowError } from './types'

function norm(s: string): string {
  return s.trim().toLowerCase()
}

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

  const company = snapshot.companies.find((c) => norm(c.name) === norm(row.company) || norm(c.code) === norm(row.company))
  if (!company) {
    errors.push({ rowNumber: row.rowNumber, column: 'Company', message: `Unknown company "${row.company}" — check spelling against the Reference Data sheet.` })
    return null
  }

  const warehouse = snapshot.warehouses.find((w) => w.company_id === company.id && norm(w.name) === norm(row.warehouse))
  if (!warehouse) {
    errors.push({ rowNumber: row.rowNumber, column: 'Warehouse', message: `Unknown warehouse "${row.warehouse}" for company "${company.name}".` })
    return null
  }

  const supplier = snapshot.suppliers.find((s) => norm(s.name) === norm(row.supplier))
  if (!supplier) {
    errors.push({ rowNumber: row.rowNumber, column: 'Supplier', message: `Unknown supplier "${row.supplier}" — check spelling against the Reference Data sheet.` })
    return null
  }

  const materialType = snapshot.materialTypes.find((m) => norm(m.code) === norm(row.materialType) || norm(m.description) === norm(row.materialType))
  if (!materialType) {
    errors.push({ rowNumber: row.rowNumber, column: 'Material Type', message: `Unknown material type "${row.materialType}" — check spelling against the Reference Data sheet.` })
    return null
  }

  let materialSizeId: string | null = null
  let sizeLabel: string | null = null
  if (row.size) {
    const size = snapshot.materialSizes.find((s) => s.material_type_id === materialType.id && norm(s.size_label) === norm(row.size))
    if (!size) {
      errors.push({ rowNumber: row.rowNumber, column: 'Size', message: `Unknown size "${row.size}" for material type "${materialType.description}".` })
      return null
    }
    materialSizeId = size.id
    sizeLabel = size.size_label
  }

  let taxRateId: string | null = null
  if (row.taxRate) {
    const taxRate = snapshot.taxRates.find((t) => norm(t.name) === norm(row.taxRate))
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
