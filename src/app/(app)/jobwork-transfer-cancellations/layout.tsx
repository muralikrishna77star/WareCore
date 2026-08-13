import { requirePageRole } from '@/lib/auth/requirePageRole'

// Not its own row in docs/PROPOSED_ROLE_PERMISSION_MATRIX.md — treated as the
// archive/cancellation counterpart to Job Work Transfers, so it mirrors the
// "Job Work Cancellations" row (narrower than its parent module: no
// warehouse_manager) rather than the broader "Job Work Transfers" row.
const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager'])

export default async function JobWorkTransferCancellationsLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole(ALLOWED_ROLES)
  return <>{children}</>
}
