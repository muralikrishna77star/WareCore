// Builds the .xlsx template used by /bills/import — a "Purchases" input
// sheet plus a "Reference Data" sheet listing the CURRENT exact
// Company/Warehouse/Supplier/Material Type/Size/Tax Rate names, fetched
// live from the DB (not hardcoded). Exact-match-only resolution
// (src/lib/purchaseImport/resolve.ts) makes this reference sheet
// load-bearing, not a nice-to-have — spelling has to match exactly.
//
// Extracted out of the API route so a test can assert this template is
// actually readable by parseWorkbook() — the header row previously broke
// this silently (required-column headers get a " *" suffix here, and
// parseWorkbook's header matcher didn't strip it, so every column in a
// file built from our OWN template came back "missing"; see
// tests/purchaseImport/buildTemplateWorkbook.test.ts).
import ExcelJS from 'exceljs'
import { COLUMNS, REQUIRED_COLUMNS } from './types'
import type { MasterDataSnapshot } from './types'

export function buildTemplateWorkbook(snapshot: MasterDataSnapshot): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()

  const purchases = workbook.addWorksheet('Purchases')
  purchases.columns = COLUMNS.map((c) => ({
    header: REQUIRED_COLUMNS.includes(c) ? `${c} *` : c,
    key: c,
    width: Math.max(c.length + 4, 16),
  }))
  purchases.getRow(1).font = { bold: true }
  purchases.addRow({
    'Company': snapshot.companies[0]?.name ?? 'ABC Steel Pvt Ltd',
    'Warehouse': snapshot.warehouses[0]?.name ?? 'Main Warehouse',
    'Supplier': snapshot.suppliers[0]?.name ?? 'XYZ Traders',
    'Bill Date': '2024-04-15',
    'Bill Ref': '',
    'Material Type': snapshot.materialTypes[0]?.code ?? 'CR',
    'Size': snapshot.materialSizes[0]?.size_label ?? '',
    'Quantity': 10.5,
    'Unit': snapshot.materialTypes[0]?.unit ?? 'tons',
    'Rate': 55000,
    'Tax Rate': snapshot.taxRates[0]?.name ?? '',
    'Line Notes': '',
    'Bill Notes': '',
  })
  purchases.getRow(2).font = { italic: true, color: { argb: 'FF888888' } }

  const ref = workbook.addWorksheet('Reference Data')
  ref.columns = [
    { header: 'Companies (name or code)', key: 'company', width: 30 },
    { header: 'Warehouses (name)', key: 'warehouse', width: 30 },
    { header: 'Suppliers (name)', key: 'supplier', width: 30 },
    { header: 'Material Types (name or code)', key: 'materialType', width: 34 },
    { header: 'Sizes (size label)', key: 'size', width: 24 },
    { header: 'Tax Rates (name)', key: 'taxRate', width: 24 },
    { header: 'Accepted Units', key: 'unit', width: 18 },
  ]
  ref.getRow(1).font = { bold: true }
  const rowCount = Math.max(
    snapshot.companies.length, snapshot.warehouses.length, snapshot.suppliers.length,
    snapshot.materialTypes.length, snapshot.materialSizes.length, snapshot.taxRates.length, 11
  )
  const units = ['kg', 'kgs', 'g', 'gram', 'grams', 'mt', 'ton', 'tons', 'tonne', 'tonnes']
  for (let i = 0; i < rowCount; i++) {
    ref.addRow({
      company: snapshot.companies[i] ? `${snapshot.companies[i].name} (${snapshot.companies[i].code})` : '',
      warehouse: snapshot.warehouses[i]?.name ?? '',
      supplier: snapshot.suppliers[i]?.name ?? '',
      materialType: snapshot.materialTypes[i] ? `${snapshot.materialTypes[i].description} (${snapshot.materialTypes[i].code})` : '',
      size: snapshot.materialSizes[i]?.size_label ?? '',
      taxRate: snapshot.taxRates[i]?.name ?? '',
      unit: units[i] ?? '',
    })
  }

  return workbook
}
