'use client'

import { useEffect, useMemo, useState } from 'react'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import {
  ACTIVE_COMPANIES_QUERY,
  ACTIVE_SUPPLIERS_QUERY,
  ACTIVE_CUSTOMERS_QUERY,
  PURCHASE_BILLS_QUERY,
  DISPATCH_ORDERS_QUERY,
  PURCHASE_BILL_ITEMS_QUERY,
  DISPATCH_ITEMS_QUERY,
  FINANCIAL_ENTRIES_QUERY,
  CREATE_FINANCIAL_ENTRY_MUTATION,
} from '@/lib/hasura/queries'
import type {
  Company,
  Supplier,
  Customer,
  PurchaseBill,
  DispatchOrder,
  PurchaseBillItem,
  DispatchItem,
  FinancialEntry,
} from '@/types'

const paymentModes = ['Cash', 'Bank', 'UPI', 'Other'] as const
const defaultDate = new Date().toISOString().split('T')[0]

export default function AccountsPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [purchaseBills, setPurchaseBills] = useState<PurchaseBill[]>([])
  const [dispatchOrders, setDispatchOrders] = useState<DispatchOrder[]>([])
  const [purchaseBillItems, setPurchaseBillItems] = useState<PurchaseBillItem[]>([])
  const [dispatchItems, setDispatchItems] = useState<DispatchItem[]>([])
  const [financialEntries, setFinancialEntries] = useState<FinancialEntry[]>([])

  const [entryType, setEntryType] = useState<'RECEIPT' | 'PAYMENT'>('RECEIPT')
  const [companyId, setCompanyId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [selectedPurchaseBillId, setSelectedPurchaseBillId] = useState('')
  const [selectedDispatchOrderId, setSelectedDispatchOrderId] = useState('')
  const [selectedPurchaseLineId, setSelectedPurchaseLineId] = useState('')
  const [selectedSubPurchaseLineId, setSelectedSubPurchaseLineId] = useState('')
  const [amount, setAmount] = useState('')
  const [entryDate, setEntryDate] = useState(defaultDate)
  const [paymentMode, setPaymentMode] = useState<typeof paymentModes[number]>('Cash')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [masterDataLoading, setMasterDataLoading] = useState(true)

  // Journal date filter
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')

  useEffect(() => {
    const loadMasterData = async () => {
      const [companiesRes, suppliersRes, customersRes, purchaseBillsRes, dispatchOrdersRes, entriesRes] =
        await Promise.all([
          hasuraFetch(ACTIVE_COMPANIES_QUERY),
          hasuraFetch(ACTIVE_SUPPLIERS_QUERY),
          hasuraFetch(ACTIVE_CUSTOMERS_QUERY),
          hasuraFetch(PURCHASE_BILLS_QUERY),
          hasuraFetch(DISPATCH_ORDERS_QUERY),
          hasuraFetch(FINANCIAL_ENTRIES_QUERY),
        ])

      setCompanies((companiesRes.data as any)?.companies ?? [])
      setSuppliers((suppliersRes.data as any)?.suppliers ?? [])
      setCustomers((customersRes.data as any)?.customers ?? [])
      setPurchaseBills((purchaseBillsRes.data as any)?.purchase_bills ?? [])
      setDispatchOrders((dispatchOrdersRes.data as any)?.dispatch_orders ?? [])
      setFinancialEntries((entriesRes.data as any)?.financial_entries ?? [])
      setMasterDataLoading(false)

      const loadedCompanies = (companiesRes.data as any)?.companies ?? []
      if (!companyId && loadedCompanies.length > 0) setCompanyId(loadedCompanies[0].id)
    }
    loadMasterData()
  }, [])

  const filteredPurchaseBills = supplierId
    ? purchaseBills.filter((b) => b.supplier_id === supplierId)
    : purchaseBills

  const filteredDispatchOrders = customerId
    ? dispatchOrders.filter((o) => o.customer_id === customerId)
    : dispatchOrders

  const selectedPurchaseBill = purchaseBills.find((b) => b.id === selectedPurchaseBillId)
  const selectedDispatchOrder = dispatchOrders.find((o) => o.id === selectedDispatchOrderId)

  const totalReceipts = useMemo(
    () => financialEntries.reduce((s, e) => (e.entry_type === 'RECEIPT' ? s + Number(e.amount) : s), 0),
    [financialEntries]
  )
  const totalPayments = useMemo(
    () => financialEntries.reduce((s, e) => (e.entry_type === 'PAYMENT' ? s + Number(e.amount) : s), 0),
    [financialEntries]
  )
  const netBalance = totalReceipts - totalPayments

  const filteredJournal = useMemo(() => {
    return financialEntries.filter((e) => {
      if (filterFrom && e.entry_date < filterFrom) return false
      if (filterTo && e.entry_date > filterTo) return false
      return true
    })
  }, [financialEntries, filterFrom, filterTo])

  const clearForm = () => {
    setSupplierId('')
    setCustomerId('')
    setSelectedPurchaseBillId('')
    setSelectedDispatchOrderId('')
    setSelectedPurchaseLineId('')
    setSelectedSubPurchaseLineId('')
    setAmount('')
    setEntryDate(defaultDate)
    setPaymentMode('Cash')
    setNotes('')
  }

  useEffect(() => {
    if (!selectedPurchaseBillId) { setPurchaseBillItems([]); setSelectedPurchaseLineId(''); return }
    setSelectedPurchaseLineId('')
    hasuraFetch<any>(PURCHASE_BILL_ITEMS_QUERY, { bill_id: selectedPurchaseBillId })
      .then((r) => setPurchaseBillItems((r.data as any)?.purchase_bill_items ?? []))
  }, [selectedPurchaseBillId])

  useEffect(() => {
    if (!selectedDispatchOrderId) { setDispatchItems([]); setSelectedSubPurchaseLineId(''); return }
    setSelectedSubPurchaseLineId('')
    hasuraFetch<any>(DISPATCH_ITEMS_QUERY, { dispatch_order_id: selectedDispatchOrderId })
      .then((r) => setDispatchItems((r.data as any)?.dispatch_items ?? []))
  }, [selectedDispatchOrderId])

  const handleSubmit = async () => {
    setError(null)
    if (!companyId) { setError('Please select a company.'); return }
    if (entryType === 'RECEIPT' && !customerId) { setError('Please select a customer for receipt.'); return }
    if (entryType === 'PAYMENT' && !supplierId) { setError('Please select a supplier for payment.'); return }
    if (entryType === 'RECEIPT' && !selectedDispatchOrderId) { setError('Please select a dispatch invoice.'); return }
    if (entryType === 'PAYMENT' && !selectedPurchaseBillId) { setError('Please select a purchase bill.'); return }
    const parsedAmount = parseFloat(amount)
    if (!parsedAmount || parsedAmount <= 0) { setError('Please enter a valid amount.'); return }

    setLoading(true)
    const response = await hasuraFetch(CREATE_FINANCIAL_ENTRY_MUTATION, {
      company_id: companyId,
      supplier_id: entryType === 'PAYMENT' ? supplierId : null,
      customer_id: entryType === 'RECEIPT' ? customerId : null,
      entry_type: entryType,
      reference_type: entryType === 'RECEIPT' ? 'dispatch_order' : 'purchase_bill',
      reference_id: entryType === 'RECEIPT' ? selectedDispatchOrderId : selectedPurchaseBillId,
      reference_number: entryType === 'RECEIPT' ? selectedDispatchOrder?.invoice_number : selectedPurchaseBill?.bill_number,
      purchase_line_id: entryType === 'PAYMENT' ? selectedPurchaseLineId || null : null,
      sub_purchase_line_id: entryType === 'RECEIPT' ? selectedSubPurchaseLineId || null : null,
      amount: parsedAmount,
      entry_date: entryDate,
      payment_mode: paymentMode,
      notes,
    })
    setLoading(false)

    if (response.error) { setError(response.error.message); return }
    const created = (response.data as any)?.insert_financial_entries_one
    if (created) { setFinancialEntries((prev) => [created, ...prev]); clearForm() }
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="space-y-5">

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
        <p className="mt-0.5 text-sm text-gray-500">Record customer receipts and supplier payments.</p>
      </div>

      {/* ── TOP: Payments & Receipts entry form ─────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">
            {entryType === 'RECEIPT' ? '💰 Receipt from Customer' : '💸 Payment to Supplier'}
          </h2>
          {/* Type toggle */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm font-medium">
            <button
              type="button"
              onClick={() => { setEntryType('RECEIPT'); setSupplierId(''); setSelectedPurchaseBillId(''); setSelectedPurchaseLineId(''); setSelectedSubPurchaseLineId('') }}
              className={`px-4 py-2 transition-colors ${entryType === 'RECEIPT' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              Receipt
            </button>
            <button
              type="button"
              onClick={() => { setEntryType('PAYMENT'); setCustomerId(''); setSelectedDispatchOrderId(''); setSelectedPurchaseLineId(''); setSelectedSubPurchaseLineId('') }}
              className={`px-4 py-2 transition-colors ${entryType === 'PAYMENT' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              Payment
            </button>
          </div>
        </div>

        {/* Form grid — fills the full width */}
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <div>
            <label className={labelCls}>Company</label>
            <select className={inputCls} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Select company</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div>
            <label className={labelCls}>{entryType === 'RECEIPT' ? 'Customer' : 'Supplier'}</label>
            {entryType === 'RECEIPT' ? (
              <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Select customer</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <select className={inputCls} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Select supplier</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>

          <div>
            <label className={labelCls}>{entryType === 'RECEIPT' ? 'Dispatch Invoice' : 'Purchase Bill'}</label>
            <select
              className={inputCls}
              value={entryType === 'RECEIPT' ? selectedDispatchOrderId : selectedPurchaseBillId}
              onChange={(e) => entryType === 'RECEIPT' ? setSelectedDispatchOrderId(e.target.value) : setSelectedPurchaseBillId(e.target.value)}
            >
              <option value="">Select {entryType === 'RECEIPT' ? 'invoice' : 'bill'}</option>
              {entryType === 'RECEIPT'
                ? filteredDispatchOrders.map((o) => <option key={o.id} value={o.id}>{o.invoice_number || o.id}</option>)
                : filteredPurchaseBills.map((b) => <option key={b.id} value={b.id}>{b.bill_number || b.id}</option>)
              }
            </select>
          </div>

          <div>
            <label className={labelCls}>{entryType === 'PAYMENT' ? 'Purchase Line ID' : 'Sub-Purchase Line ID'} <span className="text-gray-400">(opt.)</span></label>
            <select
              className={inputCls}
              value={entryType === 'PAYMENT' ? selectedPurchaseLineId : selectedSubPurchaseLineId}
              onChange={(e) => entryType === 'PAYMENT' ? setSelectedPurchaseLineId(e.target.value) : setSelectedSubPurchaseLineId(e.target.value)}
            >
              <option value="">None</option>
              {entryType === 'PAYMENT'
                ? purchaseBillItems.map((item) => <option key={item.id} value={item.purchase_line_id ?? ''}>{item.purchase_line_id || item.item_name || item.id}</option>)
                : dispatchItems.map((item) => <option key={item.id} value={item.sub_purchase_line_id ?? ''}>{item.sub_purchase_line_id || item.id}</option>)
              }
            </select>
          </div>

          <div>
            <label className={labelCls}>Amount (₹)</label>
            <input type="number" step="0.01" min="0" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>

          <div>
            <label className={labelCls}>Entry Date</label>
            <input type="date" className={inputCls} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </div>

          <div>
            <label className={labelCls}>Payment Mode</label>
            <select className={inputCls} value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as typeof paymentModes[number])}>
              {paymentModes.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className={labelCls}>Notes <span className="text-gray-400">(opt.)</span></label>
            <input type="text" className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional memo" />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4">
          {error ? <p className="text-sm text-red-600 flex-1">{error}</p> : <span className="flex-1" />}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || masterDataLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400 transition-colors"
          >
            {loading ? 'Recording…' : entryType === 'RECEIPT' ? '+ Record Receipt' : '+ Record Payment'}
          </button>
        </div>
      </section>

      {/* ── MID: Ledger Summary ─────────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Total Receipts</p>
          <p className="mt-2 text-2xl font-bold text-emerald-600">₹{totalReceipts.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          <p className="mt-1 text-xs text-gray-400">{financialEntries.filter((e) => e.entry_type === 'RECEIPT').length} entries</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Total Payments</p>
          <p className="mt-2 text-2xl font-bold text-rose-600">₹{totalPayments.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          <p className="mt-1 text-xs text-gray-400">{financialEntries.filter((e) => e.entry_type === 'PAYMENT').length} entries</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Net Balance</p>
          <p className={`mt-2 text-2xl font-bold ${netBalance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            ₹{Math.abs(netBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            <span className="ml-1 text-sm font-medium">{netBalance >= 0 ? 'CR' : 'DR'}</span>
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {financialEntries[0]
              ? `Last: ${new Date(financialEntries[0].entry_date).toLocaleDateString('en-IN')}`
              : 'No entries yet'}
          </p>
        </div>
      </section>

      {/* ── BOTTOM: Journal Entries ─────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {/* Header row with date filter on the right */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-800">Journal Entries</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {filteredJournal.length} of {financialEntries.length} entries
              {(filterFrom || filterTo) ? ' (filtered)' : ''}
            </p>
          </div>

          {/* Date range filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-gray-500 whitespace-nowrap">From</label>
              <input
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-gray-500 whitespace-nowrap">To</label>
              <input
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            {(filterFrom || filterTo) && (
              <button
                type="button"
                onClick={() => { setFilterFrom(''); setFilterTo('') }}
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 border-b border-gray-100 text-left">
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Date</th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Type</th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Party</th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Reference</th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Line ID</th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Sub-Line ID</th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Mode</th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredJournal.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-sm text-gray-400">
                    {financialEntries.length === 0
                      ? 'No journal entries yet. Use the form above to record a receipt or payment.'
                      : 'No entries match the selected date range.'}
                  </td>
                </tr>
              ) : (
                filteredJournal.map((entry) => {
                  const party = entry.entry_type === 'RECEIPT'
                    ? customers.find((c) => c.id === entry.customer_id)?.name
                    : suppliers.find((s) => s.id === entry.supplier_id)?.name
                  const isReceipt = entry.entry_type === 'RECEIPT'
                  return (
                    <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 text-gray-600 whitespace-nowrap">
                        {new Date(entry.entry_date).toLocaleDateString('en-IN')}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${isReceipt ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                          {isReceipt ? '↓ Receipt' : '↑ Payment'}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-medium text-gray-900 whitespace-nowrap">{party || '—'}</td>
                      <td className="px-5 py-3 text-gray-600 whitespace-nowrap">{entry.reference_number || '—'}</td>
                      <td className="px-5 py-3 text-gray-500 font-mono text-xs whitespace-nowrap">{entry.purchase_line_id || '—'}</td>
                      <td className="px-5 py-3 text-gray-500 font-mono text-xs whitespace-nowrap">{entry.sub_purchase_line_id || '—'}</td>
                      <td className="px-5 py-3 text-gray-600 whitespace-nowrap">{entry.payment_mode || '—'}</td>
                      <td className="px-5 py-3 text-right font-semibold whitespace-nowrap">
                        <span className={isReceipt ? 'text-emerald-700' : 'text-rose-700'}>
                          {isReceipt ? '+' : '−'}₹{Number(entry.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
