export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { hasuraQuery } from '@/lib/hasura/server'
import { TAX_RATES_QUERY } from '@/lib/hasura/queries'
import type { TaxRate } from '@/types'
import TaxRatesTable from './TaxRatesTable'

export default async function TaxRatesPage() {
  const result = await hasuraQuery(TAX_RATES_QUERY).catch(() => ({ tax_rates: [] }))
  const taxRates: TaxRate[] = (result as { tax_rates?: TaxRate[] }).tax_rates ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tax Rate Control</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage CGST, SGST, TDS and TCS percentages applied on purchase and sales values.
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/admin" className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
            <ArrowLeft className="h-4 w-4" /> Admin
          </Link>
          <Link
            href="/admin/tax-rates/new"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Add Tax Rate
          </Link>
        </div>
      </div>

      {/* Formula explanation */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 space-y-1">
        <p className="font-semibold">Tax Calculation Rules</p>
        <p>• <strong>CGST + SGST</strong> are applied on the base taxable value (qty × rate)</p>
        <p>• <strong>TDS</strong> (Purchase) = (Taxable Value + CGST + SGST) × TDS%  — deducted from payable</p>
        <p>• <strong>TCS</strong> (Sales) = (Taxable Value + CGST + SGST) × TCS%  — added to receivable</p>
      </div>

      <TaxRatesTable taxRates={taxRates} />
    </div>
  )
}
