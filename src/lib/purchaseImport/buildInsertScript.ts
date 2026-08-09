// Builds the atomic multi-statement INSERT script for a commit — pulled out
// of the API route so it can be tested directly (Next.js route.ts files may
// only export HTTP method handlers, not arbitrary helpers).
import { sqlUuidOrNull, sqlDate, sqlTextOrNull } from '@/lib/dataIntegrity/sqlSafe'
import type { ResolvedBill } from './types'

export function sqlNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Non-finite number reached SQL builder: ${n}`)
  return String(n)
}

// bill ids are supplied by the caller (not left to purchase_bills' own
// uuid_generate_v4() default) specifically so the commit route never needs a
// RETURNING clause: hasuraRunSql()/Hasura's run_sql only returns the LAST
// statement's result (see src/lib/dataIntegrity/engine.ts's header comment
// for the same lesson learned there), so relying on RETURNING from earlier
// statements would silently lose data. Knowing every id up front sidesteps
// that entirely.
//
// No explicit BEGIN/COMMIT — Postgres's simple query protocol already runs
// a multi-statement string as one implicit transaction (same reasoning as
// engine.ts). If anything fails partway (e.g. a bill_number/purchase_line_id
// collision from a concurrent import — a pre-existing, shared risk with the
// manual entry form's own client-side ID generation, not new here), nothing
// commits.
export function buildInsertScript(bills: (ResolvedBill & { id: string })[]): string {
  const billRows = bills
    .map((b) => `(${sqlUuidOrNull(b.id)}, ${sqlUuidOrNull(b.companyId)}, ${sqlUuidOrNull(b.warehouseId)}, ${sqlUuidOrNull(b.supplierId)}, ${sqlTextOrNull(b.billNumber)}, ${sqlDate(b.billDate)}, ${sqlNumber(b.totalQuantity)}, ${sqlNumber(b.totalAmount)}, ${sqlTextOrNull(b.notes)}, 'active')`)
    .join(',\n    ')

  const billsSql = `
    INSERT INTO purchase_bills (id, company_id, warehouse_id, supplier_id, bill_number, bill_date, total_quantity, total_amount, notes, status)
    VALUES
    ${billRows};
  `

  const itemRows = bills
    .flatMap((b) =>
      b.lines.map((l) => `(${sqlUuidOrNull(b.id)}, ${sqlTextOrNull(l.purchaseLineId)}, ${sqlTextOrNull(l.itemName)}, ${sqlUuidOrNull(l.materialTypeId)}, ${sqlUuidOrNull(l.materialSizeId)}, ${sqlTextOrNull(l.sizeLabel)}, ${sqlNumber(l.quantity)}, ${sqlTextOrNull(l.unit)}, ${sqlNumber(l.rate)}, ${sqlNumber(l.amount)}, ${sqlTextOrNull(l.notes)}, ${sqlUuidOrNull(l.taxRateId)}, ${sqlNumber(l.tax.taxable_value)}, ${sqlNumber(l.tax.cgst_rate)}, ${sqlNumber(l.tax.cgst_amount)}, ${sqlNumber(l.tax.sgst_rate)}, ${sqlNumber(l.tax.sgst_amount)}, ${sqlNumber(l.tax.tds_rate)}, ${sqlNumber(l.tax.tds_amount)}, ${sqlNumber(l.tax.total_with_tax)})`)
    )
    .join(',\n    ')

  const itemsSql = `
    INSERT INTO purchase_bill_items (
      bill_id, purchase_line_id, item_name, material_type_id, material_size_id, size_label,
      quantity, unit, rate, amount, notes, tax_rate_id, taxable_value,
      cgst_rate, cgst_amount, sgst_rate, sgst_amount, tds_rate, tds_amount, total_with_tax
    )
    VALUES
    ${itemRows};
  `

  return `${billsSql}\n${itemsSql}`
}
