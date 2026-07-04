import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraQuery } from '@/lib/hasura/server'
import {
  PURCHASE_BILLS_QUERY,
  DISPATCH_ORDERS_QUERY,
  JOB_WORK_ORDERS_QUERY,
  TRANSFERS_QUERY,
  CURRENT_STOCK_QUERY,
} from '@/lib/hasura/queries'
import { formatDate } from '@/lib/utils'

const fmtQ = (n: unknown) => Number(n || 0).toFixed(3)
const fmtAmt = (n: unknown) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`

const CATEGORIES = ['purchase_bills', 'transfers_pending', 'job_work_active', 'dispatches', 'stock'] as const
type Category = (typeof CATEGORIES)[number]

async function loadPurchaseBills() {
  const result = await hasuraQuery(PURCHASE_BILLS_QUERY, { where: {} })
  const rows = (result.purchase_bills ?? []).slice(0, 25).map((b: any) => ({
    id: b.id,
    type: 'purchase_bill' as const,
    label: b.bill_number,
    date: formatDate(b.bill_date),
    party: b.suppliers?.name || '—',
    amount: fmtAmt(b.total_amount),
    status: b.status,
  }))
  return { title: 'Purchase Bills', rows, viewAllUrl: '/bills' }
}

async function loadPendingTransfers() {
  const result = await hasuraQuery(TRANSFERS_QUERY, { where: { status: { _eq: 'pending' } } })
  const rows = (result.transfers ?? []).slice(0, 25).map((t: any) => ({
    id: t.id,
    type: 'transfer' as const,
    label: formatDate(t.transfer_date),
    date: formatDate(t.transfer_date),
    party: `${t.from_warehouse?.name || '—'} → ${t.to_warehouse?.name || '—'}`,
    amount: '—',
    status: t.status,
  }))
  return { title: 'Pending Transfers', rows, viewAllUrl: '/transfers' }
}

async function loadActiveJobWork() {
  const result = await hasuraQuery(JOB_WORK_ORDERS_QUERY, { where: { status: { _in: ['dispatched', 'partial_return'] } } })
  const rows = (result.job_work_orders ?? []).slice(0, 25).map((o: any) => ({
    id: o.id,
    type: 'job_work' as const,
    label: o.reference_number,
    date: formatDate(o.dispatch_date),
    party: o.suppliers?.name || '—',
    amount: '—',
    status: o.status,
  }))
  return { title: 'Active Job Work', rows, viewAllUrl: '/jobwork' }
}

async function loadDispatches() {
  const result = await hasuraQuery(DISPATCH_ORDERS_QUERY, { where: { status: { _neq: 'cancelled' } } })
  const rows = (result.dispatch_orders ?? []).slice(0, 25).map((o: any) => {
    const amount = (o.dispatch_items ?? []).reduce((s: number, i: any) => s + Number(i.amount || 0), 0)
    return {
      id: o.id,
      type: 'dispatch' as const,
      label: o.invoice_number || o.sale_ref_id || '—',
      date: formatDate(o.dispatch_date),
      party: o.customers?.name || '—',
      amount: fmtAmt(amount),
      status: o.status,
    }
  })
  return { title: 'Dispatches', rows, viewAllUrl: '/dispatch' }
}

async function loadStock() {
  const result = await hasuraQuery(CURRENT_STOCK_QUERY)
  const rows = (result.v_current_stock ?? []).slice(0, 40).map((s: any, idx: number) => ({
    id: `stock-${idx}`,
    type: null,
    label: `${s.material_type_name}${s.size_label ? ` (${s.size_label})` : ''}`,
    date: '',
    party: `${s.company_name} / ${s.warehouse_name}`,
    amount: `${fmtQ(s.current_stock)} ${s.unit || ''}`.trim(),
    status: '',
  }))
  return { title: 'Current Stock', rows, viewAllUrl: '/inventory' }
}

export async function GET(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category') as Category | null
  if (!category || !CATEGORIES.includes(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }

  try {
    const loader = {
      purchase_bills: loadPurchaseBills,
      transfers_pending: loadPendingTransfers,
      job_work_active: loadActiveJobWork,
      dispatches: loadDispatches,
      stock: loadStock,
    }[category]
    const data = await loader()
    return NextResponse.json({ category, ...data })
  } catch (err) {
    console.error('[preview/list]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load list' }, { status: 500 })
  }
}
