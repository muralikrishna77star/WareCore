export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft, Trash2, Undo2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { JOB_WORK_CANCELLATIONS_QUERY } from '@/lib/hasura/queries'
import { ExportExcelButton } from '@/components/ExportExcelButton'
import { StatCard } from '@/components/StatCard'
import { JobWorkCancellationsRows } from './JobWorkCancellationsRows'

interface JobWorkCancellationRow {
  id: string
  reference_number: string | null
  dispatch_date: string
  company_name: string | null
  warehouse_name: string | null
  vendor_name: string | null
  status: string | null
  cancelled_at: string | null
  cancelled_notes: string | null
}

export default async function JobWorkCancellationsPage() {
  const result = await hasuraQuery(JOB_WORK_CANCELLATIONS_QUERY)
  const records: JobWorkCancellationRow[] = result.job_work_cancellations ?? []

  const exportRows = records.map((r) => ({
    'Reference No.': r.reference_number || '',
    'Transaction Date': formatDate(r.dispatch_date),
    'Vendor': r.vendor_name || '',
    'Company': r.company_name || '',
    'Warehouse': r.warehouse_name || '',
    'Rate': '',
    'Status at Cancellation': r.status?.replace('_', ' ') || '',
    'Cancelled': r.cancelled_at ? formatDate(r.cancelled_at) : '',
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Work Cancellations</h1>
          <p className="mt-1 text-sm text-gray-500">Archived cancelled job work orders</p>
        </div>
        <div className="flex items-center gap-4">
          {records.length > 0 && <ExportExcelButton rows={exportRows} filename="jobwork-cancellations" sheetName="Job Work Cancellations" />}
          <Link href="/jobwork" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
            <ArrowLeft className="h-4 w-4" /> Job Work
          </Link>
        </div>
      </div>

      {records.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <StatCard icon={Undo2} iconBg="bg-blue-100" iconColor="text-blue-600"
            value={String(records.length)} label={records.length === 1 ? 'cancellation' : 'cancellations'} />
        </div>
      )}

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {records.length === 0 ? (
            <div className="p-12 text-center">
              <Trash2 className="mx-auto h-10 w-10 mb-3 text-gray-400" />
              <p className="text-gray-500">No cancelled job work orders yet.</p>
              <p className="text-sm text-gray-400 mt-1">Cancelled job work orders appear here after you delete them from the job work detail page.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <JobWorkCancellationsRows records={records} />
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
