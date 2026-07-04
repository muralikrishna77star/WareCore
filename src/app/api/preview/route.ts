import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraQuery } from '@/lib/hasura/server'
import {
  PURCHASE_BILL_BY_ID_QUERY,
  PURCHASE_BILL_ITEMS_QUERY,
  DISPATCH_ORDER_BY_ID_QUERY,
  DISPATCH_ITEMS_QUERY,
  JOB_WORK_ORDER_BY_ID_QUERY,
  JOB_WORK_ITEMS_QUERY,
  TRANSFER_BY_ID_QUERY,
  TRANSFER_ITEMS_QUERY,
} from '@/lib/hasura/queries'
import { isReferenceType, REFERENCE_ROUTE, REFERENCE_LABEL } from '@/lib/reference'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Field = { label: string; value: string }
type Item = { name: string; size?: string; quantity: string; unit?: string; rate?: string; amount?: string }

const fmtQ = (n: unknown) => Number(n || 0).toFixed(3)
const fmtAmt = (n: unknown) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('en-IN') : '—')

async function loadPurchaseBill(id: string) {
  const [billRes, itemsRes] = await Promise.all([
    hasuraQuery(PURCHASE_BILL_BY_ID_QUERY, { id }),
    hasuraQuery(PURCHASE_BILL_ITEMS_QUERY, { bill_id: id }),
  ])
  const bill = billRes.purchase_bills_by_pk
  if (!bill) return null
  const items: Item[] = (itemsRes.purchase_bill_items ?? []).map((i: any) => ({
    name: i.item_name || i.material_types?.description || '—',
    size: i.size_label,
    quantity: fmtQ(i.quantity),
    rate: i.rate != null ? fmtAmt(i.rate) : undefined,
    amount: i.amount != null ? fmtAmt(i.amount) : undefined,
  }))
  const fields: Field[] = [
    { label: 'Supplier', value: bill.suppliers?.name || '—' },
    { label: 'Date', value: fmtDate(bill.bill_date) },
    { label: 'Company', value: bill.companies?.name || '—' },
    { label: 'Warehouse', value: bill.warehouses?.name || '—' },
  ]
  return {
    title: `Purchase Bill ${bill.bill_number}`,
    status: bill.status,
    fields,
    items,
    totalQuantity: fmtQ(bill.total_quantity),
    totalAmount: fmtAmt(bill.total_amount),
  }
}

async function loadDispatch(id: string) {
  const [orderRes, itemsRes] = await Promise.all([
    hasuraQuery(DISPATCH_ORDER_BY_ID_QUERY, { id }),
    hasuraQuery(DISPATCH_ITEMS_QUERY, { dispatch_order_id: id }),
  ])
  const order = orderRes.dispatch_orders_by_pk
  if (!order) return null
  const items: Item[] = (itemsRes.dispatch_items ?? []).map((i: any) => ({
    name: i.item_name || i.material_types?.description || '—',
    size: i.size_label,
    quantity: fmtQ(i.quantity),
    rate: i.rate != null ? fmtAmt(i.rate) : undefined,
    amount: i.amount != null ? fmtAmt(i.amount) : undefined,
  }))
  const totalQuantity = items.reduce((s, i) => s + Number(i.quantity), 0)
  const totalAmount = (itemsRes.dispatch_items ?? []).reduce((s: number, i: any) => s + Number(i.amount || 0), 0)
  const fields: Field[] = [
    { label: 'Customer', value: order.customers?.name || '—' },
    { label: 'Date', value: fmtDate(order.dispatch_date) },
    { label: 'Company', value: order.companies?.name || '—' },
    { label: 'Warehouse', value: order.warehouses?.name || '—' },
    { label: 'Vehicle', value: order.vehicle_number || '—' },
  ]
  return {
    title: `Sale Entry ${order.invoice_number || order.sale_ref_id || ''}`.trim(),
    status: order.status,
    fields,
    items,
    totalQuantity: fmtQ(totalQuantity),
    totalAmount: fmtAmt(totalAmount),
  }
}

async function loadJobWork(id: string) {
  const [orderRes, itemsRes] = await Promise.all([
    hasuraQuery(JOB_WORK_ORDER_BY_ID_QUERY, { id }),
    hasuraQuery(JOB_WORK_ITEMS_QUERY, { job_work_order_id: id }),
  ])
  const order = orderRes.job_work_orders_by_pk
  if (!order) return null
  const items: Item[] = (itemsRes.job_work_items ?? []).map((i: any) => ({
    name: i.item_name || i.material_types?.description || '—',
    size: i.size_label,
    quantity: `${fmtQ(i.quantity_sent)} sent / ${fmtQ(i.quantity_received)} returned`,
  }))
  const totalSent = (itemsRes.job_work_items ?? []).reduce((s: number, i: any) => s + Number(i.quantity_sent || 0), 0)
  const fields: Field[] = [
    { label: 'Vendor', value: order.suppliers?.name || '—' },
    { label: 'Dispatch Date', value: fmtDate(order.dispatch_date) },
    { label: 'Expected Return', value: fmtDate(order.expected_return_date) },
    { label: 'Company', value: order.companies?.name || '—' },
    { label: 'Warehouse', value: order.warehouses?.name || '—' },
  ]
  return {
    title: `Job Work ${order.reference_number}`,
    status: order.status,
    fields,
    items,
    totalQuantity: fmtQ(totalSent),
  }
}

async function loadTransfer(id: string) {
  const [transferRes, itemsRes] = await Promise.all([
    hasuraQuery(TRANSFER_BY_ID_QUERY, { id }),
    hasuraQuery(TRANSFER_ITEMS_QUERY, { transfer_id: id }),
  ])
  const transfer = transferRes.transfers_by_pk
  if (!transfer) return null
  const items: Item[] = (itemsRes.transfer_items ?? []).map((i: any) => ({
    name: i.item_name || i.material_types?.description || '—',
    size: i.size_label || i.material_sizes?.size_label,
    quantity: fmtQ(i.quantity),
  }))
  const totalQuantity = items.reduce((s, i) => s + Number(i.quantity), 0)
  const fields: Field[] = [
    { label: 'Date', value: fmtDate(transfer.transfer_date) },
    { label: 'From', value: `${transfer.from_company?.name || '—'} / ${transfer.from_warehouse?.name || '—'}` },
    { label: 'To', value: `${transfer.to_company?.name || '—'} / ${transfer.to_warehouse?.name || '—'}` },
  ]
  return {
    title: `Transfer ${fmtDate(transfer.transfer_date)}`,
    status: transfer.status,
    fields,
    items,
    totalQuantity: fmtQ(totalQuantity),
  }
}

export async function GET(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')
  const id = searchParams.get('id')

  if (!isReferenceType(type) || !id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid type or id' }, { status: 400 })
  }

  try {
    const loader = {
      purchase_bill: loadPurchaseBill,
      dispatch: loadDispatch,
      job_work: loadJobWork,
      transfer: loadTransfer,
    }[type]
    const data = await loader(id)
    if (!data) return NextResponse.json({ error: `${REFERENCE_LABEL[type]} not found` }, { status: 404 })

    return NextResponse.json({
      ...data,
      type,
      fullUrl: `${REFERENCE_ROUTE[type]}/${id}`,
    })
  } catch (err) {
    console.error('[preview]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load preview' }, { status: 500 })
  }
}
