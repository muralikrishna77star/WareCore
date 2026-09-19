'use client'

import Link from 'next/link'
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Building2,
  ClipboardList,
  Factory,
  FileBarChart,
  Package,
  ReceiptText,
  Truck,
  Warehouse,
} from 'lucide-react'
import { formatNumber } from '@/lib/utils'
import { isReferenceType } from '@/lib/reference'
import { ReferenceLink } from '@/components/ReferenceLink'
import { useDashboardData } from './useDashboardData'
import { DashboardAsyncSection } from './DashboardAsyncSection'

const ENTRY_TYPE_LABELS: Record<string, string> = {
  PURCHASE_IN: 'Purchase In',
  VENDOR_RETURN_IN: 'Vendor Return',
  JOB_WORK_RETURN_IN: 'JW Return',
  TRANSFER_IN: 'Transfer In',
  ADJUSTMENT_IN: 'Adj. In',
  SALE_OUT: 'Sale Out',
  SALE_CANCEL: 'Sale Reversal',
  PURCHASE_CANCEL: 'Purchase Cancel',
  JOB_WORK_OUT: 'JW Out',
  TRANSFER_OUT: 'Transfer Out',
  ADJUSTMENT_OUT: 'Adj. Out',
}

const QUICK_LINKS = [
  { label: 'New Bill', note: 'Record supplier receipt', href: '/bills/new', icon: ReceiptText, tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  { label: 'New Transfer', note: 'Move warehouse stock', href: '/transfers/new', icon: Warehouse, tone: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  { label: 'New Job Work', note: 'Send material to vendor', href: '/jobwork/new', icon: Factory, tone: 'bg-violet-50 text-violet-700 border-violet-200' },
  { label: 'New Dispatch', note: 'Create customer dispatch', href: '/dispatch/new', icon: Truck, tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { label: 'Inventory', note: 'View current availability', href: '/inventory', icon: Package, tone: 'bg-blue-50 text-blue-700 border-blue-200' },
  { label: 'Reports', note: 'Open operational reports', href: '/reports', icon: FileBarChart, tone: 'bg-rose-50 text-rose-700 border-rose-200' },
]

export function ClassicDashboard() {
  const { data, loading, error } = useDashboardData()

  const summary = [
    { label: 'Total Stock', value: data ? `${formatNumber(data.totalStock, 2)} t` : '—', icon: Package, accent: 'from-blue-600 to-blue-700', detail: 'Available across locations' },
    { label: 'Purchase Bills', value: data ? String(data.totalBills) : '—', icon: ClipboardList, accent: 'from-amber-500 to-orange-600', detail: 'Purchase transactions' },
    { label: 'Pending Transfers', value: data ? String(data.pendingTransfers) : '—', icon: Warehouse, accent: 'from-cyan-600 to-sky-700', detail: 'Awaiting completion' },
    { label: 'Active Job Work', value: data ? String(data.pendingJobWork) : '—', icon: Factory, accent: 'from-violet-600 to-purple-700', detail: 'Material with vendors' },
    { label: 'Total Dispatches', value: data ? String(data.totalDispatches) : '—', icon: Truck, accent: 'from-emerald-600 to-green-700', detail: 'Customer dispatches' },
  ]

  return (
    <div className="space-y-5 pb-3">
      <section className="relative overflow-hidden rounded-xl border border-slate-700 bg-gradient-to-r from-slate-900 via-slate-800 to-blue-950 px-5 py-5 text-white shadow-lg">
        <div className="absolute -right-12 -top-16 h-48 w-48 rounded-full border-[28px] border-white/5" />
        <div className="absolute bottom-0 right-32 h-20 w-20 rounded-t-full bg-blue-400/10" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded border border-blue-300/30 bg-blue-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-100">
              <Building2 className="h-3.5 w-3.5" /> Operations Control Centre
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Warehouse Dashboard</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-300">A data-rich classic view of stock, purchases, transfers, job work and dispatch activity.</p>
          </div>
          <div className="rounded-lg border border-white/15 bg-white/10 px-4 py-2.5 text-right backdrop-blur-sm">
            <p className="text-[10px] uppercase tracking-wider text-slate-300">Working Date</p>
            <p className="mt-0.5 font-mono text-sm font-semibold">{new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
          </div>
        </div>
      </section>

      <DashboardAsyncSection loading={loading} error={error} skeletonRows={2}>
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {summary.map((item) => {
            const Icon = item.icon
            return (
              <article key={item.label} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <div className={`h-1.5 bg-gradient-to-r ${item.accent}`} />
                <div className="flex items-start gap-3 p-4">
                  <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm ${item.accent}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
                    <p className="mt-0.5 truncate font-mono text-xl font-bold text-slate-900">{item.value}</p>
                    <p className="mt-1 text-[10px] text-slate-400">{item.detail}</p>
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      </DashboardAsyncSection>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <header className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-4 py-3">
            <div>
              <h2 className="font-semibold text-slate-900">Quick Transactions</h2>
              <p className="text-xs text-slate-500">Start frequent warehouse activities</p>
            </div>
            <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Shortcuts</span>
          </header>
          <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
            {QUICK_LINKS.map((link) => {
              const Icon = link.icon
              return (
                <Link key={link.href} href={link.href} className="group flex items-center gap-3 rounded-lg border border-slate-200 p-3 transition hover:border-blue-300 hover:bg-blue-50/40 hover:shadow-sm">
                  <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border ${link.tone}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-800">{link.label}</span>
                    <span className="block truncate text-[11px] text-slate-500">{link.note}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-600" />
                </Link>
              )
            })}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <header className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-4 py-3">
            <div>
              <h2 className="font-semibold text-slate-900">Stock by Company</h2>
              <p className="text-xs text-slate-500">Current group-wide position</p>
            </div>
            <Building2 className="h-5 w-5 text-slate-400" />
          </header>
          <DashboardAsyncSection loading={loading} error={error} isEmpty={!!data && data.companyStock.length === 0} emptyMessage="No stock data yet." skeletonRows={3}>
            <div className="divide-y divide-slate-100 px-4">
              {data?.companyStock.map((c, index) => (
                <div key={c.id} className="flex items-center gap-3 py-3">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-800 text-xs font-bold text-white">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{c.name}</p>
                    <p className="font-mono text-[10px] text-slate-400">{c.code}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm font-bold text-slate-900">{formatNumber(c.stock, 2)} t</p>
                    <p className="text-[10px] text-emerald-600">Available stock</p>
                  </div>
                </div>
              ))}
            </div>
          </DashboardAsyncSection>
          <Link href="/inventory" className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-blue-700 hover:bg-blue-50">
            View complete inventory <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <header className="flex flex-col gap-2 border-b border-slate-200 bg-gradient-to-r from-slate-800 to-slate-700 px-4 py-3 text-white sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Recent Stock Transactions</h2>
            <p className="text-xs text-slate-300">Latest signed movements from the stock ledger</p>
          </div>
          <Link href="/movements" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-200 hover:text-white">Open movement ledger <ArrowRight className="h-3.5 w-3.5" /></Link>
        </header>
        <div className="overflow-x-auto">
          <DashboardAsyncSection loading={loading} error={error} isEmpty={!!data && data.movements.length === 0} emptyMessage="No movements recorded yet." skeletonRows={5}>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100 text-left uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 font-semibold">Date</th>
                  <th className="px-4 py-2.5 font-semibold">Movement</th>
                  <th className="px-4 py-2.5 font-semibold">Material / Size</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Quantity</th>
                  <th className="px-4 py-2.5 font-semibold">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data?.movements.map((entry) => {
                  const inbound = entry.quantity >= 0
                  return (
                    <tr key={entry.id} className="even:bg-slate-50/60 hover:bg-blue-50/70">
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-slate-500">{new Date(entry.entry_date).toLocaleDateString('en-IN')}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 rounded border px-2 py-1 font-semibold ${inbound ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
                          {inbound ? <ArrowDownRight className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                          {ENTRY_TYPE_LABELS[entry.entry_type] || entry.entry_type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        <span className="font-medium">{entry.material_types?.description}</span>
                        {entry.size_label && <span className="ml-1 text-slate-400">({entry.size_label})</span>}
                      </td>
                      <td className={`whitespace-nowrap px-4 py-2.5 text-right font-mono font-bold ${inbound ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {inbound ? '+' : '−'}{formatNumber(Math.abs(entry.quantity), 3)} {entry.material_types?.unit}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-500">
                        {isReferenceType(entry.reference_type) && entry.reference_id ? (
                          <ReferenceLink type={entry.reference_type} id={entry.reference_id} className="font-semibold text-blue-700 hover:underline">
                            {entry.reference_number || '-'}
                          </ReferenceLink>
                        ) : (entry.reference_number || '-')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </DashboardAsyncSection>
        </div>
      </section>
    </div>
  )
}
