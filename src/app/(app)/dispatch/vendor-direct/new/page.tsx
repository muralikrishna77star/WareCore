'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import {
  ACTIVE_JOB_WORK_ORDERS_PENDING_QUERY,
  ACTIVE_CUSTOMERS_QUERY,
  ACTIVE_SALES_TAX_RATES_QUERY,
  CREATE_DISPATCH_ORDER_MUTATION,
  CREATE_DISPATCH_ITEMS_MUTATION,
  ALL_INVOICE_NUMBERS_QUERY,
  ALL_SALE_LINE_IDS_QUERY,
} from '@/lib/hasura/queries'

function getMMYY(date = new Date()) {
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yy = String(date.getFullYear()).slice(-2)
  return `${mm}${yy}`
}
function nextSeq(ids: string[], pattern: RegExp) {
  return ids.reduce((max, id) => {
    const m = id?.match(pattern)
    return m ? Math.max(max, parseInt(m[1], 10)) : max
  }, 0)
}
function generateSaleId(existing: string[]) {
  return `${getMMYY()}-${String(nextSeq(existing, /^\d{4}-(\d+)$/) + 1).padStart(4, '0')}`
}
function generateSaleLineId(typeCode: string, all: string[]) {
  const prefix = typeCode.slice(0, 2).toUpperCase()
  return `${prefix}${getMMYY()}-${String(nextSeq(all, /^[A-Z]{2}\d{4}-(\d+)$/) + 1).padStart(4, '0')}`
}
function calcTax(qty: number, rate: number, tr: any) {
  const taxable = qty * rate
  if (!tr) return { taxable_value: taxable, cgst_rate: 0, cgst_amount: 0, sgst_rate: 0, sgst_amount: 0, tcs_rate: 0, tcs_amount: 0, total_with_tax: taxable }
  const cgst = (taxable * Number(tr.cgst_rate)) / 100
  const sgst = (taxable * Number(tr.sgst_rate)) / 100
  const tcs = ((taxable + cgst + sgst) * Number(tr.tcs_rate)) / 100
  return {
    taxable_value: taxable,
    cgst_rate: Number(tr.cgst_rate), cgst_amount: cgst,
    sgst_rate: Number(tr.sgst_rate), sgst_amount: sgst,
    tcs_rate: Number(tr.tcs_rate), tcs_amount: tcs,
    total_with_tax: taxable + cgst + sgst + tcs,
  }
}

type SaleLine = {
  jwItemId: string
  itemName: string
  purchaseLineId: string
  materialTypeId: string
  materialSizeId: string | null
  sizeLabel: string
  unit: string
  typeCode: string
  pendingQty: number
  quantity: string
  rate: string
  taxRateId: string
  saleLineId: string
}

export default function VendorDirectSaleNewPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-400 text-sm">Loading…</div>}>
      <VendorDirectSaleForm />
    </Suspense>
  )
}

function VendorDirectSaleForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedJwId = searchParams.get('jw')

  const [jwOrders, setJwOrders] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [taxRates, setTaxRates] = useState<any[]>([])
  const [existingInvoiceNumbers, setExistingInvoiceNumbers] = useState<string[]>([])
  const [existingLineIds, setExistingLineIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [selectedJwId, setSelectedJwId] = useState(preselectedJwId ?? '')
  const [customerId, setCustomerId] = useState('')
  const [saleId, setSaleId] = useState('')
  const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0])
  const [vehicleNumber, setVehicleNumber] = useState('')
  const [driverName, setDriverName] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<SaleLine[]>([])

  useEffect(() => {
    Promise.all([
      hasuraFetch(ACTIVE_JOB_WORK_ORDERS_PENDING_QUERY),
      hasuraFetch(ACTIVE_CUSTOMERS_QUERY),
      hasuraFetch(ACTIVE_SALES_TAX_RATES_QUERY),
      hasuraFetch(ALL_INVOICE_NUMBERS_QUERY),
      hasuraFetch(ALL_SALE_LINE_IDS_QUERY),
    ]).then(([jwoRes, cuRes, trRes, invRes, sliRes]) => {
      setJwOrders((jwoRes.data as any)?.job_work_orders ?? [])
      setCustomers((cuRes.data as any)?.customers ?? [])
      setTaxRates((trRes.data as any)?.tax_rates ?? [])
      const invNums: string[] = ((invRes.data as any)?.dispatch_orders ?? []).map((o: any) => o.invoice_number).filter(Boolean)
      const lineIds: string[] = ((sliRes.data as any)?.dispatch_items ?? []).map((i: any) => i.sale_line_id).filter(Boolean)
      setExistingInvoiceNumbers(invNums)
      setExistingLineIds(lineIds)
      setSaleId(generateSaleId(invNums))
      setLoading(false)
    })
  }, [])

  // When JW order is selected, build lines from pending items
  useEffect(() => {
    if (!selectedJwId) { setLines([]); return }
    const jwo = jwOrders.find((o: any) => o.id === selectedJwId)
    if (!jwo) { setLines([]); return }

    const usedLineIds: string[] = [...existingLineIds]
    const newLines: SaleLine[] = []

    for (const item of jwo.job_work_items ?? []) {
      const pending = Number(item.quantity_sent) - Number(item.quantity_received ?? 0)
      if (pending <= 0) continue
      const typeCode = item.material_types?.code ?? ''
      const saleLineId = generateSaleLineId(typeCode, [...usedLineIds])
      usedLineIds.push(saleLineId)
      newLines.push({
        jwItemId: item.id,
        itemName: item.item_name ?? item.material_types?.description ?? '',
        purchaseLineId: item.purchase_line_id ?? '',
        materialTypeId: item.material_type_id,
        materialSizeId: item.material_size_id ?? null,
        sizeLabel: item.size_label ?? item.material_sizes?.size_label ?? '',
        unit: item.unit ?? item.material_types?.unit ?? 'MT',
        typeCode,
        pendingQty: pending,
        quantity: pending.toFixed(3),
        rate: '',
        taxRateId: '',
        saleLineId,
      })
    }
    setLines(newLines)
  }, [selectedJwId, jwOrders, existingLineIds])

  const selectedJwo = jwOrders.find((o: any) => o.id === selectedJwId)

  function updateLine(i: number, field: keyof SaleLine, value: string) {
    setLines(prev => {
      const updated = [...prev]
      updated[i] = { ...updated[i], [field]: value }
      return updated
    })
  }

  const totalQty = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0)
  const totalAmt = lines.reduce((s, l) => {
    const tr = taxRates.find(t => t.id === l.taxRateId)
    const t = calcTax(parseFloat(l.quantity) || 0, parseFloat(l.rate) || 0, tr)
    return s + t.total_with_tax
  }, 0)

  async function handleSave(status: 'active' | 'draft') {
    if (!selectedJwId) { setError('Select a job work order.'); return }
    if (!customerId) { setError('Select a customer.'); return }
    const validLines = lines.filter(l => l.quantity && parseFloat(l.quantity) > 0)
    if (!validLines.length) { setError('No items to sell.'); return }

    setSaving(true); setError('')

    const freshInvRes = await hasuraFetch(ALL_INVOICE_NUMBERS_QUERY)
    const freshInvNums: string[] = ((freshInvRes.data as any)?.dispatch_orders ?? []).map((o: any) => o.invoice_number).filter(Boolean)
    let invoiceToUse = saleId.trim()
    if (freshInvNums.includes(invoiceToUse)) {
      const newId = generateSaleId(freshInvNums)
      setSaleId(newId); setExistingInvoiceNumbers(freshInvNums)
      setError(`Sale ID "${invoiceToUse}" already taken — assigned "${newId}". Review and save again.`)
      setSaving(false); return
    }

    const { data: orderData, error: oErr } = await hasuraFetch<any>(CREATE_DISPATCH_ORDER_MUTATION, {
      company_id: selectedJwo?.company_id ?? null,
      warehouse_id: selectedJwo?.warehouse_id ?? null,
      customer_id: customerId,
      invoice_number: invoiceToUse,
      dispatch_date: saleDate,
      vehicle_number: vehicleNumber || null,
      driver_name: driverName || null,
      total_quantity: totalQty,
      total_amount: totalAmt || null,
      notes: notes || null,
      status,
      sale_ref_id: null,
      is_vendor_direct: true,
      source_job_work_order_id: selectedJwId,
    })
    const order = orderData?.insert_dispatch_orders_one
    if (oErr || !order) { setError(oErr?.message ?? 'Failed to create order'); setSaving(false); return }

    const objects = validLines.map(l => {
      const tr = taxRates.find(t => t.id === l.taxRateId)
      const tax = calcTax(parseFloat(l.quantity), parseFloat(l.rate) || 0, tr || null)
      return {
        dispatch_order_id: order.id,
        source_job_work_item_id: l.jwItemId,
        item_name: l.itemName || null,
        purchase_line_id: l.purchaseLineId || null,
        material_type_id: l.materialTypeId || null,
        material_size_id: l.materialSizeId || null,
        size_label: l.sizeLabel || null,
        quantity: parseFloat(l.quantity),
        unit: l.unit,
        rate: l.rate ? parseFloat(l.rate) : null,
        amount: (parseFloat(l.quantity) * (parseFloat(l.rate) || 0)) || null,
        sale_line_id: l.saleLineId || null,
        tax_rate_id: l.taxRateId || null,
        taxable_value: tax.taxable_value || null,
        cgst_rate: tax.cgst_rate || null,
        cgst_amount: tax.cgst_amount || null,
        sgst_rate: tax.sgst_rate || null,
        sgst_amount: tax.sgst_amount || null,
        tcs_rate: tax.tcs_rate || null,
        tcs_amount: tax.tcs_amount || null,
        total_with_tax: tax.total_with_tax || null,
      }
    })

    const { error: iErr } = await hasuraFetch(CREATE_DISPATCH_ITEMS_MUTATION, { objects })
    if (iErr) { setError(iErr.message); setSaving(false); return }

    router.push('/dispatch')
    router.refresh()
  }

  const fieldCls = 'block w-full rounded border border-gray-300 px-2 py-2 text-sm focus:border-blue-500 focus:outline-none'

  return (
    <div className="max-w-5xl mx-auto">
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-amber-50 border-b border-amber-200">
          <div>
            <h1 className="text-base font-semibold text-gray-900">Vendor Direct Sale</h1>
            <p className="text-xs text-amber-700 mt-0.5">Selling from vendor — no warehouse return needed</p>
          </div>
          <div className="flex gap-2">
            <Link href="/dispatch" className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100">
              Cancel
            </Link>
            <button type="button" onClick={() => handleSave('draft')} disabled={saving}
              className="rounded border border-amber-400 bg-amber-50 px-4 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50">
              Save Draft
            </button>
            <button type="button" onClick={() => handleSave('active')} disabled={saving}
              className="rounded bg-blue-600 px-5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Confirm Sale'}
            </button>
          </div>
        </div>

        {/* Order header */}
        <div className="px-4 py-3 border-b border-gray-200">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
            <div className="col-span-2 sm:col-span-1 lg:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">Job Work Order *</label>
              <select value={selectedJwId} onChange={e => setSelectedJwId(e.target.value)} className={fieldCls} disabled={loading}>
                <option value="">{loading ? 'Loading…' : '— Select order —'}</option>
                {jwOrders.map((o: any) => (
                  <option key={o.id} value={o.id}>
                    {o.reference_number} · {o.suppliers?.name} ({o.status})
                  </option>
                ))}
              </select>
              {selectedJwo && (
                <p className="text-[10px] text-blue-600 mt-0.5">
                  {selectedJwo.companies?.name} · {selectedJwo.warehouses?.name}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Customer *</label>
              <select value={customerId} onChange={e => setCustomerId(e.target.value)} className={fieldCls}>
                <option value="">— Select —</option>
                {customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Sale ID</label>
              <div className="flex gap-1">
                <input value={saleId} onChange={e => setSaleId(e.target.value)}
                  className="block flex-1 min-w-0 rounded border border-gray-300 px-2 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none" />
                <button type="button" onClick={() => setSaleId(generateSaleId(existingInvoiceNumbers))}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">↻</button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Sale Date</label>
              <input type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Vehicle / Notes</label>
              <input value={vehicleNumber} onChange={e => setVehicleNumber(e.target.value)} placeholder="Vehicle no." className={fieldCls} />
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="flex items-center justify-between px-4 py-2 bg-amber-50 border-b border-amber-100">
          <span className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Items at Vendor</span>
          {selectedJwo && lines.length === 0 && (
            <span className="text-xs text-amber-600">No pending items at this vendor</span>
          )}
        </div>

        {lines.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-left">
                  <th className="px-4 py-2 text-xs font-medium text-gray-500">Item</th>
                  <th className="px-4 py-2 text-xs font-medium text-gray-500">Purchase Line</th>
                  <th className="px-4 py-2 text-xs font-medium text-gray-500">Size</th>
                  <th className="px-4 py-2 text-xs font-medium text-gray-500">Pending at Vendor</th>
                  <th className="px-4 py-2 text-xs font-medium text-gray-500">Qty to Sell</th>
                  <th className="px-4 py-2 text-xs font-medium text-gray-500">Rate (₹)</th>
                  <th className="px-4 py-2 text-xs font-medium text-gray-500">Tax Rate</th>
                  <th className="px-4 py-2 text-xs font-medium text-gray-500 text-right">Total (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((line, i) => {
                  const tr = taxRates.find(t => t.id === line.taxRateId)
                  const tax = calcTax(parseFloat(line.quantity) || 0, parseFloat(line.rate) || 0, tr || null)
                  const qty = parseFloat(line.quantity) || 0
                  const overQty = qty > line.pendingQty
                  return (
                    <tr key={line.jwItemId} className="hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <span className="font-medium text-gray-900">{line.itemName || '—'}</span>
                        {line.saleLineId && (
                          <span className="block text-[10px] font-mono text-green-700 bg-green-50 border border-green-200 rounded px-1 mt-0.5 inline-block">{line.saleLineId}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-blue-700">{line.purchaseLineId || '—'}</td>
                      <td className="px-4 py-2 text-xs text-gray-600">{line.sizeLabel || '—'}</td>
                      <td className="px-4 py-2">
                        <span className="text-sm font-semibold text-gray-700">
                          {line.pendingQty.toFixed(3)} {line.unit}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <input type="number" value={line.quantity}
                          onChange={e => updateLine(i, 'quantity', e.target.value)}
                          step="0.001" min="0.001" max={line.pendingQty}
                          className={`block w-28 rounded border px-2 py-1.5 text-sm focus:outline-none ${overQty ? 'border-red-400 bg-red-50' : 'border-gray-300 focus:border-blue-500'}`} />
                        {overQty && <p className="text-[10px] text-red-600 mt-0.5">Exceeds pending qty</p>}
                      </td>
                      <td className="px-4 py-2">
                        <input type="number" value={line.rate}
                          onChange={e => updateLine(i, 'rate', e.target.value)}
                          step="0.01" min="0" placeholder="0.00"
                          className="block w-28 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
                      </td>
                      <td className="px-4 py-2">
                        <select value={line.taxRateId} onChange={e => updateLine(i, 'taxRateId', e.target.value)}
                          className="block w-32 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none">
                          <option value="">No Tax</option>
                          {taxRates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2 text-right font-semibold text-gray-900">
                        {tax.total_with_tax > 0 ? `₹${tax.total_with_tax.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200">
                  <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-right">Totals:</td>
                  <td className="px-4 py-3 text-sm font-bold">{totalQty.toFixed(3)}</td>
                  <td />
                  <td />
                  <td className="px-4 py-3 text-right text-sm font-bold">
                    ₹{totalAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : !loading && selectedJwId ? (
          <div className="p-8 text-center text-gray-400 text-sm">All items at this vendor have already been returned or sold.</div>
        ) : !selectedJwId ? (
          <div className="p-8 text-center text-gray-400 text-sm">Select a job work order to see pending items.</div>
        ) : (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        )}

        {error && (
          <div className="border-t border-red-200 bg-red-50 px-4 py-2">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}
      </div>
    </div>
  )
}
