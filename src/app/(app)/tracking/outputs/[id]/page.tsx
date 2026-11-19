import { requirePageRole } from '@/lib/auth/requirePageRole'
import { TRACKING_ROLES } from '@/lib/tracking/constants'
import { ReceiptDetail } from '@/components/tracking/ReceiptDetail'

export default async function TrackingReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageRole(TRACKING_ROLES.view)
  const { id } = await params
  return (
    <ReceiptDetail
      receiptId={id}
      canOperate={TRACKING_ROLES.operate.has(session.role)}
      canLabel={TRACKING_ROLES.label.has(session.role)}
    />
  )
}
