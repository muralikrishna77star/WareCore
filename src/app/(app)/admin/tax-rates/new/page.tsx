import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import TaxRateForm from '../TaxRateForm'

export default function NewTaxRatePage() {
  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <Link href="/admin/tax-rates" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"><ArrowLeft className="h-4 w-4" /> Back to Tax Rates</Link>
      <h1 className="text-2xl font-bold text-gray-900">Add Tax Rate</h1>
      <TaxRateForm />
    </div>
  )
}
