import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { CAN_VIEW } from '@/lib/dataIntegrity/auth'

const TABS = [
  { href: '/data-integrity', label: 'Dashboard' },
  { href: '/data-integrity/runs', label: 'Reconciliation Runs' },
  { href: '/data-integrity/exceptions', label: 'Exception Workbench' },
  { href: '/data-integrity/rules', label: 'Rule Catalogue' },
]

export default async function DataIntegrityLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  const session = token ? verifySession(token) : null
  if (!session || !CAN_VIEW.has(session.role)) redirect('/dashboard')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Data Integrity &amp; Reconciliation Control Centre</h1>
        <p className="mt-1 text-sm text-gray-500">
          Detect, explain, and track warehouse-data inconsistencies. Read-only — no scan here ever changes stock.
        </p>
      </div>
      <div className="border-b border-gray-200">
        <nav className="flex gap-6 -mb-px">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="whitespace-nowrap border-b-2 border-transparent px-1 py-3 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700"
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  )
}
