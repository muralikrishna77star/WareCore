export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft, ArrowRight, ArrowLeftRight, Shuffle } from 'lucide-react'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { hasuraQuery } from '@/lib/hasura/server'
import { JOB_WORK_TRANSFERS_QUERY } from '@/lib/hasura/queries'
import JobWorkTransfersTable from './JobWorkTransfersTable'
import { StatCard } from '@/components/StatCard'

const TRANSFER_DELETE_ROLES = new Set(['admin', 'developer', 'company_manager'])

export default async function JobWorkTransfersPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  const session = token ? verifySession(token) : null
  const canDelete = !!session && TRANSFER_DELETE_ROLES.has(session.role)

  const result = await hasuraQuery(JOB_WORK_TRANSFERS_QUERY)
  const records = result.job_work_transfers ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Work Vendor Transfers</h1>
          <p className="mt-1 text-sm text-gray-500">Audit trail of pending job work handed from one vendor to another</p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/jobwork-transfer-cancellations" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
            Deleted Transfers <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/jobwork" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
            <ArrowLeft className="h-4 w-4" /> Job Work
          </Link>
        </div>
      </div>

      {records.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <StatCard icon={Shuffle} iconBg="bg-blue-100" iconColor="text-blue-600"
            value={String(records.length)} label={records.length === 1 ? 'transfer' : 'transfers'} />
        </div>
      )}

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {records.length === 0 ? (
            <div className="p-12 text-center">
              <ArrowLeftRight className="mx-auto h-10 w-10 mb-3 text-gray-400" />
              <p className="text-gray-500">No vendor transfers yet.</p>
              <p className="text-sm text-gray-400 mt-1">Transfers appear here after you move pending job work to another vendor from an order&apos;s detail page.</p>
            </div>
          ) : (
            <JobWorkTransfersTable records={records} canDelete={canDelete} />
          )}
        </div>
      </div>
    </div>
  )
}
