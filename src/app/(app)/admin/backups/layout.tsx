import { requirePageRole } from '@/lib/auth/requirePageRole'

const ALLOWED_ROLES = new Set(['admin', 'developer'])

export default async function BackupsLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole(ALLOWED_ROLES, '/admin')
  return <>{children}</>
}
