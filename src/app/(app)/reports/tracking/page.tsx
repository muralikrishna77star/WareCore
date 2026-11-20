import Link from 'next/link'
import { notFound } from 'next/navigation'
import { QrCode } from 'lucide-react'
import { requirePageRole } from '@/lib/auth/requirePageRole'
import { isTrackingMasterEnabled, TRACKING_ROLES } from '@/lib/tracking/constants'
import { TRACKING_REPORTS } from '@/lib/tracking/reportDefs'

export default async function TrackingReportsPage() {
  if (!isTrackingMasterEnabled()) notFound()
  await requirePageRole(TRACKING_ROLES.view)
  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-sm text-blue-600 hover:underline">Reports</Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">QR Tracking reports</h1>
        <p className="mt-1 text-sm text-gray-500">What the labels say about the physical bundles. These reports read only and change no stock figure.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TRACKING_REPORTS.map((report) => (
          <Link key={report.key} href={`/reports/tracking/${report.key}`} className="group flex items-start gap-4 rounded-xl border border-l-4 border-l-cyan-500 bg-cyan-50/40 p-5 transition-all hover:border-cyan-300 hover:shadow-sm">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-100">
              <QrCode className="h-5 w-5 text-cyan-700" strokeWidth={2} />
            </span>
            <div>
              <p className="font-semibold text-gray-900 group-hover:text-cyan-800">{report.title}</p>
              <p className="mt-0.5 text-sm text-gray-500">{report.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
