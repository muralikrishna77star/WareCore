'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, Settings, DatabaseBackup, ShieldCheck, ClipboardList, Undo2,
  Wallet, Package, RefreshCw, ArrowLeftRight, Factory, Shuffle, Receipt,
  ChartColumn, Truck, KeyRound, LogOut, Search, X, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { APP_VERSION } from '@/lib/version'
import { RecordPreviewProvider } from '@/components/RecordPreviewProvider'
import { Copilot } from '@/components/ai/Copilot'
import { DashboardViewProvider, useDashboardView } from '@/components/DashboardViewProvider'
import { DashboardViewToggle } from '@/components/DashboardViewToggle'
import type { DashboardView } from '@/lib/dashboardViewPreference'

// Chrome styling per dashboard view — same links, hrefs, labels, icons and
// active-route logic everywhere; only these class strings change.
const CHROME: Record<
  DashboardView,
  {
    sidebarBg: string
    navItemBase: string
    navItemActive: string
    navItemInactive: string
    headerClass: string
    mobileNavBg: string
    mobileNavActive: string
    mobileNavInactive: string
  }
> = {
  classic: {
    sidebarBg: 'bg-slate-800',
    navItemBase:
      'flex items-center gap-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors border-l-4 border-transparent',
    navItemActive: 'border-blue-400 bg-slate-700/70 text-white',
    navItemInactive: 'text-gray-300 hover:bg-slate-700/40 hover:text-white',
    headerClass: 'h-14 bg-white shadow-none border-b-2 border-slate-300',
    mobileNavBg: 'bg-slate-50 border-t-2 border-slate-300',
    mobileNavActive: 'text-blue-700 font-semibold',
    mobileNavInactive: 'text-slate-500 hover:text-slate-800',
  },
  modern: {
    sidebarBg: 'bg-gradient-to-b from-slate-900 to-blue-950',
    navItemBase: 'flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors',
    navItemActive: 'bg-blue-600 text-white shadow-md shadow-blue-950/40',
    navItemInactive: 'text-gray-300 hover:bg-white/10 hover:text-white',
    headerClass: 'h-16 bg-white shadow-md border-b border-blue-100',
    mobileNavBg: 'bg-white shadow-[0_-4px_16px_rgba(15,23,42,0.08)]',
    mobileNavActive: 'text-blue-700',
    mobileNavInactive: 'text-gray-500 hover:text-gray-900',
  },
}

type NavItem = {
  title: string
  href: string
  icon: LucideIcon
}

const navItems: NavItem[] = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { title: 'Admin', href: '/admin', icon: Settings },
  { title: 'Backup & Restore', href: '/admin/backups', icon: DatabaseBackup },
  { title: 'Data Integrity', href: '/data-integrity', icon: ShieldCheck },
  { title: 'Purchase Entry', href: '/bills', icon: ClipboardList },
  { title: 'Purchase Cancellations', href: '/purchase-cancellations', icon: Undo2 },
  { title: 'Accounts', href: '/accounts', icon: Wallet },
  { title: 'Inventory', href: '/inventory', icon: Package },
  { title: 'Movements', href: '/movements', icon: RefreshCw },
  { title: 'Transfers', href: '/transfers', icon: ArrowLeftRight },
  { title: 'Job Work', href: '/jobwork', icon: Factory },
  { title: 'Job Work Transfers', href: '/jobwork-transfers', icon: Shuffle },
  { title: 'Job Work Cancellations', href: '/jobwork-cancellations', icon: Undo2 },
  { title: 'Sale Entry', href: '/dispatch', icon: Receipt },
  { title: 'Sale Cancellations', href: '/sale-cancellations', icon: Undo2 },
  { title: 'Reports', href: '/reports', icon: ChartColumn },
]

const MOBILE_NAV_ITEMS: { href: string; icon: LucideIcon; label: string }[] = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/bills/new', icon: ClipboardList, label: 'Bill' },
  { href: '/dispatch/new', icon: Truck, label: 'Dispatch' },
  { href: '/inventory', icon: Package, label: 'Stock' },
  { href: '/reports', icon: ChartColumn, label: 'Reports' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardViewProvider>
      <AppLayoutShell>{children}</AppLayoutShell>
    </DashboardViewProvider>
  )
}

