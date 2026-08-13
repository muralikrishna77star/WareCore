'use client'

import dynamic from 'next/dynamic'
import { useDashboardView } from '@/components/DashboardViewProvider'

const ClassicDashboard = dynamic(() => import('./ClassicDashboard').then((m) => m.ClassicDashboard), {
  ssr: false,
  loading: () => <DashboardViewLoading />,
})

const ModernDashboard = dynamic(() => import('./ModernDashboard').then((m) => m.ModernDashboard), {
  ssr: false,
  loading: () => <DashboardViewLoading />,
})

function DashboardViewLoading() {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-label="Loading dashboard">
      <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
      <div className="h-40 animate-pulse rounded-lg bg-gray-100" />
    </div>
  )
}

/**
 * The Classic/Modern choice itself lives in DashboardViewProvider (mounted
 * app-wide in the (app) layout, with a selector in the header/sidebar
 * drawer) so it can also reskin the shell on every page. This component just
 * renders the right dashboard content for whichever view is currently selected.
 */
export function DashboardViewSwitcher() {
  const { view } = useDashboardView()

  return view === 'classic' ? <ClassicDashboard /> : <ModernDashboard />
}
