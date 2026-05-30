export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { hasuraQuery } from '@/lib/hasura/server'
import TaxRateForm from '../../TaxRateForm'
import type { TaxRate } from '@/types'

export default async function EditTaxRatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await hasuraQuery(`
    query GetTaxRate($id: uuid!) {
      tax_rates_by_pk(id: $id) {
        id name cgst_rate sgst_rate tds_rate tcs_rate applicable_to is_active created_at updated_at
      }
    }
  `, { id }).catch(() => ({}))
  const taxRate: TaxRate | null = (result as any)?.tax_rates_by_pk ?? null

  if (!taxRate) {
    return (
      <div className="p-6">
        <p className="text-red-600">Tax rate not found.</p>
        <Link href="/admin/tax-rates" className="text-blue-600 hover:underline text-sm mt-2 block">← Back</Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <Link href="/admin/tax-rates" className="text-sm text-blue-600 hover:underline">← Back to Tax Rates</Link>
      <h1 className="text-2xl font-bold text-gray-900">Edit Tax Rate</h1>
      <TaxRateForm existing={taxRate} />
    </div>
  )
}
