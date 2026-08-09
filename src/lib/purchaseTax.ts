// Purchase line tax math — shared by the manual entry form
// (src/app/(app)/bills/new/page.tsx) and the bulk Excel import
// (src/lib/purchaseImport/) so both compute cgst/sgst/tds identically.
//
// CGST/SGST apply to the taxable value (quantity * rate); TDS applies to
// (taxable + CGST + SGST), matching supabase/migrations/014_tax_rates.sql's
// documented convention.

export interface TaxRateInput {
  cgst_rate: number | string
  sgst_rate: number | string
  tds_rate: number | string
}

export interface TaxBreakdown {
  taxable_value: number
  cgst_rate: number
  cgst_amount: number
  sgst_rate: number
  sgst_amount: number
  tds_rate: number
  tds_amount: number
  total_with_tax: number
}

export function calculateLineTax(quantity: number, rate: number, taxRate: TaxRateInput | null | undefined): TaxBreakdown {
  const taxable = (quantity || 0) * (rate || 0)
  if (!taxRate) {
    return { taxable_value: taxable, cgst_rate: 0, cgst_amount: 0, sgst_rate: 0, sgst_amount: 0, tds_rate: 0, tds_amount: 0, total_with_tax: taxable }
  }
  const cgstRate = Number(taxRate.cgst_rate)
  const sgstRate = Number(taxRate.sgst_rate)
  const tdsRate = Number(taxRate.tds_rate)
  const cgst = (taxable * cgstRate) / 100
  const sgst = (taxable * sgstRate) / 100
  const tdsBase = taxable + cgst + sgst
  const tds = (tdsBase * tdsRate) / 100
  return {
    taxable_value: taxable,
    cgst_rate: cgstRate, cgst_amount: cgst,
    sgst_rate: sgstRate, sgst_amount: sgst,
    tds_rate: tdsRate, tds_amount: tds,
    total_with_tax: taxable + cgst + sgst - tds,
  }
}
