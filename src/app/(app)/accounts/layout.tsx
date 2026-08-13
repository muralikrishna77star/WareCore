import { requirePageRole } from '@/lib/auth/requirePageRole'

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager', 'billing_staff'])

export default async function AccountsLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole(ALLOWED_ROLES)
  return <>{children}</>
}
