export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft, Trash2, Undo2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { PURCHASE_CANCELLATIONS_QUERY } from '@/lib/hasura/queries'
import { ExportExcelButton } from '@/components/ExportExcelButton'
import { ListingSummary } from '@/components/ListingSummary'
import { PurchaseCancellationsRows } from './PurchaseCancellationsRows'

interface PurchaseCancellationRow {
  id: string
  bill_number: string
  bill_date: string
  company_name: string | null
  warehouse_name: string | null
  supplier_name: string | null
  total_quantity: number
  total_amount: number
  cancelled_at: string | null
  purged_at: string
}

export default async function PurchaseCancellationsPage() {
  const result = await hasuraQuery(PURCHASE_CANCELLATIONS_QUERY)
  const records: PurchaseCancellationRow[] = result.purchase_cancellations ?? []

  const totalQuantity = records.reduce((s, r) => s + Number(r.total_quantity || 0), 0)
  const totalAmount = records.reduce((s, r) => s + Number(r.total_amount || 0), 0)

  const exportRows = records.map((r) => {
    const qty = Number(r.total_quantity || 0)
    const amount = Number(r.total_amount || 0)
    return {
      'Bill No.': r.bill_number,
      'Transaction Date': formatDate(r.bill_date),
      'Supplier': r.supplier_name || '',
      'Company': r.company_name || '',
      'Warehouse': r.warehouse_name || '',
      'Qty': qty,
      'Rate': qty > 0 ? amount / qty : '',
      'Amount': amount,
      'Cancelled': r.cancelled_at ? formatDate(r.cancelled_at) : '',
      'Purged': formatDate(r.purged_at),
    }
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[1.4375rem] font-bold text-gray-900">Purchase Cancellations</h1>
          <p className="mt-1 text-[0.9375rem] text-gray-500">Archived cancelled purchase bills</p>
        </div>
        <div className="flex items-center gap-4">
          {records.length > 0 && <ExportExcelButton rows={exportRows} filename="purchase-cancellations" sheetName="Purchase Cancellations" />}
          <Link href="/bills" className="text-[0.9375rem] text-blue-600 hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="h-4 w-4 shrink-0" /> Purchase Bills
          </Link>
        </div>
      </div>

      {records.length > 0 && (
        <ListingSummary count={records.length} countLabel="cancellation" countIcon={Undo2} totalQuantity={totalQuantity} totalAmount={totalAmount} />
      )}

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {records.length === 0 ? (
            <div className="p-12 text-center">
              <Trash2 className="mx-auto h-10 w-10 text-gray-400 mb-3" />
              <p className="text-gray-500">No purged cancellations yet.</p>
              <p className="text-[0.8125rem] text-gray-400 mt-1">Cancelled bills appear here after you purge them from the bill detail page.</p>
            </div>
          ) : (
            <table className="w-full text-[0.9375rem]">
              <PurchaseCancellationsRows records={records} />
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
