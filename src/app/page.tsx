import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import WebsiteHomePage from './(website)/page'
import { WebsiteHeader, WebsiteFooter } from '@/components/website/WebsiteChrome'
import CustomerHome from '@/components/CustomerHome'
import { currentTenantSlug } from '@/lib/tenancy/context'
import { isMultiTenant } from '@/lib/tenancy/config'
import { getBrand } from '@/lib/tenancy/brand'
import { customerHomeImages } from '@/lib/tenancy/customerHome'

export default async function RootPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  const session = token ? verifySession(token) : null

  if (session) redirect('/dashboard')

  // A customer's own address (bsm.warecore.space) opens on that
  // customer's page; WareCore's website stays on www.warecore.space.
  const slug = isMultiTenant() ? await currentTenantSlug().catch(() => null) : null
  if (slug) return <CustomerHome brand={await getBrand()} images={customerHomeImages(slug)} />

  return (
    <div className="min-h-screen bg-white">
      <WebsiteHeader />
      <WebsiteHomePage />
      <WebsiteFooter />
    </div>
  )
}
