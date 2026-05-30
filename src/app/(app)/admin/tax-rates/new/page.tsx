import Link from 'next/link'
import TaxRateForm from '../TaxRateForm'

export default function NewTaxRatePage() {
  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <Link href="/admin/tax-rates" className="text-sm text-blue-600 hover:underline">← Back to Tax Rates</Link>
      <h1 className="text-2xl font-bold text-gray-900">Add Tax Rate</h1>
      <TaxRateForm />
    </div>
  )
}
