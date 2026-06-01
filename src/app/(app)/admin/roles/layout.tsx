import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession } from '@/lib/auth/session'

const ALLOWED_ROLES = new Set(['admin', 'company_manager'])

export default async function RolesLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const token = cookieStore.get('wc_session')?.value
  const session = token ? verifySession(token) : null

  if (!session || !ALLOWED_ROLES.has(session.role)) {
    redirect('/admin')
  }

  return <>{children}</>
}
