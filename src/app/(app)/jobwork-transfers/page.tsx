export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { hasuraQuery } from '@/lib/hasura/server'
import { JOB_WORK_TRANSFERS_QUERY } from '@/lib/hasura/queries'
import JobWorkTransfersTable from './JobWorkTransfersTable'

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
          <Link href="/jobwork-transfer-cancellations" className="text-sm text-blue-600 hover:underline">
            Deleted Transfers →
          </Link>
          <Link href="/jobwork" className="text-sm text-blue-600 hover:underline">
            ← Job Work
          </Link>
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {records.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-400 text-4xl mb-3">⇄</p>
              <p className="text-gray-500">No vendor transfers yet.</p>
              <p className="text-sm text-gray-400 mt-1">Transfers appear here after you move pending job work to another vendor from an order's detail page.</p>
            </div>
          ) : (
            <JobWorkTransfersTable records={records} canDelete={canDelete} />
          )}
        </div>
      </div>
    </div>
  )
}
