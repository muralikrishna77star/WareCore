import { LIFECYCLE_LABELS, PICKUP_STATUS_LABELS, type LifecycleStatus, type PickupStatus } from '@/lib/tracking/constants'

const LIFECYCLE_STYLES: Record<LifecycleStatus, string> = {
  LABELLED: 'bg-gray-100 text-gray-800',
  IN_STOCK: 'bg-green-100 text-green-800',
  ON_PICKUP: 'bg-blue-100 text-blue-800',
  READY: 'bg-blue-100 text-blue-800',
  PICKED_UP: 'bg-gray-100 text-gray-800',
  ON_HOLD: 'bg-amber-100 text-amber-800',
  MISSING: 'bg-red-100 text-red-800',
  LEFT_WAREHOUSE: 'bg-amber-100 text-amber-800',
  SPLIT: 'bg-gray-100 text-gray-800',
}

const PICKUP_STYLES: Record<PickupStatus, string> = {
  OPEN: 'bg-gray-100 text-gray-800',
  READY: 'bg-blue-100 text-blue-800',
  HANDED_OVER: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
}

export function LifecycleBadge({ status, voided = false }: { status: LifecycleStatus; voided?: boolean }) {
  if (voided) return <span className="whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Voided</span>
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${LIFECYCLE_STYLES[status]}`}>{LIFECYCLE_LABELS[status]}</span>
}

export function PickupBadge({ status }: { status: PickupStatus }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${PICKUP_STYLES[status]}`}>{PICKUP_STATUS_LABELS[status]}</span>
}
