import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import WebsiteHomePage from './(website)/page'

export default async function RootPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  const session = token ? verifySession(token) : null

  if (session) redirect('/dashboard')

  return <WebsiteHomePage />
}


