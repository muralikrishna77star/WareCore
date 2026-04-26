'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

const navItems = [
  {
    title: 'Dashboard',
    href: '/dashboard',
    icon: '📊',
  },
  {
    title: 'Bill Entry',
    href: '/bills',
    icon: '📋',
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
    title: 'Sale Entry',
    href: '/dispatch',
    icon: '🧾',
  },
  {
    title: 'Reports',
    href: '/reports',
    icon: '📈',
  },
  {
    title: 'Admin',
    href: '/admin',
    icon: '⚙️',
  },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  const handleSignOut = async () => {
    await fetch('/api/auth/login', { method: 'DELETE' })
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
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
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
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
        <nav className="mt-4 px-3 space-y-1 overflow-y-auto h-[calc(100vh-8rem)]">
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

        {/* Sign out */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-800 space-y-1">
          <Link
            href="/profile"
            className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <span>🔑</span>
            Change Password
          </Link>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <span>🚪</span>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header */}
        <header className="flex h-16 items-center justify-between bg-white px-6 shadow-sm border-b">
          <button
            className="text-gray-500 hover:text-gray-700 lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <span className="sr-only">Open menu</span>
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="flex items-center gap-4 ml-auto">
            <Link
              href="/"
              className="text-sm text-gray-500 hover:text-blue-600 transition-colors"
              target="_blank"
            >
              View Website →
            </Link>
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
    </div>
  )
}
