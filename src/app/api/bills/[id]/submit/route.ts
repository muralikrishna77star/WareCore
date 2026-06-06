import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraQuery } from '@/lib/hasura/server'

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager', 'billing_staff'])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid bill ID' }, { status: 400 })
  }

  const check = await hasuraQuery<any>(
    `query CheckBill($id: uuid!) { purchase_bills_by_pk(id: $id) { status warehouse_id } }`,
    { id }
  )
  const bill = check.purchase_bills_by_pk
  if (!bill) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
  if (bill.status !== 'draft') return NextResponse.json({ error: 'Only draft bills can be submitted' }, { status: 400 })
  if (!bill.warehouse_id) return NextResponse.json({ error: 'Warehouse is required before submitting' }, { status: 400 })

  const result = await hasuraQuery<any>(
    `mutation SubmitBill($id: uuid!) {
      update_purchase_bills_by_pk(pk_columns: {id: $id}, _set: {status: "active"}) { id status }
    }`,
    { id }
  )

  if (!result.update_purchase_bills_by_pk) {
    return NextResponse.json({ error: 'Failed to submit bill' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
