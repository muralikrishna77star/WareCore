'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import { CREATE_TAX_RATE_MUTATION, UPDATE_TAX_RATE_MUTATION } from '@/lib/hasura/queries'
import type { TaxRate } from '@/types'

interface Props {
  existing?: TaxRate
}

export default function TaxRateForm({ existing }: Props) {
  const router = useRouter()
  const [name, setName] = useState(existing?.name ?? '')
  const [cgstRate, setCgstRate] = useState(String(existing?.cgst_rate ?? '9'))
  const [sgstRate, setSgstRate] = useState(String(existing?.sgst_rate ?? '9'))
  const [tdsRate, setTdsRate] = useState(String(existing?.tds_rate ?? '0'))
  const [tcsRate, setTcsRate] = useState(String(existing?.tcs_rate ?? '0'))
  const [applicableTo, setApplicableTo] = useState<'BOTH' | 'PURCHASE' | 'SALES'>(existing?.applicable_to ?? 'BOTH')
  const [isActive, setIsActive] = useState(existing?.is_active ?? true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const cgst = parseFloat(cgstRate) || 0
  const sgst = parseFloat(sgstRate) || 0
  const tds  = parseFloat(tdsRate)  || 0
  const tcs  = parseFloat(tcsRate)  || 0

  // Live preview
  const sampleValue = 10000
  const cgstAmt = (sampleValue * cgst) / 100
  const sgstAmt = (sampleValue * sgst) / 100
  const tdsBase = sampleValue + cgstAmt + sgstAmt
  const tdsAmt  = (tdsBase * tds) / 100
  const tcsAmt  = (tdsBase * tcs) / 100

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required.'); return }
    setLoading(true); setError('')
    const vars = {
      name: name.trim(), cgst_rate: cgst, sgst_rate: sgst,
      tds_rate: tds, tcs_rate: tcs, applicable_to: applicableTo,
      ...(existing ? { id: existing.id, is_active: isActive } : {}),
    }
    const mutation = existing ? UPDATE_TAX_RATE_MUTATION : CREATE_TAX_RATE_MUTATION
    const { error: err } = await hasuraFetch(mutation, vars)
    setLoading(false)
    if (err) { setError(err.message); return }
    router.push('/admin/tax-rates')
    router.refresh()
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none'
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1'

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white rounded-xl border border-gray-200 p-6">
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

      <div>
        <label className={labelCls}>Tax Rate Name *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls}
          placeholder="e.g. GST 18%, GST 18% + TDS 2%" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>CGST % *</label>
          <input type="number" step="0.01" min="0" max="50" value={cgstRate}
            onChange={(e) => setCgstRate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>SGST % *</label>
          <input type="number" step="0.01" min="0" max="50" value={sgstRate}
            onChange={(e) => setSgstRate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>TDS % <span className="text-gray-400 font-normal">(on taxable+GST, for purchases)</span></label>
          <input type="number" step="0.01" min="0" max="100" value={tdsRate}
            onChange={(e) => setTdsRate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>TCS % <span className="text-gray-400 font-normal">(on taxable+GST, for sales)</span></label>
          <input type="number" step="0.01" min="0" max="100" value={tcsRate}
            onChange={(e) => setTcsRate(e.target.value)} className={inputCls} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Applicable To</label>
          <select value={applicableTo} onChange={(e) => setApplicableTo(e.target.value as any)} className={inputCls}>
            <option value="BOTH">Purchase & Sales</option>
            <option value="PURCHASE">Purchase Only</option>
            <option value="SALES">Sales Only</option>
          </select>
        </div>
        {existing && (
          <div>
            <label className={labelCls}>Status</label>
            <select value={isActive ? 'active' : 'inactive'} onChange={(e) => setIsActive(e.target.value === 'active')} className={inputCls}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        )}
      </div>

      {/* Live Preview */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Live Preview — Sample Value ₹{sampleValue.toLocaleString('en-IN')}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex justify-between"><span className="text-gray-600">Taxable Value</span><span className="font-medium">₹{sampleValue.toLocaleString('en-IN')}</span></div>
          <div className="flex justify-between"><span className="text-gray-600">CGST ({cgst}%)</span><span className="font-medium text-orange-700">+ ₹{cgstAmt.toLocaleString('en-IN', {minimumFractionDigits:2})}</span></div>
          <div className="flex justify-between"><span className="text-gray-600">SGST ({sgst}%)</span><span className="font-medium text-orange-700">+ ₹{sgstAmt.toLocaleString('en-IN', {minimumFractionDigits:2})}</span></div>
          {tds > 0 && <div className="flex justify-between"><span className="text-gray-600">TDS ({tds}% on ₹{tdsBase.toLocaleString('en-IN')})</span><span className="font-medium text-red-700">− ₹{tdsAmt.toLocaleString('en-IN', {minimumFractionDigits:2})}</span></div>}
          {tcs > 0 && <div className="flex justify-between"><span className="text-gray-600">TCS ({tcs}% on ₹{tdsBase.toLocaleString('en-IN')})</span><span className="font-medium text-blue-700">+ ₹{tcsAmt.toLocaleString('en-IN', {minimumFractionDigits:2})}</span></div>}
          <div className="flex justify-between border-t pt-2 sm:col-span-2">
            <span className="font-semibold text-gray-800">Net {tds > 0 ? 'Payable (after TDS)' : tcs > 0 ? 'Receivable (incl. TCS)' : 'Total with GST'}</span>
            <span className="font-bold text-gray-900">
              ₹{(sampleValue + cgstAmt + sgstAmt - tdsAmt + tcsAmt).toLocaleString('en-IN', {minimumFractionDigits:2})}
            </span>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button type="submit" disabled={loading}
          className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Saving…' : existing ? 'Update Tax Rate' : 'Create Tax Rate'}
        </button>
        <button type="button" onClick={() => router.push('/admin/tax-rates')}
          className="rounded-lg border border-gray-300 px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  )
}
