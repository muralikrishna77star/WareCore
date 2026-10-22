import { requirePageRole } from '@/lib/auth/requirePageRole'

// Plans, costs and billing accounts are internal — same audience as Backup & Restore.
const ALLOWED_ROLES = new Set(['admin', 'developer'])

export default async function AboutLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole(ALLOWED_ROLES, '/admin')
  return <>{children}</>
}
