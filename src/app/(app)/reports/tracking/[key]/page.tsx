import { notFound } from 'next/navigation'
import { requirePageRole } from '@/lib/auth/requirePageRole'
import { isTrackingMasterEnabled, TRACKING_ROLES, UUID_RE } from '@/lib/tracking/constants'
import { isTrackingReportKey } from '@/lib/tracking/reportDefs'
import { TrackingReport } from '@/components/tracking/TrackingReport'

export default async function TrackingReportPage({ params, searchParams }: {
  params: Promise<{ key: string }>
  searchParams: Promise<{ warehouse_id?: string }>
}) {
  if (!isTrackingMasterEnabled()) notFound()
  await requirePageRole(TRACKING_ROLES.view)
  const { key } = await params
  if (!isTrackingReportKey(key)) notFound()
  const { warehouse_id: warehouseId } = await searchParams
  return <TrackingReport reportKey={key} initialWarehouse={warehouseId && UUID_RE.test(warehouseId) ? warehouseId : ''} />
}
