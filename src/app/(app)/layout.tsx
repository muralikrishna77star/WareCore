'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { APP_VERSION } from '@/lib/version'
import { RecordPreviewProvider } from '@/components/RecordPreviewProvider'
import { Copilot } from '@/components/ai/Copilot'

type NavItem = {
  title: string
  href: string
  icon: string
}

const navItems: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/dashboard',
    icon: '📊',
  },
  {
    title: 'Admin',
    href: '/admin',
    icon: '⚙️',
  },
  {
    title: 'Backup & Restore',
    href: '/admin/backups',
    icon: '🗄️',
  },
  {
    title: 'Purchase Entry',
    href: '/bills',
    icon: '📋',
  },
  {
    title: 'Purchase Cancellations',
    href: '/purchase-cancellations',
    icon: '🗑️',
  },
  {
    title: 'Accounts',
    href: '/accounts',
    icon: '💰',
  },
  {
    title: 'Inventory',
    href: '/inventory',
    icon: '📦',
  },
  {
    title: 'Movements',
    href: '/movements',
    icon: '🔄',
  },
  {
    title: 'Transfers',
    href: '/transfers',
    icon: '↔️',
  },
  {
    title: 'Job Work',
    href: '/jobwork',
    icon: '🏭',
  },
  {
    title: 'Job Work Cancellations',
    href: '/jobwork-cancellations',
    icon: '🗑️',
  },
  {
    title: 'Sale Entry',
    href: '/dispatch',
    icon: '🧾',
  },
  {
    title: 'Sale Cancellations',
    href: '/sale-cancellations',
    icon: '🗑️',
  },
  {
    title: 'Reports',
    href: '/reports',
    icon: '📈',
  },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [isDesktop, setIsDesktop] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  const handleSignOut = async () => {
    await fetch('/api/auth/login', { method: 'DELETE' })
    router.push('/login')
    router.refresh()
  }

  useEffect(() => {
    const loadSession = async () => {
      try {
        const res = await fetch('/api/auth/session')
        if (!res.ok) return
        const data = await res.json()
        setUserEmail(data.email || '')
      } catch (error) {
        console.error('Session fetch failed', error)
      }
    }
    loadSession()
  }, [])

  useEffect(() => {
    fetch('/api/desktop/status')
      .then((res) => res.json())
      .then((data) => setIsDesktop(!!data.isDesktop))
      .catch(() => {})
  }, [])

  return (
    // DesktopTitleBar (src/components/DesktopTitleBar.tsx) is `fixed` and
    // reserves its own 2.5rem via body padding-top — subtract that here too,
    // so this shell's "fill the viewport, scroll only inside <main>" sizing
    // doesn't overflow the window by the title bar's height on desktop.
    <RecordPreviewProvider>
    <div className={cn('flex overflow-hidden bg-gray-100', isDesktop ? 'h-[calc(100vh-2.5rem)]' : 'h-screen')}>
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black bg-opacity-50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-gray-900 transform transition-transform duration-200 ease-in-out lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          isDesktop && 'border-r-2 border-cyan-600/40'
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between px-6 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">W</span>
            </div>
            <span className="text-white font-bold text-lg">WareCore</span>
          </div>
          <button
            className="text-gray-400 hover:text-white lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            ✕
          </button>
        </div>

        {/* Navigation */}
        <nav className="mt-4 px-3 space-y-1 overflow-y-auto h-[calc(100vh-10rem)]">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                )}
              >
                <span className="text-base">{item.icon}</span>
                {item.title}
              </Link>
            )
          })}
        </nav>

        {/* Version footer */}
        <div className="absolute bottom-0 left-0 right-0 px-4 py-3 border-t border-gray-800 bg-gray-900">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">WareCore WMS</span>
            <span className="inline-flex items-center rounded bg-gray-800 border border-gray-700 px-2 py-0.5 text-[10px] font-mono text-gray-400">
              v{APP_VERSION}
            </span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header */}
        <header className={cn('flex h-16 items-center justify-between bg-white px-6 shadow-sm border-b', isDesktop && 'border-b-2 border-cyan-100')}>
          <button
            className="text-gray-500 hover:text-gray-700 lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <span className="sr-only">Open menu</span>
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="flex items-center gap-4 ml-auto relative">
            <span className="hidden sm:inline-flex items-center rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-xs font-mono font-medium text-blue-600">
              v{APP_VERSION}
            </span>
            <Link
              href="/"
              className="text-sm text-gray-500 hover:text-blue-600 transition-colors"
              target="_blank"
            >
              View Website →
            </Link>
            <div className="relative">
              <button
                type="button"
                onClick={() => setProfileOpen((prev) => !prev)}
                className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50 transition-colors"
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white text-sm font-semibold">
                  {userEmail ? userEmail.charAt(0).toUpperCase() : 'U'}
                </span>
                <span className="hidden sm:inline-flex truncate max-w-[10rem]">{userEmail || 'User Profile'}</span>
              </button>
              {profileOpen && (
                <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-semibold text-gray-900">Signed in as</p>
                    <p className="truncate text-sm text-gray-600">{userEmail || 'Unknown user'}</p>
                  </div>
                  <div className="flex flex-col gap-1 p-2">
                    <Link
                      href="/profile"
                      onClick={() => setProfileOpen(false)}
                      className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <span>🔑</span>
                      Change Password
                    </Link>
                    <button
                      type="button"
                      onClick={async () => {
                        setProfileOpen(false)
                        await handleSignOut()
                      }}
                      className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 text-left"
                    >
                      <span>🚪</span>
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 pb-20 lg:pb-6">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 lg:hidden print:hidden">
        <div className="grid grid-cols-5 h-16">
          {[
            { href: '/dashboard', icon: '📊', label: 'Dashboard' },
            { href: '/bills/new', icon: '📋', label: 'Bill' },
            { href: '/dispatch/new', icon: '🚚', label: 'Dispatch' },
            { href: '/inventory', icon: '📦', label: 'Stock' },
            { href: '/reports', icon: '📈', label: 'Reports' },
          ].map((item) => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && item.href !== '/bills/new' && item.href !== '/dispatch/new' && pathname.startsWith(item.href.split('/new')[0] + '/'))
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors',
                  isActive ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'
                )}
              >
                <span className="text-xl leading-none">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>

      <Copilot />
    </div>
    </RecordPreviewProvider>
  )
}
