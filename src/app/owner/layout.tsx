import Link from 'next/link'
import { OwnerSignOut } from './OwnerSignOut'
import { currentOwner } from '@/lib/tenancy/ownerAuth'

export const metadata = { title: 'WareCore — Owner console' }
export const dynamic = 'force-dynamic'

/** The owner console (console.warecore.space): not part of any customer's app. */
export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const owner = await currentOwner()
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/owner" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- static local SVG */}
            <img src="/assets/brand/logo-mark.svg" alt="" className="h-7 w-7" />
            <span className="font-bold text-gray-900">WareCore</span>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Owner console</span>
          </Link>
          {owner && (
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <Link href="/owner" className="hover:text-gray-900">Customers</Link>
              <Link href="/owner/services" className="hover:text-gray-900">Services &amp; costs</Link>
              <span className="hidden sm:inline">{owner.fullName}</span>
              <OwnerSignOut />
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}