function AppLayoutShell({ children }: { children: React.ReactNode }) {
  const { view } = useDashboardView()
  const chrome = CHROME[view]
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [isDesktop, setIsDesktop] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  // Quick page search — Modern header only. Filters the real sidebar nav
  // list; does not search records (items/bills/vendors), since that would
  // need its own query wiring. Cmd/Ctrl+K focuses it, matching the visible hint.
  const [navQuery, setNavQuery] = useState('')
  const [navSearchOpen, setNavSearchOpen] = useState(false)
  const navSearchRef = useRef<HTMLInputElement>(null)
  const navMatches = navQuery.trim()
    ? navItems.filter((item) => item.title.toLowerCase().includes(navQuery.trim().toLowerCase()))
    : []

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        navSearchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const goToNavMatch = (item: NavItem) => {
    router.push(item.href)
    setNavQuery('')
    setNavSearchOpen(false)
    navSearchRef.current?.blur()
  }

  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

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
          'fixed inset-y-0 left-0 z-50 w-64 transform transition-[transform,background-color] duration-200 ease-in-out lg:static lg:translate-x-0',
          chrome.sidebarBg,
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
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Appearance toggle — also reachable via the header on sm+ screens;
            shown here too so it's reachable from the mobile drawer. */}
        <div className="px-6 py-3 sm:hidden">
          <DashboardViewToggle />
        </div>

        {/* Navigation */}
        <nav className="mt-4 px-3 space-y-1 overflow-y-auto h-[calc(100vh-10rem)]">
          {view === 'modern' && (
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500">Workspace</p>
          )}
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(chrome.navItemBase, isActive ? chrome.navItemActive : chrome.navItemInactive)}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
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
        <header className={cn('flex items-center gap-4 px-6', chrome.headerClass, isDesktop && 'border-b-2 border-cyan-100')}>
          <button
            className="text-gray-500 hover:text-gray-700 lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <span className="sr-only">Open menu</span>
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {view === 'modern' && (
            <div className="relative hidden md:block w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                ref={navSearchRef}
                type="text"
                value={navQuery}
                onChange={(e) => { setNavQuery(e.target.value); setNavSearchOpen(true) }}
                onFocus={() => setNavSearchOpen(true)}
                onBlur={() => setTimeout(() => setNavSearchOpen(false), 100)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && navMatches.length > 0) goToNavMatch(navMatches[0])
                  if (e.key === 'Escape') { setNavQuery(''); setNavSearchOpen(false) }
                }}
                placeholder="Jump to a page..."
                className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-14 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:outline-none"
              />
              {!navQuery && (
                <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-mono text-gray-400">
                  ⌘K
                </kbd>
              )}
              {navQuery && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setNavQuery(''); navSearchRef.current?.focus() }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              {navSearchOpen && navQuery && (
                <div className="absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  {navMatches.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-gray-500">No matching pages</p>
                  ) : (
                    navMatches.map((item) => {
                      const Icon = item.icon
                      return (
                        <button
                          key={item.href}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => goToNavMatch(item)}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700"
                        >
                          <Icon className="h-4 w-4 shrink-0 text-gray-400" />
                          {item.title}
                        </button>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-4 ml-auto relative">
            <div className="hidden sm:block">
              <DashboardViewToggle />
            </div>
            {view === 'modern' && (
              <span className="hidden sm:inline text-xs font-mono text-gray-400">{today}</span>
            )}
            <span className="hidden sm:inline-flex items-center rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-xs font-mono font-medium text-blue-600">
              v{APP_VERSION}
            </span>
            <Link
              href="/"
              className="hidden lg:inline text-sm text-gray-500 hover:text-blue-600 transition-colors whitespace-nowrap"
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
                      <KeyRound className="h-4 w-4" />
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
                      <LogOut className="h-4 w-4" />
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
      <nav className={cn('fixed bottom-0 left-0 right-0 z-40 lg:hidden print:hidden', chrome.mobileNavBg)}>
        <div className="grid grid-cols-5 h-16">
          {MOBILE_NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && item.href !== '/bills/new' && item.href !== '/dispatch/new' && pathname.startsWith(item.href.split('/new')[0] + '/'))
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors',
                  isActive ? chrome.mobileNavActive : chrome.mobileNavInactive
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={2} />
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
