export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft, Trash2, Undo2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { JOB_WORK_TRANSFER_CANCELLATIONS_QUERY } from '@/lib/hasura/queries'
import { ExportExcelButton } from '@/components/ExportExcelButton'
import { StatCard } from '@/components/StatCard'
import { JobWorkTransferCancellationsRows } from './JobWorkTransferCancellationsRows'

interface JobWorkTransferCancellationRow {
  id: string
  transfer_number: string | null
  transfer_date: string
  from_reference_number: string | null
  from_vendor_name: string | null
  to_reference_number: string | null
  to_vendor_name: string | null
  reason: string | null
  cancelled_at: string | null
  cancelled_notes: string | null
  job_work_cancellation_id: string | null
}

export default async function JobWorkTransferCancellationsPage() {
  const result = await hasuraQuery(JOB_WORK_TRANSFER_CANCELLATIONS_QUERY)
  const records: JobWorkTransferCancellationRow[] = result.job_work_transfer_cancellations ?? []

  const exportRows = records.map((r) => ({
    'Transfer No.': r.transfer_number || '',
    'Transaction Date': formatDate(r.transfer_date),
    'From Order': r.from_reference_number || '',
    'From Vendor': r.from_vendor_name || '',
    'To Order': r.to_reference_number || '',
    'To Vendor': r.to_vendor_name || '',
    'Rate': '',
    'Reason': r.reason || '',
    'Cancelled': r.cancelled_at ? formatDate(r.cancelled_at) : '',
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Work Transfer Deletions</h1>
          <p className="mt-1 text-sm text-gray-500">Archived deleted vendor transfers</p>
        </div>
        <div className="flex items-center gap-4">
          {records.length > 0 && <ExportExcelButton rows={exportRows} filename="jobwork-transfer-cancellations" sheetName="Transfer Deletions" />}
          <Link href="/jobwork-transfers" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
            <ArrowLeft className="h-4 w-4" /> Vendor Transfers
          </Link>
        </div>
      </div>

      {records.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <StatCard icon={Undo2} iconBg="bg-blue-100" iconColor="text-blue-600"
            value={String(records.length)} label={records.length === 1 ? 'deletion' : 'deletions'} />
        </div>
      )}

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {records.length === 0 ? (
            <div className="p-12 text-center">
              <Trash2 className="mx-auto h-10 w-10 mb-3 text-gray-400" />
              <p className="text-gray-500">No deleted vendor transfers yet.</p>
              <p className="text-sm text-gray-400 mt-1">Deleted transfers appear here after you delete one from the Vendor Transfers list.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <JobWorkTransferCancellationsRows records={records} />
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
