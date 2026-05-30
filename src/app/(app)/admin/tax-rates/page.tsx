export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { hasuraQuery } from '@/lib/hasura/server'
import { TAX_RATES_QUERY } from '@/lib/hasura/queries'
import type { TaxRate } from '@/types'

export default async function TaxRatesPage() {
  const result = await hasuraQuery(TAX_RATES_QUERY).catch(() => ({ tax_rates: [] }))
  const taxRates: TaxRate[] = (result as any).tax_rates ?? []

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
          <Link href="/admin" className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
            ← Admin
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

      <div className="rounded-xl border bg-white overflow-hidden">
        {taxRates.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-400 text-4xl mb-3">🧾</p>
            <p className="text-gray-500">No tax rates configured yet.</p>
            <Link href="/admin/tax-rates/new" className="mt-4 inline-block text-blue-600 hover:underline text-sm">
              Add your first tax rate →
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase text-right">CGST %</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase text-right">SGST %</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase text-right">GST Total %</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase text-right">TDS %</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase text-right">TCS %</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Applies To</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {taxRates.map((tr) => (
                  <tr key={tr.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{tr.name}</td>
                    <td className="px-5 py-3 text-right text-gray-700">{Number(tr.cgst_rate).toFixed(2)}%</td>
                    <td className="px-5 py-3 text-right text-gray-700">{Number(tr.sgst_rate).toFixed(2)}%</td>
                    <td className="px-5 py-3 text-right font-semibold text-gray-900">
                      {(Number(tr.cgst_rate) + Number(tr.sgst_rate)).toFixed(2)}%
                    </td>
                    <td className="px-5 py-3 text-right text-gray-700">
                      {Number(tr.tds_rate) > 0 ? `${Number(tr.tds_rate).toFixed(2)}%` : '—'}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-700">
                      {Number(tr.tcs_rate) > 0 ? `${Number(tr.tcs_rate).toFixed(2)}%` : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        tr.applicable_to === 'PURCHASE' ? 'bg-orange-50 text-orange-700' :
                        tr.applicable_to === 'SALES' ? 'bg-green-50 text-green-700' :
                        'bg-blue-50 text-blue-700'
                      }`}>
                        {tr.applicable_to === 'BOTH' ? 'Purchase & Sales' : tr.applicable_to}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        tr.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                      }`}>
                        {tr.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/tax-rates/${tr.id}/edit`}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
