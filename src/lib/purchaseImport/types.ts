// Shared types for the bulk purchase (Bill) Excel import
// (src/app/(app)/bills/import, src/app/api/bills/import/**).

import type { TaxBreakdown } from '@/lib/purchaseTax'

export const COLUMNS = [
  'Company', 'Warehouse', 'Supplier', 'Bill Date', 'Bill Ref',
  'Material Type', 'Size', 'Quantity', 'Unit', 'Rate', 'Tax Rate',
  'Line Notes', 'Bill Notes',
] as const
export type ColumnName = (typeof COLUMNS)[number]

// Columns that must be present (as a header) and non-blank on every data row.
export const REQUIRED_COLUMNS: ColumnName[] = ['Company', 'Warehouse', 'Supplier', 'Bill Date', 'Material Type', 'Quantity', 'Rate']

// A file-level error (rowNumber null — e.g. a missing required column or an
// unreadable workbook) or a row-level error (rowNumber = the 1-based
// spreadsheet row, matching what the user sees in Excel).
export interface RowError {
  rowNumber: number | null
  column?: ColumnName
  message: string
}

// One data row after parsing/normalization, before FK resolution.
// `*Raw` fields preserve the original text for error messages when a value
// couldn't be normalized.
export interface ParsedRow {
  rowNumber: number
  company: string
  warehouse: string
  supplier: string
  billDate: string // normalized YYYY-MM-DD, or '' if unparseable
  billDateRaw: string
  billRef: string
  materialType: string
  size: string
  quantity: number | null
  quantityRaw: string
  unit: string
  rate: number | null
  rateRaw: string
  taxRate: string
  lineNotes: string
  billNotes: string
}

// One resolved, ID-assigned line ready to insert.
export interface ResolvedLine {
  rowNumber: number
  materialTypeId: string
  materialSizeId: string | null
  sizeLabel: string | null
  // No item_master resolution in this pass (kept optional in the schema) —
  // this is a display default, e.g. "CR Coil - 1.40x1080", so imported
  // lines don't show blank where the manual form always has a name.
  itemName: string
  quantity: number
  unit: string
  rate: number
  amount: number
  taxRateId: string | null
  notes: string | null
  purchaseLineId: string
  tax: TaxBreakdown
}

// One resolved, ID-assigned bill (a group of lines) ready to insert.
export interface ResolvedBill {
  groupKey: string
  companyId: string
  warehouseId: string
  supplierId: string
  billDate: string
  billNumber: string
  notes: string | null
  lines: ResolvedLine[]
  totalQuantity: number
  totalAmount: number
  // Human-readable labels, for the preview/results screens.
  companyLabel: string
  warehouseLabel: string
  supplierLabel: string
}

export interface MasterDataSnapshot {
  companies: { id: string; name: string; code: string }[]
  warehouses: { id: string; name: string; company_id: string }[]
  suppliers: { id: string; name: string }[]
  materialTypes: { id: string; code: string; description: string; unit: string }[]
  materialSizes: { id: string; material_type_id: string; size_label: string }[]
  taxRates: { id: string; name: string; cgst_rate: number; sgst_rate: number; tds_rate: number }[]
  existingBillNumbers: string[]
  existingLineIds: string[]
  // Every active Item Master row's identity, so the commit step can tell
  // which purchased material/size combos have no Item yet and allocate new
  // codes for them (see resolveNewItems() in resolve.ts).
  itemMaster: { id: string; item_code: string; material_type_id: string; material_size_id: string | null }[]
}

// One Item Master row the import needs to create because a purchased
// material/size combo had no existing Item — see resolveNewItems().
export interface NewItemMaster {
  itemCode: string
  itemName: string
  materialTypeId: string
  materialSizeId: string | null
  sizeLabel: string | null
  unit: string
}
