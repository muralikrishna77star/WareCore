import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePageRole } from '@/lib/auth/requirePageRole'
import { isTrackingMasterEnabled, TRACKING_ROLES } from '@/lib/tracking/constants'

export default async function TrackingLayout({ children }: { children: React.ReactNode }) {
  if (!isTrackingMasterEnabled()) notFound()
  const session = await requirePageRole(TRACKING_ROLES.view)

  const tabs = [
    ...(TRACKING_ROLES.label.has(session.role) ? [{ href: '/tracking/receive', label: 'Receive & Label' }] : []),
    ...(TRACKING_ROLES.operate.has(session.role) ? [{ href: '/tracking/stock', label: 'Put Away & Move' }] : []),
    { href: '/tracking/pickups', label: 'Pickups' },
    { href: '/tracking/dispatches', label: 'Job Work Dispatch' },
    { href: '/tracking/vendors', label: 'Vendor Stock' },
    { href: '/tracking/outputs', label: 'Job Work Outputs' },
    { href: '/tracking/scan', label: 'Scan' },
    { href: '/tracking/units', label: 'Tracked Units' },
    { href: '/tracking/locations', label: 'Locations' },
    ...(TRACKING_ROLES.manage.has(session.role) ? [{ href: '/tracking/verify', label: 'Old Stock' }] : []),
    ...(TRACKING_ROLES.settings.has(session.role) ? [{ href: '/admin/tracking', label: 'Settings' }] : []),
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">QR Tracking</h1>
        <p className="mt-1 text-sm text-gray-500">
          Label, place and hand over physical bundles. Nothing on these screens changes stock figures.
        </p>
      </div>
      <div className="border-b border-gray-200">
        <nav className="flex gap-6 -mb-px overflow-x-auto">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="whitespace-nowrap border-b-2 border-transparent px-1 py-3 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700"
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  )
}
