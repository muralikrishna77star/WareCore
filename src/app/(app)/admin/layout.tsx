import { requirePageRole } from '@/lib/auth/requirePageRole'

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager'])

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole(ALLOWED_ROLES)
  return <>{children}</>
}
